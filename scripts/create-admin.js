'use strict';
// Yönetici ekle / şifre sıfırla:  node scripts/create-admin.js kullanici "YeniSifre123456"
const cfg = require('../lib/config');
const { open, dbFile } = require('../lib/db');
const auth = require('../lib/auth');
(async () => {
  const [u, pw] = process.argv.slice(2);
  if (!u || !pw) { console.error('Kullanım: node scripts/create-admin.js <kullanıcı> <şifre>'); process.exit(1); }
  const prob = auth.passwordProblem(pw); if (prob) { console.error(prob); process.exit(1); }
  const db = open(dbFile()); const hash = await auth.hashPassword(pw);
  const ex = db.prepare('SELECT id FROM admins WHERE lower(username)=lower(?)').get(u);
  if (ex) { db.prepare('UPDATE admins SET pass_hash=? WHERE id=?').run(hash, ex.id); db.prepare('DELETE FROM sessions WHERE admin_id=?').run(ex.id); console.log('Şifre güncellendi:', u); }
  else { db.prepare('INSERT INTO admins(username,pass_hash,created_at) VALUES(?,?,?)').run(u, hash, Date.now()); console.log('Yönetici eklendi:', u); }
  db.close();
})();
