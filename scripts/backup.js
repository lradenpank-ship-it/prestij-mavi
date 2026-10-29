'use strict';
// Elle / cron ile yedek: node scripts/backup.js [hedef-klasör]
// Veritabanını (tutarlı kopya) ve yüklenen fotoğrafları hedef klasöre alır.
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const { open, dbFile } = require('../lib/db');
const dest = path.resolve(process.argv[2] || path.join(cfg.DATA_DIR, 'yedekler'));
fs.mkdirSync(dest, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const db = open(dbFile());
const file = path.join(dest, `magaza-${stamp}.sqlite`);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
const up = path.join(cfg.DATA_DIR, 'uploads');
if (fs.existsSync(up)) fs.cpSync(up, path.join(dest, `uploads-${stamp}`), { recursive: true });
console.log('Yedek alındı:', file);
