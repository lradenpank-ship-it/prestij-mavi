'use strict';
// Prestij Servis Ekipmanları – e-ticaret sunucusu. Bağımlılık yok: yalnızca Node.js (22+).
const fs = require('fs');
const path = require('path');
const http = require('http');

const cfg = require('./lib/config');
fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
const log = require('./lib/logger');
const { open, settings, dbFile } = require('./lib/db');
const { Ctx, HttpError, hit, loadStatic, serveUpload } = require('./lib/http');
const U = require('./lib/util');
const auth = require('./lib/auth');
const seed = require('./lib/seed');
const maint = require('./lib/maintenance');
const pay = require('./lib/payments');
const { doc } = require('./lib/layout');

// ---- gizli anahtar (CSRF imzası). Bir kez üretilir, data/ içinde saklanır.
const secretFile = path.join(cfg.DATA_DIR, 'secret.key');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, U.rid(32), { mode: 0o600 });
const secret = fs.readFileSync(secretFile, 'utf8').trim();

const db = open(dbFile());
const S = settings(db);
if (cfg.SEED_DEMO) seed.run(db); else db.prepare('SELECT 1').get();

const theme = require('./theme');
const statics = loadStatic([path.join(cfg.ROOT, 'public'), path.join(cfg.ROOT, 'theme', 'public')]);
const app = {
  db, S, secret, theme,
  asset: (p) => { const f = statics.get(p); return f ? `${p}?v=${f.ver}` : p; },
};

// ---- rotalar
const exact = new Map(); const patterns = [];
for (const table of [require('./routes/shop'), require('./routes/admin')]) {
  for (const [m, p, h] of table) {
    const methods = Array.isArray(m) ? m : [m];
    for (const mm of methods) {
      if (typeof p === 'string') exact.set(`${mm} ${p}`, h); else patterns.push([mm, p, h]);
    }
  }
}
function match(ctx) {
  const m = ctx.method === 'HEAD' ? 'GET' : ctx.method;
  const h = exact.get(`${m} ${ctx.path}`);
  if (h) return h;
  for (const [mm, re, handler] of patterns) {
    if (mm !== m) continue;
    const r = re.exec(ctx.path);
    if (r) { ctx.params = r.slice(1); return handler; }
  }
  return null;
}

function serveStatic(ctx) {
  const f = statics.get(ctx.path);
  if (!f) throw new HttpError(404, 'Bulunamadı');
  const etag = `"${f.ver}"`;
  if (ctx.req.headers['if-none-match'] === etag) { ctx.sent = true; ctx.res.writeHead(304, { ETag: etag }); ctx.res.end(); return; }
  ctx._finish(200, f.type, f.buf, { ETag: etag, 'Cache-Control': ctx.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=3600' });
}

function errorPage(ctx, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const msg = status < 500 ? err.message : 'Beklenmeyen bir hata oluştu. Lütfen biraz sonra tekrar deneyin.';
  if (ctx.sent) { try { ctx.res.destroy(); } catch { /* yok */ } return; }
  if (ctx.wantsJson) return ctx.json({ ok: false, msg }, status);
  const title = status === 404 ? 'Sayfa bulunamadı' : status === 429 ? 'Çok fazla deneme' : status === 403 ? 'İşlem reddedildi' : 'Bir sorun oluştu';
  try {
    if (ctx.path.startsWith('/yonetim')) {
      return ctx.html(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${U.e(title)}</title><link rel="stylesheet" href="${app.asset('/static/admin.css')}"></head><body class="admin login"><div class="ad-login"><h1>${U.e(title)}</h1><p>${U.e(msg)}</p><a class="ad-btn" href="/yonetim">Yönetim ana sayfası</a></div></body></html>`, status);
    }
    ctx.html(doc(ctx, { title, noindex: true, body: `<div class="container narrow"><div class="empty err-page"><h1>${U.e(title)}</h1><p>${U.e(msg)}</p><p><a class="btn btn-primary" href="/">Ana sayfaya dön</a> <a class="btn btn-ghost" href="/urunler">Ürünlere göz at</a></p></div></div>` }), status);
  } catch (e2) {
    log.error('Hata sayfası üretilemedi', e2);
    if (!ctx.sent) ctx.text(msg, status);
  }
}

async function handle(req, res) {
  const t0 = process.hrtime.bigint();
  const ctx = new Ctx(req, res, app);
  ctx.theme = theme;
  try {
    if (!hit(`g:${ctx.ip}`, 900, 60000)) throw new HttpError(429, 'Çok fazla istek. Lütfen biraz bekleyin.');
    if (!['GET', 'HEAD', 'POST'].includes(ctx.method)) throw new HttpError(405, 'Desteklenmeyen istek');
    if (ctx.path.startsWith('/static/')) return serveStatic(ctx);
    if (ctx.path.startsWith('/uploads/')) { if (serveUpload(ctx)) return; throw new HttpError(404, 'Bulunamadı'); }
    if (ctx.path === '/favicon.ico') return ctx.redirect('/static/favicon.svg', 301);
    if (ctx.path.length > 1 && ctx.path.endsWith('/')) return ctx.redirect(ctx.path.slice(0, -1) + ctx.url.search, 301);
    const handler = match(ctx);
    if (!handler) throw new HttpError(404, 'Aradığınız sayfa bulunamadı.');
    await ctx.parseBody(/^\/yonetim\/urun\/(yeni|\d+)$/.test(ctx.path) ? 6 * 1024 * 1024 : 256 * 1024);
    await handler(ctx);
    if (!ctx.sent) throw new Error('Yanıt üretilmedi: ' + ctx.path);
  } catch (err) {
    if (!(err instanceof HttpError)) log.error(`İstek hatası ${ctx.method} ${ctx.path}`, err);
    errorPage(ctx, err);
  } finally {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    log.access(`${ctx.ip} ${ctx.method} ${ctx.path} ${res.statusCode} ${ms.toFixed(1)}ms ${(req.headers['user-agent'] || '-').slice(0, 80)}`);
  }
}

const server = http.createServer((req, res) => { handle(req, res).catch((err) => { log.error('Kritik istek hatası', err); try { res.destroy(); } catch { /* yok */ } }); });
server.headersTimeout = 20000; server.requestTimeout = 60000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 60;
server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* yok */ } });
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') log.error(`Port ${cfg.PORT} kullanımda. Başka bir PORT deneyin: PORT=3001 node server.js`);
  else log.error('Sunucu hatası', err);
  log.flushSync(); process.exit(1);
});

let closing = false;
function shutdown(sig) {
  if (closing) return; closing = true;
  log.info(`${sig} alındı, kapatılıyor…`);
  server.close(() => finish());
  setTimeout(finish, 10000).unref();
  function finish() { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* yok */ } log.flushSync(); process.exit(0); }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => { log.error('Yakalanmamış hata (süreç yeniden başlatılacak)', err); log.flushSync(); process.exit(1); });
process.on('unhandledRejection', (err) => { log.error('Yakalanmamış söz reddi', err); });

(async () => {
  await auth.ensureAdmin(db, cfg, log);
  maint.start(app);
  setInterval(() => { const m = process.memoryUsage(); log.info(`bellek rss=${(m.rss / 1048576).toFixed(0)}MB heap=${(m.heapUsed / 1048576).toFixed(0)}MB`); }, 3600000).unref();
  server.listen(cfg.PORT, cfg.HOST, () => {
    log.info(`Mağaza çalışıyor: http://localhost:${cfg.PORT}  (yönetim: /yonetim)  tema: ${theme.id}  ödeme: ${pay.provider}`);
    if (pay.isDemo()) log.warn('UYARI: Ödeme DEMO modunda; gerçek tahsilat yapılmaz. Canlı kullanım için README’ye bakın.');
  });
})().catch((err) => { log.error('Başlatma hatası', err); log.flushSync(); process.exit(1); });
