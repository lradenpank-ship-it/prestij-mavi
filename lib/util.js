'use strict';
const crypto = require('crypto');

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => MAP[c]);

const nf = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
/** kuruş -> "84.900 ₺" / "1.290,50 ₺" */
const tl = (k) => {
  k = Math.round(Number(k) || 0);
  return (k % 100 === 0 ? nf0.format(k / 100) : nf.format(k / 100)) + ' ₺';
};

function slugify(s) {
  const out = String(s || '').toLocaleLowerCase('tr')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return out || 'urun';
}

/** Türkçe karakterleri sadeleştirilmiş, küçük harfli arama anahtarı */
function searchKey(s) {
  return String(s == null ? '' : s).toLocaleLowerCase('tr')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/i̇/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "84.900,50" | "84900.5" -> kuruş (NaN: geçersiz) */
function parseMoney(s) {
  s = String(s == null ? '' : s).trim().replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) : NaN;
}

const dateTR = (ms) => (ms ? new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const dayTR = (ms) => (ms ? new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

const rid = (n = 12) => crypto.randomBytes(n).toString('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

/** Düz metin -> güvenli paragraflar */
function paragraphs(text) {
  return String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${e(p).replace(/\n/g, '<br>')}</p>`).join('');
}

const isEmail = (s) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(s)) && String(s).length <= 254;
const cleanPhone = (s) => String(s || '').replace(/[^\d+]/g, '').slice(0, 16);
const isPhone = (s) => { const d = String(s).replace(/\D/g, ''); return d.length >= 10 && d.length <= 13; };
const trim = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);

function luhn(num) {
  const d = String(num).replace(/\D/g, '');
  if (d.length < 12 || d.length > 19) return false;
  let sum = 0; let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

module.exports = { e, tl, slugify, searchKey, parseMoney, dateTR, dayTR, rid, sha256, hmac, safeEq, clamp, int, paragraphs, isEmail, cleanPhone, isPhone, trim, luhn };
