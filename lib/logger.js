'use strict';
// Günlük dosyalara yazan, tamponlu ve süresi dolunca silen basit günlükçü.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const dir = path.join(cfg.DATA_DIR, 'logs');
fs.mkdirSync(dir, { recursive: true });
const buf = new Map(); // dosya -> satırlar

const day = () => new Date().toISOString().slice(0, 10);

function write(kind, text) {
  const file = path.join(dir, `${kind}-${day()}.log`);
  let arr = buf.get(file);
  if (!arr) { arr = []; buf.set(file, arr); }
  if (arr.length < 5000) arr.push(`${new Date().toISOString()} ${text}\n`); // bellek şişmesin
}

function flush() {
  for (const [file, arr] of buf) {
    if (!arr.length) { buf.delete(file); continue; }
    const data = arr.join('');
    buf.delete(file);
    fs.appendFile(file, data, () => {});
  }
}
const timer = setInterval(flush, 1000);
timer.unref();

function flushSync() {
  for (const [file, arr] of buf) {
    try { if (arr.length) fs.appendFileSync(file, arr.join('')); } catch { /* yok say */ }
  }
  buf.clear();
}

function cleanup() {
  const limit = Date.now() - cfg.LOG_KEEP_DAYS * 86400000;
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p); } catch { /* yok say */ }
    }
  } catch { /* yok say */ }
}

const log = {
  access: (t) => write('access', t),
  info: (t) => { write('app', 'INFO ' + t); console.log(t); },
  warn: (t) => { write('app', 'WARN ' + t); console.warn(t); },
  error: (t, err) => {
    const msg = err && err.stack ? `${t}\n${err.stack}` : `${t} ${err || ''}`;
    write('error', msg); console.error(msg);
  },
  flush, flushSync, cleanup, dir,
};
module.exports = log;
