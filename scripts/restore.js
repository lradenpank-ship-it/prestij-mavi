'use strict';
// Yedekten geri yükleme: önce sunucuyu durdurun.  node scripts/restore.js yedek-dosyasi.sqlite
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const { dbFile } = require('../lib/db');
const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('Kullanım: node scripts/restore.js <yedek.sqlite>'); process.exit(1); }
const { DatabaseSync } = require('node:sqlite');
const t = new DatabaseSync(src); const ok = t.prepare('PRAGMA integrity_check').get(); t.close();
if (Object.values(ok)[0] !== 'ok') { console.error('Yedek dosyası bozuk görünüyor:', ok); process.exit(1); }
const target = dbFile();
if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.onceki-${Date.now()}`);
for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(target + ext); } catch { /* yok */ } }
fs.copyFileSync(src, target);
console.log('Geri yüklendi:', target, '(eski veritabanı .onceki-* olarak saklandı)');
