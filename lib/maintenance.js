'use strict';
// Arka plan bakım işleri: yedek, günlük temizliği, oturum temizliği, süresi dolan siparişler, e-posta kuyruğu.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const log = require('./logger');
const shop = require('./shop');
const mail = require('./mail');
const auth = require('./auth');

const backupDir = path.join(cfg.DATA_DIR, 'yedekler');

function backup(db) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDHHMM
  const file = path.join(backupDir, `magaza-${stamp}.sqlite`);
  if (fs.existsSync(file)) return file;
  // VACUUM INTO: çalışan veritabanından tutarlı, sıkıştırılmış kopya (WAL dahil)
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  // eski yedekleri sil
  const all = fs.readdirSync(backupDir).filter((f) => /^magaza-\d{12}\.sqlite$/.test(f)).sort();
  while (all.length > cfg.BACKUP_KEEP) { try { fs.unlinkSync(path.join(backupDir, all.shift())); } catch { break; } }
  log.info(`Yedek alındı: ${file}`);
  return file;
}

function listBackups() {
  try {
    return fs.readdirSync(backupDir).filter((f) => /^magaza-\d{12}\.sqlite$/.test(f)).sort().reverse()
      .map((f) => ({ name: f, size: fs.statSync(path.join(backupDir, f)).size }));
  } catch { return []; }
}

function start(app) {
  const { db, S } = app;
  const every = (ms, fn, name) => {
    const t = setInterval(() => { Promise.resolve().then(fn).catch((err) => log.error(`Bakım işi hata verdi: ${name}`, err)); }, ms);
    t.unref(); return t;
  };
  every(10 * 60 * 1000, () => { const n = shop.expireUnpaid(db, S); if (n) log.info(`${n} ödenmemiş sipariş süresi dolduğu için iptal edildi.`); }, 'siparis-zaman-asimi');
  every(30 * 1000, () => mail.processOutbox(db, log), 'eposta');
  every(60 * 60 * 1000, () => { auth.cleanupSessions(db); mail.cleanupOutbox(db); log.cleanup(); }, 'temizlik');
  every(6 * 60 * 60 * 1000, () => backup(db), 'yedek');
  every(60 * 60 * 1000, () => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.exec('PRAGMA optimize'); } catch (err) { log.warn('WAL checkpoint: ' + err.message); } }, 'wal');
  // açılışta bir kez
  setTimeout(() => { try { backup(db); auth.cleanupSessions(db); log.cleanup(); shop.expireUnpaid(db, S); } catch (err) { log.error('Açılış bakımı', err); } }, 3000).unref();
}

module.exports = { start, backup, listBackups, backupDir };
