'use strict';
// Tema A · Prestij Mavi — açık zemin, lacivert çerçeve, kategori kenar çubuklu klasik e-ticaret vitrini.
const U = require('../lib/util');
const ui = require('../lib/ui');
const catalog = require('../lib/catalog');
const shop = require('../lib/shop');
const { e, tl } = U;
const { ico, illu, logo } = ui;

const NAV = [['/urunler?sirala=yeni', 'Yeni ürünler'], ['/kampanyalar', 'Kampanyalar'], ['/kategori/arac-liftleri', 'Araç liftleri'], ['/kategori/takim-arabalari', 'Takım arabaları'], ['/sayfa/katalog', 'Katalog'], ['/sayfa/odeme-sistemi', 'Ödeme sistemi'], ['/sayfa/hakkimizda', 'Hakkımızda'], ['/iletisim', 'İletişim']];

function header(ctx) {
  const S = ctx.S; const c = shop.loadCart(ctx); const cats = catalog.categories(ctx.db);
  const q = ctx.query.q || '';
  return `<div class="announce"><div class="container"><span>${e(S.get('announce'))}</span><span class="ann-links"><a href="/siparis-takip">Sipariş takibi</a><a href="/havale-bildirimi">Havale bildirimi</a><a href="tel:${e(S.get('phone').replace(/[^\d+]/g, ''))}">${e(S.get('phone'))}</a></span></div></div>
<header class="topbar"><div class="container">
<a class="brand" href="/" aria-label="${e(S.get('shop_name'))} ana sayfa">${logo('light')}</a>
<form class="search" method="get" action="/urunler" role="search"><label class="sr" for="s-cat">Kategori</label>
<select id="s-cat" name="kategori"><option value="">Tüm kategoriler</option>${cats.map((x) => `<option value="${e(x.slug)}" ${ctx.query.kategori === x.slug ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select>
<label class="sr" for="s-q">Ara</label><input id="s-q" type="search" name="q" value="${e(q)}" placeholder="Ürün, kod veya kategori ara"><button type="submit" aria-label="Ara">${ico.search}</button></form>
<div class="actions"><a class="act-link" href="/siparis-takip">${ico.user}<span>Sipariş takibi</span></a>
<a class="cartlink" href="/sepet"><span class="cart-ico">${ico.cart}<span class="cbadge" data-cart-badge data-cart-count ${c.count ? '' : 'hidden'}>${c.count}</span></span><span class="cart-txt"><small>Sepetim</small><b data-cart-total>${tl(c.total)}</b></span></a>
<button class="navtoggle" type="button" data-nav-toggle aria-expanded="false" aria-label="Menü">${ico.menu}</button></div></div></header>
<nav class="menubar" data-nav aria-label="Ana menü"><div class="container"><a class="allcats" href="/urunler">${ico.menu}Tüm kategoriler</a>
${NAV.map(([h, l]) => `<a href="${h.replace('araç-liftleri', 'araç-liftleri')}">${l}</a>`).join('')}</div></nav>`.replace('/kategori/arac-liftleri', '/kategori/arac-liftleri');
}

function footer(ctx) {
  const S = ctx.S; const back = e(ctx.path);
  return `<section class="container newsletter-wrap"><div class="newsletter"><div><h2>Kampanyalardan ilk siz haberdar olun</h2><p>E-bültene kayıt olun, yeni ürün ve fırsatları e-postanıza gönderelim.</p></div>
<form method="post" action="/bulten">${ctx.csrfField()}<input type="hidden" name="back" value="${back}"><label class="sr" for="nl-mail">E-posta</label><input id="nl-mail" type="email" name="email" placeholder="E-posta adresiniz" required><button class="btn btn-primary" type="submit">Kayıt ol</button></form></div></section>
<footer class="sitefoot"><div class="container"><div class="foot-grid">
<div class="foot-brand">${logo('dark')}<p>Oto servis ve sanayi ekipmanlarında güvenli, hızlı ve destekli alışveriş.</p></div>
<div><h3>Kurumsal</h3><a href="/sayfa/hakkimizda">Hakkımızda</a><a href="/iletisim">İletişim</a><a href="/havale-bildirimi">Havale bildirimi</a><a href="/siparis-takip">Sipariş ve kargo takibi</a></div>
<div><h3>Alışveriş</h3><a href="/sayfa/mesafeli-satis-sozlesmesi">Mesafeli satış sözleşmesi</a><a href="/sayfa/gizlilik-kvkk">Gizlilik politikası</a><a href="/sayfa/iade-kosullari">İptal ve iade koşulları</a><a href="/sayfa/gizlilik-kvkk">KVKK aydınlatma metni</a><a href="/sayfa/kargo-teslimat">Kargo ve teslimat</a></div>
<div><h3>İletişim</h3><p>${e(S.get('address'))}<br>${e(S.get('phone'))}<br>${e(S.get('email'))}</p></div></div>
<div class="foot-bottom"><span>© ${new Date().getFullYear()} ${e(S.get('shop_name'))}. Tüm hakları saklıdır.</span><span class="paypills"><span>Kredi / banka kartı</span><span>Havale / EFT</span><span>Kademeli ödeme</span></span></div></div></footer>`;
}

function home(ctx) {
  const { db, S } = ctx;
  const cats = catalog.categories(db);
  const tiles = cats.slice(0, 6);
  const tab = ctx.query.k || '';
  const tabCats = cats.filter((c) => c.n > 0).slice(0, 6);
  const prods = catalog.list(db, { cat: tabCats.find((c) => c.slug === tab) ? tab : '', sort: 'onerilen', per: 8, limit: 8 }).items;
  const promo = (cat, label, kind) => { const c = cats.find((x) => x.slug === cat); return c ? `<a class="promo" href="/kategori/${e(c.slug)}"><div class="promo-img">${illu(kind, 'light', c.name)}</div><div><small>${label}</small><b>${e(c.name)}</b><span>İncele →</span></div></a>` : ''; };
  return `<div class="container hero-wrap">
<aside class="catside"><h2>KATEGORİLER</h2>${cats.map((c) => `<a href="/kategori/${e(c.slug)}"><span>${e(c.name)}</span>${ico.chev}</a>`).join('')}</aside>
<div class="hero-col"><section class="hero"><svg class="hero-deco" viewBox="0 0 480 300" aria-hidden="true"><ellipse cx="232" cy="150" rx="205" ry="112" fill="none" stroke="#fff" stroke-width="3"/><ellipse cx="255" cy="146" rx="176" ry="92" fill="none" stroke="#fff" stroke-width="3"/><ellipse cx="272" cy="156" rx="138" ry="62" fill="none" stroke="#fff" stroke-width="3"/></svg>
<div class="hero-text"><span class="hero-badge">${e(S.get('hero_badge'))}</span><h1>${e(S.get('hero_title'))}</h1><p>${e(S.get('hero_text'))}</p>
<div class="hero-cta"><a class="btn btn-accent btn-lg" href="/urunler">Alışverişe başla</a><a class="btn btn-outline btn-lg" href="/sayfa/katalog">Kataloğu görüntüle</a></div></div>
<div class="hero-art">${illu('lift2', 'dark', 'Araç lifti')}</div></section>
<div class="promos">${promo('kriko-ve-vincler', 'Fırsat', 'kriko')}${promo('takim-arabalari', 'Yeni', 'takim')}</div></div></div>

<section class="container trust"><div>${ico.shield}<span><b>Güvenli ödeme</b><small>3D Secure ile korumalı</small></span></div><div>${ico.truck}<span><b>Hızlı kargo</b><small>Siparişiniz özenle paketlenir</small></span></div><div>${ico.wrench}<span><b>Kurulum desteği</b><small>Liftlerde montaj ve devreye alma</small></span></div><div>${ico.headset}<span><b>Satış sonrası destek</b><small>Servis ve yedek parça</small></span></div></section>

<section class="container block"><h2 class="sec-title">Kategoriye göre alışveriş</h2><div class="tiles">${tiles.map((c) => `<a class="tile" href="/kategori/${e(c.slug)}"><div>${illu(c.kind, 'light', c.name)}</div><b>${e(c.name)}</b></a>`).join('')}</div></section>

<section class="container block" id="populer"><div class="sec-head"><h2 class="sec-title">Popüler ürünler</h2><a class="more" href="/urunler">Tüm ürünleri gör →</a></div>
<div class="tabs"><a class="${!tab ? 'on' : ''}" href="/#populer">Tümü</a>${tabCats.map((c) => `<a class="${tab === c.slug ? 'on' : ''}" href="/?k=${e(c.slug)}#populer">${e(c.name)}</a>`).join('')}</div>
<div class="grid-products">${prods.map((p) => ui.productCard(ctx, p)).join('')}</div>${S.get('demo_mode') === '1' ? '<p class="demo-note">Ürün adları, özellikler ve fiyatlar örnektir; gerçek ürün verisiyle değiştirilecek.</p>' : ''}</section>

<section class="container block"><div class="consult"><div><small>Araç liftleri</small><h2>Lift seçimi ve kurulumda yanınızdayız.</h2><p>Atölyenizin ölçüsüne ve araç tipine göre doğru lifti birlikte seçelim. Montaj ve devreye alma desteği sunulur.</p><a class="btn btn-accent btn-lg" href="/iletisim?konu=danismanlik">Danışmanlık talep et</a></div><div class="consult-art">${illu('makas', 'dark', 'Makaslı lift')}</div></div></section>

<section class="container block"><h2 class="sec-title sm">Çalıştığımız markalar</h2><div class="brands">${'<div>[Marka logosu]</div>'.repeat(6)}</div></section>`;
}

module.exports = { id: 'mavi', tone: 'light', themeColor: '#26256F', fonts: 'https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=Inter:wght@400;500;600&display=swap', header, footer, home };
