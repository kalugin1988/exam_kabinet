'use strict';

const path = require('node:path');
const express = require('express');
const { APP_DIR } = require('./config');
const { requireAuthentication, sameOrigin } = require('./auth/middleware');
const authRoutes = require('./auth/router');
const { getAllClassrooms, getAllStudents, getSubjects, parallelColors } = require('../bd');
const { errorHandler, notFound } = require('./errors');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(APP_DIR, 'views'));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    res.locals.title = 'Экзамены';
    res.locals.activePage = '';
    next();
  });
  app.use('/assets', express.static(path.join(APP_DIR, 'public'), { dotfiles: 'deny' }));
  app.get('/assets/vendor/xlsx.js', (req, res) => res.sendFile(require.resolve('xlsx/dist/xlsx.full.min.js')));
  app.use(express.static(path.join(APP_DIR, 'public'), { dotfiles: 'deny', index: false }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(sameOrigin);
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/login', (req, res) => res.render('login', { reason: req.query.reason, title: 'Вход' }));
  app.use('/api/auth', authRoutes);
  app.use(requireAuthentication);
  app.get('/', async (req, res, next) => {
    try {
      const [classrooms, students, subjectsResult] = await Promise.all([getAllClassrooms(), getAllStudents(), getSubjects()]);
      res.render('index', { classrooms, students, subjects: subjectsResult.map(row => row.subject), parallelColors });
    } catch (error) { next(error); }
  });
  app.get('/api/classrooms', async (req, res, next) => {
    try { res.json({ success: true, classrooms: await getAllClassrooms() }); }
    catch (error) { next(error); }
  });
  app.use('/import', require('./import/router'));
  app.use('/forms', require('./print/router'));
  app.use(require('./seating/router'));
  app.use(require('../server_oo'));
  app.use(require('../server_print'));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
