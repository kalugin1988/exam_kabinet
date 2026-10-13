'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const APP_DIR = path.resolve(__dirname, '..');
const envPath = path.join(APP_DIR, '.env');
// The local .env is the administrator's explicit startup configuration.
// Process variables are supported for deployment; a value in .env takes priority.
const fileConfig = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
const config = { ...process.env, ...fileConfig };
const port = Number(config.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT должен быть числом от 1 до 65535');

module.exports = { APP_DIR, config, port };
