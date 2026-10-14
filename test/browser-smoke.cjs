'use strict';

// Optional end-to-end check: node test/browser-smoke.cjs
// Uses an installed Playwright and Chromium, never the working application's DB.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const xlsx = require('xlsx');

const source = path.resolve(__dirname, '..');
const run = path.join(source, 'data', 'test-runs', `browser-${randomUUID()}`);
const application = path.join(run, 'app');
const errors = [];
const failures = [];
const expectedHttpErrors = new Set();
let server;
let context;
let phase = 'initialization';
let browserPage;

async function availablePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function inspect(page, label, screenshot = true) {
  await page.waitForLoadState('networkidle');
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
  assert.equal(await page.locator('body > header').count(), 1, `${label}: header`);
  assert.equal(await page.locator('body > main').count(), 1, `${label}: main`);
  assert.equal(await page.locator('body > footer').count(), 1, `${label}: footer`);
  assert.ok(await page.locator('nav').count(), `${label}: navigation landmark`);
  assert.ok(await page.locator('main section').count(), `${label}: semantic sections`);
  if (screenshot) await page.screenshot({ path: path.join(run, `${label}.png`), fullPage: true });
}

async function login(page, credentials, destination = '/') {
  await page.locator('#login').fill(credentials.ADMIN_LOGIN);
  await page.locator('#password').fill(credentials.ADMIN_PASSWORD);
  await Promise.all([page.waitForURL(url => url.pathname === destination), page.locator('#loginSubmit').click()]);
}

async function fillRoom(page, room) {
  for (const [id, value] of Object.entries(room)) await page.locator(`#${id}`).fill(String(value));
}

async function runChecks() {
  await fs.mkdir(application, { recursive: true, mode: 0o700 });
  for (const entry of ['src', 'views', 'public', 'algorithms', 'server.js', 'bd.js', 'server_oo.js', 'server_print.js', 'package.json', 'package-lock.json']) {
    await fs.cp(path.join(source, entry), path.join(application, entry), { recursive: true });
  }
  const configuration = {
    PORT: String(await availablePort()), NODE_ENV: 'test', COOKIE_SECURE: 'false',
    ADMIN_LOGIN: `browser_${randomBytes(8).toString('hex')}`,
    ADMIN_PASSWORD: randomBytes(24).toString('base64url'),
    JWT_SECRET: randomBytes(48).toString('base64url'),
  };
  const environment = { ...process.env };
  for (const key of Object.keys(configuration)) delete environment[key];
  await fs.writeFile(path.join(application, '.env'), Object.entries(configuration).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  const logPath = path.join(run, 'server.log');
  const log = await fs.open(logPath, 'a', 0o600);
  server = spawn('npm', ['start'], { cwd: application, env: environment, detached: true, stdio: ['ignore', log.fd, log.fd] });
  server.on('error', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${configuration.PORT}`;
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { ready = (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch (error) { if (server.exitCode !== null) throw new Error('Isolated npm start exited; inspect retained server.log'); }
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, 'Isolated npm start reached /health');
  await log.close();
  context = await chromium.launchPersistentContext(path.join(run, 'chromium-profile'), {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true, viewport: { width: 1280, height: 900 }, args: ['--no-sandbox'],
  });
  context.on('page', page => {
    page.on('pageerror', error => errors.push(`${new URL(page.url()).pathname}: ${error.message}`));
    page.on('requestfailed', request => {
      const reason = request.failure()?.errorText || '';
      if (reason !== 'net::ERR_ABORTED') failures.push(`${request.method()} ${new URL(request.url()).pathname}: ${reason}`);
    });
    page.on('response', response => {
      const responsePath = new URL(response.url()).pathname;
      if (response.status() >= 400 && !(responsePath === '/api/auth/login' && response.status() === 401) &&
        !expectedHttpErrors.has(`${response.status()} ${responsePath}`)) {
        failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
  });
  const page = await context.newPage();
  browserPage = page;
  page.setDefaultTimeout(10000);
  await page.goto(`${origin}/login`);
  await inspect(page, 'desktop-login');
  await page.locator('#loginSubmit').click();
  assert.equal(await page.locator('#loginFieldError').isVisible(), true, 'Empty login has inline validation');
  assert.equal(await page.locator('#passwordFieldError').isVisible(), true, 'Empty password has inline validation');
  await page.locator('#login').fill(configuration.ADMIN_LOGIN);
  await page.locator('#password').fill(randomBytes(24).toString('base64url'));
  await page.locator('#loginSubmit').click();
  await page.locator('#loginError').waitFor({ state: 'visible' });
  assert.match(await page.locator('#loginError').innerText(), /Неверный логин или пароль/);
  await login(page, configuration);
  await inspect(page, 'desktop-dashboard');

  await page.locator('nav a[href="/kabinet"]').click();
  await fillRoom(page, { roomNumber: 101, roomDesks: 12, roomRows: 3, roomFloor: 1 });
  await page.locator('#addClassroomForm [type=submit]').click();
  await page.locator('.classroom-item').filter({ hasText: 'Кабинет №101' }).waitFor();
  await page.locator('.classroom-item').filter({ hasText: 'Кабинет №101' }).locator('[data-edit]').click();
  await page.locator('#roomDesks').fill('15');
  await page.locator('#addClassroomForm [type=submit]').click();
  await page.waitForFunction(() => document.querySelector('.classroom-item')?.textContent.includes('15 парт'));
  await fillRoom(page, { roomNumber: 102, roomDesks: 2, roomRows: 1, roomFloor: 2 });
  await page.locator('#addClassroomForm [type=submit]').click();
  const temporary = page.locator('.classroom-item').filter({ hasText: 'Кабинет №102' });
  await temporary.waitFor();
  page.once('dialog', dialog => dialog.accept());
  await temporary.locator('[data-delete]').click();
  await temporary.waitFor({ state: 'hidden' });
  await inspect(page, 'desktop-classrooms');

  const workbook = xlsx.utils.book_new();
  const rows = [['Фамилия', 'Имя', 'Отчество', 'Предмет', 'Код ОО', 'Класс', 'Код участника']];
  for (let index = 0; index < 6; index++) rows.push([`Проверка${index + 1}`, `Участник${index + 1}`, 'Иванович', 'Математика', `00${index + 1}`, String(5 + index % 3), `00${101 + index}`]);
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(rows), 'Browser');
  const fixturePath = path.join(run, 'participants.xlsx');
  xlsx.writeFile(workbook, fixturePath);
  await page.locator('nav a[href="/import"]').click();
  await page.locator('#uploadFile').setInputFiles(fixturePath);
  await page.locator('#uploadButton').click();
  await page.locator('#uploadResult').waitFor({ state: 'visible' });
  assert.match(await page.locator('#uploadResult').innerText(), /6/);
  await page.waitForFunction(() => document.querySelector('#dataPreview table'));
  await page.locator('#rosterButton').click();
  await page.locator('#rosterResult').waitFor({ state: 'visible' });
  assert.match(await page.locator('#rosterResult').innerText(), /Добавлено: 6/);
  await inspect(page, 'desktop-import');
  await page.locator('nav a[href="/seating"]').click();
  await page.locator('#subjectSelect').selectOption('Математика');
  await page.locator('#generateButton').click();
  await page.waitForFunction(() => document.querySelector('#globalMessage')?.textContent.includes('Рассадка сформирована'));
  assert.equal(await page.locator('#unplacedStudents').innerText(), '0');
  assert.equal(await page.locator('#placedStudents').innerText(), '6');
  await inspect(page, 'desktop-seating');

  await page.locator('nav a[href="/forms"]').click();
  await page.locator('#documentSubject').selectOption('Математика');
  await page.locator('#examDate').fill('2026-10-13');
  await page.locator('#siteCode').fill('0001');
  await page.locator('#schoolName').fill('Площадка браузерной проверки');
  for (const type of ['generate', 'general-statement', 'transfer-act', 'accompanying-sheet', 'registration-list']) {
    await page.locator(`[name=document_type][value="${type}"]`).check();
    if (['generate', 'accompanying-sheet', 'registration-list'].includes(type)) await page.locator('#documentClassroom').selectOption('101');
    const [documentPage] = await Promise.all([page.waitForEvent('popup'), page.locator('#documentForm [type=submit]').click()]);
    await documentPage.waitForLoadState('networkidle');
    assert.equal(new URL(documentPage.url()).pathname, `/forms/${type}`);
    const printableContent = type === 'accompanying-sheet' ? '.codes-grid' : 'table';
    assert.ok(await documentPage.locator(printableContent).count(), `${type} contains printable content`);
    assert.doesNotMatch(await documentPage.locator('body').innerText(), /Ошибка сервера/);
    await documentPage.screenshot({ path: path.join(run, `document-${type}.png`), fullPage: true });
    await documentPage.close();
  }
  await inspect(page, 'desktop-forms');
  await page.locator('a[href="/print"]').click();
  await page.waitForFunction(() => document.querySelector('#printSelection option[value="1"]'));
  await page.locator('#printSelection').selectOption('1');
  await page.locator('#printPreviewButton').click();
  await page.locator('#printPreview .print-page').first().waitFor();
  assert.equal(await page.locator('#printPreview .print-page').count(), 4, 'Form R: three parallels and inventory');
  assert.match(await page.locator('#printSummary').innerText(), /6.*участников/s);
  await page.locator('[name=printFormat][value="M"]').check();
  await page.locator('#printParallel').uncheck();
  await page.locator('#printPreviewButton').click();
  await page.locator('#printPreview .print-page').first().waitFor();
  assert.equal(await page.locator('#printPreview .print-page').count(), 2, 'Form M: combined list and inventory');
  assert.match(await page.locator('#printPreview').innerText(), /Мониторинг рассадки участников/);
  const [selectedPrint] = await Promise.all([context.waitForEvent('page'), page.locator('#printSelectedButton').click()]);
  await selectedPrint.locator('.print-page').first().waitFor();
  assert.equal(await selectedPrint.locator('.print-page').count(), 2);
  await selectedPrint.screenshot({ path: path.join(run, 'legacy-selected-print.png'), fullPage: true });
  await page.waitForFunction(() => !document.querySelector('#printSelectedButton').disabled);
  await selectedPrint.close();
  const [selectedExcel] = await Promise.all([page.waitForEvent('download'), page.locator('#printExcelButton').click()]);
  const selectedExcelPath = path.join(run, 'legacy-selected.xlsx');
  await selectedExcel.saveAs(selectedExcelPath);
  assert.equal(xlsx.readFile(selectedExcelPath).SheetNames.length, 2, 'Selected XLSX includes list and inventory');
  await page.locator('#printGrouping').selectOption('school');
  await page.locator('#printSelection').selectOption('001');
  await page.locator('#printPreviewButton').click();
  await page.locator('#printPreview .print-page').first().waitFor();
  assert.equal(await page.locator('#printPreview .print-page').count(), 2, 'School preview includes inventory');
  const [allPrint] = await Promise.all([context.waitForEvent('page'), page.locator('#printAllButton').click()]);
  await allPrint.locator('.print-page').first().waitFor();
  assert.equal(await allPrint.locator('.print-page').count(), 12, 'Six schools each have list and inventory');
  await page.waitForFunction(() => !document.querySelector('#printAllButton').disabled);
  await allPrint.close();
  const [allExcel] = await Promise.all([page.waitForEvent('download'), page.locator('#printAllExcelButton').click()]);
  const allExcelPath = path.join(run, 'legacy-all.xlsx');
  await allExcel.saveAs(allExcelPath);
  assert.equal(xlsx.readFile(allExcelPath).SheetNames.length, 7, 'All-school XLSX includes six lists and inventory');
  await inspect(page, 'desktop-print');
  await page.locator('nav a[href="/oo"]').click();
  await inspect(page, 'desktop-institutions');

  for (const width of [390, 320, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [route, label] of [['/', 'dashboard'], ['/import', 'import'], ['/kabinet', 'classrooms'], ['/seating', 'seating'], ['/forms', 'forms'], ['/print', 'print'], ['/oo', 'institutions']]) {
      await page.goto(`${origin}${route}`);
      if (route === '/import') {
        await page.waitForFunction(() => document.querySelector('#dataTable option[value="participants_Browser"]'));
        await page.locator('#dataTable').selectOption('participants_Browser');
        await page.locator('#dataPreview table').waitFor();
      }
      if (route === '/print') {
        await page.waitForFunction(() => document.querySelector('#printSelection option[value="1"]'));
        await page.locator('#printSelection').selectOption('1');
        await page.locator('#printPreviewButton').click();
        await page.locator('#printPreview .print-page').first().waitFor();
      }
      if (route === '/forms') {
        await page.locator('#documentSubject').selectOption('Математика');
        await page.locator('#examDate').fill('2026-10-13');
        await page.locator('#siteCode').fill('0001');
        await page.locator('#schoolName').fill('Площадка браузерной проверки');
        for (const type of ['generate', 'general-statement', 'transfer-act', 'accompanying-sheet', 'registration-list']) {
          await page.locator(`[name=document_type][value="${type}"]`).check();
          if (['generate', 'accompanying-sheet', 'registration-list'].includes(type)) await page.locator('#documentClassroom').selectOption('101');
          const [documentPage] = await Promise.all([page.waitForEvent('popup'), page.locator('#documentForm [type=submit]').click()]);
          await documentPage.setViewportSize({ width, height: 844 });
          await inspect(documentPage, `mobile-${width}-document-${type}`);
          await documentPage.close();
        }
      }
      await inspect(page, `mobile-${width}-${label}`);
    }
    await page.locator('#logoutButton').click();
    await page.waitForURL(url => url.pathname === '/login');
    await inspect(page, `mobile-${width}-login`);
    await page.locator('#loginSubmit').click();
    assert.equal(await page.locator('#loginFieldError').isVisible(), true);
    assert.equal(await page.locator('#passwordFieldError').isVisible(), true);
    await page.locator('#login').fill(configuration.ADMIN_LOGIN);
    await page.locator('#password').fill(randomBytes(24).toString('base64url'));
    await page.locator('#loginSubmit').click();
    await page.locator('#loginError').waitFor({ state: 'visible' });
    assert.match(await page.locator('#loginError').innerText(), /Неверный логин или пароль/);
    await page.goto(`${origin}/login?next=${encodeURIComponent('https://example.invalid/escape')}`);
    await login(page, configuration);
    assert.equal(new URL(page.url()).origin, origin, 'External next parameter remains on this application');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  phase = 'invalid token on page navigation';
  await context.addCookies([{ name: 'exam_session', value: 'not-a-jwt', url: origin, httpOnly: true, sameSite: 'Strict' }]);
  await page.goto(`${origin}/kabinet`);
  await page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('reason') === 'invalid');
  assert.match(await page.locator('#loginNotice').innerText(), /Токен авторизации недействителен/);
  assert.doesNotMatch(await page.locator('#loginNotice').innerText(), /Сессия истекла/);
  await login(page, configuration, '/kabinet');
  expectedHttpErrors.add('401 /api/auth/me');
  phase = 'invalid token in a mounted GET API';
  await context.addCookies([{ name: 'exam_session', value: 'not-a-jwt', url: origin, httpOnly: true, sameSite: 'Strict' }]);
  await Promise.all([
    page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('reason') === 'invalid'),
    page.evaluate(() => Exam.request('/api/auth/me').catch(() => {})),
  ]);
  assert.match(await page.locator('#loginNotice').innerText(), /Токен авторизации недействителен/);
  await login(page, configuration, '/kabinet');
  await context.clearCookies();
  phase = 'missing token in a mounted GET API';
  await Promise.all([
    page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('reason') === 'required'),
    page.evaluate(() => Exam.request('/api/auth/me').catch(() => {})),
  ]);
  assert.match(await page.locator('#loginNotice').innerText(), /Войдите в систему/);
  assert.doesNotMatch(await page.locator('#loginNotice').innerText(), /Токен авторизации недействителен|Сессия истекла/);
  expectedHttpErrors.delete('401 /api/auth/me');
  await login(page, configuration, '/kabinet');
  const expired = jwt.sign({ role: 'admin', version: 1 }, configuration.JWT_SECRET, {
    algorithm: 'HS256', issuer: 'exam-center', audience: 'exam-admin', subject: '1', jwtid: randomUUID(), expiresIn: -1,
  });
  phase = 'expired session';
  await context.addCookies([{ name: 'exam_session', value: expired, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  await page.goto(`${origin}/kabinet`);
  await page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('reason') === 'expired');
  assert.match(await page.locator('#loginNotice').innerText(), /Сессия истекла/);
  await inspect(page, 'mobile-320-expired');
  await login(page, configuration, '/kabinet');
  await page.locator('#logoutButton').click();
  await page.waitForURL(url => url.pathname === '/login');
  await page.goto(`${origin}/seating`);
  assert.equal(new URL(page.url()).pathname, '/login', 'Logout protects subsequent visits');
  assert.deepEqual(errors, [], 'No browser JavaScript errors');
  assert.deepEqual(failures, [], 'No unexpected HTTP errors or failed requests');
  console.log(`Browser smoke passed: desktop 1280, tablet 768/1024, mobile 390/320, semantic markup, login, navigation, room CRUD, XLSX import, seating, five document types, forms R/M, selected/all printing and XLSX, logout, invalid/missing token notices and expiry.\nArtifacts: ${run}`);
}

runChecks().catch(error => {
  console.error(error.message);
  console.error('Browser checkpoint:', phase, browserPage?.url());
  if (errors.length) console.error('Browser errors:', errors);
  if (failures.length) console.error('HTTP/request errors:', failures);
  console.error(`Retained artifacts: ${run}`);
  process.exitCode = 1;
}).finally(async () => {
  if (context) await context.close();
  if (server && server.exitCode === null) {
    try { process.kill(-server.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') console.error(error.message); }
  }
});
