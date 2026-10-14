'use strict';

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function wantsJson(req) {
  // Mounted routers shorten req.path (e.g. /api/auth/me becomes /me).
  const pathname = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;
  return pathname.startsWith('/api/') || pathname.includes('/api/') ||
    req.method !== 'GET' || req.get('accept')?.includes('application/json');
}

function notFound(req, res, next) {
  next(new HttpError(404, 'Страница или запись не найдена', 'NOT_FOUND'));
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.code === 'LIMIT_FILE_SIZE' ? 413 :
    Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
  const message = error.type === 'entity.parse.failed' ? 'Некорректный JSON в запросе' :
    /constraint failed/i.test(error.message || '') ? 'Запись с такими данными уже существует или нарушает ограничения' :
    status === 413 ? 'Размер файла превышает допустимый предел' :
    status >= 500 ? 'Внутренняя ошибка сервера. Повторите попытку.' : error.message;
  if (status >= 500) console.error(`[${req.method} ${req.path}]`, error.operation || '', error.message);
  if (wantsJson(req)) return res.status(status).json({ success: false, error: message, code: error.code || 'REQUEST_FAILED' });
  return res.status(status).render('error', { message, status, title: 'Ошибка', activePage: '' });
}

module.exports = { HttpError, wantsJson, notFound, errorHandler };
