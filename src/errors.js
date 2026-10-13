'use strict';

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function wantsJson(req) {
  return req.path.startsWith('/api/') || req.path.includes('/api/') ||
    req.method !== 'GET' || req.get('accept')?.includes('application/json');
}

function notFound(req, res, next) {
  next(new HttpError(404, 'Страница или запись не найдена', 'NOT_FOUND'));
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.code === 'LIMIT_FILE_SIZE' ? 413 :
    Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
  const message = status === 413 ? 'Размер файла превышает допустимый предел' :
    status >= 500 ? 'Внутренняя ошибка сервера. Повторите попытку.' : error.message;
  if (status >= 500) console.error(`[${req.method} ${req.path}]`, error.message);
  if (wantsJson(req)) return res.status(status).json({ success: false, error: message, code: error.code || 'REQUEST_FAILED' });
  return res.status(status).render('error', { message, status, title: 'Ошибка', activePage: '' });
}

module.exports = { HttpError, wantsJson, notFound, errorHandler };
