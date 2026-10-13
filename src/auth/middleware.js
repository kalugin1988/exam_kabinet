'use strict';

const { authenticateToken } = require('./service');
const { wantsJson, HttpError } = require('../errors');
const { config } = require('../config');

const COOKIE_NAME = 'exam_session';
const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.COOKIE_SECURE === 'true' || config.NODE_ENV === 'production', path: '/' };

function tokenFromRequest(req) {
  const authorization = req.get('authorization');
  if (authorization) {
    const match = authorization.match(/^Bearer ([^\s]+)$/i);
    if (!match) throw new HttpError(401, 'Неверный формат токена', 'INVALID_TOKEN');
    return match[1];
  }
  const cookie = (req.get('cookie') || '').split(';').find(value => value.trim().startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;
  try { return decodeURIComponent(cookie.trim().slice(COOKIE_NAME.length + 1)); }
  catch { throw new HttpError(401, 'Неверный формат токена', 'INVALID_TOKEN'); }
}

async function requireAuthentication(req, res, next) {
  try {
    const token = tokenFromRequest(req);
    if (!token) throw new HttpError(401, 'Войдите в систему', 'AUTH_REQUIRED');
    req.user = await authenticateToken(token);
    res.locals.user = req.user;
    next();
  } catch (error) {
    if (error.status === 401) {
      res.clearCookie(COOKIE_NAME, cookieOptions);
      if (!wantsJson(req)) {
        const returnTo = encodeURIComponent(req.originalUrl);
        return res.redirect(`/login?reason=${error.code === 'AUTH_REQUIRED' ? 'required' : 'expired'}&returnTo=${returnTo}`);
      }
    }
    next(error);
  }
}

function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  try {
    if (req.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Запрос с другого сайта запрещён', 'CROSS_SITE_REQUEST');
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) throw new HttpError(403, 'Запрос с другого сайта запрещён', 'CROSS_SITE_REQUEST');
    next();
  } catch (error) { next(error instanceof HttpError ? error : new HttpError(403, 'Недопустимый источник запроса')); }
}

module.exports = { requireAuthentication, sameOrigin, tokenFromRequest, cookieOptions, COOKIE_NAME };
