'use strict';
// Uçtan uca kendi kendine test: geçici veri klasörüyle sunucuyu başlatır, gerçek bir müşteri gibi
// sipariş verir, yönetici olarak onaylar. Kullanım:  node scripts/selftest.js
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3900 + Math.floor(Math.random() * 90);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'magaza-test-'));
const ADMIN_PASS = 'Test12345678x';
let pass = 0; let fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? '→ ' + String(extra).slice(0, 300) : ''); } };

class Client {
  constructor() { this.jar = {}; }
  req(method, url, form, headers = {}) {
    return new Promise((resolve, reject) => {
      const body = form ? new URLSearchParams(form).toString() : null;
      const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
      const r = http.request({ host: '127.0.0.1', port: PORT, path: url, method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          for (const sc of res.headers['set-cookie'] || []) {
            const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = decodeURIComponent(kv.slice(i + 1));
            if (/Max-Age=0/i.test(sc) || v === '') delete this.jar[k]; else this.jar[k] = v;
          }
          resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') });
        });
      });
      r.on('error', reject); if (body) r.write(body); r.end();
    });
  }
  get(u, h) { return this.req('GET', u, null, h); }
  post(u, f, h) { return this.req('POST', u, f, h); }
  async csrf(u = '/') { const r = await this.get(u); const m = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text); return m ? m[1] : null; }
}
const loc = (r) => r.headers.location || '';

async function main() {
  const srv = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: DATA, ADMIN_PASS, PAYMENT_PROVIDER: 'demo', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; srv.stdout.on('data', (d) => { out += d; }); srv.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 50; i++) { try { await new Client().get('/saglik'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  try {
    console.log('Sayfalar');
    const c = new Client();
    for (const u of ['/', '/urunler', '/kampanyalar', '/kategori/arac-liftleri', '/urun/iki-direkli-arac-lifti', '/sepet', '/siparis-takip', '/havale-bildirimi', '/iletisim', '/sayfa/hakkimizda', '/hakkimizda', '/sitemap.xml', '/robots.txt', '/saglik', '/urunler?q=cekmeceli', '/urunler?q=%C3%A7ekmeceli&sirala=fiyat-artan']) {
      const r = await c.get(u); ok(r.status === 200, `GET ${u}`, r.status);
    }
    ok((await c.get('/urunler?q=' + encodeURIComponent('takım'))).text.includes('Çekmeceli Takım Arabası'), 'Türkçe arama (takım)');
    ok((await c.get('/urunler?q=cekmeceli')).text.includes('Çekmeceli Takım Arabası'), 'Türkçe arama (ASCII)');
    ok((await c.get('/yok-boyle-sayfa')).status === 404, '404');
    ok((await c.get('/yonetim')).status === 303, 'Yönetim girişsiz yönlendirir');
    ok((await c.get('/static/base.css')).status === 200, 'Statik dosya');

    console.log('CSRF ve doğrulama');
    const noCsrf = await new Client().post('/sepet/ekle', { id: 1, qty: 1 });
    ok(noCsrf.status === 403, 'CSRF belirteci olmadan POST reddedilir', noCsrf.status);

    console.log('Sepet');
    let t = await c.csrf('/urun/hidrolik-garaj-krikosu');
    let r = await c.post('/sepet/ekle', { _csrf: t, id: 3, qty: 2, back: '/sepet' });
    ok(r.status === 303 && loc(r) === '/sepet', 'Sepete ekle', r.status);
    r = await c.post('/sepet/ekle', { _csrf: t, id: 3, qty: 1 }, { Accept: 'application/json' });
    const j = JSON.parse(r.text); ok(j.ok && j.count === 3, 'AJAX sepet sayacı', r.text);
    r = await c.post('/sepet/ekle', { _csrf: t, id: 999999, qty: 1 }, { Accept: 'application/json' });
    ok(JSON.parse(r.text).ok === false, 'Olmayan ürün eklenemez');
    r = await c.get('/sepet'); ok(r.text.includes('Hidrolik Garaj Krikosu') && r.text.includes('14.850'), 'Sepet toplamı (3 × 4.950)', r.text.match(/Toplam[^<]*<b>[^<]*/));
    r = await c.post('/sepet/guncelle', { _csrf: t, id: 3, qty: 1 }); ok(r.status === 303, 'Sepet güncelle');

    console.log('Havale siparişi');
    r = await c.get('/odeme'); ok(r.status === 200 && r.text.includes('Havale / EFT'), 'Ödeme sayfası');
    let m = /name="idem" value="([a-f0-9]+)"/.exec(r.text); const idem = m && m[1];
    t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1];
    r = await c.post('/odeme', { _csrf: t, idem, name: 'A', email: 'x', phone: '1', city: '', address: 'k', pay_method: 'havale' });
    ok(r.status === 422 && r.text.includes('Geçerli bir e-posta'), 'Geçersiz form 422 verir');
    const order = { _csrf: t, idem, name: 'Ali Veli', email: 'ali@example.com', phone: '0532 111 22 33', city: 'İstanbul', address: 'Sanayi Mah. 12. Sokak No:5 Tuzla', note: 'test', invoice_type: 'bireysel', pay_method: 'havale', consent: '1' };
    r = await c.post('/odeme', order); ok(r.status === 303 && /^\/siparis\/[a-f0-9]{24}\?yeni=1$/.test(loc(r)), 'Sipariş oluştu', loc(r) + r.text.slice(0, 200));
    const orderUrl = loc(r).split('?')[0];
    const r2 = await c.post('/odeme', order); ok(r2.status === 303 && r2.headers.location !== undefined, 'Boş sepetle tekrar gönderim reddedilir');
    r = await c.get(orderUrl); ok(r.text.includes('IBAN') && r.text.includes('PS26') || r.text.includes('IBAN'), 'Sipariş sayfası IBAN gösterir');
    const no = /PS\d{8}/.exec(r.text)[0];
    ok((await c.get('/urun/hidrolik-garaj-krikosu')).text.includes('Stokta var'), 'Stok hâlâ var');

    console.log('Havale bildirimi ve yönetici onayı');
    t = await c.csrf('/havale-bildirimi');
    r = await c.post('/havale-bildirimi', { _csrf: t, no, name: 'Ali Veli', bank: 'Test Bank', amount: '4.950,00', paid_on: '2026-10-29', note: '' });
    ok(r.status === 303, 'Havale bildirimi alındı', r.text.slice(0, 200));
    const a = new Client();
    t = await a.csrf('/yonetim/giris');
    r = await a.post('/yonetim/giris', { _csrf: t, username: 'admin', password: 'yanlis' }); ok(r.status === 401, 'Yanlış şifre reddedilir');
    r = await a.post('/yonetim/giris', { _csrf: t, username: 'admin', password: ADMIN_PASS }); ok(r.status === 303 && loc(r) === '/yonetim', 'Yönetici girişi', r.status);
    for (const u of ['/yonetim', '/yonetim/siparisler', '/yonetim/urunler', '/yonetim/havale', '/yonetim/kategoriler', '/yonetim/mesajlar', '/yonetim/sayfalar', '/yonetim/ayarlar', '/yonetim/yonetici', '/yonetim/kayitlar', '/yonetim/urun/yeni', '/yonetim/urun/1', '/yonetim/siparisler.csv', '/yonetim/bulten.csv']) {
      r = await a.get(u); ok(r.status === 200, `Yönetim ${u}`, r.status);
    }
    r = await a.get('/yonetim/havale'); ok(r.text.includes(no), 'Havale bildirimi listede');
    const hid = /action="\/yonetim\/havale\/(\d+)"/.exec(r.text)[1];
    t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1];
    r = await a.post(`/yonetim/havale/${hid}`, { _csrf: t, act: 'onay' }); ok(r.status === 303, 'Havale onaylandı');
    r = await c.get(orderUrl); ok(r.text.includes('Hazırlanıyor') && r.text.includes('Ödendi'), 'Sipariş ödendi/hazırlanıyor', r.text.match(/pill[^>]*>[^<]*/g));
    r = await a.get('/yonetim/havale'); ok(!r.text.includes(`action="/yonetim/havale/${hid}"`), 'Onaylanan bildirim yeni listeden düştü');
    r = await a.post(`/yonetim/havale/${hid}`, { _csrf: t, act: 'onay' }); ok(r.status === 303, 'Çift onay zararsız');
    r = await c.get(orderUrl); const events = r.text.match(/Ödeme alındı/g) || []; ok(events.length === 1, 'Ödeme yalnızca bir kez işlendi', events.length);

    console.log('Sipariş takibi');
    t = await c.csrf('/siparis-takip');
    r = await c.post('/siparis-takip', { _csrf: t, no, who: 'ALI@example.com' }); ok(r.status === 303 && loc(r) === orderUrl, 'E-posta ile takip');
    r = await c.post('/siparis-takip', { _csrf: t, no, who: '0532 111 22 33' }); ok(r.status === 303 && loc(r) === orderUrl, 'Telefon ile takip');
    r = await c.post('/siparis-takip', { _csrf: t, no, who: 'baska@example.com' }); ok(r.status === 404, 'Yanlış bilgiyle takip reddedilir');

    console.log('Kart siparişi (demo)');
    const k = new Client();
    t = await k.csrf('/'); await k.post('/sepet/ekle', { _csrf: t, id: 8, qty: 1 });
    r = await k.get('/odeme'); t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1]; const idem2 = /name="idem" value="([a-f0-9]+)"/.exec(r.text)[1];
    r = await k.post('/odeme', { ...order, _csrf: t, idem: idem2, pay_method: 'kart' });
    ok(r.status === 303 && /^\/odeme\/kart\/[a-f0-9]{24}\/\d+$/.test(loc(r)), 'Kart ödeme sayfasına yönlendi', loc(r));
    const cardUrl = loc(r);
    r = await k.get(cardUrl); ok(r.text.includes('DEMO ÖDEME'), 'Demo kart formu'); t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1];
    r = await k.post(cardUrl, { _csrf: t, cc_name: 'Ali Veli', cc_number: '4000 0000 0000 0002', cc_exp: '12/39', cc_cvc: '123' }); ok(r.status === 422, 'Reddedilen kart');
    r = await k.post(cardUrl, { _csrf: t, cc_name: 'Ali Veli', cc_number: '1234 5678 9012 3456', cc_exp: '12/39', cc_cvc: '123' }); ok(r.status === 422, 'Geçersiz kart numarası');
    r = await k.post(cardUrl, { _csrf: t, cc_name: 'Ali Veli', cc_number: '4242 4242 4242 4242', cc_exp: '12/39', cc_cvc: '123' }); ok(r.status === 303 && loc(r).includes('odeme=ok'), 'Kart ödemesi başarılı', r.status + loc(r));
    r = await k.get(cardUrl); ok(r.status === 303, 'Ödenmiş ödeme tekrar açılmaz');
    const kOrder = loc(await k.get(cardUrl)); r = await k.get(kOrder.split('?')[0]); ok(r.text.includes('Ödendi'), 'Kart siparişi ödendi');
    ok(!/4242 4242/.test(r.text), 'Kart numarası sayfada yok');

    console.log('Kademeli ödeme (lift)');
    const g = new Client();
    t = await g.csrf('/'); await g.post('/sepet/ekle', { _csrf: t, id: 1, qty: 1 });
    r = await g.get('/odeme'); ok(r.text.includes('Kademeli ödeme'), 'Kademeli seçeneği sunuldu');
    t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1]; const idem3 = /name="idem" value="([a-f0-9]+)"/.exec(r.text)[1];
    r = await g.post('/odeme', { ...order, _csrf: t, idem: idem3, pay_method: 'kademeli', deposit_via: 'kart' });
    ok(r.status === 303 && loc(r).startsWith('/odeme/kart/'), 'Ön ödeme kart sayfası', loc(r));
    const dep = loc(r); r = await g.get(dep); t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1];
    ok(r.text.includes('25.470'), 'Ön ödeme %30 = 25.470 ₺', r.text.match(/[\d.]+ ₺ öde/));
    r = await g.post(dep, { _csrf: t, cc_name: 'Ali Veli', cc_number: '4242424242424242', cc_exp: '12/39', cc_cvc: '123' }); ok(r.status === 303, 'Ön ödeme alındı');
    const gOrder = loc(r).split('?')[0]; r = await g.get(gOrder);
    ok(r.text.includes('Kısmi ödendi') && r.text.includes('Hazırlanıyor'), 'Kısmi ödendi / hazırlanıyor');
    ok(r.text.includes('Kalan tutar') && r.text.includes('59.430'), 'Kalan tutar 59.430 ₺ gösterildi');
    const gNo = /PS\d{8}/.exec(r.text)[0];
    const bal = /action="\/siparis\/[a-f0-9]{24}\/yontem"[^>]*>.*?name="pid" value="(\d+)"/s.exec(r.text);
    ok(!!bal, 'Kalan tutar için ödeme yöntemi değiştirilebilir');
    t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1];
    r = await g.post(gOrder + '/yontem', { _csrf: t, pid: bal[1], method: 'kart' }); ok(r.status === 303 && loc(r).startsWith('/odeme/kart/'), 'Kalan tutar kartla ödenebilir');
    r = await g.get(loc(r)); t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1];
    r = await g.post(g.lastCard = r.text && '/odeme/kart/' + gOrder.split('/')[2] + '/' + bal[1], { _csrf: t, cc_name: 'Ali Veli', cc_number: '4242424242424242', cc_exp: '12/39', cc_cvc: '123' }); ok(r.status === 303, 'Kalan tutar ödendi', r.status);
    r = await g.get(gOrder); ok(/Ödendi/.test(r.text) && !r.text.includes('Kısmi ödendi'), 'Kademeli sipariş tam ödendi');

    console.log('Stok ve iptal');
    const db = new (require('node:sqlite').DatabaseSync)(path.join(DATA, 'magaza.sqlite'));
    const stock = (id) => db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock;
    ok(stock(1) === 11, 'Lift stoğu 12 → 11', stock(1));
    r = await a.get('/yonetim/siparisler'); const gid = new RegExp(`/yonetim/siparis/(\\d+)">${gNo}`).exec(r.text)[1];
    r = await a.get(`/yonetim/siparis/${gid}`); t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1];
    r = await a.post(`/yonetim/siparis/${gid}/durum`, { _csrf: t, status: 'kargoda', cargo_company: 'Test Kargo', cargo_no: 'TK123' }); ok(r.status === 303, 'Kargoya verildi');
    r = await g.get(gOrder); ok(r.text.includes('TK123'), 'Müşteri kargo bilgisini görüyor');
    const s0 = stock(3);
    const o3 = new Client(); t = await o3.csrf('/'); await o3.post('/sepet/ekle', { _csrf: t, id: 3, qty: 5 });
    r = await o3.get('/odeme'); t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1];
    r = await o3.post('/odeme', { ...order, _csrf: t, idem: /name="idem" value="([a-f0-9]+)"/.exec(r.text)[1], pay_method: 'havale' });
    ok(stock(3) === s0 - 5, 'Sipariş stoğu düşürdü', stock(3));
    const o3url = loc(r).split('?')[0]; const o3no = /PS\d{8}/.exec((await o3.get(o3url)).text)[0];
    r = await a.get('/yonetim/siparisler'); const oid = new RegExp(`/yonetim/siparis/(\\d+)">${o3no}`).exec(r.text)[1];
    r = await a.get(`/yonetim/siparis/${oid}`); t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1];
    r = await a.post(`/yonetim/siparis/${oid}/durum`, { _csrf: t, status: 'iptal' }); ok(stock(3) === s0, 'İptal stoğu geri verdi', stock(3));
    r = await a.post(`/yonetim/siparis/${oid}/durum`, { _csrf: t, status: 'iptal' }); ok(stock(3) === s0, 'İkinci iptal stoğu tekrar artırmaz', stock(3));
    r = await a.post(`/yonetim/siparis/${oid}/durum`, { _csrf: t, status: 'hazirlaniyor' }); r = await o3.get(o3url); ok(r.text.includes('İptal edildi'), 'İptal geri alınamaz');
    // stok yetersizliği
    db.prepare('UPDATE products SET stock=1 WHERE id=7').run();
    const o4 = new Client(); t = await o4.csrf('/'); await o4.post('/sepet/ekle', { _csrf: t, id: 7, qty: 1 });
    const o5 = new Client(); t = await o5.csrf('/'); await o5.post('/sepet/ekle', { _csrf: t, id: 7, qty: 1 });
    r = await o4.get('/odeme'); const t4 = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1]; const i4 = /name="idem" value="([a-f0-9]+)"/.exec(r.text)[1];
    r = await o5.get('/odeme'); const t5 = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1]; const i5 = /name="idem" value="([a-f0-9]+)"/.exec(r.text)[1];
    const [ra, rb] = [await o4.post('/odeme', { ...order, _csrf: t4, idem: i4, pay_method: 'havale' }), await o5.post('/odeme', { ...order, _csrf: t5, idem: i5, pay_method: 'havale' })];
    ok(db.prepare('SELECT COUNT(*) c FROM order_items WHERE product_id=7').get().c === 1 && stock(7) === 0, 'Son ürün yalnızca bir müşteriye satılır (aşırı satış yok)', `${ra.status}/${rb.status}/${stock(7)}`);
    // idempotency
    const o6 = new Client(); t = await o6.csrf('/'); await o6.post('/sepet/ekle', { _csrf: t, id: 8, qty: 1 });
    r = await o6.get('/odeme'); t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1]; const i6 = /name="idem" value="([a-f0-9]+)"/.exec(r.text)[1];
    const first = await o6.post('/odeme', { ...order, _csrf: t, idem: i6, pay_method: 'havale' });
    o6.jar.cart = '8.1'; // aynı formun tekrar gönderilmesi
    const dup = await o6.post('/odeme', { ...order, _csrf: t, idem: i6, pay_method: 'havale' });
    ok(first.status === 303 && dup.status === 303 && loc(first).split('?')[0] === loc(dup).split('?')[0], 'Çift gönderim aynı siparişi döndürür', `${loc(first)} | ${loc(dup)}`);
    ok(db.prepare('SELECT COUNT(*) c FROM orders WHERE idem=?').get(i6).c === 1, 'Tek sipariş kaydı');

    console.log('Yönetici: ürün ekle/düzenle');
    r = await a.get('/yonetim/urun/yeni'); t = /name="_csrf" value="([a-f0-9]+)"/.exec(r.text)[1];
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const boundary = '----t' + Date.now();
    const parts = [['_csrf', t], ['name', 'Test Ürünü Çelik'], ['category_id', '1'], ['price', '1.234,50'], ['stock', '5'], ['kind', 'lamba'], ['active', '1'], ['short', 'kısa'], ['description', 'açıklama'], ['specs', 'Güç: 5 kW']]
      .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
    const bodyBuf = Buffer.concat([Buffer.from(parts), Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    r = await new Promise((resolve, reject) => {
      const cookie = Object.entries(a.jar).map(([kk, v]) => `${kk}=${encodeURIComponent(v)}`).join('; ');
      const rq = http.request({ host: '127.0.0.1', port: PORT, path: '/yonetim/urun/yeni', method: 'POST', headers: { Cookie: cookie, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': bodyBuf.length } }, (res) => { let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: s })); });
      rq.on('error', reject); rq.end(bodyBuf);
    });
    ok(r.status === 303 && /\/yonetim\/urun\/\d+/.test(loc(r)), 'Fotoğraflı ürün eklendi', r.status + r.text.slice(0, 300));
    const pr = db.prepare('SELECT * FROM products ORDER BY id DESC LIMIT 1').get();
    ok(pr.price === 123450 && pr.image && pr.slug === 'test-urunu-celik', 'Fiyat/slug/görsel doğru', JSON.stringify(pr).slice(0, 200));
    r = await c.get(`/uploads/${pr.image}`); ok(r.status === 200 && r.headers['content-type'] === 'image/png', 'Yüklenen görsel sunuluyor');
    r = await c.get('/urun/test-urunu-celik'); ok(r.status === 200 && r.text.includes('1.234,50') && r.text.includes(`/uploads/${pr.image}`), 'Ürün sayfası yeni ürünü gösteriyor');
    ok((await c.get('/uploads/../../etc/passwd')).status === 404, 'Dizin gezintisi engelli');

    console.log('Güvenlik başlıkları');
    r = await c.get('/'); ok(!!r.headers['content-security-policy'] && r.headers['x-content-type-options'] === 'nosniff', 'CSP ve nosniff');
    ok(!/<script(?![^>]*src=)(?![^>]*ld\+json)[^>]*>/i.test(r.text), 'Satır içi betik yok');
    const xss = await c.get('/urunler?q=%3Cscript%3Ealert(1)%3C/script%3E'); ok(!xss.text.includes('<script>alert(1)'), 'Arama XSS kaçışlı');
    r = await c.post('/bulten', { email: 'a@b.co' }); ok(r.status === 403, 'Bülten CSRF korumalı');
    t = await c.csrf('/'); r = await c.post('/bulten', { _csrf: t, email: 'musteri@example.com' }); ok(r.status === 303, 'Bülten kaydı');
    t = await c.csrf('/iletisim'); r = await c.post('/iletisim', { _csrf: t, name: 'Ali', email: 'a@b.co', body: 'Merhaba, bilgi almak istiyorum', kind: 'iletisim' }); ok(r.status === 303, 'İletişim formu');
    r = await a.get('/yonetim/mesajlar'); ok(r.text.includes('Merhaba, bilgi almak istiyorum'), 'Mesaj yönetimde görünüyor');
    r = await a.post('/yonetim/cikis', { _csrf: await a.csrf('/yonetim') }); r = await a.get('/yonetim'); ok(r.status === 303, 'Çıkıştan sonra yönetim kapalı');

    console.log('Hız sınırı');
    const rl = new Client(); t = await rl.csrf('/yonetim/giris'); let blocked = false;
    for (let i = 0; i < 14; i++) { const x = await rl.post('/yonetim/giris', { _csrf: t, username: 'admin', password: 'x' + i }); if (x.status === 429) { blocked = true; break; } }
    ok(blocked, 'Çok sayıda yanlış girişte engellenir (429)');
    db.close();
  } catch (err) {
    fail++; console.log('  ✗ TEST ÇÖKTÜ:', err.stack || err);
  } finally {
    srv.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (fail) console.log('\nSunucu çıktısı:\n' + out.slice(-3000));
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* yok */ }
  }
  console.log(`\n${pass} başarılı, ${fail} başarısız`);
  process.exit(fail ? 1 : 0);
}
main();
