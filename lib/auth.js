'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const U = require('./util');
const { HttpError } = require('./http');

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 7;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hashHex, 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

function passwordProblem(pw) {
  if (String(pw).length < 10) return 'Şifre en az 10 karakter olmalı.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Şifre hem harf hem rakam içermeli.';
  return null;
}

function createSession(ctx, adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  ctx.db.prepare('INSERT INTO sessions(token_hash,admin_id,expires_at,ip) VALUES(?,?,?,?)')
    .run(U.sha256(token), adminId, Date.now() + SESSION_DAYS * 86400000, ctx.ip);
  ctx.cookie('psid', token, { maxAge: SESSION_DAYS * 86400 });
}

function currentAdmin(ctx) {
  if (ctx._admin !== undefined) return ctx._admin;
  const t = ctx.cookies.psid;
  let admin = null;
  if (t && /^[a-f0-9]{64}$/.test(t)) {
    admin = ctx.db.prepare(`SELECT a.id, a.username FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(U.sha256(t), Date.now()) || null;
  }
  ctx._admin = admin;
  return admin;
}

function requireAdmin(ctx) {
  const a = currentAdmin(ctx);
  if (!a) { ctx.redirect('/yonetim/giris'); return null; }
  return a;
}

function destroySession(ctx) {
  const t = ctx.cookies.psid;
  if (t) ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(U.sha256(t));
  ctx.clearCookie('psid');
}

function audit(ctx, action, detail) {
  const a = currentAdmin(ctx);
  ctx.db.prepare('INSERT INTO audit(at,admin,action,detail) VALUES(?,?,?,?)').run(Date.now(), a ? a.username : '-', action, String(detail || '').slice(0, 500));
}

/** İlk kurulumda yönetici yoksa oluşturur. Şifre verilmemişse rastgele üretir ve data/ilk-sifre.txt'ye yazar. */
async function ensureAdmin(db, cfg, log) {
  const n = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
  if (n > 0) return;
  let pw = cfg.ADMIN_PASS; let generated = false;
  if (!pw) { pw = crypto.randomBytes(9).toString('base64url') + '7'; generated = true; }
  const hash = await hashPassword(pw);
  db.prepare('INSERT INTO admins(username,pass_hash,created_at) VALUES(?,?,?)').run(cfg.ADMIN_USER, hash, Date.now());
  if (generated) {
    const fs = require('fs'); const path = require('path');
    const f = path.join(cfg.DATA_DIR, 'ilk-sifre.txt');
    fs.writeFileSync(f, `Yönetim paneli: /yonetim\nKullanıcı: ${cfg.ADMIN_USER}\nŞifre: ${pw}\n\nGiriş yaptıktan sonra şifreyi değiştirin ve bu dosyayı silin.\n`, { mode: 0o600 });
    log.info(`Yönetici oluşturuldu. Giriş bilgileri: ${f}`);
  } else log.info(`Yönetici oluşturuldu: ${cfg.ADMIN_USER}`);
}

function cleanupSessions(db) { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); }

module.exports = { hashPassword, verifyPassword, passwordProblem, createSession, currentAdmin, requireAdmin, destroySession, audit, ensureAdmin, cleanupSessions, HttpError };
