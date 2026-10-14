'use strict';

async function start() {
  let pool;
  try {
    const { port } = require('./src/config');
    const domain = require('./bd');
    const { initializeDatabase, initializeExistingClassroomTables } = domain;
    pool = domain.pool;
    const { initializeAdministrator } = require('./src/auth/service');
    const { createApp } = require('./src/app');
    await initializeDatabase();
    await initializeExistingClassroomTables();
    await initializeAdministrator();
    const app = createApp();
    const server = await new Promise((resolve, reject) => {
      const listener = app.listen(port, () => resolve(listener));
      listener.once('error', reject);
    });
    console.log(`Единый кабинет экзаменов запущен. Порт: ${port}. Хранилище: ./data/exam.sqlite`);
    let stopping = false;
    async function stop() {
      if (stopping) return;
      stopping = true;
      const timeout = setTimeout(() => process.exit(1), 10000);
      timeout.unref();
      try {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await pool.end();
        clearTimeout(timeout);
      } catch (error) {
        console.error('Ошибка завершения:', error.message);
        process.exitCode = 1;
      }
    }
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return server;
  } catch (error) {
    console.error('Не удалось запустить приложение:', error.message);
    try { if (pool) await pool.end(); } catch (closeError) { console.error('Ошибка закрытия базы:', closeError.message); }
    process.exitCode = 1;
  }
}

start();
