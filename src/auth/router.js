'use strict';

const express = require('express');
const { loginAdministrator, logoutSession, SESSION_SECONDS } = require('./service');
const { requireAuthentication, COOKIE_NAME, cookieOptions } = require('./middleware');
const { HttpError } = require('../errors');
const router = express.Router();
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

router.post('/login', async (req, res, next) => {
  const key = req.ip;
  try {
    const now = Date.now();
    for (const [ip, item] of attempts) if (item.until <= now) attempts.delete(ip);
    const attempt = attempts.get(key) || { count: 0, until: now + WINDOW };
    if (attempt.count >= MAX_ATTEMPTS) {
      res.set('Retry-After', String(Math.ceil((attempt.until - now) / 1000)));
      throw new HttpError(429, 'Слишком много попыток. Попробуйте позже.', 'LOGIN_RATE_LIMIT');
    }
    const { login, password } = req.body || {};
    if (typeof login !== 'string' || typeof password !== 'string' || !login.trim() || !password || login.length > 128 || password.length > 1024) {
      throw new HttpError(400, 'Введите логин и пароль', 'INVALID_LOGIN_FORM');
    }
    attempt.count++;
    attempts.set(key, attempt);
    const result = await loginAdministrator(login.trim(), password);
    attempts.delete(key);
    res.cookie(COOKIE_NAME, result.token, { ...cookieOptions, maxAge: SESSION_SECONDS * 1000 });
    res.json({ success: true, user: result.user, expiresAt: result.expiresAt });
  } catch (error) { next(error); }
});

router.get('/me', requireAuthentication, (req, res) => {
  res.json({ success: true, user: { login: req.user.login, role: req.user.role }, expiresAt: req.user.expiresAt });
});

router.post('/logout', requireAuthentication, async (req, res, next) => {
  try {
    await logoutSession(req.user.sessionId);
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
