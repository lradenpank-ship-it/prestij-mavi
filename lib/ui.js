'use strict';
// Temalardan bağımsız ortak arayüz parçaları. Görünümü tema CSS'i belirler.
const { e, tl } = require('./util');
const { illu, logo } = require('./illu');
const shop = require('./shop');

const ico = {
  search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  user: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  cart: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.5 11h11L21 7H6"/></svg>',
  menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  chev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  plus: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  shield: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  truck: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
  wrench: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 0-2-2z"/></svg>',
  headset: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/></svg>',
};

const BADGE_CLASS = { 'Çok satan': 'b-hot', Yeni: 'b-new', 'İndirim': 'b-sale', Hediyeli: 'b-gift' };
const badge = (b) => (b ? `<span class="pbadge ${BADGE_CLASS[b] || 'b-other'}">${e(b)}</span>` : '');

function productImg(ctx, p, cls = '') {
  const tone = ctx.theme.tone;
  if (p.image) return `<img class="pic ${cls}" src="/uploads/${e(p.image)}" alt="${e(p.name)}" loading="lazy" decoding="async">`;
  return illu(p.kind, tone, p.name);
}

function priceBlock(p) {
  return `<div class="pprice"><b>${tl(p.price)}</b>${p.old_price && p.old_price > p.price ? `<s>${tl(p.old_price)}</s>` : ''}</div>`;
}

function addForm(ctx, p, label = 'Sepete ekle') {
  if (p.stock <= 0) return '<button class="addbtn" type="button" disabled><span class="t">Stokta yok</span><span class="p">–</span></button>';
  return `<form method="post" action="/sepet/ekle" data-ajax class="addform">${ctx.csrfField()}<input type="hidden" name="id" value="${p.id}"><input type="hidden" name="qty" value="1"><input type="hidden" name="back" value="${e(ctx.path + ctx.url.search)}">
<button class="addbtn" type="submit" aria-label="${e(p.name)} ürününü sepete ekle"><span class="t">${e(label)}</span><span class="p">${ico.plus}</span></button></form>`;
}

function productCard(ctx, p) {
  return `<article class="pcard">
<a class="pimg" href="/urun/${e(p.slug)}" tabindex="-1" aria-hidden="true">${badge(p.badge)}${productImg(ctx, p)}</a>
<div class="pbody"><div class="pcat">${e(p.cat_name || '')}</div>
<h3 class="pname"><a href="/urun/${e(p.slug)}">${e(p.name)}</a></h3>
<div class="pspec">${e(p.short || '')}</div>
<div class="pfoot">${priceBlock(p)}${addForm(ctx, p)}</div></div></article>`;
}

function pager(page, pages, hrefFn) {
  if (pages <= 1) return '';
  const nums = []; const add = (n) => { if (n >= 1 && n <= pages && !nums.includes(n)) nums.push(n); };
  [1, 2, page - 1, page, page + 1, pages - 1, pages].forEach(add);
  nums.sort((a, b) => a - b);
  let out = '<nav class="pager" aria-label="Sayfalar">'; let prev = 0;
  if (page > 1) out += `<a href="${e(hrefFn(page - 1))}" rel="prev">‹ Önceki</a>`;
  for (const n of nums) {
    if (n - prev > 1) out += '<span class="gap">…</span>';
    out += n === page ? `<span class="cur" aria-current="page">${n}</span>` : `<a href="${e(hrefFn(n))}">${n}</a>`;
    prev = n;
  }
  if (page < pages) out += `<a href="${e(hrefFn(page + 1))}" rel="next">Sonraki ›</a>`;
  return out + '</nav>';
}

const statusPill = (s) => `<span class="pill st-${e(s)}">${e(shop.STATUS[s] || s)}</span>`;
const payPill = (s) => `<span class="pill ps-${e(s)}">${e(shop.PAY_STATUS[s] || s)}</span>`;

/** Sepet özeti parçası (çekmece ve /sepet/mini için) */
function miniCart(ctx) {
  const c = shop.loadCart(ctx);
  if (!c.lines.length) return '<div class="mini-empty">Sepetiniz boş. Mağazadan ürün ekleyin.</div>';
  const lines = c.lines.map((l) => `<div class="mini-line">
<div class="mini-img">${productImg(ctx, l)}</div>
<div class="mini-info"><a class="mini-name" href="/urun/${e(l.slug)}">${e(l.name)}</a><div class="mini-price">${tl(l.line)}</div>
<div class="qty">
<form method="post" action="/sepet/guncelle" data-ajax>${ctx.csrfField()}<input type="hidden" name="id" value="${l.id}"><input type="hidden" name="qty" value="${l.qty - 1}"><button type="submit" aria-label="Azalt">−</button></form>
<span>${l.qty}</span>
<form method="post" action="/sepet/guncelle" data-ajax>${ctx.csrfField()}<input type="hidden" name="id" value="${l.id}"><input type="hidden" name="qty" value="${l.qty + 1}"><button type="submit" aria-label="Artır" ${l.qty >= l.stock ? 'disabled' : ''}>+</button></form>
</div></div></div>`).join('');
  return `${lines}<div class="mini-sum"><div><span>Ara toplam</span><span>${tl(c.subtotal)}</span></div>
<div><span>Kargo</span><span>${c.shipping ? tl(c.shipping) : 'Ücretsiz'}</span></div>
<div class="mini-total"><span>Toplam</span><b>${tl(c.total)}</b></div></div>
<a class="btn btn-primary btn-block btn-lg" href="/odeme">Güvenli ödemeye geç</a><a class="mini-link" href="/sepet">Sepeti görüntüle</a>`;
}

function field(label, name, value = '', o = {}) {
  const type = o.type || 'text';
  const common = `id="f-${name}" name="${name}" ${o.required ? 'required' : ''} ${o.autocomplete ? `autocomplete="${o.autocomplete}"` : ''} ${o.max ? `maxlength="${o.max}"` : ''} ${o.attrs || ''}`;
  const input = type === 'textarea'
    ? `<textarea ${common} rows="${o.rows || 4}">${e(value)}</textarea>`
    : `<input type="${type}" ${common} value="${e(value)}" ${o.placeholder ? `placeholder="${e(o.placeholder)}"` : ''} ${o.inputmode ? `inputmode="${o.inputmode}"` : ''}>`;
  return `<div class="field ${o.cls || ''}"><label for="f-${name}">${e(label)}${o.required ? ' <i>*</i>' : ''}</label>${input}${o.hint ? `<small>${e(o.hint)}</small>` : ''}${o.err ? `<em class="ferr">${e(o.err)}</em>` : ''}</div>`;
}

module.exports = { ico, badge, productImg, priceBlock, addForm, productCard, pager, statusPill, payPill, miniCart, field, illu, logo };
