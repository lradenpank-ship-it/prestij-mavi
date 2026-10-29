'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const cfg = require('./config');
const U = require('./util');

class HttpError extends Error {
  constructor(status, message) { super(message || String(status)); this.status = status; }
}

// ---------- Hız sınırlama (bellek sınırlı) ----------
const buckets = new Map();
const MAX_BUCKETS = 50000;
function hit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear(); // saldırı altında bile bellek sınırlı kalır
    b = { n: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.n += 1;
  return b.n <= limit;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k); }, 60000).unref();

// ---------- Çerezler ----------
function parseCookies(h) {
  const out = {};
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* bozuk çerez */ }
  }
  return out;
}

function cookieStr(name, value, o = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${o.path || '/'}; SameSite=${o.sameSite || 'Lax'}`;
  if (o.httpOnly !== false) s += '; HttpOnly';
  if (o.maxAge != null) s += `; Max-Age=${Math.floor(o.maxAge)}`;
  if (o.secure) s += '; Secure';
  return s;
}

// ---------- Gövde okuma ----------
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = parseInt(req.headers['content-length'] || '0', 10);
    if (len > limit) { reject(new HttpError(413, 'İstek çok büyük')); req.resume(); return; }
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'İstek çok büyük')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseUrlencoded(buf) {
  const out = Object.create(null);
  const sp = new URLSearchParams(buf.toString('utf8'));
  let n = 0;
  for (const [k, v] of sp) {
    if (++n > 400) break;
    if (k.endsWith('[]')) { (out[k.slice(0, -2)] = out[k.slice(0, -2)] || []).push(v); } else out[k] = v;
  }
  return out;
}

function parseMultipart(buf, boundary) {
  const fields = Object.create(null); const files = [];
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  let parts = 0;
  while (pos !== -1 && parts++ < 100) {
    pos += delim.length;
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break; // kapanış
    if (buf[pos] === 0x0d) pos += 2;
    const headEnd = buf.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) break;
    const head = buf.slice(pos, headEnd).toString('utf8');
    const next = buf.indexOf(delim, headEnd + 4);
    if (next < 0) break;
    const data = buf.slice(headEnd + 4, next - 2); // sondaki \r\n
    const name = /name="([^"]*)"/i.exec(head);
    const fn = /filename="([^"]*)"/i.exec(head);
    const ct = /content-type:\s*([^\r\n;]+)/i.exec(head);
    if (name) {
      if (fn) { if (fn[1] && data.length) files.push({ field: name[1], filename: fn[1], type: ct ? ct[1].trim() : '', data }); } else fields[name[1]] = data.toString('utf8');
    }
    pos = next;
  }
  return { fields, files };
}

// ---------- İstek bağlamı ----------
class Ctx {
  constructor(req, res, app) {
    this.req = req; this.res = res; this.app = app;
    this.db = app.db; this.S = app.S; this.cfg = cfg;
    this.method = req.method;
    const u = new URL(req.url, 'http://x');
    this.path = u.pathname; this.query = Object.fromEntries(u.searchParams); this.url = u;
    this.cookies = parseCookies(req.headers.cookie);
    this.setCookies = [];
    this.params = []; this.form = Object.create(null); this.files = [];
    this.status = 200; this.headers = {};
    const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    this.ip = (cfg.TRUST_PROXY && xf) || req.socket.remoteAddress || '0.0.0.0';
    this.secure = cfg.IS_HTTPS || (cfg.TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
    this.wantsJson = (req.headers.accept || '').includes('application/json');
    this.sent = false;
  }

  cookie(name, value, o = {}) { this.setCookies.push(cookieStr(name, value, { secure: this.secure, ...o })); }
  clearCookie(name) { this.setCookies.push(cookieStr(name, '', { maxAge: 0, secure: this.secure })); }

  limit(key, n, windowMs) {
    if (!hit(`${key}:${this.ip}`, n, windowMs)) throw new HttpError(429, 'Çok fazla deneme. Lütfen biraz bekleyip tekrar deneyin.');
  }

  /** CSRF: çereze bağlı HMAC belirteci */
  csrf() {
    let c = this.cookies.pcsrf;
    if (!c || !/^[a-f0-9]{32}$/.test(c)) {
      c = U.rid(16); this.cookies.pcsrf = c;
      this.cookie('pcsrf', c, { maxAge: 86400 * 30 });
    }
    return U.hmac(this.app.secret, 'csrf:' + c).slice(0, 40);
  }
  csrfField() { return `<input type="hidden" name="_csrf" value="${this.csrf()}">`; }
  checkCsrf() {
    const c = this.cookies.pcsrf;
    const t = this.form._csrf;
    if (!c || !t || !U.safeEq(U.hmac(this.app.secret, 'csrf:' + c).slice(0, 40), t)) {
      throw new HttpError(403, 'Oturum süresi doldu veya form geçersiz. Sayfayı yenileyip tekrar deneyin.');
    }
  }

  async parseBody(limit = 1024 * 1024) {
    if (this.method !== 'POST') return;
    const ct = this.req.headers['content-type'] || '';
    const buf = await readBody(this.req, limit);
    if (ct.startsWith('multipart/form-data')) {
      const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
      if (!m) throw new HttpError(400, 'Geçersiz form');
      const r = parseMultipart(buf, m[1] || m[2]);
      this.form = r.fields; this.files = r.files;
    } else if (ct.startsWith('application/x-www-form-urlencoded')) {
      this.form = parseUrlencoded(buf);
    } else if (ct.startsWith('application/json')) {
      try { this.form = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Geçersiz JSON'); }
    }
  }

  // ----- yanıtlar -----
  _finish(status, type, body, extra = {}) {
    if (this.sent) return;
    this.sent = true;
    const res = this.res;
    const h = {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; frame-src 'self' https://www.paytr.com; form-action 'self'; base-uri 'self'; object-src 'none'",
      ...this.headers, ...extra,
    };
    if (this.secure) h['Strict-Transport-Security'] = 'max-age=31536000';
    if (this.setCookies.length) h['Set-Cookie'] = this.setCookies;
    let payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    const ae = this.req.headers['accept-encoding'] || '';
    if (payload.length > 1024 && /^(text\/|application\/(json|javascript|xml)|image\/svg)/.test(type) && /\bgzip\b/.test(ae)) {
      payload = zlib.gzipSync(payload, { level: 5 }); h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding';
    }
    h['Content-Length'] = payload.length;
    this.status = status;
    res.writeHead(status, h);
    res.end(this.method === 'HEAD' ? undefined : payload);
  }
  html(body, status) { this._finish(status || this.status, 'text/html; charset=utf-8', body, { 'Cache-Control': 'no-store' }); }
  json(obj, status) { this._finish(status || this.status, 'application/json; charset=utf-8', JSON.stringify(obj), { 'Cache-Control': 'no-store' }); }
  text(body, status, type = 'text/plain; charset=utf-8') { this._finish(status || this.status, type, body, { 'Cache-Control': 'no-cache' }); }
  redirect(to, status = 303) {
    if (this.sent) return; this.sent = true;
    const h = { Location: to, 'Cache-Control': 'no-store' };
    if (this.setCookies.length) h['Set-Cookie'] = this.setCookies;
    this.status = status; this.res.writeHead(status, h); this.res.end();
  }
  flash(msg, kind = 'ok') { this.cookie('pflash', `${kind}|${msg}`, { maxAge: 60 }); }
  takeFlash() {
    const f = this.cookies.pflash; if (!f) return null;
    this.clearCookie('pflash'); delete this.cookies.pflash;
    const i = f.indexOf('|'); return i < 0 ? null : { kind: f.slice(0, i), msg: f.slice(i + 1) };
  }
}

// ---------- Statik dosyalar (bellekte, sürüm damgalı) ----------
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };

function loadStatic(dirs) {
  const map = new Map();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    (function walk(d, rel) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) { walk(path.join(d, f.name), rel + f.name + '/'); continue; }
        const buf = fs.readFileSync(path.join(d, f.name));
        const type = TYPES[path.extname(f.name).toLowerCase()] || 'application/octet-stream';
        const ver = require('crypto').createHash('md5').update(buf).digest('hex').slice(0, 8);
        map.set('/static/' + rel + f.name, { buf, type, ver });
      }
    })(dir, '');
  }
  return map;
}

const UPLOAD_RE = /^\/uploads\/([a-f0-9]{24}\.(?:jpg|png|webp))$/;
function serveUpload(ctx) {
  const m = UPLOAD_RE.exec(ctx.path);
  if (!m) return false;
  const file = path.join(cfg.DATA_DIR, 'uploads', m[1]);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { ctx._finish(404, 'text/plain; charset=utf-8', 'Bulunamadı'); return; }
    const type = TYPES[path.extname(file)];
    ctx.sent = true;
    ctx.res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    if (ctx.method === 'HEAD') { ctx.res.end(); return; }
    fs.createReadStream(file).on('error', () => ctx.res.destroy()).pipe(ctx.res);
  });
  return true;
}

function imageExt(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

module.exports = { HttpError, Ctx, hit, loadStatic, serveUpload, imageExt, cookieStr, parseCookies };
