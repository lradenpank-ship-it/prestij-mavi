'use strict';
// Yük ve dayanıklılık testi: gerçek HTTP ile N sipariş verir, sonra büyük veritabanında yönetim sorgularını ölçer.
// Kullanım:  node scripts/loadtest.js 10000 [eşzamanlılık=24]
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const N = parseInt(process.argv[2] || '2000', 10); const CONC = parseInt(process.argv[3] || '24', 10);
const PORT = 3800 + Math.floor(Math.random() * 90);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'magaza-load-'));
const agent = new http.Agent({ keepAlive: true, maxSockets: CONC * 2 });
const call = (method, url, form, headers = {}) => new Promise((resolve, reject) => {
  const body = form ? new URLSearchParams(form).toString() : null;
  const r = http.request({ agent, host: '127.0.0.1', port: PORT, path: url, method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) } }, (res) => {
    const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(ch).toString() }));
  });
  r.on('error', reject); if (body) r.write(body); r.end();
});
const cookies = (res) => (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const ms = () => Number(process.hrtime.bigint() / 1000000n);
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)] || 0;

(async () => {
  const srv = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: DATA, ADMIN_PASS: 'Test12345678x', TRUST_PROXY: '1', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; srv.stdout.on('data', (d) => { out += d; }); srv.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 60; i++) { try { await call('GET', '/saglik'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(DATA, 'magaza.sqlite'));
  db.prepare('UPDATE products SET stock=?').run(N * 5);
  // arama sorgularını anlamlı kılmak için çok sayıda ürün ekle
  const ip = db.prepare(`INSERT INTO products(slug,sku,name,category_id,price,stock,short,kind,created_at,updated_at,search) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  db.exec('BEGIN'); for (let i = 0; i < 5000; i++) ip.run(`yuk-urun-${i}`, `YK-${i}`, `Yük test ürünü ${i}`, 1 + (i % 12), 100000 + i * 100, 50, 'test', 'lokma', Date.now() - i * 1000, Date.now(), `yuk test urunu ${i}`); db.exec('COMMIT');
  console.log(`${N} sipariş, eşzamanlılık ${CONC}`);
  const lat = []; let done = 0; let failed = 0; const t0 = ms(); let next = 0;
  const one = async (i) => {
    const ipaddr = { 'X-Forwarded-For': `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` };
    const s = ms();
    const r1 = await call('GET', '/', null, ipaddr); const jar = cookies(r1);
    const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(r1.text)[1];
    const pid = 1 + (i % 12); const h = { ...ipaddr, Cookie: jar };
    const r2 = await call('POST', '/sepet/ekle', { _csrf: csrf, id: pid, qty: 1 + (i % 3) }, h); h.Cookie = `${jar}; ${cookies(r2)}`;
    const r3 = await call('GET', '/odeme', null, h); const idem = /name="idem" value="([a-f0-9]+)"/.exec(r3.text)[1];
    const r4 = await call('POST', '/odeme', { _csrf: csrf, idem, name: `Müşteri ${i}`, email: `m${i}@example.com`, phone: `053${String(1000000 + i).slice(-7)}`, city: 'İstanbul', address: `Test mahallesi ${i}. sokak no ${i % 90}`, invoice_type: 'bireysel', pay_method: 'havale', consent: '1' }, h);
    lat.push(ms() - s);
    if (r4.status !== 303) { failed++; if (failed < 4) console.log('  hata', r4.status, r4.text.slice(0, 200)); }
    done++;
  };
  const worker = async () => { for (;;) { const i = next++; if (i >= N) return; try { await one(i); } catch (err) { failed++; if (failed < 4) console.log('  istisna', err.message); } if (done % 1000 === 0 && done) process.stdout.write(`  ${done}…\r`); } };
  await Promise.all(Array.from({ length: CONC }, worker));
  const dt = (ms() - t0) / 1000;
  console.log(`\nSüre ${dt.toFixed(1)} sn → ${(N / dt).toFixed(1)} sipariş/sn (her sipariş 4 istek) · başarısız: ${failed}`);
  console.log(`Sipariş akışı gecikmesi (4 istek toplamı): p50=${pct(lat, 0.5)}ms p95=${pct(lat, 0.95)}ms p99=${pct(lat, 0.99)}ms`);
  const cnt = db.prepare('SELECT COUNT(*) c, COUNT(DISTINCT no) d FROM orders').get();
  console.log(`Veritabanı: ${cnt.c} sipariş, ${cnt.d} benzersiz numara, ${(fs.statSync(path.join(DATA, 'magaza.sqlite')).size / 1048576).toFixed(1)} MB`);
  const stockSum = db.prepare('SELECT SUM(stock) s FROM products WHERE id<=12').get().s; const sold = db.prepare('SELECT SUM(qty) q FROM order_items').get().q;
  console.log(`Stok tutarlılığı: ${12 * N * 5} - ${sold} satılan = ${12 * N * 5 - sold}, kalan stok toplamı = ${stockSum} → ${12 * N * 5 - sold === stockSum ? 'TUTARLI' : 'TUTARSIZ!'}`);
  const bad = db.prepare('SELECT COUNT(*) c FROM orders o WHERE total <> subtotal + shipping OR subtotal <> (SELECT SUM(qty*unit_price) FROM order_items WHERE order_id=o.id)').get().c; console.log(`Tutar tutarsızlığı olan sipariş: ${bad}`);
  // yönetim ve mağaza sorguları büyük veride
  const login = await call('GET', '/yonetim/giris'); let jar = cookies(login); const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(login.text)[1];
  const lr = await call('POST', '/yonetim/giris', { _csrf: csrf, username: 'admin', password: 'Test12345678x' }, { Cookie: jar }); jar = jar + '; ' + cookies(lr);
  const timed = async (name, url) => { const s = ms(); const r = await call('GET', url, null, { Cookie: jar }); console.log(`  ${name.padEnd(34)} ${String(ms() - s).padStart(5)} ms  (${r.status}, ${(r.text.length / 1024).toFixed(0)} KB)`); };
  console.log('Büyük veride sayfa süreleri:');
  await timed('Ana sayfa', '/'); await timed('Ürün listesi (5000 ürün) sayfa 3', '/urunler?sayfa=3'); await timed('Ürün araması', '/urunler?q=yuk+test+urunu+42');
  await timed('Yönetim özeti', '/yonetim'); await timed('Siparişler ilk sayfa', '/yonetim/siparisler'); await timed('Siparişler son sayfa', `/yonetim/siparisler?sayfa=${Math.ceil(N / 50)}`);
  await timed('Sipariş araması (ad)', '/yonetim/siparisler?q=musteri+777'); await timed('Sipariş araması (telefon)', '/yonetim/siparisler?q=05311');
  await timed('Siparişler durum filtresi', '/yonetim/siparisler?durum=odeme-bekliyor'); await timed('Ürünler (yönetim) sayfa 20', '/yonetim/urunler?sayfa=20'); await timed('Site haritası', '/sitemap.xml');
  let s = ms(); const csv = await call('GET', '/yonetim/siparisler.csv', null, { Cookie: jar }); console.log(`  ${'CSV dışa aktarım'.padEnd(34)} ${String(ms() - s).padStart(5)} ms  (${(csv.text.length / 1048576).toFixed(1)} MB, ${csv.text.split('\n').length - 2} satır)`);
  s = ms(); db.exec(`VACUUM INTO '${path.join(DATA, 'test-yedek.sqlite')}'`); console.log(`  ${'Yedek (VACUUM INTO)'.padEnd(34)} ${String(ms() - s).padStart(5)} ms`);
  const mem = (await call('GET', '/saglik')).text; const rss = (() => { try { return (parseInt(fs.readFileSync(`/proc/${srv.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1], 10) / 1024).toFixed(0); } catch { return '?'; } })();
  console.log(`Sunucu belleği (RSS): ${rss} MB · sağlık: ${mem}`);
  db.close(); srv.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 800));
  if (/Kritik|Yakalanmamış|İstek hatası/.test(out)) console.log('SUNUCUDA HATA KAYDI VAR:\n' + out.slice(-1500)); else console.log('Sunucu günlüğünde hata yok.');
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* yok */ }
  process.exit(failed || cnt.c !== cnt.d || bad ? 1 : 0);
})();
