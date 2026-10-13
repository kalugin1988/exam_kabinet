'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test, after } = require('node:test');

// Unit tests have their own application copy and database under ./data/.
// Retain the fixture for inspection; never remove or reset the user's database.
const APP_DIR = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(APP_DIR, 'data', 'test-runs', `unit-${randomUUID()}`, 'app');
fs.mkdirSync(path.join(FIXTURE_DIR, 'src'), { recursive: true, mode: 0o700 });
fs.copyFileSync(path.join(APP_DIR, 'bd.js'), path.join(FIXTURE_DIR, 'bd.js'));
fs.copyFileSync(path.join(APP_DIR, 'src', 'database.js'), path.join(FIXTURE_DIR, 'src', 'database.js'));
const storage = require(path.join(FIXTURE_DIR, 'src', 'database'));
const cabinet = require(path.join(FIXTURE_DIR, 'bd'));

after(async () => {
  await storage.close();
});

test('storage stays under the application data directory', () => {
  assert.equal(storage.DATA_DIR, path.join(FIXTURE_DIR, 'data'));
  assert.equal(path.dirname(storage.databasePath), storage.DATA_DIR);
});

test('SQL parameters are bound safely, including repeats and different order', async () => {
  const dangerousText = "Иванов'); DROP TABLE Ученики; --";
  const result = await storage.pool.query('SELECT $2 AS second, $1 AS first, $2 AS repeated', [dangerousText, 42]);
  assert.deepEqual(result.rows, [{ second: 42, first: dangerousText, repeated: 42 }]);
  const literal = await storage.pool.query("SELECT '$1' AS literal, $1 AS value -- $2\n", ['safe']);
  assert.deepEqual(literal.rows, [{ literal: '$1', value: 'safe' }]);
  await assert.rejects(storage.pool.query('SELECT $2', [1]), /Missing SQL parameter/);
});

test('Russian searches match either letter case', async () => {
  const result = await storage.pool.query('SELECT lower_ru($1) LIKE lower_ru($2) AS matched', ['ИванОВ', '%иванов%']);
  assert.equal(result.rows[0].matched, 1);
});

test('a failed transaction rolls back real schema and row changes', async () => {
  const tableName = `test_rollback_${process.pid}`;
  await assert.rejects(storage.transaction(async tx => {
    const schema = await tx.query(`CREATE TABLE ${storage.quoteIdentifier(tableName)} (id INTEGER PRIMARY KEY, value TEXT)`);
    assert.equal(schema.rowCount, 0);
    const inserted = await tx.query(`INSERT INTO ${storage.quoteIdentifier(tableName)} (id, value) VALUES ($1, $2)`, [1, 'original']);
    assert.equal(inserted.rowCount, 1);
    await tx.query(`INSERT INTO ${storage.quoteIdentifier(tableName)} (id, value) VALUES ($1, $2)`, [1, 'duplicate']);
  }), /UNIQUE constraint/);
  assert.equal(await storage.tableExists(tableName), false);
});

test('queries from another request wait for the complete atomic transaction', async () => {
  const events = [];
  let announceStarted;
  const started = new Promise(resolve => { announceStarted = resolve; });
  let releaseTransaction;
  const continueTransaction = new Promise(resolve => { releaseTransaction = resolve; });
  const first = storage.transaction(async tx => {
    events.push('begin');
    announceStarted();
    await continueTransaction;
    await tx.query('SELECT 1');
    events.push('end');
  });
  await started;
  const second = storage.pool.query('SELECT 2').then(() => events.push('second request'));
  await Promise.resolve();
  assert.deepEqual(events, ['begin']);
  releaseTransaction();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['begin', 'end', 'second request']);
});

test('restart initialization preserves seats, block status and JSON layouts', async () => {
  await cabinet.initializeDatabase();
  const roomNumber = 900000000 + (process.pid % 99999999);
  const sentinel = new Error('Roll back the test fixture');
  await assert.rejects(storage.transaction(async () => {
    const room = await cabinet.createClassroom(roomNumber, 3, 2, 1);
    await cabinet.createClassroomTable(roomNumber);
    const places = await cabinet.getClassroomPlaces(roomNumber);
    assert.equal(places.length, 6);
    assert.equal(places[0].заблокировано, false);
    await cabinet.updatePlaceBlockStatus(roomNumber, '1А', true);
    const mapping = { 1: { desks: 2 }, 2: { desks: 1 } };
    await cabinet.updateClassroomLayout(room.id, mapping);
    await cabinet.initializeDatabase();
    await cabinet.initializeExistingClassroomTables();
    assert.deepEqual(await cabinet.getBlockedPlaces(roomNumber), ['1А']);
    assert.deepEqual(await cabinet.getClassroomLayout(room.id), mapping);
    const metadata = await storage.pool.query("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)", [`kabinet_${roomNumber}`]);
    assert.equal(metadata.rows[0].exists, true);
    const columns = await storage.getTableColumns(`kabinet_${roomNumber}`);
    assert.ok(columns.some(column => column.name === 'заблокировано'));
    throw sentinel;
  }), error => error === sentinel);
  assert.equal(await storage.tableExists(`kabinet_${roomNumber}`), false);
});
