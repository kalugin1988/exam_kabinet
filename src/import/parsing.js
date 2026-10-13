const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const xlsx = require('xlsx');
const { transaction, quoteIdentifier } = require('../database');

const MAX_ROWS = 100000;
const MAX_SHEETS = 100;
const MAX_COLUMNS = 100;
const MAX_CELL_LENGTH = 10000;

class ImportError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'ImportError';
    this.status = status;
  }
}

function text(value) {
  const result = value === undefined || value === null ? '' : String(value).trim();
  if (result.length > MAX_CELL_LENGTH) {
    throw new ImportError(`Значение ячейки превышает ${MAX_CELL_LENGTH} символов.`);
  }
  return result;
}

function parseFIO(value) {
  const parts = text(value).split(/\s+/).filter(Boolean);
  return { surname: parts[0] || '', name: parts[1] || '', patronymic: parts.slice(2).join(' ') };
}

function createSafeTableName(sheetName, prefix = 'scan') {
  const maxLength = prefix === 'participants' ? 30 : 50;
  const name = String(sheetName).replace(/[^a-zA-Z0-9а-яА-ЯёЁ_]/g, '_')
    .replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, maxLength) || 'sheet';
  return `${prefix}_${name}`;
}

function generateParticipantsTableName(sheetName) {
  return createSafeTableName(sheetName, 'participants');
}

function readSheets(filePath, prefix) {
  let workbook;
  try {
    if (path.extname(filePath).toLowerCase() === '.csv') {
      const contents = fs.readFileSync(filePath);
      let source;
      if (contents[0] === 0xff && contents[1] === 0xfe) {
        source = new TextDecoder('utf-16le', { fatal: true }).decode(contents);
      } else if (contents[0] === 0xfe && contents[1] === 0xff) {
        source = new TextDecoder('utf-16be', { fatal: true }).decode(contents);
      } else {
        try {
          source = new TextDecoder('utf-8', { fatal: true }).decode(contents);
        } catch (error) {
          source = new TextDecoder('windows-1251').decode(contents);
        }
      }
      // Parsing decoded text avoids SheetJS's default ANSI interpretation of
      // CSV files without a BOM; raw mode also keeps leading zeros in codes.
      workbook = xlsx.read(source, { type: 'string', raw: true, cellFormula: false });
    } else {
      workbook = xlsx.readFile(filePath, { cellDates: false, cellFormula: false });
    }
  } catch (error) {
    throw new ImportError('Не удалось прочитать таблицу. Проверьте формат и целостность файла.');
  }
  if (!workbook.SheetNames.length || workbook.SheetNames.length > MAX_SHEETS) {
    throw new ImportError(`Файл должен содержать от 1 до ${MAX_SHEETS} листов.`);
  }
  const usedNames = new Set();
  let totalRows = 0;
  return workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    if (worksheet['!ref']) {
      const range = xlsx.utils.decode_range(worksheet['!ref']);
      const rowCount = range.e.r + 1;
      if (rowCount > MAX_ROWS + 1 || range.e.c + 1 > MAX_COLUMNS) {
        throw new ImportError(`Лист «${sheetName}» превышает лимит ${MAX_ROWS} строк или ${MAX_COLUMNS} столбцов.`);
      }
      totalRows += rowCount;
      if (totalRows > MAX_ROWS + MAX_SHEETS) {
        throw new ImportError(`Общий лимит файла — ${MAX_ROWS} строк данных.`);
      }
    }
    const data = xlsx.utils.sheet_to_json(worksheet, {
      header: 1, raw: false, defval: '', blankrows: false, dateNF: 'dd.mm.yyyy'
    });
    const baseName = createSafeTableName(sheetName, prefix);
    let tableName = baseName;
    if (usedNames.has(tableName.toLowerCase())) {
      const suffix = crypto.createHash('sha256').update(sheetName).digest('hex').slice(0, 8);
      tableName = `${baseName}_${suffix}`;
      let counter = 1;
      while (usedNames.has(tableName.toLowerCase())) tableName = `${baseName}_${suffix}_${counter++}`;
    }
    usedNames.add(tableName.toLowerCase());
    return { sheetName, tableName, data };
  });
}

const SCAN_COLUMNS = [
  'participant_number', 'date', 'subject', 'class', 'participant_code',
  'scan_status', 'pages_count', 'full_name', 'link', 'last_name', 'first_name', 'middle_name'
];
const OLD_STUDENT_COLUMNS = [
  'number', 'surname', 'name', 'patronymic', 'gender', 'birth_date', 'doc_type',
  'doc_series', 'doc_number', 'snils', 'ovz', 'school_code', 'school_name',
  'parallel', 'letter', 'subgroup', 'ate', 'platform', 'assignments'
];
const OLD_PARTICIPANT_COLUMNS = [
  'number', 'fio', 'surname', 'name', 'patronymic', 'school_code',
  'class', 'letter', 'subject', 'parallel', 'platform'
];
const NEW_PARTICIPANT_COLUMNS = [
  'platform', 'subject', 'school_code', 'class', 'parallel', 'letter',
  'surname', 'name', 'patronymic', 'fio', 'work_code'
];

function insertSql(tableName, columns) {
  return `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(', ')})
    VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`;
}

async function replaceSheets(plans) {
  try {
    await transaction(async (tx) => {
      try {
        for (const plan of plans) {
          if (!plan.rows.length) continue;
          const table = quoteIdentifier(plan.tableName);
          // Replace only the imported sheets, and commit all sheets together.
          // Invalid or failed imports keep the previously stored dataset intact.
          await tx.query(`DROP TABLE IF EXISTS ${table}`);
          await tx.query(`CREATE TABLE ${table} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ${plan.columns.map((column) => `${quoteIdentifier(column)} TEXT`).join(',\n')},
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`);
          const sql = insertSql(plan.tableName, plan.columns);
          for (const row of plan.rows) await tx.query(sql, row);
        }
      } catch (error) {
        throw error;
      }
    });
  } catch (error) {
    throw error;
  }
}

function requireRecords(plans) {
  if (!plans.some((plan) => plan.rows.length)) {
    throw new ImportError('В файле нет записей для импорта. Проверьте заголовки и строки данных.');
  }
}

async function parseScanFile(filePath) {
  try {
    const plans = readSheets(filePath, 'scan').map(({ sheetName, tableName, data }) => {
      if (data.length > 1 && data[0].length < 8) {
        throw new ImportError(`В листе «${sheetName}» ожидаются 9 столбцов: номер, дата, предмет, класс, код участника, статус скана, страницы, ФИО и ссылка.`);
      }
      const rows = data.slice(1).map((row) => {
        const values = Array.from({ length: 9 }, (_, index) => text(row[index]));
        const fio = parseFIO(values[7]);
        return values.concat(fio.surname, fio.name, fio.patronymic);
      }).filter((row) => row[0] || row[7]);
      return { sheetName, tableName, columns: SCAN_COLUMNS, rows, totalRows: Math.max(0, data.length - 1) };
    });
    requireRecords(plans);
    await replaceSheets(plans);
    const totalRecords = plans.reduce((sum, plan) => sum + plan.rows.length, 0);
    return {
      success: true, processedSheets: plans.length, totalRecords,
      results: plans.map((plan) => ({
        sheetName: plan.sheetName, tableName: plan.tableName, records: plan.rows.length,
        totalRows: plan.totalRows, errors: 0, status: plan.rows.length ? 'success' : 'empty'
      })),
      message: `Загружено ${totalRecords} записей сканов из ${plans.length} листов.`
    };
  } catch (error) {
    throw error;
  }
}

function mapHeadersToIndexes(headers) {
  const map = {};
  headers.forEach((header, index) => {
    const key = text(header).toLowerCase().replace(/\s+/g, ' ');
    if (key === 'platform' || key.includes('код места проведения')) map.platform = index;
    else if (key === 'subject' || key.includes('предмет')) map.subject = index;
    else if (key === 'school_code' || key.includes('код оо')) map.school_code = index;
    else if (key === 'patronymic' || key.includes('отчество')) map.patronymic = index;
    else if (key === 'surname' || key === 'last_name' || key.includes('фамилия')) map.surname = index;
    else if (key === 'name' || key === 'first_name' || /^имя(?:\s|$)/.test(key)) map.name = index;
    else if (key === 'fio' || key === 'full_name' || /^фио(?:\s|$)/.test(key)) map.fio = index;
    else if (key === 'work_code' || key.includes('код работы') || key.includes('код участника') || key === 'participant_code') map.work_code = index;
    else if (key === '0' || key === 'letter' || key.includes('буква')) map.letter = index;
    else if (key === 'class' || key === 'parallel' || key.includes('класс')) map.class = index;
  });
  return map;
}

function prepareNewParticipantsRowData(row, headerMap) {
  const get = (key) => text(headerMap[key] === undefined ? '' : row[headerMap[key]]);
  const split = parseFIO(get('fio'));
  const surname = get('surname') || split.surname;
  const name = get('name') || split.name;
  const patronymic = get('patronymic') || split.patronymic;
  return [get('platform'), get('subject'), get('school_code'), get('class'), get('class'),
    get('letter'), surname, name, patronymic, [surname, name, patronymic].filter(Boolean).join(' '), get('work_code')];
}

async function parseParticipants(filePath, newFormat) {
  try {
    const plans = readSheets(filePath, 'participants').map(({ sheetName, tableName, data }) => {
      const isStudents = sheetName.trim() === 'Учащиеся (МЭ)';
      const columns = newFormat ? NEW_PARTICIPANT_COLUMNS : isStudents ? OLD_STUDENT_COLUMNS : OLD_PARTICIPANT_COLUMNS;
      let headerMap;
      if (newFormat && data.length > 1) {
        headerMap = mapHeadersToIndexes(data[0]);
        if (headerMap.surname === undefined && headerMap.name === undefined && headerMap.fio === undefined) {
          throw new ImportError(`Лист «${sheetName}»: в новом формате нужны заголовки «Фамилия», «Имя» или «ФИО».`);
        }
      } else if (!newFormat && data.length > 1 && data[0].length < (isStudents ? 14 : 4)) {
        throw new ImportError(`Лист «${sheetName}» не соответствует старому формату участников.`);
      }
      const rows = data.slice(1).filter((row) => row.some((cell) => text(cell))).map((row) => {
        if (newFormat) return prepareNewParticipantsRowData(row, headerMap);
        if (isStudents) return columns.map((_, index) => text(row[index]));
        const values = Array.from({ length: 8 }, (_, index) => text(row[index]));
        const fio = parseFIO(values[1]);
        return [values[0], values[1], fio.surname, fio.name, fio.patronymic,
          values[2], values[3], values[4], values[5], values[6] || values[3], values[7]];
      }).filter((row) => newFormat ? row[6] || row[7] : isStudents ? row[1] || row[2] : row[1]);
      return { sheetName, tableName, columns, rows };
    });
    requireRecords(plans);
    await replaceSheets(plans);
    return {
      success: true, message: `Файл ${newFormat ? 'нового' : 'старого'} формата успешно обработан.`,
      totalRecords: plans.reduce((sum, plan) => sum + plan.rows.length, 0),
      sheets: plans.map((plan) => ({
        sheetName: plan.sheetName, tableName: plan.rows.length ? plan.tableName : null,
        rowCount: plan.rows.length, ...(plan.rows.length ? {} : { error: 'Лист пустой или содержит только заголовки' })
      }))
    };
  } catch (error) {
    throw error;
  }
}

async function parseParticipantsFile(filePath) {
  try {
    return await parseParticipants(filePath, false);
  } catch (error) {
    throw error;
  }
}

async function parseNewParticipantsFile(filePath) {
  try {
    return await parseParticipants(filePath, true);
  } catch (error) {
    throw error;
  }
}

async function parseOOFile(filePath) {
  try {
    const firstSheet = readSheets(filePath, 'oo')[0];
    if (firstSheet.data.length < 2 || firstSheet.data[0].length < 4) {
      throw new ImportError('В файле ОО нужны заголовки и строки: код ОМСУ, код ОО, номер, наименование; полное наименование можно добавить пятым столбцом.');
    }
    const rows = firstSheet.data.slice(1).map((row) => Array.from({ length: 5 }, (_, index) => text(row[index])))
      .filter((row) => row.some(Boolean));
    if (!rows.length) throw new ImportError('В файле нет образовательных учреждений.');
    for (const row of rows) {
      if (!row[3] && !row[4]) throw new ImportError('Для каждого учреждения требуется наименование.');
      row[4] ||= row[3];
      if (row.some((value, index) => value.length > (index < 3 ? 50 : 500))) {
        throw new ImportError('Коды и номер учреждения должны быть не длиннее 50 символов, наименования — 500 символов.');
      }
    }
    let inserted = 0;
    let updated = 0;
    await transaction(async (tx) => {
      try {
        for (const row of rows) {
          const existing = row[1]
            ? await tx.query('SELECT id FROM oo WHERE code_oo = $1 ORDER BY id LIMIT 1', [row[1]])
            : await tx.query('SELECT id FROM oo WHERE code_omsu = $1 AND name_oo = $2 ORDER BY id LIMIT 1', [row[0], row[3]]);
          if (existing.rows.length) {
            await tx.query(`UPDATE oo SET code_omsu = $1, code_oo = $2, number_oo = $3,
              name_oo = $4, full_name = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6`, [...row, existing.rows[0].id]);
            updated++;
          } else {
            await tx.query('INSERT INTO oo (code_omsu, code_oo, number_oo, name_oo, full_name) VALUES ($1, $2, $3, $4, $5)', row);
            inserted++;
          }
          if (row[1]) {
            await tx.query(`INSERT INTO schools (code, name) VALUES ($1, $2)
              ON CONFLICT(code) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP`, [row[1], row[4]]);
          }
        }
      } catch (error) {
        throw error;
      }
    });
    return { success: true, processedRecords: rows.length, errorRecords: 0, inserted, updated,
      message: `Обработано ${rows.length} учреждений: добавлено ${inserted}, обновлено ${updated}.` };
  } catch (error) {
    throw error;
  }
}

module.exports = {
  ImportError, parseFIO, createSafeTableName, generateParticipantsTableName,
  mapHeadersToIndexes, parseScanFile, parseParticipantsFile, parseNewParticipantsFile, parseOOFile
};
