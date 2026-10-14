'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { DatabaseSync } = require('node:sqlite');

// Resolve from the application directory, so the storage location does not depend
// on the directory from which npm start was invoked.
const DATA_DIR = path.resolve(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const databasePath = path.join(DATA_DIR, 'exam.sqlite');
const database = new DatabaseSync(databasePath);
fs.chmodSync(databasePath, 0o600);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);
database.function('lower_ru', { deterministic: true }, value => String(value ?? '').toLocaleLowerCase('ru-RU'));

const transactionContext = new AsyncLocalStorage();
let pending = Promise.resolve();
let closed = false;

function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string' || !identifier || identifier.includes('\0')) {
    throw new TypeError('Invalid SQL identifier');
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

// These are the PostgreSQL expressions used by the existing cabinet modules.
// All metadata is read from SQLite itself; imported tables remain ordinary tables.
function normalizeSql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new TypeError('SQL query must be a nonempty string');
  }
  return sql
    .replace(/\bSERIAL\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/\bJSONB\b/gi, 'TEXT')
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/\bSELECT\s+FROM\s+information_schema\./gi, 'SELECT 1 FROM information_schema.')
    .replace(/\bFROM\s+information_schema\.tables\b/gi, `FROM (
      SELECT name AS table_name, 'public' AS table_schema
      FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    )`)
    .replace(/\bFROM\s+information_schema\.columns\b/gi, `FROM (
      SELECT tables.name AS table_name, columns.name AS column_name,
        columns.type AS data_type, columns.cid + 1 AS ordinal_position,
        'public' AS table_schema
      FROM sqlite_master AS tables JOIN pragma_table_info(tables.name) AS columns
      WHERE tables.type = 'table'
    )`)
    .replace(/\bSELECT\s+COUNT\(\*\)(?=\s+FROM\b)/gi, 'SELECT COUNT(*) AS count');
}

function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function normalizeRow(row) {
  const result = { ...row };
  for (const key of ['занято', 'заблокировано', 'exists']) {
    if (result[key] !== undefined && result[key] !== null) result[key] = Boolean(result[key]);
  }
  if (typeof result.row_mapping === 'string') result.row_mapping = JSON.parse(result.row_mapping);
  // PostgreSQL assigns this implicit name to SELECT EXISTS (...).
  for (const key of Object.keys(result)) {
    if (/^exists\s*\(/i.test(key)) {
      result.exists = Boolean(result[key]);
      delete result[key];
    }
  }
  return result;
}

function executeQuery(sql, params = []) {
  if (closed) throw new Error('Database connection is closed');
  if (!Array.isArray(params)) throw new TypeError('SQL parameters must be an array');
  const argumentsList = [];
  // Bind each occurrence separately: this also supports repeated $n parameters
  // without interpolating user values into SQL or binding unused parameters.
  const tokens = /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\/|\$(\d+)/g;
  const statementSql = normalizeSql(sql).replace(tokens, (token, number) => {
    if (number === undefined) return token;
    const index = Number(number) - 1;
    if (index < 0 || index >= params.length) throw new RangeError(`Missing SQL parameter $${number}`);
    argumentsList.push(normalizeValue(params[index]));
    return '?';
  });
  if (!argumentsList.length && params.length) argumentsList.push(...params.map(normalizeValue));
  const statement = database.prepare(statementSql);
  if (statement.columns().length) {
    const rows = statement.all(...argumentsList).map(normalizeRow);
    return { rows, rowCount: rows.length };
  }
  const result = statement.run(...argumentsList);
  // SQLite retains the preceding changes() value for DDL statements.
  const isMutation = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i.test(statementSql);
  return { rows: [], rowCount: isMutation ? Number(result.changes) : 0 };
}

function enqueue(operation) {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}

async function query(sql, params = []) {
  try {
    if (transactionContext.getStore()) return executeQuery(sql, params);
    return await enqueue(() => executeQuery(sql, params));
  } catch (error) {
    // Preserve the original SQLite error and make constraint failures useful to
    // the application's central HTTP error handler.
    if (/constraint failed/i.test(error.message)) error.status = 409;
    throw error;
  }
}

async function transaction(callback) {
  try {
    if (typeof callback !== 'function') throw new TypeError('Transaction callback is required');
    if (transactionContext.getStore()) {
      // Nested domain operations share the outer atomic transaction.
      return await callback({ query });
    }
    return await enqueue(async () => {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = await transactionContext.run(true, () => callback({ query }));
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof Error && !error.operation) error.operation = 'transaction';
    throw error;
  }
}

async function tableExists(tableName) {
  try {
    const result = await query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $1", [tableName]);
    return result.rowCount > 0;
  } catch (error) {
    throw error;
  }
}

async function getTableColumns(tableName) {
  try {
    const result = await query(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
    return result.rows;
  } catch (error) {
    throw error;
  }
}

async function close() {
  try {
    await enqueue(() => {
      if (!closed) {
        database.close();
        closed = true;
      }
    });
  } catch (error) {
    throw error;
  }
}

const pool = { query, transaction, end: close };

module.exports = {
  pool, database, DATA_DIR, databasePath, quoteIdentifier,
  tableExists, getTableColumns, transaction, close,
};
