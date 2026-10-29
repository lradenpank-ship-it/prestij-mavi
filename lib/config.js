'use strict';
// Yapılandırma: önce ortam değişkenleri, sonra config.json, sonra varsayılanlar.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let file = {};
try { file = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { /* config.json isteğe bağlı */ }
const g = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : (file[k] !== undefined ? file[k] : d));

const cfg = {
  ROOT,
  PORT: parseInt(g('PORT', 3000), 10),
  HOST: String(g('HOST', '0.0.0.0')),
  BASE_URL: String(g('BASE_URL', '')).replace(/\/+$/, ''),
  DATA_DIR: path.resolve(ROOT, String(g('DATA_DIR', 'data'))),
  TRUST_PROXY: String(g('TRUST_PROXY', '0')) === '1',
  // Ödeme: demo | paytr
  PAYMENT_PROVIDER: String(g('PAYMENT_PROVIDER', 'demo')).toLowerCase(),
  PAYTR_MERCHANT_ID: String(g('PAYTR_MERCHANT_ID', '')),
  PAYTR_KEY: String(g('PAYTR_KEY', '')),
  PAYTR_SALT: String(g('PAYTR_SALT', '')),
  PAYTR_TEST: String(g('PAYTR_TEST', '1')),
  // E-posta (isteğe bağlı)
  SMTP_HOST: String(g('SMTP_HOST', '')),
  SMTP_PORT: parseInt(g('SMTP_PORT', 465), 10),
  SMTP_SECURE: String(g('SMTP_SECURE', 'tls')), // tls (465) | starttls (587) | none
  SMTP_USER: String(g('SMTP_USER', '')),
  SMTP_PASS: String(g('SMTP_PASS', '')),
  SMTP_FROM: String(g('SMTP_FROM', '')),
  // İlk kurulumda yönetici
  ADMIN_USER: String(g('ADMIN_USER', 'admin')),
  ADMIN_PASS: String(g('ADMIN_PASS', '')),
  SEED_DEMO: String(g('SEED_DEMO', '1')) === '1',
  LOG_KEEP_DAYS: parseInt(g('LOG_KEEP_DAYS', 60), 10),
  BACKUP_KEEP: parseInt(g('BACKUP_KEEP', 14), 10),
};
cfg.IS_HTTPS = cfg.BASE_URL.startsWith('https://');
module.exports = cfg;
