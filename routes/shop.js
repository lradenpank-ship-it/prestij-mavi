'use strict';
const U = require('../lib/util');
const { e, tl } = U;
const catalog = require('../lib/catalog');
const shop = require('../lib/shop');
const pay = require('../lib/payments');
const ui = require('../lib/ui');
const { doc } = require('../lib/layout');
const { HttpError } = require('../lib/http');
const log = require('../lib/logger');

const safeBack = (s, d = '/sepet') => (typeof s === 'string' && s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') && s.length < 300 ? s : d);
const page = (ctx, o) => ctx.html(doc(ctx, o));

// ---------------------------------------------------------------- Ana sayfa
function home(ctx) {
  page(ctx, { body: ctx.theme.home(ctx), canonical: '/', jsonld: { '@context': 'https://schema.org', '@type': 'Organization', name: ctx.S.get('shop_name'), url: ctx.cfg.BASE_URL || undefined } });
}

// ---------------------------------------------------------------- Ürün listesi
function listing(ctx) {
  const q = U.trim(ctx.query.q || '', 80);
  const catSlug = ctx.params[0] || ctx.query.kategori || '';
  const sort = ctx.query.sirala || 'onerilen';
  const campaign = ctx.path === '/kampanyalar' || ctx.query.kampanya === '1';
  const cats = catalog.categories(ctx.db);
  const cat = cats.find((c) => c.slug === catSlug);
  if (catSlug && !cat) throw new HttpError(404, 'Kategori bulunamadı');
  const r = catalog.list(ctx.db, { cat: cat && cat.slug, q, sort, campaign, page: U.int(ctx.query.sayfa, 1), per: 24 });
  const title = campaign ? 'Kampanyalar' : q ? `"${q}" araması` : cat ? cat.name : 'Tüm ürünler';
  const qs = (extra) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (sort !== 'onerilen') p.set('sirala', sort);
    if (campaign && ctx.path !== '/kampanyalar') p.set('kampanya', '1');
    if (!ctx.params[0] && cat) p.set('kategori', cat.slug);
    for (const [k, v] of Object.entries(extra)) { if (v == null || v === 1 && k === 'sayfa') p.delete(k); else p.set(k, v); }
    const s = p.toString(); return s ? '?' + s : '';
  };
  const basePath = ctx.params[0] ? `/kategori/${cat.slug}` : ctx.path;
  const side = `<aside class="filters" aria-label="Filtreler"><h2>Kategoriler</h2><ul>
<li><a href="/urunler" class="${!cat && !campaign ? 'on' : ''}">Tüm ürünler</a></li>
<li><a href="/kampanyalar" class="${campaign ? 'on' : ''}">Kampanyalar</a></li>
${cats.map((c) => `<li><a href="/kategori/${e(c.slug)}" class="${cat && cat.id === c.id ? 'on' : ''}">${e(c.name)} <small>${c.n}</small></a></li>`).join('')}</ul></aside>`;
  const sorts = [['onerilen', 'Önerilen'], ['yeni', 'En yeni'], ['cok-satan', 'Çok satanlar'], ['fiyat-artan', 'Fiyat: düşükten yükseğe'], ['fiyat-azalan', 'Fiyat: yüksekten düşüğe']];
  const body = `<div class="container"><nav class="crumbs" aria-label="Sayfa yolu"><a href="/">Ana sayfa</a> <span>/</span> ${cat ? `<a href="/urunler">Ürünler</a> <span>/</span> <b>${e(cat.name)}</b>` : `<b>${e(title)}</b>`}</nav>
<div class="page-head"><h1>${e(title)}</h1><p>${r.total} ürün</p></div>
<div class="shop-layout">${side}<section class="results">
<form class="toolbar" method="get" action="${e(basePath)}" data-autosubmit>
${q ? `<input type="hidden" name="q" value="${e(q)}">` : ''}${campaign && ctx.path !== '/kampanyalar' ? '<input type="hidden" name="kampanya" value="1">' : ''}
<label class="sr" for="sirala">Sırala</label><select id="sirala" name="sirala">${sorts.map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
<noscript><button class="btn btn-ghost">Uygula</button></noscript></form>
${r.items.length ? `<div class="grid-products">${r.items.map((p) => ui.productCard(ctx, p)).join('')}</div>` : '<div class="empty"><h2>Ürün bulunamadı</h2><p>Farklı bir arama deneyin veya <a href="/urunler">tüm ürünlere</a> göz atın.</p></div>'}
${ui.pager(r.page, r.pages, (n) => basePath + qs({ sayfa: n }))}
</section></div></div>`;
  page(ctx, { title, body, canonical: ctx.params[0] ? `/kategori/${cat.slug}` : (q ? undefined : ctx.path), noindex: !!q || r.page > 1 });
}

// ---------------------------------------------------------------- Ürün sayfası
function product(ctx) {
  const p = catalog.bySlug(ctx.db, ctx.params[0]);
  if (!p) throw new HttpError(404, 'Ürün bulunamadı');
  const rel = catalog.related(ctx.db, p);
  const specs = String(p.specs || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':'); return i > 0 ? `<tr><th>${e(l.slice(0, i))}</th><td>${e(l.slice(i + 1).trim())}</td></tr>` : `<tr><td colspan="2">${e(l)}</td></tr>`;
  }).join('');
  const inStock = p.stock > 0;
  const stockTxt = !inStock ? '<span class="stock out">Stokta yok</span>' : p.stock <= 5 ? `<span class="stock low">Son ${p.stock} adet</span>` : '<span class="stock in">Stokta var</span>';
  const buy = inStock ? `<form method="post" action="/sepet/ekle" data-ajax class="buy">${ctx.csrfField()}<input type="hidden" name="id" value="${p.id}"><input type="hidden" name="back" value="/urun/${e(p.slug)}">
<label class="sr" for="qty">Adet</label><input id="qty" class="qty-input" type="number" name="qty" value="1" min="1" max="${Math.min(99, p.stock)}" inputmode="numeric">
<button class="btn btn-primary btn-lg" type="submit">Sepete ekle</button></form>` : '<button class="btn btn-ghost btn-lg" disabled>Stokta yok</button>';
  const staged = p.staged_ok ? `<li>Kademeli ödeme uygun: ön ödeme + kalan tutar teslim/montaj öncesi (toplam ${tl(ctx.S.num('staged_min', 0))} ve üzeri sepetlerde)</li>` : '';
  const body = `<div class="container"><nav class="crumbs" aria-label="Sayfa yolu"><a href="/">Ana sayfa</a> <span>/</span> <a href="/urunler">Ürünler</a> <span>/</span> ${p.cat_slug ? `<a href="/kategori/${e(p.cat_slug)}">${e(p.cat_name)}</a> <span>/</span>` : ''} <b>${e(p.name)}</b></nav>
<div class="pdp"><div class="pdp-media">${ui.badge(p.badge)}${ui.productImg(ctx, p)}</div>
<div class="pdp-info"><div class="pcat">${e(p.cat_name || '')}</div><h1>${e(p.name)}</h1>
<div class="pdp-meta">${p.sku ? `<span>Ürün kodu: ${e(p.sku)}</span>` : ''}${stockTxt}</div>
<p class="pdp-short">${e(p.short || '')}</p>
<div class="pdp-price">${ui.priceBlock(p)}<small>${e(ctx.S.get('currency_note'))}</small></div>
${buy}
<ul class="assure"><li>Kredi/banka kartı (3D Secure), havale/EFT ile ödeme</li>${staged}<li>Kurulum ve satış sonrası destek için bizimle iletişime geçin</li></ul>
<a class="btn btn-ghost" href="/iletisim?konu=${encodeURIComponent(p.name)}">Bu ürün için bilgi / teklif iste</a></div></div>
<section class="pdp-tabs"><h2>Ürün açıklaması</h2><div class="prose">${U.paragraphs(p.description)}</div>
${specs ? `<h2>Teknik özellikler</h2><table class="specs">${specs}</table>` : ''}</section>
${rel.length ? `<section class="related"><h2>Benzer ürünler</h2><div class="grid-products">${rel.map((r) => ui.productCard(ctx, r)).join('')}</div></section>` : ''}</div>`;
  const base = ctx.cfg.BASE_URL || `http://${ctx.req.headers.host}`;
  page(ctx, {
    title: p.name, description: `${p.name} – ${p.short || ''}`.slice(0, 160), body, canonical: `/urun/${p.slug}`, ogType: 'product', ogImage: p.image ? `/uploads/${p.image}` : undefined,
    jsonld: { '@context': 'https://schema.org', '@type': 'Product', name: p.name, sku: p.sku || undefined, description: p.short || p.name, image: p.image ? `${base}/uploads/${p.image}` : undefined,
      offers: { '@type': 'Offer', priceCurrency: 'TRY', price: (p.price / 100).toFixed(2), availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: `${base}/urun/${p.slug}` } },
  });
}

// ---------------------------------------------------------------- Sepet
function cartPage(ctx) {
  const c = shop.loadCart(ctx);
  const free = ctx.S.num('free_ship_min', 0);
  const body = `<div class="container"><div class="page-head"><h1>Sepetim</h1></div>
${c.lines.length ? `<div class="cart-layout"><div class="cart-lines">${c.lines.map((l) => `<div class="cart-line">
<a class="cl-img" href="/urun/${e(l.slug)}">${ui.productImg(ctx, l)}</a>
<div class="cl-info"><a class="cl-name" href="/urun/${e(l.slug)}">${e(l.name)}</a><div class="cl-unit">${tl(l.price)} / adet</div>
${l.stock < 6 ? `<small class="stock low">Stokta ${l.stock} adet</small>` : ''}</div>
<form class="cl-qty" method="post" action="/sepet/guncelle">${ctx.csrfField()}<input type="hidden" name="id" value="${l.id}"><label class="sr" for="q${l.id}">Adet</label><input id="q${l.id}" type="number" name="qty" value="${l.qty}" min="0" max="${Math.min(99, l.stock)}" inputmode="numeric"><button class="btn btn-ghost" type="submit">Güncelle</button></form>
<div class="cl-total">${tl(l.line)}</div>
<form method="post" action="/sepet/guncelle">${ctx.csrfField()}<input type="hidden" name="id" value="${l.id}"><input type="hidden" name="qty" value="0"><button class="cl-del" type="submit" aria-label="${e(l.name)} ürününü kaldır">✕</button></form></div>`).join('')}</div>
<aside class="summary card"><h2>Sipariş özeti</h2>
<div class="row"><span>Ara toplam</span><span>${tl(c.subtotal)}</span></div>
<div class="row"><span>Kargo</span><span>${c.shipping ? tl(c.shipping) : 'Ücretsiz'}</span></div>
${free && c.shipping ? `<small class="hint">${tl(free - c.subtotal)} daha ekleyin, kargo ücretsiz olsun.</small>` : ''}
<div class="row total"><span>Toplam</span><b>${tl(c.total)}</b></div>
${c.stagedOk ? `<p class="hint good">Bu sepet için kademeli ödeme kullanılabilir (ön ödeme %${c.stagedPct}).</p>` : ''}
<a class="btn btn-primary btn-block btn-lg" href="/odeme">Güvenli ödemeye geç</a><a class="btn btn-ghost btn-block" href="/urunler">Alışverişe devam et</a></aside></div>`
    : '<div class="empty"><h2>Sepetiniz boş</h2><p>Beğendiğiniz ürünleri sepete ekleyin.</p><a class="btn btn-primary" href="/urunler">Ürünlere göz at</a></div>'}</div>`;
  page(ctx, { title: 'Sepetim', body, noindex: true });
}

function cartReply(ctx, msg, ok = true) {
  const c = shop.loadCart(ctx);
  if (ctx.wantsJson) return ctx.json({ ok, msg, count: c.count, total: tl(c.total), subtotal: tl(c.subtotal), mini: ui.miniCart(ctx) });
  ctx.flash(msg, ok ? 'ok' : 'err');
  return ctx.redirect(safeBack(ctx.form.back, '/sepet'));
}

function cartAdd(ctx) {
  ctx.checkCsrf(); ctx.limit('cart', 120, 600000);
  const id = U.int(ctx.form.id); const qty = U.clamp(U.int(ctx.form.qty, 1), 1, 99);
  const p = ctx.db.prepare('SELECT id,name,stock FROM products WHERE id=? AND active=1').get(id);
  if (!p || p.stock <= 0) return cartReply(ctx, 'Bu ürün şu an stokta yok.', false);
  const lines = shop.parseCart(ctx.cookies.cart);
  const ex = lines.find((l) => l.id === id);
  if (ex) ex.qty = Math.min(99, ex.qty + qty); else lines.push({ id, qty });
  const cur = ex ? ex.qty : qty;
  if (cur > p.stock) { (ex || lines[lines.length - 1]).qty = p.stock; shop.saveCart(ctx, lines); return cartReply(ctx, `"${p.name}" için en fazla ${p.stock} adet eklenebilir.`, false); }
  shop.saveCart(ctx, lines);
  return cartReply(ctx, `"${p.name}" sepete eklendi.`);
}

function cartUpdate(ctx) {
  ctx.checkCsrf(); ctx.limit('cart', 120, 600000);
  const id = U.int(ctx.form.id); const qty = U.int(ctx.form.qty, 1);
  let lines = shop.parseCart(ctx.cookies.cart);
  if (qty <= 0) lines = lines.filter((l) => l.id !== id);
  else { const l = lines.find((x) => x.id === id); if (l) l.qty = Math.min(99, qty); }
  shop.saveCart(ctx, lines);
  return cartReply(ctx, qty <= 0 ? 'Ürün sepetten çıkarıldı.' : 'Sepet güncellendi.');
}

function cartMini(ctx) { ctx.json({ ok: true, ...(() => { const c = shop.loadCart(ctx); return { count: c.count, total: tl(c.total) }; })(), mini: ui.miniCart(ctx) }); }

// ---------------------------------------------------------------- Ödeme (checkout)
const CITIES = ['Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya', 'Artvin', 'Aydın', 'Balıkesir', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari', 'Hatay', 'Isparta', 'Mersin', 'İstanbul', 'İzmir', 'Kars', 'Kastamonu', 'Kayseri', 'Kırklareli', 'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak', 'Aksaray', 'Bayburt', 'Karaman', 'Kırıkkale', 'Batman', 'Şırnak', 'Bartın', 'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye', 'Düzce'];

function checkoutForm(ctx, v = {}, errs = {}) {
  const c = shop.loadCart(ctx);
  const methods = [];
  if (pay.cardAvailable()) methods.push(['kart', 'Kredi / banka kartı', '3D Secure ile güvenli ödeme. Kart bilgileri bu sitede saklanmaz.']);
  methods.push(['havale', 'Havale / EFT', 'Sipariş sonrası IBAN gösterilir; ödemeden sonra havale bildirimi yaparsınız.']);
  if (c.stagedOk) methods.push(['kademeli', 'Kademeli ödeme', `Şimdi %${c.stagedPct} ön ödeme, kalan tutar teslim/montaj öncesi.`]);
  const sel = v.pay_method || methods[0][0];
  const dv = v.deposit_via || (pay.cardAvailable() ? 'kart' : 'havale');
  const f = (label, name, o = {}) => ui.field(label, name, v[name] || '', { ...o, err: errs[name] });
  const body = `<div class="container"><div class="page-head"><h1>Ödeme</h1><p>Bilgilerinizi girin, ödeme yönteminizi seçin.</p></div>
${errs._ ? `<div class="alert alert-err" role="alert">${e(errs._)}</div>` : ''}
<form method="post" action="/odeme" class="checkout-layout" novalidate>${ctx.csrfField()}<input type="hidden" name="idem" value="${e(v.idem || U.rid(10))}">
<div class="checkout-main">
<fieldset class="card"><legend>Teslimat bilgileri</legend><div class="form-grid">
${f('Ad soyad', 'name', { required: true, autocomplete: 'name', max: 80 })}
${f('E-posta', 'email', { required: true, type: 'email', autocomplete: 'email', max: 120 })}
${f('Telefon', 'phone', { required: true, type: 'tel', autocomplete: 'tel', max: 20, inputmode: 'tel', placeholder: '05xx xxx xx xx' })}
<div class="field"><label for="f-city">İl <i>*</i></label><select id="f-city" name="city" required autocomplete="address-level1"><option value="">Seçin</option>${CITIES.map((x) => `<option ${v.city === x ? 'selected' : ''}>${x}</option>`).join('')}</select>${errs.city ? `<em class="ferr">${e(errs.city)}</em>` : ''}</div>
${f('Adres', 'address', { required: true, type: 'textarea', rows: 3, autocomplete: 'street-address', max: 400, cls: 'span2' })}
${f('Sipariş notu (isteğe bağlı)', 'note', { type: 'textarea', rows: 2, max: 400, cls: 'span2' })}
</div></fieldset>
<fieldset class="card"><legend>Fatura bilgileri</legend>
<div class="radio-row"><label><input type="radio" name="invoice_type" value="bireysel" ${(v.invoice_type || 'bireysel') === 'bireysel' ? 'checked' : ''}> Bireysel</label><label><input type="radio" name="invoice_type" value="kurumsal" ${v.invoice_type === 'kurumsal' ? 'checked' : ''}> Kurumsal</label></div>
<div class="form-grid corp">${f('Firma unvanı', 'company', { max: 120, cls: 'span2' })}${f('Vergi dairesi', 'tax_office', { max: 60 })}${f('Vergi no / TC kimlik no', 'tax_no', { max: 20, inputmode: 'numeric' })}</div></fieldset>
<fieldset class="card"><legend>Ödeme yöntemi</legend>${errs.pay_method ? `<em class="ferr">${e(errs.pay_method)}</em>` : ''}
<div class="pay-options">${methods.map(([id, t, d]) => `<label class="pay-opt"><input type="radio" name="pay_method" value="${id}" ${sel === id ? 'checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div>
${c.stagedOk ? `<div class="deposit-via"><b>Ön ödemeyi nasıl yapacaksınız?</b><div class="radio-row">${pay.cardAvailable() ? `<label><input type="radio" name="deposit_via" value="kart" ${dv === 'kart' ? 'checked' : ''}> Kartla</label>` : ''}<label><input type="radio" name="deposit_via" value="havale" ${dv === 'havale' ? 'checked' : ''}> Havale / EFT ile</label></div></div>` : ''}
</fieldset>
<label class="consent ${errs.consent ? 'bad' : ''}"><input type="checkbox" name="consent" value="1" ${v.consent ? 'checked' : ''}> <span><a href="/sayfa/mesafeli-satis-sozlesmesi" target="_blank" rel="noopener">Mesafeli satış sözleşmesini</a>, <a href="/sayfa/iade-kosullari" target="_blank" rel="noopener">iade koşullarını</a> ve <a href="/sayfa/gizlilik-kvkk" target="_blank" rel="noopener">KVKK aydınlatma metnini</a> okudum, kabul ediyorum.</span></label>${errs.consent ? `<em class="ferr">${e(errs.consent)}</em>` : ''}
</div>
<aside class="summary card"><h2>Siparişiniz</h2>${c.lines.map((l) => `<div class="sum-line"><span>${l.qty} × ${e(l.name)}</span><span>${tl(l.line)}</span></div>`).join('')}
<div class="row"><span>Ara toplam</span><span>${tl(c.subtotal)}</span></div><div class="row"><span>Kargo</span><span>${c.shipping ? tl(c.shipping) : 'Ücretsiz'}</span></div>
<div class="row total"><span>Toplam</span><b>${tl(c.total)}</b></div><small class="hint">${e(ctx.S.get('currency_note'))}</small>
<button class="btn btn-primary btn-block btn-lg" type="submit" data-once>Siparişi tamamla</button><a class="btn btn-ghost btn-block" href="/sepet">Sepete dön</a></aside>
</form></div>`;
  page(ctx, { title: 'Ödeme', body, noindex: true });
}

function checkoutGet(ctx) {
  const c = shop.loadCart(ctx);
  if (!c.lines.length) { ctx.flash('Sepetiniz boş.', 'err'); return ctx.redirect('/urunler'); }
  checkoutForm(ctx);
}

function checkoutPost(ctx) {
  ctx.checkCsrf(); ctx.limit('order', 25, 3600000);
  const c = shop.loadCart(ctx);
  if (!c.lines.length) { ctx.flash('Sepetiniz boş.', 'err'); return ctx.redirect('/urunler'); }
  const F = ctx.form;
  const v = {
    name: U.trim(F.name, 80), email: U.trim(F.email, 120).toLowerCase(), phone: U.cleanPhone(F.phone), city: U.trim(F.city, 40),
    address: U.trim(F.address, 400), note: U.trim(F.note, 400), invoice_type: F.invoice_type === 'kurumsal' ? 'kurumsal' : 'bireysel',
    company: U.trim(F.company, 120), tax_office: U.trim(F.tax_office, 60), tax_no: U.trim(F.tax_no, 20).replace(/\D/g, ''),
    pay_method: String(F.pay_method || ''), deposit_via: F.deposit_via === 'havale' ? 'havale' : 'kart', consent: F.consent === '1', idem: /^[a-f0-9]{20}$/.test(F.idem || '') ? F.idem : U.rid(10),
  };
  const errs = {};
  if (v.name.length < 3) errs.name = 'Ad soyad girin.';
  if (!U.isEmail(v.email)) errs.email = 'Geçerli bir e-posta girin.';
  if (!U.isPhone(v.phone)) errs.phone = 'Geçerli bir telefon numarası girin.';
  if (!CITIES.includes(v.city)) errs.city = 'İl seçin.';
  if (v.address.length < 10) errs.address = 'Açık adresinizi girin.';
  if (v.invoice_type === 'kurumsal') {
    if (v.company.length < 3) errs.company = 'Firma unvanı girin.';
    if (!/^\d{10,11}$/.test(v.tax_no)) errs.tax_no = 'Vergi no (10) veya TC kimlik no (11 hane) girin.';
    if (v.tax_office.length < 2) errs.tax_office = 'Vergi dairesi girin.';
  }
  const allowed = ['havale']; if (pay.cardAvailable()) allowed.push('kart'); if (c.stagedOk) allowed.push('kademeli');
  if (!allowed.includes(v.pay_method)) errs.pay_method = 'Ödeme yöntemi seçin.';
  if (v.pay_method === 'kademeli' && v.deposit_via === 'kart' && !pay.cardAvailable()) v.deposit_via = 'havale';
  if (!v.consent) errs.consent = 'Devam etmek için sözleşmeleri onaylamalısınız.';
  if (Object.keys(errs).length) { ctx.status = 422; return checkoutForm(ctx, v, errs); }
  let r;
  try {
    r = shop.createOrder(ctx, {
      lines: c.lines.map((l) => ({ id: l.id, qty: l.qty })), name: v.name, email: v.email, phone: v.phone, city: v.city, address: v.address, note: v.note,
      invoiceType: v.invoice_type, company: v.invoice_type === 'kurumsal' ? v.company : null, taxOffice: v.invoice_type === 'kurumsal' ? v.tax_office : null,
      taxNo: v.invoice_type === 'kurumsal' ? v.tax_no : null, payMethod: v.pay_method, depositVia: v.deposit_via, ip: ctx.ip, idem: v.idem, provider: pay.provider,
    });
  } catch (err) {
    if (err instanceof shop.OrderError) { errs._ = err.message; return checkoutForm(ctx, v, errs); }
    throw err;
  }
  shop.saveCart(ctx, []);
  const o = r.order;
  const first = ctx.db.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY id LIMIT 1').get(o.id);
  if (first.method === 'kart' && !r.duplicate) return ctx.redirect(`/odeme/kart/${o.token}/${first.id}`);
  return ctx.redirect(`/siparis/${o.token}?yeni=1`);
}

// ---------------------------------------------------------------- Sipariş sayfası
function getOrderByToken(ctx, token) {
  if (!/^[a-f0-9]{24}$/.test(token)) throw new HttpError(404, 'Sipariş bulunamadı');
  const o = ctx.db.prepare('SELECT * FROM orders WHERE token=?').get(token);
  if (!o) throw new HttpError(404, 'Sipariş bulunamadı');
  return o;
}

function bankBlock(ctx, o, amount) {
  return `<div class="bank card"><h3>Havale / EFT bilgileri</h3><pre>${e(ctx.S.get('bank_info'))}</pre>
<p>Tutar: <b>${tl(amount)}</b> · Açıklama: <b>${e(o.no)}</b></p>
<a class="btn btn-primary" href="/havale-bildirimi?no=${encodeURIComponent(o.no)}&tutar=${amount}">Havale bildirimi yap</a></div>`;
}

function orderPage(ctx) {
  const o = getOrderByToken(ctx, ctx.params[0]);
  const items = ctx.db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
  const pays = ctx.db.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY id').all(o.id);
  const events = ctx.db.prepare('SELECT at,text FROM order_events WHERE order_id=? AND internal=0 ORDER BY id DESC').all(o.id);
  const q = ctx.query;
  const banner = q.yeni ? `<div class="alert alert-ok"><b>Teşekkürler!</b> ${e(o.no)} numaralı siparişiniz alındı. Sipariş bilgileri ${e(o.email)} adresine gönderilir. Bu sayfanın adresini kaydedin; siparişinizi buradan takip edebilirsiniz.</div>`
    : q.odeme === 'ok' ? '<div class="alert alert-ok">Ödemeniz alındı. Teşekkür ederiz.</div>'
      : q.odeme === 'hata' ? '<div class="alert alert-err">Ödeme tamamlanamadı. Aşağıdan tekrar deneyebilirsiniz.</div>' : '';
  const payRows = pays.map((p) => {
    let action = '';
    if (p.status === 'pending' && o.status !== 'iptal') {
      const switchBtns = (['kart', 'havale'].filter((m) => m !== p.method && (m !== 'kart' || pay.cardAvailable()))).map((m) =>
        `<form method="post" action="/siparis/${o.token}/yontem" class="inline">${ctx.csrfField()}<input type="hidden" name="pid" value="${p.id}"><input type="hidden" name="method" value="${m}"><button class="linkbtn" type="submit">${m === 'kart' ? 'Kartla öde' : 'Havale ile öde'}</button></form>`).join(' ');
      if (p.method === 'kart') action = `<a class="btn btn-primary" href="/odeme/kart/${o.token}/${p.id}">Kart ile öde</a> ${switchBtns}`;
      else action = `${bankBlock(ctx, o, p.amount)}${switchBtns}`;
    }
    return `<div class="pay-row"><div class="pr-head"><b>${e(shop.PAYMENT_KIND[p.kind])}</b> · ${tl(p.amount)} · ${e(shop.METHOD[p.method] || p.method)} <span class="pill pm-${p.status}">${e(shop.PAYMENT_STATUS[p.status])}</span></div>${action}</div>`;
  }).join('');
  const body = `<div class="container narrow"><div class="page-head"><h1>Sipariş ${e(o.no)}</h1><p>${U.dateTR(o.created_at)} · ${ui.statusPill(o.status)} ${ui.payPill(o.pay_status)}</p></div>
${banner}
${o.status === 'odeme-bekliyor' ? '<div class="alert alert-warn">Ödemeniz tamamlanana kadar siparişiniz için stok ayrılır; süre dolarsa sipariş otomatik iptal edilir.</div>' : ''}
<section class="card"><h2>Ödeme</h2><p>Toplam <b>${tl(o.total)}</b> · Ödenen <b>${tl(o.paid_total)}</b>${o.total > o.paid_total && o.status !== 'iptal' ? ` · Kalan <b>${tl(o.total - o.paid_total)}</b>` : ''}</p>${payRows}</section>
${o.cargo_no ? `<section class="card"><h2>Kargo</h2><p>${e(o.cargo_company || '')} · Takip no: <b>${e(o.cargo_no)}</b></p></section>` : ''}
<section class="card"><h2>Ürünler</h2><table class="tbl"><thead><tr><th>Ürün</th><th>Adet</th><th>Fiyat</th><th>Tutar</th></tr></thead><tbody>
${items.map((i) => `<tr><td>${e(i.name)}</td><td>${i.qty}</td><td>${tl(i.unit_price)}</td><td>${tl(i.unit_price * i.qty)}</td></tr>`).join('')}
</tbody><tfoot><tr><td colspan="3">Kargo</td><td>${o.shipping ? tl(o.shipping) : 'Ücretsiz'}</td></tr><tr><td colspan="3"><b>Toplam</b></td><td><b>${tl(o.total)}</b></td></tr></tfoot></table></section>
<section class="card"><h2>Teslimat</h2><p>${e(o.name)}<br>${e(o.address)}<br>${e(o.city || '')}<br>${e(o.phone)}</p></section>
<section class="card"><h2>Sipariş geçmişi</h2><ol class="timeline">${events.map((ev) => `<li><time>${U.dateTR(ev.at)}</time> ${e(ev.text)}</li>`).join('')}</ol></section>
<p class="hint">Sorularınız için <a href="/iletisim">bize ulaşın</a>. Sipariş numaranız: <b>${e(o.no)}</b></p></div>`;
  page(ctx, { title: `Sipariş ${o.no}`, body, noindex: true });
}

function orderSwitchMethod(ctx) {
  ctx.checkCsrf(); ctx.limit('switch', 30, 600000);
  const o = getOrderByToken(ctx, ctx.params[0]);
  const pid = U.int(ctx.form.pid); const m = ctx.form.method;
  if (!['kart', 'havale'].includes(m) || (m === 'kart' && !pay.cardAvailable())) throw new HttpError(400, 'Geçersiz yöntem');
  const p = ctx.db.prepare('SELECT * FROM payments WHERE id=? AND order_id=?').get(pid, o.id);
  if (!p || p.status !== 'pending' || o.status === 'iptal') throw new HttpError(400, 'Bu ödeme değiştirilemez');
  ctx.db.prepare('UPDATE payments SET method=?, provider=? WHERE id=?').run(m, m === 'kart' ? pay.provider : null, pid);
  if (m === 'kart') return ctx.redirect(`/odeme/kart/${o.token}/${pid}`);
  return ctx.redirect(`/siparis/${o.token}`);
}

// ---------------------------------------------------------------- Kart ödemesi
function loadCardPayment(ctx) {
  const o = getOrderByToken(ctx, ctx.params[0]);
  const p = ctx.db.prepare('SELECT * FROM payments WHERE id=? AND order_id=?').get(U.int(ctx.params[1]), o.id);
  if (!p || p.method !== 'kart') throw new HttpError(404, 'Ödeme bulunamadı');
  if (p.status === 'paid') { ctx.redirect(`/siparis/${o.token}?odeme=ok`); return null; }
  if (p.status !== 'pending' || o.status === 'iptal') { ctx.redirect(`/siparis/${o.token}`); return null; }
  if (!pay.cardAvailable()) { ctx.flash('Kart ile ödeme şu anda kullanılamıyor. Havale/EFT seçebilirsiniz.', 'err'); ctx.redirect(`/siparis/${o.token}`); return null; }
  return { o, p };
}

function cardForm(ctx, o, p, err = '', v = {}) {
  const demo = `<div class="demo-banner" role="note"><b>DEMO ÖDEME EKRANI</b> – gerçek tahsilat yapılmaz. Test kartı: <code>4242 4242 4242 4242</code>, gelecek bir tarih, CVC <code>123</code>. (4000 ile başlayan kartlar reddedilir.)</div>`;
  const body = `<div class="container narrow"><div class="page-head"><h1>Kart ile ödeme</h1><p>Sipariş ${e(o.no)} · <b>${tl(p.amount)}</b></p></div>
${demo}${err ? `<div class="alert alert-err" role="alert">${e(err)}</div>` : ''}
<form class="card cardform" method="post" autocomplete="off">${ctx.csrfField()}
${ui.field('Kart üzerindeki isim', 'cc_name', v.cc_name || '', { required: true, max: 60, autocomplete: 'cc-name' })}
${ui.field('Kart numarası', 'cc_number', '', { required: true, max: 23, inputmode: 'numeric', autocomplete: 'cc-number', placeholder: '0000 0000 0000 0000' })}
<div class="form-grid">${ui.field('Son kullanma (AA/YY)', 'cc_exp', '', { required: true, max: 5, autocomplete: 'cc-exp', placeholder: 'AA/YY' })}${ui.field('Güvenlik kodu', 'cc_cvc', '', { required: true, max: 4, inputmode: 'numeric', autocomplete: 'cc-csc', placeholder: 'CVC' })}</div>
<button class="btn btn-primary btn-block btn-lg" type="submit" data-once>${tl(p.amount)} öde</button>
<p class="hint">Kart bilgileriniz bu sitede saklanmaz. Gerçek kurulumda bu adım ödeme kuruluşunun 3D Secure sayfasında yapılır.</p></form></div>`;
  page(ctx, { title: 'Kart ile ödeme', body, noindex: true });
}

async function cardGet(ctx) {
  const r = loadCardPayment(ctx); if (!r) return;
  const { o, p } = r;
  if (pay.provider === 'demo') return cardForm(ctx, o, p);
  ctx.limit('paytr', 20, 600000);
  let token;
  try { token = await pay.paytrToken(ctx, o, p); } catch (err) {
    log.error(`PayTR token alınamadı (${o.no})`, err);
    ctx.flash('Ödeme sayfası şu anda açılamadı. Lütfen biraz sonra tekrar deneyin veya havale/EFT seçin.', 'err');
    return ctx.redirect(`/siparis/${o.token}`);
  }
  const body = `<div class="container narrow"><div class="page-head"><h1>Güvenli ödeme</h1><p>Sipariş ${e(o.no)} · <b>${tl(p.amount)}</b></p></div>
<iframe src="https://www.paytr.com/odeme/guvenli/${e(token)}" id="paytriframe" class="psp-frame" title="Güvenli ödeme" scrolling="no"></iframe></div>`;
  page(ctx, { title: 'Güvenli ödeme', body, noindex: true });
}

function cardPost(ctx) {
  ctx.checkCsrf(); ctx.limit('card', 20, 600000);
  const r = loadCardPayment(ctx); if (!r) return;
  const { o, p } = r;
  if (pay.provider !== 'demo') throw new HttpError(400, 'Geçersiz istek');
  const F = ctx.form;
  const chk = pay.demoCardCheck(F.cc_number, F.cc_name, F.cc_exp, F.cc_cvc);
  if (!chk.ok) { ctx.status = 422; return cardForm(ctx, o, p, chk.msg, { cc_name: U.trim(F.cc_name, 60) }); }
  shop.markPaid(ctx.db, ctx.S, p.id, `DEMO-${U.rid(5)}`, `Demo ödeme · kart sonu ${chk.last4}`);
  return ctx.redirect(`/siparis/${o.token}?odeme=ok`);
}

function paytrCallback(ctx) {
  ctx.limit('paytr-cb', 600, 60000);
  const F = ctx.form;
  if (pay.provider !== 'paytr' || !pay.paytrVerify(F)) { log.warn('PayTR bildirimi imza doğrulanamadı'); return ctx.text('PAYTR notification failed: bad hash', 400); }
  const m = /^(PS\d+)P(\d+)$/.exec(String(F.merchant_oid || ''));
  if (m) {
    const p = ctx.db.prepare('SELECT p.*, o.no FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=?').get(+m[2]);
    if (p && p.no === m[1]) {
      if (F.status === 'success') {
        if (String(p.amount) !== String(F.total_amount)) log.error(`PayTR tutar uyuşmazlığı (${p.no}): beklenen ${p.amount}, gelen ${F.total_amount}`);
        const res = shop.markPaid(ctx.db, ctx.S, p.id, `PAYTR-${F.merchant_oid}`, 'PayTR');
        if (!res.ok) log.error(`PayTR ödemesi alındı ancak işlenemedi (${p.no}): ${res.reason}. MANUEL KONTROL / İADE GEREKEBİLİR.`);
      } else shop.failPayment(ctx.db, p.id, `PayTR: ${F.failed_reason_msg || 'başarısız'}`);
    }
  }
  return ctx.text('OK');
}

// ---------------------------------------------------------------- Takip, havale bildirimi
function trackForm(ctx, err = '', v = {}) {
  const body = `<div class="container narrow"><div class="page-head"><h1>Sipariş takibi</h1><p>Sipariş numaranız ve sipariş sırasında kullandığınız e-posta veya telefon ile siparişinizi görüntüleyin.</p></div>
${err ? `<div class="alert alert-err" role="alert">${e(err)}</div>` : ''}
<form class="card" method="post" action="/siparis-takip">${ctx.csrfField()}
${ui.field('Sipariş numarası', 'no', v.no || ctx.query.no || '', { required: true, max: 20, placeholder: 'PS26000123' })}
${ui.field('E-posta veya telefon', 'who', v.who || '', { required: true, max: 120 })}
<button class="btn btn-primary btn-lg" type="submit">Siparişi göster</button></form></div>`;
  page(ctx, { title: 'Sipariş takibi', body, noindex: true });
}
function trackPost(ctx) {
  ctx.checkCsrf(); ctx.limit('track', 20, 600000);
  const no = U.trim(ctx.form.no, 20).toUpperCase(); const who = U.trim(ctx.form.who, 120).toLowerCase();
  const o = /^PS\d{8,12}$/.test(no) ? ctx.db.prepare('SELECT token,email,phone FROM orders WHERE no=?').get(no) : null;
  const digits = (s) => String(s).replace(/\D/g, '').slice(-10);
  if (o && who && (o.email === who || (digits(who).length === 10 && digits(who) === digits(o.phone)))) return ctx.redirect(`/siparis/${o.token}`);
  ctx.status = 404; return trackForm(ctx, 'Bilgilerle eşleşen sipariş bulunamadı.', { no, who });
}

function havaleForm(ctx, err = '', v = {}) {
  const body = `<div class="container narrow"><div class="page-head"><h1>Havale bildirimi</h1><p>Havale/EFT ödemenizi yaptıktan sonra bu formu doldurun; ödemeniz kontrol edilir ve siparişiniz hazırlanır.</p></div>
${err ? `<div class="alert alert-err" role="alert">${e(err)}</div>` : ''}
<form class="card" method="post" action="/havale-bildirimi">${ctx.csrfField()}
<div class="hp" aria-hidden="true"><label>Web sitesi <input name="website" tabindex="-1" autocomplete="off"></label></div>
${ui.field('Sipariş numarası', 'no', v.no ?? ctx.query.no ?? '', { required: true, max: 20, placeholder: 'PS26000123' })}
${ui.field('Gönderen ad soyad', 'name', v.name || '', { required: true, max: 80 })}
<div class="form-grid">${ui.field('Gönderilen banka', 'bank', v.bank || '', { max: 60 })}${ui.field('Tutar (₺)', 'amount', v.amount ?? (ctx.query.tutar ? String(Number(ctx.query.tutar) / 100).replace('.', ',') : ''), { required: true, max: 14, inputmode: 'decimal' })}</div>
${ui.field('Ödeme tarihi', 'paid_on', v.paid_on || '', { type: 'date', required: true })}
${ui.field('Not (isteğe bağlı)', 'note', v.note || '', { type: 'textarea', rows: 3, max: 300 })}
<button class="btn btn-primary btn-lg" type="submit" data-once>Bildirimi gönder</button></form></div>`;
  page(ctx, { title: 'Havale bildirimi', body, noindex: true });
}
function havalePost(ctx) {
  ctx.checkCsrf(); ctx.limit('havale', 10, 3600000);
  const F = ctx.form;
  if (F.website) return ctx.redirect('/'); // bot tuzağı
  const v = { no: U.trim(F.no, 20).toUpperCase(), name: U.trim(F.name, 80), bank: U.trim(F.bank, 60), amount: U.trim(F.amount, 14), paid_on: U.trim(F.paid_on, 10), note: U.trim(F.note, 300) };
  const amount = U.parseMoney(v.amount);
  if (!/^PS\d{8,12}$/.test(v.no)) { ctx.status = 422; return havaleForm(ctx, 'Sipariş numarasını doğru girin (örn. PS26000123).', v); }
  if (v.name.length < 3) { ctx.status = 422; return havaleForm(ctx, 'Gönderen adını girin.', v); }
  if (Number.isNaN(amount) || amount <= 0) { ctx.status = 422; return havaleForm(ctx, 'Tutarı girin.', v); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.paid_on)) { ctx.status = 422; return havaleForm(ctx, 'Ödeme tarihini seçin.', v); }
  const o = ctx.db.prepare('SELECT id FROM orders WHERE no=?').get(v.no);
  ctx.db.prepare('INSERT INTO havale_notices(order_id,order_no,name,bank,amount,paid_on,note,ip,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(o ? o.id : null, v.no, v.name, v.bank, amount, v.paid_on, v.note, ctx.ip, Date.now());
  if (o) shop.addEvent(ctx.db, o.id, 'Havale bildirimi alındı, ödemeniz kontrol ediliyor.');
  ctx.flash('Havale bildiriminiz alındı. Ödemeniz kontrol edildikten sonra siparişiniz hazırlanacak.');
  return ctx.redirect('/');
}

// ---------------------------------------------------------------- İletişim, bülten, sayfalar
function contactForm(ctx, err = '', v = {}) {
  const pg = ctx.db.prepare('SELECT * FROM pages WHERE slug=\'iletisim\'').get();
  const konu = U.trim(ctx.query.konu || '', 120);
  const danis = ctx.query.konu === 'danismanlik';
  const body = `<div class="container"><div class="page-head"><h1>İletişim</h1></div><div class="contact-layout">
<div class="card prose">${U.paragraphs(pg ? pg.body : '')}<p><b>Adres:</b> ${e(ctx.S.get('address'))}<br><b>Telefon:</b> ${e(ctx.S.get('phone'))}<br><b>E-posta:</b> ${e(ctx.S.get('email'))}</p></div>
<form class="card" method="post" action="/iletisim">${ctx.csrfField()}${err ? `<div class="alert alert-err" role="alert">${e(err)}</div>` : ''}
<div class="hp" aria-hidden="true"><label>Web sitesi <input name="website" tabindex="-1" autocomplete="off"></label></div>
<input type="hidden" name="kind" value="${danis ? 'danismanlik' : 'iletisim'}">
${ui.field('Ad soyad', 'name', v.name || '', { required: true, max: 80, autocomplete: 'name' })}
<div class="form-grid">${ui.field('E-posta', 'email', v.email || '', { required: true, type: 'email', max: 120 })}${ui.field('Telefon', 'phone', v.phone || '', { type: 'tel', max: 20 })}</div>
${ui.field(danis ? 'Atölye ölçüsü, araç tipi ve ihtiyacınız' : 'Mesajınız', 'body', v.body ?? (danis ? '' : (konu ? `${konu} hakkında bilgi almak istiyorum.` : '')), { required: true, type: 'textarea', rows: 6, max: 1500 })}
<button class="btn btn-primary btn-lg" type="submit" data-once>${danis ? 'Danışmanlık talep et' : 'Gönder'}</button></form></div></div>`;
  page(ctx, { title: danis ? 'Danışmanlık talebi' : 'İletişim', body, canonical: '/iletisim' });
}
function contactPost(ctx) {
  ctx.checkCsrf(); ctx.limit('contact', 6, 3600000);
  const F = ctx.form;
  if (F.website) return ctx.redirect('/');
  const v = { name: U.trim(F.name, 80), email: U.trim(F.email, 120), phone: U.cleanPhone(F.phone), body: U.trim(F.body, 1500), kind: F.kind === 'danismanlik' ? 'danismanlik' : 'iletisim' };
  if (v.name.length < 2 || !U.isEmail(v.email) || v.body.length < 5) { ctx.status = 422; return contactForm(ctx, 'Ad, geçerli e-posta ve mesaj alanlarını doldurun.', v); }
  ctx.db.prepare('INSERT INTO messages(kind,name,email,phone,body,created_at) VALUES(?,?,?,?,?,?)').run(v.kind, v.name, v.email, v.phone, v.body, Date.now());
  ctx.flash('Mesajınız alındı. En kısa sürede dönüş yapacağız.');
  return ctx.redirect('/');
}

function newsletter(ctx) {
  ctx.checkCsrf(); ctx.limit('news', 8, 3600000);
  const email = U.trim(ctx.form.email, 120).toLowerCase();
  if (!U.isEmail(email)) { ctx.flash('Geçerli bir e-posta adresi girin.', 'err'); return ctx.redirect(safeBack(ctx.form.back, '/')); }
  ctx.db.prepare('INSERT OR IGNORE INTO newsletter(email,created_at) VALUES(?,?)').run(email, Date.now());
  ctx.flash('E-bültene kaydınız alındı. Teşekkürler!');
  return ctx.redirect(safeBack(ctx.form.back, '/'));
}

function staticPage(ctx) {
  const slug = ctx.params[0];
  const pg = ctx.db.prepare('SELECT * FROM pages WHERE slug=?').get(slug);
  if (!pg) throw new HttpError(404, 'Sayfa bulunamadı');
  const body = `<div class="container narrow"><nav class="crumbs"><a href="/">Ana sayfa</a> <span>/</span> <b>${e(pg.title)}</b></nav><div class="page-head"><h1>${e(pg.title)}</h1></div><article class="card prose">${U.paragraphs(pg.body)}</article></div>`;
  page(ctx, { title: pg.title, body, canonical: `/sayfa/${slug}` });
}
const alias = (slug) => (ctx) => { ctx.params = [slug]; return staticPage(ctx); };

// ---------------------------------------------------------------- SEO / sağlık
function sitemap(ctx) {
  const base = ctx.cfg.BASE_URL || `http://${ctx.req.headers.host}`;
  const urls = ['/', '/urunler', '/kampanyalar', '/iletisim', '/siparis-takip', '/havale-bildirimi'];
  for (const c of ctx.db.prepare('SELECT slug FROM categories WHERE active=1').all()) urls.push(`/kategori/${c.slug}`);
  for (const p of ctx.db.prepare('SELECT slug FROM pages').all()) urls.push(`/sayfa/${p.slug}`);
  for (const p of ctx.db.prepare('SELECT slug FROM products WHERE active=1 ORDER BY id LIMIT 45000').all()) urls.push(`/urun/${p.slug}`);
  ctx.text(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${e(base + u)}</loc></url>`).join('')}</urlset>`, 200, 'application/xml; charset=utf-8');
}
function robots(ctx) {
  const base = ctx.cfg.BASE_URL || `http://${ctx.req.headers.host}`;
  ctx.text(`User-agent: *\nDisallow: /yonetim\nDisallow: /sepet\nDisallow: /odeme\nDisallow: /siparis\nSitemap: ${base}/sitemap.xml\n`);
}
function health(ctx) {
  const t0 = Date.now();
  const n = ctx.db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  ctx.json({ ok: true, uptime: Math.round(process.uptime()), orders: n, db_ms: Date.now() - t0, payment: pay.provider });
}

function search(ctx) { return ctx.redirect('/urunler?q=' + encodeURIComponent(U.trim(ctx.query.q || '', 80))); }

module.exports = [
  ['GET', '/', home],
  ['GET', '/urunler', listing], ['GET', '/kampanyalar', listing], [['GET'], /^\/kategori\/([a-z0-9-]+)$/, listing],
  ['GET', '/ara', search],
  [['GET'], /^\/urun\/([a-z0-9-]+)$/, product],
  ['GET', '/sepet', cartPage], ['POST', '/sepet/ekle', cartAdd], ['POST', '/sepet/guncelle', cartUpdate], ['GET', '/sepet/mini', cartMini],
  ['GET', '/odeme', checkoutGet], ['POST', '/odeme', checkoutPost],
  [['GET'], /^\/siparis\/([a-f0-9]{24})$/, orderPage], [['POST'], /^\/siparis\/([a-f0-9]{24})\/yontem$/, orderSwitchMethod],
  [['GET'], /^\/odeme\/kart\/([a-f0-9]{24})\/(\d+)$/, cardGet], [['POST'], /^\/odeme\/kart\/([a-f0-9]{24})\/(\d+)$/, cardPost],
  ['POST', '/odeme/paytr/bildirim', paytrCallback],
  ['GET', '/siparis-takip', (ctx) => trackForm(ctx)], ['POST', '/siparis-takip', trackPost],
  ['GET', '/havale-bildirimi', (ctx) => havaleForm(ctx)], ['POST', '/havale-bildirimi', havalePost],
  ['GET', '/iletisim', (ctx) => contactForm(ctx)], ['POST', '/iletisim', contactPost],
  ['POST', '/bulten', newsletter],
  [['GET'], /^\/sayfa\/([a-z0-9-]+)$/, staticPage],
  ['GET', '/hakkimizda', alias('hakkimizda')], ['GET', '/katalog', alias('katalog')], ['GET', '/odeme-sistemi', alias('odeme-sistemi')], ['GET', '/kargo-teslimat', alias('kargo-teslimat')],
  ['GET', '/sitemap.xml', sitemap], ['GET', '/robots.txt', robots], ['GET', '/saglik', health],
];
module.exports.CITIES = CITIES;
