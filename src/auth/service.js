'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const jwt = require('jsonwebtoken');
const { pool, DATA_DIR, transaction } = require('../database');
const { config } = require('../config');
const { HttpError } = require('../errors');

const scrypt = promisify(scryptCallback);
const SESSION_SECONDS = 8 * 60 * 60;
const JWT_OPTIONS = { algorithm: 'HS256', issuer: 'exam-center', audience: 'exam-admin' };

async function hashPassword(password) {
  try {
    const salt = randomBytes(16).toString('hex');
    const hash = await scrypt(password, salt, 64);
    return `scrypt:${salt}:${hash.toString('hex')}`;
  } catch (error) { throw error; }
}

async function verifyPassword(password, stored) {
  try {
    if (typeof password !== 'string' || typeof stored !== 'string') return false;
    const [method, salt, expectedHex] = stored.split(':');
    if (method !== 'scrypt' || !salt || !/^[a-f0-9]{128}$/.test(expectedHex || '')) return false;
    const actual = await scrypt(password, salt, 64);
    return timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'));
  } catch (error) { throw error; }
}

async function getAdministrator() {
  try {
    return (await pool.query('SELECT * FROM auth_admin WHERE id = 1')).rows[0];
  } catch (error) { throw error; }
}

async function initializeAdministrator() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS auth_admin (
      id INTEGER PRIMARY KEY CHECK (id = 1), login TEXT NOT NULL,
      password_hash TEXT NOT NULL, jwt_secret TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, admin_version INTEGER NOT NULL
    )`);
    if (config.ADMIN_LOGIN !== undefined && (!String(config.ADMIN_LOGIN).trim() || config.ADMIN_LOGIN.trim().length > 128)) throw new Error('ADMIN_LOGIN должен содержать от 1 до 128 символов');
    if (config.ADMIN_PASSWORD !== undefined && (String(config.ADMIN_PASSWORD).length < 12 || String(config.ADMIN_PASSWORD).length > 1024)) throw new Error('ADMIN_PASSWORD должен содержать от 12 до 1024 символов');
    if (config.JWT_SECRET !== undefined && Buffer.byteLength(config.JWT_SECRET) < 32) throw new Error('JWT_SECRET должен содержать не менее 32 байт');

    let current = await getAdministrator();
    const login = config.ADMIN_LOGIN?.trim() || current?.login || `admin_${randomBytes(4).toString('hex')}`;
    const generatedPassword = !current && !config.ADMIN_PASSWORD ? randomBytes(24).toString('base64url') : null;
    const password = config.ADMIN_PASSWORD || generatedPassword;
    const passwordChanged = password ? !current || !await verifyPassword(password, current.password_hash) : false;
    const passwordHash = passwordChanged ? await hashPassword(password) : current.password_hash;
    const secret = config.JWT_SECRET || current?.jwt_secret || randomBytes(48).toString('base64url');
    const changed = !current || login !== current.login || passwordChanged || secret !== current.jwt_secret;
    if (generatedPassword) {
      const defaultPath = path.join(DATA_DIR, 'initial-admin.json');
      const bootstrapPath = fs.existsSync(defaultPath) ? path.join(DATA_DIR, `initial-admin-${randomUUID()}.json`) : defaultPath;
      // Deliver the generated password to the machine owner before committing
      // the new administrator. Preserve any earlier bootstrap credentials.
      fs.writeFileSync(bootstrapPath, JSON.stringify({ login, password: generatedPassword }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      console.log(`Первичные учётные данные созданы: ./data/${path.basename(bootstrapPath)} (доступ только владельцу файла).`);
    }
    if (changed) {
      await transaction(async () => {
        await pool.query(`INSERT INTO auth_admin (id,login,password_hash,jwt_secret,version)
          VALUES (1,$1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET
          login=excluded.login,password_hash=excluded.password_hash,jwt_secret=excluded.jwt_secret,
          version=excluded.version,updated_at=CURRENT_TIMESTAMP`,
        [login, passwordHash, secret, current ? current.version + 1 : 1]);
        await pool.query('DELETE FROM auth_sessions');
      });
    }
    await pool.query('DELETE FROM auth_sessions WHERE expires_at <= $1', [Math.floor(Date.now() / 1000)]);
    return { login, changed };
  } catch (error) { throw error; }
}

async function loginAdministrator(login, password) {
  try {
    const administrator = await getAdministrator();
    // Always calculate the password hash, including for an unknown login.
    const validPassword = await verifyPassword(password, administrator.password_hash);
    if (login !== administrator.login || !validPassword) throw new HttpError(401, 'Неверный логин или пароль', 'INVALID_CREDENTIALS');
    const sessionId = randomUUID();
    const token = jwt.sign({ role: 'admin', version: administrator.version }, administrator.jwt_secret,
      { ...JWT_OPTIONS, subject: '1', jwtid: sessionId, expiresIn: SESSION_SECONDS });
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    await pool.query('INSERT INTO auth_sessions (id,expires_at,admin_version) VALUES ($1,$2,$3)', [sessionId, expiresAt, administrator.version]);
    return { token, expiresAt, user: { login: administrator.login, role: 'admin' } };
  } catch (error) { throw error; }
}

async function authenticateToken(token) {
  try {
    const administrator = await getAdministrator();
    let payload;
    try {
      payload = jwt.verify(token, administrator.jwt_secret, {
        algorithms: ['HS256'], issuer: JWT_OPTIONS.issuer, audience: JWT_OPTIONS.audience,
      });
    } catch (error) {
      throw new HttpError(401, error.name === 'TokenExpiredError' ? 'Сессия истекла. Войдите снова.' : 'Недействительный токен. Войдите снова.',
        error.name === 'TokenExpiredError' ? 'SESSION_EXPIRED' : 'INVALID_TOKEN');
    }
    const session = (await pool.query('SELECT * FROM auth_sessions WHERE id=$1', [payload.jti])).rows[0];
    if (!session || payload.sub !== '1' || payload.version !== administrator.version ||
      session.admin_version !== administrator.version || session.expires_at <= Math.floor(Date.now()/1000)) {
      throw new HttpError(401, 'Сессия завершена. Войдите снова.', 'SESSION_EXPIRED');
    }
    if (payload.role !== 'admin') throw new HttpError(403, 'Недостаточно прав', 'FORBIDDEN');
    return { login: administrator.login, role: payload.role, sessionId: payload.jti, expiresAt: payload.exp };
  } catch (error) { throw error; }
}

async function logoutSession(id) {
  try { await pool.query('DELETE FROM auth_sessions WHERE id=$1', [id]); }
  catch (error) { throw error; }
}

module.exports = { initializeAdministrator, loginAdministrator, authenticateToken, logoutSession, hashPassword, verifyPassword, SESSION_SECONDS };
