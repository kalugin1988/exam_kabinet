'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const jwt = require('jsonwebtoken');
const xlsx = require('xlsx');

const APP_DIR = path.resolve(__dirname, '..');

async function availablePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function fixture({ generated = false } = {}) {
  // An independent app copy keeps every SQLite database and uploaded file under
  // the project's ./data/. Test runs are retained; no data directory is deleted.
  const directory = path.join(APP_DIR, 'data', 'test-runs', `integration-${randomUUID()}`, 'app');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  for (const entry of ['server.js', 'server_oo.js', 'server_print.js', 'package.json', 'bd.js', 'src', 'algorithms', 'public', 'views']) {
    await fs.cp(path.join(APP_DIR, entry), path.join(directory, entry), { recursive: true });
  }
  const configuration = {
    PORT: String(await availablePort()),
    NODE_ENV: 'test',
    COOKIE_SECURE: 'false',
  };
  if (!generated) {
    configuration.ADMIN_LOGIN = `test_${randomBytes(8).toString('hex')}`;
    configuration.ADMIN_PASSWORD = randomBytes(24).toString('base64url');
    configuration.JWT_SECRET = randomBytes(48).toString('base64url');
  }
  let child;
  let closed;
  let output = '';
  const privateValues = new Set();

  function rememberSecrets() {
    for (const key of ['ADMIN_PASSWORD', 'JWT_SECRET']) {
      if (configuration[key]) privateValues.add(configuration[key]);
    }
  }

  function diagnostic() {
    let safe = output.slice(-12000);
    for (const value of privateValues) safe = safe.replaceAll(value, '[redacted]');
    return safe;
  }

  async function saveConfiguration() {
    rememberSecrets();
    const content = Object.entries(configuration).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
    await fs.writeFile(path.join(directory, '.env'), content, { mode: 0o600 });
  }

  async function request(endpoint, { method = 'GET', token, cookie, json, headers = {}, body, redirect = 'manual' } = {}) {
    const requestHeaders = { ...headers };
    if (token) requestHeaders.authorization = `Bearer ${token}`;
    if (cookie) requestHeaders.cookie = cookie;
    if (json !== undefined) {
      requestHeaders['content-type'] = 'application/json';
      body = JSON.stringify(json);
    }
    return await fetch(`http://127.0.0.1:${configuration.PORT}${endpoint}`, {
      method, headers: requestHeaders, body, redirect, signal: AbortSignal.timeout(10000),
    });
  }

  async function start() {
    await saveConfiguration();
    const environment = { ...process.env };
    // A developer's existing bindings must never influence generated-admin tests.
    for (const key of ['ADMIN_LOGIN', 'ADMIN_PASSWORD', 'JWT_SECRET', 'PORT', 'NODE_ENV', 'COOKIE_SECURE']) delete environment[key];
    child = spawn('npm', ['start'], {
      cwd: directory, env: environment, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const current = child;
    closed = new Promise(resolve => {
      current.once('error', error => {
        output += `\n${error.message}`;
        resolve();
      });
      current.once('close', resolve);
    });
    current.stdout.on('data', bytes => { output += bytes.toString(); });
    current.stderr.on('data', bytes => { output += bytes.toString(); });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (current.exitCode !== null) throw new Error(`npm start exited before readiness.\n${diagnostic()}`);
      try {
        const response = await request('/health');
        if (response.status === 200 && (await response.json()).status === 'ok') return;
      } catch {
        // The readiness probe retries while Node opens the isolated SQLite DB.
      }
      await delay(100);
    }
    throw new Error(`npm start did not become ready.\n${diagnostic()}`);
  }

  async function stop() {
    if (!child || child.exitCode !== null) return;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    const stopped = await Promise.race([closed.then(() => true), delay(5000, undefined, { ref: false }).then(() => false)]);
    if (!stopped) {
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      await closed;
    }
    child = null;
  }

  async function json(endpoint, options, expectedStatus = 200) {
    const response = await request(endpoint, { ...options, headers: { accept: 'application/json', ...options?.headers } });
    assert.equal(response.status, expectedStatus, `${options?.method || 'GET'} ${endpoint}`);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    return await response.json();
  }

  async function login() {
    const response = await request('/api/auth/login', {
      method: 'POST', json: { login: configuration.ADMIN_LOGIN, password: configuration.ADMIN_PASSWORD },
    });
    assert.equal(response.status, 200, 'configured administrator can log in');
    const user = await response.json();
    assert.equal(user.user.login, configuration.ADMIN_LOGIN);
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie && /HttpOnly/i.test(setCookie), 'JWT is stored in an HttpOnly cookie');
    assert.match(setCookie, /SameSite=Strict/i);
    const cookie = setCookie.split(';')[0];
    const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    assert.equal(token.split('.').length, 3, 'session uses a JWT');
    privateValues.add(token);
    return { token, cookie };
  }

  async function upload(endpoint, rows, sheetName, token, filename = 'integration.xlsx') {
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(rows), sheetName);
    const bytes = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const form = new FormData();
    form.set('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
    return await request(endpoint, { method: 'POST', token, body: form });
  }

  function assertNoSecretLogging() {
    for (const value of privateValues) assert.ok(!output.includes(value), 'startup and requests must not log credentials or JWT secrets');
  }

  return { directory, configuration, request, json, login, upload, start, stop, saveConfiguration, assertNoSecretLogging, privateValues };
}

test('npm start serves one authenticated workflow: Excel import, seating, forms and persistent SQLite', { timeout: 120000 }, async t => {
  const app = await fixture();
  t.after(async () => {
    await app.stop();
    app.assertNoSecretLogging();
  });
  await app.start();
  let session;
  let room;
  let participantTable;
  let persistedStudents;
  const subject = 'Математика';

  await t.test('protected routes reject missing credentials, bad passwords and cross-site writes', async () => {
    for (const endpoint of ['/api/students', '/api/health', '/import/api/db-info', '/forms/api/options']) {
      const response = await app.json(endpoint, {}, 401);
      assert.equal(response.success, false);
    }
    for (const endpoint of ['/', '/seating', '/kabinet', '/oo', '/import', '/forms']) {
      const response = await app.request(endpoint);
      assert.equal(response.status, 302, endpoint);
      assert.ok(response.headers.get('location').startsWith('/login?'), endpoint);
    }
    assert.equal((await app.request('/login')).status, 200);
    await app.json('/api/auth/login', { method: 'POST', json: {} }, 400);
    await app.json('/api/auth/login', {
      method: 'POST', json: { login: app.configuration.ADMIN_LOGIN, password: 'incorrect_password' },
    }, 401);
    await app.json('/api/auth/login', {
      method: 'POST', headers: { origin: 'https://other.example' },
      json: { login: app.configuration.ADMIN_LOGIN, password: app.configuration.ADMIN_PASSWORD },
    }, 403);
    session = await app.login();
    const me = await app.json('/api/auth/me', { cookie: session.cookie });
    assert.equal(me.user.role, 'admin');
    await app.json('/api/not-a-route', { token: session.token }, 404);
    await app.json('/api/students', { token: 'not-a-jwt' }, 401);
    await app.json('/api/students', { cookie: 'exam_session=%zz' }, 401);
    const claims = jwt.decode(session.token);
    const expired = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 1 }, app.configuration.JWT_SECRET);
    assert.equal((await app.json('/api/students', { token: expired }, 401)).code, 'SESSION_EXPIRED');
    const forbidden = jwt.sign({ ...claims, role: 'viewer' }, app.configuration.JWT_SECRET);
    await app.json('/api/students', { token: forbidden }, 403);
    const expiredPage = await app.request('/seating', { token: expired });
    assert.equal(expiredPage.status, 302);
    assert.match(expiredPage.headers.get('location'), /reason=expired/);
    await app.json('/api/classrooms', {
      method: 'POST', token: session.token, headers: { 'sec-fetch-site': 'cross-site' }, json: {},
    }, 403);
  });

  await t.test('all import formats are available; invalid replacements preserve data', async () => {
    const institutions = await app.upload('/import/oo/load', [
      ['Код ОМСУ', 'Код ОО', 'Номер', 'Наименование', 'Полное наименование'],
      ['001', 'TEST-SCHOOL', '25', 'Школа интеграции', 'Школа для интеграционных проверок'],
    ], 'ОО', session.token);
    assert.equal(institutions.status, 200);
    assert.equal((await institutions.json()).processedRecords, 1);
    const participants = await app.upload('/import/participants/new/load', [
      ['Код места проведения', 'Предмет', 'Код ОО', 'Класс', 'Буква', 'Фамилия', 'Имя', 'Отчество', 'Код работы'],
      ['100', subject, 'TEST-SCHOOL', '9', 'А', 'Иванов', 'Иван', 'Иванович', 'TEST-WORK-01'],
      ['100', subject, 'TEST-SCHOOL', '9', 'А', 'Петрова', 'Анна', 'Петровна', 'TEST-WORK-02'],
      ['100', subject, 'TEST-SCHOOL', '10', 'А', 'Сидоров', 'Пётр', 'Андреевич', 'TEST-WORK-03'],
      ['100', subject, 'TEST-SCHOOL', '10', 'А', 'Смирнова', 'Мария', 'Сергеевна', 'TEST-WORK-04'],
    ], 'Участники', session.token);
    assert.equal(participants.status, 200);
    const result = await participants.json();
    assert.equal(result.totalRecords, 4);
    participantTable = result.sheets[0].tableName;
    const tablePath = `/import/participants/api/table/${encodeURIComponent(participantTable)}`;
    const original = await app.json(tablePath, { token: session.token });
    assert.equal(original.total, 4);
    const filtered = await app.json(`${tablePath}?surname=${encodeURIComponent('ИВАНОВ')}&limit=1`, { token: session.token });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.data[0].surname, 'Иванов');
    await app.json(`${tablePath}?unexpected_column=value`, { token: session.token }, 400);
    const invalid = await app.upload('/import/participants/new/load', [['Неверный заголовок'], ['Данные']], 'Участники', session.token);
    assert.equal(invalid.status, 422);
    assert.deepEqual((await app.json(tablePath, { token: session.token })).data, original.data);
    const old = await app.upload('/import/participants/load', [
      ['Номер', 'ФИО', 'Код ОО', 'Класс', 'Буква', 'Предмет', 'Параллель', 'Площадка'],
      ['1', 'Орлов Алексей Сергеевич', 'TEST-SCHOOL', '11', 'А', 'Физика', '11', '100'],
    ], 'Старый формат', session.token);
    assert.equal(old.status, 200);
    assert.equal((await old.json()).totalRecords, 1);
    const scans = await app.upload('/import/scan/load', [
      ['Номер', 'Дата', 'Предмет', 'Класс', 'Код участника', 'Статус', 'Страниц', 'ФИО', 'Ссылка'],
      ['1', '13.10.2026', subject, '9', 'TEST-WORK-01', 'Обработан', '2', 'Иванов Иван Иванович', 'https://example.org/scan'],
    ], 'Сканы', session.token);
    assert.equal(scans.status, 200);
    assert.equal((await scans.json()).totalRecords, 1);
    const scanData = await app.json(`/import/scan/api/data?filter=${encodeURIComponent('ИВАНОВ')}`, { token: session.token });
    assert.equal(scanData.tables[0].data.length, 1);
    const extension = await app.upload('/import/participants/new/load', [['ФИО'], ['Тестовый Ученик']], 'Ошибка', session.token, 'unsafe.exe');
    assert.equal(extension.status, 415);
    const imported = await app.json('/import/participants/api/import-students', {
      method: 'POST', token: session.token, json: { table: participantTable, subject },
    });
    assert.equal(imported.inserted, 4);
    const students = (await app.json('/api/students', { token: session.token })).students;
    assert.equal(students.length, 4);
    assert.ok(students.every(student => student.school_name_oo === 'Школа интеграции'));
    assert.deepEqual(students.map(student => student.participant_code).sort(), ['TEST-WORK-01', 'TEST-WORK-02', 'TEST-WORK-03', 'TEST-WORK-04']);
  });

  await t.test('seating respects blocked places; repeat participant imports preserve assignments', async () => {
    const created = await app.json('/api/classrooms', {
      method: 'POST', token: session.token,
      json: { номер_кабинета: 101, количество_парт: 4, количество_рядов_парт: 2, этаж: 1 },
    }, 201);
    room = created.classroom;
    await app.json(`/api/classrooms/${room.id}/block-place`, {
      method: 'PUT', token: session.token, json: { placeNumber: '1А', blocked: true },
    });
    await app.json(`/api/classrooms/${room.id}/layout`, {
      method: 'PUT', token: session.token, json: { row_mapping: { 1: { desks: 2 }, 2: { desks: 2 } } },
    });
    const generated = await app.json('/api/generate-seating', { method: 'POST', token: session.token, json: { subject } });
    assert.equal(generated.stats.seatingCount, 4);
    assert.equal(generated.unplacedStudents.length, 0);
    assert.ok(generated.seating.every(assignment => assignment.place !== '1А'));
    assert.equal(new Set(generated.seating.map(assignment => `${assignment.classroom}/${assignment.place}`)).size, 4);
    persistedStudents = (await app.json('/api/students', { token: session.token })).students;
    const repeated = await app.json('/import/participants/api/import-students', {
      method: 'POST', token: session.token, json: { table: participantTable, subject },
    });
    assert.equal(repeated.inserted, 0);
    assert.equal(repeated.updated, 4);
    const identityAndSeat = students => students.map(student => [student.id, student.номер_кабинета, student.номер_места]);
    assert.deepEqual(identityAndSeat((await app.json('/api/students', { token: session.token })).students), identityAndSeat(persistedStudents));

    await app.json('/api/students/place', {
      method: 'PUT', token: session.token,
      json: { studentId: persistedStudents[0].id, classroomNumber: 101, placeNumber: persistedStudents[1].номер_места },
    }, 409);
    await app.json('/api/import-seating', {
      method: 'POST', token: session.token, json: { data: { students: [{ фимилия: 'Недостаточно данных' }] } },
    }, 400);
    assert.deepEqual(identityAndSeat((await app.json('/api/students', { token: session.token })).students), identityAndSeat(persistedStudents));

    const temporarilyBlocked = ['2А', '2Б', '1Г', '2В', '2Г'];
    for (const placeNumber of temporarilyBlocked) {
      await app.json(`/api/classrooms/${room.id}/block-place`, {
        method: 'PUT', token: session.token, json: { placeNumber, blocked: true },
      });
    }
    const limited = await app.json('/api/generate-seating', { method: 'POST', token: session.token, json: { subject } });
    assert.equal(limited.stats.seatingCount, 2);
    assert.equal(limited.unplacedStudents.length, 2);
    const limitedStudents = (await app.json('/api/students', { token: session.token })).students;
    const unplacedIds = new Set(limited.unplacedStudents.map(student => student.id));
    for (const student of limitedStudents.filter(student => unplacedIds.has(student.id))) {
      assert.equal(student.номер_кабинета, null, 'recomputation clears an unplaced student\'s previous classroom');
      assert.equal(student.номер_места, null, 'recomputation clears an unplaced student\'s previous seat');
    }
    assert.equal(limitedStudents.filter(student => !student.номер_места).length, 2);
    for (const placeNumber of temporarilyBlocked) {
      await app.json(`/api/classrooms/${room.id}/block-place`, {
        method: 'PUT', token: session.token, json: { placeNumber, blocked: false },
      });
    }
    assert.equal((await app.json('/api/generate-seating', { method: 'POST', token: session.token, json: { subject } })).stats.seatingCount, 4);
    persistedStudents = (await app.json('/api/students', { token: session.token })).students;
  });

  await t.test('five print documents, bulk forms, native pages and data export work together', async () => {
    const parameters = new URLSearchParams({ subject, exam_date: '2026-10-13', site_code: '100', school_name: 'Тестовая площадка', classroom: '101' });
    for (const endpoint of ['generate', 'general-statement', 'transfer-act', 'accompanying-sheet', 'registration-list']) {
      const response = await app.request(`/forms/${endpoint}?${parameters}`, { token: session.token });
      assert.equal(response.status, 200, endpoint);
      const document = await response.text();
      assert.match(document, /Математика/);
      assert.match(document, /101/);
      if (['generate', 'registration-list'].includes(endpoint)) assert.match(document, /Иванов Иван Иванович/);
      if (endpoint === 'accompanying-sheet') assert.match(document, /TEST-WORK-04/);
    }
    parameters.set('all_classrooms', 'true');
    parameters.delete('classroom');
    for (const endpoint of ['generate', 'registration-list', 'accompanying-sheet']) {
      assert.equal((await app.request(`/forms/${endpoint}?${parameters}`, { token: session.token })).status, 200, `bulk ${endpoint}`);
    }
    await app.json('/forms/generate?subject=Math&exam_date=invalid&site_code=100&classroom=101', { token: session.token }, 400);
    for (const endpoint of ['/', '/seating', '/kabinet', '/oo', '/import', '/forms']) {
      const response = await app.request(endpoint, { cookie: session.cookie });
      assert.equal(response.status, 200, endpoint);
      assert.match(await response.text(), /<main\b/);
    }
    const exported = await app.json('/api/export-seating', { token: session.token });
    assert.equal(exported.students.length, 4);
    assert.ok(exported.students.every(student => student.номер_места));
    const info = await app.json('/import/api/db-info', { token: session.token });
    assert.equal(info.path, './data/exam.sqlite');
    assert.equal(info.participantsRecords, 5);
    assert.equal(info.scanRecords, 1);
    await fs.access(path.join(app.directory, 'data', 'exam.sqlite'));
    await assert.rejects(fs.access(path.join(app.directory, 'uploads')), { code: 'ENOENT' });
  });

  await t.test('logout revokes tokens; restart preserves data and .env rotation revokes old sessions', async () => {
    await app.json('/api/auth/logout', { method: 'POST', token: session.token });
    await app.json('/api/students', { token: session.token }, 401);
    session = await app.login();
    await app.stop();
    await app.start();
    // Unchanged configuration retains active sessions and all local data.
    assert.equal((await app.json('/api/students', { token: session.token })).students.length, 4);
    assert.deepEqual((await app.json(`/api/classrooms/${room.id}/blocked-places`, { token: session.token })).blockedPlaces, ['1А']);
    const layout = await app.json(`/api/classrooms/${room.id}/layout`, { token: session.token });
    assert.deepEqual(layout.row_mapping, { 1: { desks: 2 }, 2: { desks: 2 } });
    const seats = (await app.json('/api/students', { token: session.token })).students;
    assert.deepEqual(seats.map(student => [student.id, student.номер_кабинета, student.номер_места]), persistedStudents.map(student => [student.id, student.номер_кабинета, student.номер_места]));
    const oldCredentials = { login: app.configuration.ADMIN_LOGIN, password: app.configuration.ADMIN_PASSWORD };
    await app.stop();
    app.configuration.ADMIN_LOGIN = `rotated_${randomBytes(8).toString('hex')}`;
    app.configuration.ADMIN_PASSWORD = randomBytes(24).toString('base64url');
    app.configuration.JWT_SECRET = randomBytes(48).toString('base64url');
    await app.start();
    await app.json('/api/auth/login', { method: 'POST', json: oldCredentials }, 401);
    await app.json('/api/students', { token: session.token }, 401);
    session = await app.login();
    assert.equal((await app.json('/api/students', { token: session.token })).students.length, 4);
  });

  await t.test('room renames, capacity changes and deletion reconcile assigned students atomically', async () => {
    await app.json('/api/classrooms', { method: 'POST', token: session.token, json: {} }, 400);
    await app.json('/api/classrooms', {
      method: 'POST', token: session.token,
      json: { номер_кабинета: 101, количество_парт: 4, количество_рядов_парт: 2, этаж: 1 },
    }, 409);
    const other = (await app.json('/api/classrooms', {
      method: 'POST', token: session.token,
      json: { номер_кабинета: 102, количество_парт: 2, количество_рядов_парт: 1, этаж: 1 },
    }, 201)).classroom;
    await app.json('/api/students/place', {
      method: 'PUT', token: session.token,
      json: { studentId: 999999999, classroomNumber: 102, placeNumber: '1А' },
    }, 404);
    const studentId = persistedStudents[0].id;
    await app.json('/api/students/place', {
      method: 'PUT', token: session.token, json: { studentId, classroomNumber: 102, placeNumber: '2А' },
    });
    await app.json(`/api/classrooms/${other.id}`, {
      method: 'PUT', token: session.token,
      json: { номер_кабинета: 103, количество_парт: 2, количество_рядов_парт: 1, этаж: 1 },
    });
    let moved = (await app.json('/api/students', { token: session.token })).students.find(student => student.id === studentId);
    assert.equal(moved.номер_кабинета, 103);
    assert.equal(moved.номер_места, '2А');
    const reduced = await app.json(`/api/classrooms/${other.id}`, {
      method: 'PUT', token: session.token,
      json: { номер_кабинета: 103, количество_парт: 1, количество_рядов_парт: 1, этаж: 1 },
    });
    assert.equal(reduced.unseatedCount, 1);
    moved = (await app.json('/api/students', { token: session.token })).students.find(student => student.id === studentId);
    assert.equal(moved.номер_кабинета, null);
    assert.equal(moved.номер_места, null);
    await app.json('/api/students/place', {
      method: 'PUT', token: session.token, json: { studentId, classroomNumber: 103, placeNumber: '1А' },
    });
    await app.json(`/api/classrooms/${other.id}`, { method: 'DELETE', token: session.token });
    await app.json(`/api/classrooms/${other.id}/free-places`, { token: session.token }, 404);
    moved = (await app.json('/api/students', { token: session.token })).students.find(student => student.id === studentId);
    assert.equal(moved.номер_кабинета, null);
    assert.equal(moved.номер_места, null);
    assert.equal((await app.json('/api/students', { token: session.token })).students.length, 4);
  });

  await t.test('placement checks validate existence; desk swaps preserve learners and reject unsafe changes', async () => {
    const classroom = (await app.json('/api/classrooms', {
      method: 'POST', token: session.token,
      json: { номер_кабинета: 104, количество_парт: 4, количество_рядов_парт: 2, этаж: 1 },
    }, 201)).classroom;
    const younger = persistedStudents.filter(student => student.паралель === '9');
    const older = persistedStudents.find(student => student.паралель === '10');
    await app.json('/api/students/place', {
      method: 'PUT', token: session.token, json: { studentId: younger[0].id, classroomNumber: 104, placeNumber: '1А' },
    });
    await app.json('/api/students/place', {
      method: 'PUT', token: session.token, json: { studentId: older.id, classroomNumber: 104, placeNumber: '1В' },
    });
    await app.json('/api/check-placement', {
      method: 'POST', token: session.token, json: { studentId: younger[0].id, classroomNumber: 104, placeNumber: '999М' },
    }, 404);
    await app.json('/api/check-placement', {
      method: 'POST', token: session.token, json: { studentId: younger[0].id, classroomNumber: 999, placeNumber: '1А' },
    }, 404);
    const positions = students => students.map(student => [student.id, student.номер_кабинета, student.номер_места]);
    const before = positions((await app.json('/api/students', { token: session.token })).students);
    await app.json(`/api/classrooms/${classroom.id}/move-desk`, {
      method: 'PUT', token: session.token, json: { fromRow: 1, fromDesk: 1, toRow: 999, toDesk: 1 },
    }, 400);
    assert.deepEqual(positions((await app.json('/api/students', { token: session.token })).students), before);

    const swapped = await app.json(`/api/classrooms/${classroom.id}/move-desk`, {
      method: 'PUT', token: session.token, json: { fromRow: 1, fromDesk: 1, toRow: 2, toDesk: 1 },
    });
    assert.equal(swapped.movedCount, 2);
    const after = (await app.json('/api/students', { token: session.token })).students;
    assert.equal(after.find(student => student.id === younger[0].id).номер_места, '1В');
    assert.equal(after.find(student => student.id === older.id).номер_места, '1А');
    assert.equal(new Set(after.filter(student => student.номер_кабинета === 104).map(student => student.номер_места)).size, 2);

    await app.json(`/api/classrooms/${classroom.id}/block-place`, {
      method: 'PUT', token: session.token, json: { placeNumber: '1А', blocked: true },
    });
    await app.json(`/api/classrooms/${classroom.id}/move-desk`, {
      method: 'PUT', token: session.token, json: { fromRow: 1, fromDesk: 1, toRow: 2, toDesk: 1 },
    }, 409);
    assert.deepEqual(positions((await app.json('/api/students', { token: session.token })).students), positions(after));
    await app.json(`/api/classrooms/${classroom.id}/block-place`, {
      method: 'PUT', token: session.token, json: { placeNumber: '1А', blocked: false },
    });
    await app.json(`/api/classrooms/${classroom.id}/move-desk`, {
      method: 'PUT', token: session.token, json: { fromRow: 1, fromDesk: 1, toRow: 2, toDesk: 1 },
    });
    await app.json('/api/students/place', {
      method: 'PUT', token: session.token, json: { studentId: younger[1].id, classroomNumber: 104, placeNumber: '2В' },
    });
    const beforeForbidden = positions((await app.json('/api/students', { token: session.token })).students);
    await app.json(`/api/classrooms/${classroom.id}/move-desk`, {
      method: 'PUT', token: session.token, json: { fromRow: 1, fromDesk: 1, toRow: 2, toDesk: 1 },
    }, 409);
    assert.deepEqual(positions((await app.json('/api/students', { token: session.token })).students), beforeForbidden);
  });
});

test('missing administrator configuration generates private credentials once and reuses database values', { timeout: 60000 }, async t => {
  const app = await fixture({ generated: true });
  t.after(async () => {
    await app.stop();
    app.assertNoSecretLogging();
  });
  await app.start();
  const credentialPath = path.join(app.directory, 'data', 'initial-admin.json');
  const credentials = JSON.parse(await fs.readFile(credentialPath, 'utf8'));
  assert.ok(typeof credentials.login === 'string' && credentials.login.length > 6);
  assert.ok(typeof credentials.password === 'string' && credentials.password.length >= 24);
  app.privateValues.add(credentials.password);
  assert.equal((await fs.stat(credentialPath)).mode & 0o777, 0o600);
  const response = await app.request('/api/auth/login', { method: 'POST', json: credentials });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  await app.stop();
  const database = new DatabaseSync(path.join(app.directory, 'data', 'exam.sqlite'), { readOnly: true });
  let administrator;
  try {
    administrator = database.prepare('SELECT login, password_hash, jwt_secret, version FROM auth_admin WHERE id=1').get();
  } finally {
    database.close();
  }
  assert.equal(administrator.login, credentials.login);
  assert.match(administrator.password_hash, /^scrypt:/);
  assert.ok(!administrator.password_hash.includes(credentials.password), 'database stores a password hash');
  assert.ok(administrator.jwt_secret.length >= 32);
  app.privateValues.add(administrator.jwt_secret);
  await app.start();
  assert.equal((await app.json('/api/auth/me', { cookie })).user.login, credentials.login);
  const secondLogin = await app.request('/api/auth/login', { method: 'POST', json: credentials });
  assert.equal(secondLogin.status, 200);
  assert.ok((await fs.readFile(credentialPath, 'utf8')).includes(credentials.login));
});

test('administrator bootstrap preserves an existing credential file when initializing a fresh database', { timeout: 60000 }, async t => {
  const app = await fixture({ generated: true });
  t.after(async () => {
    await app.stop();
    app.assertNoSecretLogging();
  });
  const dataDirectory = path.join(app.directory, 'data');
  await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const oldCredentials = { login: `previous_${randomBytes(8).toString('hex')}`, password: randomBytes(24).toString('base64url') };
  app.privateValues.add(oldCredentials.password);
  const oldContent = JSON.stringify(oldCredentials, null, 2) + '\n';
  const oldPath = path.join(dataDirectory, 'initial-admin.json');
  await fs.writeFile(oldPath, oldContent, { mode: 0o600 });
  await app.start();
  assert.ok(await fs.readFile(oldPath, 'utf8') === oldContent, 'existing credentials remain unchanged');
  const generatedFiles = (await fs.readdir(dataDirectory)).filter(name => /^initial-admin-[0-9a-f-]+\.json$/i.test(name));
  assert.equal(generatedFiles.length, 1);
  const newPath = path.join(dataDirectory, generatedFiles[0]);
  const newCredentials = JSON.parse(await fs.readFile(newPath, 'utf8'));
  app.privateValues.add(newCredentials.password);
  assert.equal((await fs.stat(newPath)).mode & 0o777, 0o600);
  await app.json('/api/auth/login', { method: 'POST', json: oldCredentials }, 401);
  const loggedIn = await app.request('/api/auth/login', { method: 'POST', json: newCredentials });
  assert.equal(loggedIn.status, 200);
  const cookie = loggedIn.headers.get('set-cookie').split(';')[0];
  await app.stop();
  await app.start();
  assert.equal((await app.json('/api/auth/me', { cookie })).user.login, newCredentials.login);
  assert.ok(await fs.readFile(oldPath, 'utf8') === oldContent, 'restart still preserves the previous credential file');
  assert.equal((await fs.readdir(dataDirectory)).filter(name => /^initial-admin-[0-9a-f-]+\.json$/i.test(name)).length, 1);
});
