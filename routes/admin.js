'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../lib/util');
const { e, tl } = U;
const auth = require('../lib/auth');
const shop = require('../lib/shop');
const catalog = require('../lib/catalog');
const pay = require('../lib/payments');
const maint = require('../lib/maintenance');
const mail = require('../lib/mail');
const { illu, KINDS } = require('../lib/illu');
const { HttpError, imageExt } = require('../lib/http');
const { tx, dbFile } = require('../lib/db');
const log = require('../lib/logger');
const { PAGES } = require('../lib/seed');

const NAV = [
  ['/yonetim', 'Özet'], ['/yonetim/siparisler', 'Siparişler'], ['/yonetim/havale', 'Havale bildirimleri'], ['/yonetim/urunler', 'Ürünler'],
  ['/yonetim/kategoriler', 'Kategoriler'], ['/yonetim/mesajlar', 'Mesajlar'], ['/yonetim/sayfalar', 'Sayfalar'], ['/yonetim/ayarlar', 'Ayarlar'],
  ['/yonetim/yonetici', 'Hesap ve yedek'], ['/yonetim/kayitlar', 'Kayıtlar'],
];

function layout(ctx, admin, title, body, active) {
  const db = ctx.db;
  const nh = db.prepare('SELECT COUNT(*) c FROM havale_notices WHERE status=\'yeni\'').get().c;
  const nm = db.prepare('SELECT COUNT(*) c FROM messages WHERE seen=0').get().c;
  const no = db.prepare('SELECT COUNT(*) c FROM orders WHERE status=\'odeme-bekliyor\' OR status=\'hazirlaniyor\'').get().c;
  const badges = { '/yonetim/havale': nh, '/yonetim/mesajlar': nm, '/yonetim/siparisler': no };
  const flash = ctx.takeFlash();
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>${e(title)} · Yönetim</title><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${ctx.app.asset('/static/admin.css')}"><script src="${ctx.app.asset('/static/app.js')}" defer></script></head>
<body class="admin"><aside class="ad-side"><div class="ad-brand"><b>PRESTİJ</b><small>Yönetim paneli</small></div>
<nav>${NAV.map(([h, l]) => `<a href="${h}" class="${active === h ? 'on' : ''}">${l}${badges[h] ? `<span class="ad-n">${badges[h]}</span>` : ''}</a>`).join('')}</nav>
<div class="ad-user"><a href="/" target="_blank" rel="noopener">Siteyi görüntüle ↗</a><form method="post" action="/yonetim/cikis">${ctx.csrfField()}<button class="ad-link">Çıkış (${e(admin.username)})</button></form></div></aside>
<main class="ad-main"><header class="ad-head"><h1>${e(title)}</h1></header>
${flash ? `<div class="ad-alert ${flash.kind === 'err' ? 'err' : 'ok'}" role="status">${e(flash.msg)}</div>` : ''}${body}</main></body></html>`;
  ctx.html(html);
}

const guard = (fn, active) => async (ctx) => {
  const a = auth.requireAdmin(ctx); if (!a) return;
  if (ctx.method === 'POST') ctx.checkCsrf();
  return fn(ctx, a, (title, body) => layout(ctx, a, title, body, active));
};

const sel = (name, opts, cur, attrs = '') => `<select name="${name}" ${attrs}>${opts.map(([v, l]) => `<option value="${e(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${e(l)}</option>`).join('')}</select>`;
const pager = (page, pages, hrefFn) => {
  if (pages <= 1) return '';
  return `<div class="ad-pager">${page > 1 ? `<a href="${e(hrefFn(page - 1))}">‹ Önceki</a>` : ''}<span>Sayfa ${page} / ${pages}</span>${page < pages ? `<a href="${e(hrefFn(page + 1))}">Sonraki ›</a>` : ''}</div>`;
};
const field = (label, name, val = '', o = {}) => {
  const input = o.type === 'textarea' ? `<textarea name="${name}" rows="${o.rows || 4}" ${o.max ? `maxlength="${o.max}"` : ''}>${e(val)}</textarea>`
    : o.html ? o.html : `<input type="${o.type || 'text'}" name="${name}" value="${e(val)}" ${o.required ? 'required' : ''} ${o.max ? `maxlength="${o.max}"` : ''} ${o.attrs || ''}>`;
  return `<label class="ad-f ${o.cls || ''}"><span>${e(label)}</span>${input}${o.hint ? `<small>${e(o.hint)}</small>` : ''}</label>`;
};

// ------------------------------------------------------------------ Giriş
function loginForm(ctx, err = '') {
  ctx.html(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Yönetim girişi</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${ctx.app.asset('/static/admin.css')}"></head><body class="admin login"><form class="ad-login" method="post" action="/yonetim/giris">
<div class="ad-brand"><b>PRESTİJ</b><small>Yönetim paneli</small></div>${err ? `<div class="ad-alert err" role="alert">${e(err)}</div>` : ''}${ctx.csrfField()}
${field('Kullanıcı adı', 'username', '', { required: true, attrs: 'autocomplete="username" autofocus' })}${field('Şifre', 'password', '', { type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
<button class="ad-btn primary">Giriş yap</button></form></body></html>`);
}
async function loginPost(ctx) {
  ctx.checkCsrf(); ctx.limit('login', 10, 900000);
  const u = U.trim(ctx.form.username, 60).toLowerCase(); const pw = String(ctx.form.password || '').slice(0, 200);
  ctx.limit('login-u:' + u, 8, 900000);
  const row = ctx.db.prepare('SELECT * FROM admins WHERE lower(username)=?').get(u);
  const ok = row ? await auth.verifyPassword(pw, row.pass_hash) : (await auth.verifyPassword(pw, 'scrypt$00$00'), false);
  if (!ok) { log.warn(`Yönetici girişi başarısız: ${u} (${ctx.ip})`); ctx.status = 401; return loginForm(ctx, 'Kullanıcı adı veya şifre hatalı.'); }
  auth.createSession(ctx, row.id); ctx._admin = undefined;
  auth.audit(ctx, 'giris', ctx.ip);
  ctx.redirect('/yonetim');
}
function logout(ctx) { ctx.checkCsrf(); auth.destroySession(ctx); ctx.redirect('/yonetim/giris'); }

// ------------------------------------------------------------------ Özet
const dashboard = guard((ctx, a, L) => {
  const db = ctx.db; const now = Date.now(); const d30 = now - 30 * 86400000; const d1 = now - 86400000;
  const s = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(paid_total),0) paid, COALESCE(SUM(total),0) tot FROM orders WHERE created_at>? AND status<>'iptal'`).get(d30);
  const s1 = db.prepare(`SELECT COUNT(*) n FROM orders WHERE created_at>? AND status<>'iptal'`).get(d1);
  const wait = db.prepare(`SELECT COUNT(*) n FROM orders WHERE status='odeme-bekliyor'`).get().n;
  const prep = db.prepare(`SELECT COUNT(*) n FROM orders WHERE status='hazirlaniyor'`).get().n;
  const hv = db.prepare(`SELECT COUNT(*) n FROM havale_notices WHERE status='yeni'`).get().n;
  const low = db.prepare('SELECT id,name,stock FROM products WHERE active=1 AND stock<=3 ORDER BY stock,id LIMIT 8').all();
  const recent = db.prepare('SELECT id,no,name,total,status,pay_status,created_at FROM orders ORDER BY id DESC LIMIT 8').all();
  const total = db.prepare('SELECT COUNT(*) n FROM orders').get().n;
  const bk = maint.listBackups()[0];
  const size = (() => { try { return (fs.statSync(dbFile()).size / 1048576).toFixed(1); } catch { return '?'; } })();
  const warn = [];
  if (pay.isDemo()) warn.push('<b>Ödeme sağlayıcısı DEMO modunda.</b> Kart ödemeleri gerçek para çekmez ve sipariş "ödendi" olur. Canlıya almadan önce PAYMENT_PROVIDER ayarını yapın (README).');
  if (!ctx.cfg.BASE_URL) warn.push('BASE_URL ayarlı değil: e-postalardaki bağlantılar ve site haritası için alan adınızı BASE_URL olarak tanımlayın.');
  if (!mail.enabled()) warn.push('E-posta (SMTP) ayarlı değil: müşteri bildirimleri gönderilmez, yalnızca "Kayıtlar" bölümünde birikir.');
  if (ctx.S.get('bank_info').includes('[')) warn.push('Havale/EFT banka bilgileri henüz doldurulmamış (Ayarlar).');
  L('Özet', `${warn.map((w) => `<div class="ad-alert warn">${w}</div>`).join('')}
<div class="ad-cards"><div class="ad-card"><small>Son 30 gün sipariş</small><b>${s.n}</b></div><div class="ad-card"><small>Son 30 gün ciro (sipariş)</small><b>${tl(s.tot)}</b></div>
<div class="ad-card"><small>Tahsil edilen</small><b>${tl(s.paid)}</b></div><div class="ad-card"><small>Son 24 saat</small><b>${s1.n}</b></div>
<div class="ad-card ${wait ? 'hot' : ''}"><small>Ödeme bekleyen</small><b>${wait}</b></div><div class="ad-card ${prep ? 'hot' : ''}"><small>Hazırlanacak</small><b>${prep}</b></div>
<div class="ad-card ${hv ? 'hot' : ''}"><small>Yeni havale bildirimi</small><b>${hv}</b></div><div class="ad-card"><small>Toplam sipariş</small><b>${total}</b></div></div>
<div class="ad-cols"><section class="ad-box"><h2>Son siparişler</h2><table class="ad-t"><thead><tr><th>No</th><th>Müşteri</th><th>Tutar</th><th>Durum</th><th>Tarih</th></tr></thead><tbody>
${recent.map((o) => `<tr><td><a href="/yonetim/siparis/${o.id}">${e(o.no)}</a></td><td>${e(o.name)}</td><td>${tl(o.total)}</td><td>${e(shop.STATUS[o.status])}</td><td>${U.dateTR(o.created_at)}</td></tr>`).join('') || '<tr><td colspan="5">Henüz sipariş yok.</td></tr>'}</tbody></table></section>
<section class="ad-box"><h2>Stoku azalanlar</h2>${low.length ? `<ul class="ad-list">${low.map((p) => `<li><a href="/yonetim/urun/${p.id}">${e(p.name)}</a> <b class="${p.stock <= 0 ? 'neg' : ''}">${p.stock}</b></li>`).join('')}</ul>` : '<p>Stok sorunu yok.</p>'}
<h2>Sistem</h2><ul class="ad-list"><li>Veritabanı <b>${size} MB</b></li><li>Son yedek <b>${bk ? bk.name.slice(7, 19).replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/, '$3.$2.$1 $4:$5') : 'yok'}</b></li><li>Ödeme <b>${e(pay.provider)}</b></li></ul></section></div>`);
}, '/yonetim');

// ------------------------------------------------------------------ Siparişler
const ordersList = guard((ctx, a, L) => {
  const q = U.trim(ctx.query.q || '', 60); const st = ctx.query.durum || ''; const ps = ctx.query.odeme || '';
  const where = []; const args = [];
  if (shop.STATUS[st]) { where.push('status=?'); args.push(st); }
  if (shop.PAY_STATUS[ps]) { where.push('pay_status=?'); args.push(ps); }
  if (q) { where.push('search LIKE ?'); args.push(`%${U.searchKey(q)}%`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const per = 50; const total = ctx.db.prepare(`SELECT COUNT(*) n FROM orders ${w}`).get(...args).n;
  const pages = Math.max(1, Math.ceil(total / per)); const page = U.clamp(U.int(ctx.query.sayfa, 1), 1, pages);
  const rows = ctx.db.prepare(`SELECT id,no,name,phone,total,paid_total,status,pay_method,pay_status,created_at FROM orders ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per);
  const href = (n) => `/yonetim/siparisler?${new URLSearchParams({ q, durum: st, odeme: ps, sayfa: n })}`;
  L('Siparişler', `<form class="ad-filter" method="get"><input type="search" name="q" value="${e(q)}" placeholder="No, ad, e-posta, telefon">
${sel('durum', [['', 'Tüm durumlar'], ...Object.entries(shop.STATUS)], st)}${sel('odeme', [['', 'Tüm ödemeler'], ...Object.entries(shop.PAY_STATUS)], ps)}<button class="ad-btn">Filtrele</button>
<a class="ad-btn" href="/yonetim/siparisler.csv?${new URLSearchParams({ q, durum: st, odeme: ps })}">CSV indir</a></form>
<p class="ad-muted">${total} sipariş</p>
<table class="ad-t"><thead><tr><th>No</th><th>Müşteri</th><th>Yöntem</th><th>Tutar</th><th>Ödenen</th><th>Durum</th><th>Ödeme</th><th>Tarih</th></tr></thead><tbody>
${rows.map((o) => `<tr><td><a href="/yonetim/siparis/${o.id}">${e(o.no)}</a></td><td>${e(o.name)}<br><small>${e(o.phone)}</small></td><td>${e(shop.METHOD[o.pay_method])}</td><td>${tl(o.total)}</td><td>${tl(o.paid_total)}</td><td><span class="ad-pill s-${o.status}">${e(shop.STATUS[o.status])}</span></td><td>${e(shop.PAY_STATUS[o.pay_status])}</td><td>${U.dateTR(o.created_at)}</td></tr>`).join('') || '<tr><td colspan="8">Sipariş bulunamadı.</td></tr>'}</tbody></table>${pager(page, pages, href)}`);
}, '/yonetim/siparisler');

function ordersCsv(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return;
  const st = ctx.query.durum || ''; const ps = ctx.query.odeme || '';
  const where = []; const args = [];
  if (shop.STATUS[st]) { where.push('status=?'); args.push(st); }
  if (shop.PAY_STATUS[ps]) { where.push('pay_status=?'); args.push(ps); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  ctx.sent = true;
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="siparisler.csv"', 'Cache-Control': 'no-store' });
  const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  ctx.res.write('﻿' + ['No', 'Tarih', 'Ad', 'E-posta', 'Telefon', 'İl', 'Adres', 'Yöntem', 'Durum', 'Ödeme durumu', 'Toplam', 'Ödenen', 'Fatura', 'Firma', 'Vergi no'].join(';') + '\n');
  let last = 0;
  for (;;) { // sayfa sayfa oku: bellek sabit kalır
    const rows = ctx.db.prepare(`SELECT * FROM orders ${w ? w + ' AND' : 'WHERE'} id>? ORDER BY id LIMIT 1000`).all(...args, last);
    if (!rows.length) break;
    ctx.res.write(rows.map((o) => [o.no, new Date(o.created_at).toISOString(), o.name, o.email, o.phone, o.city, o.address, shop.METHOD[o.pay_method], shop.STATUS[o.status], shop.PAY_STATUS[o.pay_status], (o.total / 100).toFixed(2).replace('.', ','), (o.paid_total / 100).toFixed(2).replace('.', ','), o.invoice_type, o.company, o.tax_no].map(cell).join(';')).join('\n') + '\n');
    last = rows[rows.length - 1].id;
  }
  ctx.res.end();
}

const orderDetail = guard((ctx, a, L) => {
  const o = ctx.db.prepare('SELECT * FROM orders WHERE id=?').get(U.int(ctx.params[0]));
  if (!o) throw new HttpError(404, 'Sipariş bulunamadı');
  const items = ctx.db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
  const pays = ctx.db.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY id').all(o.id);
  const events = ctx.db.prepare('SELECT * FROM order_events WHERE order_id=? ORDER BY id DESC').all(o.id);
  const notices = ctx.db.prepare('SELECT * FROM havale_notices WHERE order_id=? ORDER BY id DESC').all(o.id);
  const base = ctx.cfg.BASE_URL || '';
  L(`Sipariş ${o.no}`, `<p><a href="/yonetim/siparisler">‹ Siparişler</a> · <button class="ad-btn" data-print>Yazdır</button> · <a href="${base}/siparis/${o.token}" target="_blank" rel="noopener">Müşteri görünümü ↗</a></p>
<div class="ad-cols"><section class="ad-box"><h2>Müşteri</h2><p><b>${e(o.name)}</b><br>${e(o.email)}<br>${e(o.phone)}<br>${e(o.address)}<br>${e(o.city || '')}</p>
${o.invoice_type === 'kurumsal' ? `<p><b>Kurumsal fatura</b><br>${e(o.company)}<br>${e(o.tax_office)} VD · ${e(o.tax_no)}</p>` : '<p>Bireysel fatura</p>'}${o.note ? `<p><b>Not:</b> ${e(o.note)}</p>` : ''}
<small class="ad-muted">IP: ${e(o.ip || '')} · ${U.dateTR(o.created_at)}</small></section>
<section class="ad-box"><h2>Durum</h2><form method="post" action="/yonetim/siparis/${o.id}/durum" class="ad-stack">${ctx.csrfField()}
${field('Sipariş durumu', 'status', '', { html: sel('status', Object.entries(shop.STATUS), o.status) })}
${field('Kargo firması', 'cargo_company', o.cargo_company || '', { max: 60 })}${field('Takip numarası', 'cargo_no', o.cargo_no || '', { max: 60 })}
<button class="ad-btn primary">Kaydet</button></form>${o.status === 'iptal' ? '<p class="ad-muted">İptal edilen sipariş geri açılamaz; stok iade edildi.</p>' : '<p class="ad-muted">"İptal" seçilirse stok geri verilir.</p>'}</section></div>
<section class="ad-box"><h2>Ödemeler — ${e(shop.METHOD[o.pay_method])}</h2><table class="ad-t"><thead><tr><th>Tür</th><th>Yöntem</th><th>Tutar</th><th>Durum</th><th>Ref</th><th></th></tr></thead><tbody>
${pays.map((p) => `<tr><td>${e(shop.PAYMENT_KIND[p.kind])}</td><td>${e(shop.METHOD[p.method] || p.method)}</td><td>${tl(p.amount)}</td><td>${e(shop.PAYMENT_STATUS[p.status])}${p.paid_at ? `<br><small>${U.dateTR(p.paid_at)}</small>` : ''}</td><td><small>${e(p.provider_ref || p.note || '')}</small></td>
<td>${p.status === 'pending' && o.status !== 'iptal' ? `<form method="post" action="/yonetim/siparis/${o.id}/odeme" data-confirm="Bu ödeme alındı olarak işaretlensin mi?">${ctx.csrfField()}<input type="hidden" name="pid" value="${p.id}"><button class="ad-btn primary">Ödendi işaretle</button></form>` : ''}</td></tr>`).join('')}</tbody></table>
<p>Toplam <b>${tl(o.total)}</b> · Ödenen <b>${tl(o.paid_total)}</b> · Kalan <b>${tl(Math.max(0, o.total - o.paid_total))}</b></p>
${notices.length ? `<h3>Havale bildirimleri</h3><ul class="ad-list">${notices.map((n) => `<li>${U.dateTR(n.created_at)} · ${e(n.name)} · ${tl(n.amount)} · ${e(n.bank || '')} · <b>${e(n.status)}</b></li>`).join('')}</ul><p><a href="/yonetim/havale">Havale bildirimlerine git</a></p>` : ''}</section>
<section class="ad-box"><h2>Ürünler</h2><table class="ad-t"><thead><tr><th>Ürün</th><th>Kod</th><th>Adet</th><th>Fiyat</th><th>Tutar</th></tr></thead><tbody>
${items.map((i) => `<tr><td>${e(i.name)}</td><td>${e(i.sku || '')}</td><td>${i.qty}</td><td>${tl(i.unit_price)}</td><td>${tl(i.unit_price * i.qty)}</td></tr>`).join('')}
<tr><td colspan="4">Kargo</td><td>${tl(o.shipping)}</td></tr><tr><td colspan="4"><b>Toplam</b></td><td><b>${tl(o.total)}</b></td></tr></tbody></table></section>
<section class="ad-box"><h2>Geçmiş ve notlar</h2><form method="post" action="/yonetim/siparis/${o.id}/not" class="ad-inline">${ctx.csrfField()}<input name="note" placeholder="Dahili not (müşteri görmez)" maxlength="300" required><button class="ad-btn">Ekle</button></form>
<ul class="ad-list">${events.map((ev) => `<li><small>${U.dateTR(ev.at)}</small> ${ev.internal ? '<i>(dahili)</i> ' : ''}${e(ev.text)}</li>`).join('')}</ul></section>`);
}, '/yonetim/siparisler');

function orderStatus(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  const id = U.int(ctx.params[0]); const st = ctx.form.status;
  const o = ctx.db.prepare('SELECT * FROM orders WHERE id=?').get(id); if (!o) throw new HttpError(404);
  const cargoCompany = U.trim(ctx.form.cargo_company, 60) || null; const cargoNo = U.trim(ctx.form.cargo_no, 60) || null;
  if (cargoCompany !== o.cargo_company || cargoNo !== o.cargo_no) ctx.db.prepare('UPDATE orders SET cargo_company=?, cargo_no=? WHERE id=?').run(cargoCompany, cargoNo, id);
  const changed = shop.setStatus(ctx.db, ctx.S, id, st, { cargoCompany, cargoNo });
  auth.audit(ctx, 'siparis-durum', `${o.no} → ${st}`);
  ctx.flash(changed ? 'Sipariş güncellendi.' : 'Kargo bilgisi kaydedildi.');
  ctx.redirect(`/yonetim/siparis/${id}`);
}
function orderPay(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  const id = U.int(ctx.params[0]); const pid = U.int(ctx.form.pid);
  const p = ctx.db.prepare('SELECT * FROM payments WHERE id=? AND order_id=?').get(pid, id); if (!p) throw new HttpError(404);
  const r = shop.markPaid(ctx.db, ctx.S, pid, `MANUEL-${a.username}`, 'Yönetici onayı');
  auth.audit(ctx, 'odeme-onay', `payment ${pid} order ${id}`);
  ctx.flash(r.ok ? 'Ödeme kaydedildi.' : 'Ödeme işlenemedi (sipariş iptal olabilir).', r.ok ? 'ok' : 'err');
  ctx.redirect(`/yonetim/siparis/${id}`);
}
function orderNote(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  const id = U.int(ctx.params[0]);
  shop.addEvent(ctx.db, id, `${a.username}: ${U.trim(ctx.form.note, 300)}`, 1);
  ctx.redirect(`/yonetim/siparis/${id}`);
}

// ------------------------------------------------------------------ Havale bildirimleri
const havale = guard((ctx, a, L) => {
  const st = ctx.query.durum || 'yeni';
  const per = 50; const total = ctx.db.prepare('SELECT COUNT(*) n FROM havale_notices WHERE status=?').get(st).n;
  const pages = Math.max(1, Math.ceil(total / per)); const page = U.clamp(U.int(ctx.query.sayfa, 1), 1, pages);
  const rows = ctx.db.prepare(`SELECT h.*, o.total, o.paid_total, o.token FROM havale_notices h LEFT JOIN orders o ON o.id=h.order_id WHERE h.status=? ORDER BY h.id DESC LIMIT ? OFFSET ?`).all(st, per, (page - 1) * per);
  L('Havale bildirimleri', `<p class="ad-tabs">${['yeni', 'onaylandi', 'reddedildi'].map((s) => `<a class="${st === s ? 'on' : ''}" href="?durum=${s}">${{ yeni: 'Yeni', onaylandi: 'Onaylanan', reddedildi: 'Reddedilen' }[s]}</a>`).join('')}</p>
<table class="ad-t"><thead><tr><th>Tarih</th><th>Sipariş</th><th>Gönderen</th><th>Banka</th><th>Bildirilen</th><th>Sipariş tutarı</th><th></th></tr></thead><tbody>
${rows.map((h) => `<tr><td>${U.dateTR(h.created_at)}<br><small>Ödeme: ${e(h.paid_on || '')}</small></td><td>${h.order_id ? `<a href="/yonetim/siparis/${h.order_id}">${e(h.order_no)}</a>` : `${e(h.order_no)} <small class="neg">(eşleşmedi)</small>`}</td>
<td>${e(h.name)}${h.note ? `<br><small>${e(h.note)}</small>` : ''}</td><td>${e(h.bank || '')}</td><td>${tl(h.amount)}</td><td>${h.total != null ? `${tl(h.total)}<br><small>ödenen ${tl(h.paid_total)}</small>` : '-'}</td>
<td>${h.status === 'yeni' ? `<form method="post" action="/yonetim/havale/${h.id}" class="ad-inline">${ctx.csrfField()}<button class="ad-btn primary" name="act" value="onay" data-confirm="Ödeme banka hesabında görüldü mü? Sipariş ödendi olarak işaretlenecek.">Onayla</button><button class="ad-btn" name="act" value="red">Reddet</button></form>` : ''}</td></tr>`).join('') || '<tr><td colspan="7">Kayıt yok.</td></tr>'}</tbody></table>${pager(page, pages, (n) => `?durum=${st}&sayfa=${n}`)}`);
}, '/yonetim/havale');

function havaleAct(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  const id = U.int(ctx.params[0]);
  const n = ctx.db.prepare('SELECT * FROM havale_notices WHERE id=?').get(id);
  if (!n || n.status !== 'yeni') { ctx.flash('Bildirim zaten işlendi.', 'err'); return ctx.redirect('/yonetim/havale'); }
  if (ctx.form.act === 'onay') {
    let msg = 'Bildirim onaylandı.';
    if (n.order_id) {
      const p = ctx.db.prepare(`SELECT id FROM payments WHERE order_id=? AND status='pending' AND method='havale' ORDER BY id LIMIT 1`).get(n.order_id)
        || ctx.db.prepare(`SELECT id FROM payments WHERE order_id=? AND status='pending' ORDER BY id LIMIT 1`).get(n.order_id);
      if (p) {
        ctx.db.prepare('UPDATE payments SET method=\'havale\' WHERE id=?').run(p.id);
        const r = shop.markPaid(ctx.db, ctx.S, p.id, `HAVALE-${id}`, `Havale bildirimi #${id}`);
        msg = r.ok ? 'Onaylandı, ödeme sipariş üzerine işlendi.' : 'Bildirim onaylandı ancak ödeme işlenemedi (sipariş iptal edilmiş olabilir).';
      } else msg = 'Onaylandı; siparişte bekleyen ödeme kalmamış.';
    }
    ctx.db.prepare('UPDATE havale_notices SET status=\'onaylandi\' WHERE id=?').run(id);
    auth.audit(ctx, 'havale-onay', `${n.order_no} ${tl(n.amount)}`);
    ctx.flash(msg);
  } else {
    ctx.db.prepare('UPDATE havale_notices SET status=\'reddedildi\' WHERE id=?').run(id);
    if (n.order_id) shop.addEvent(ctx.db, n.order_id, 'Havale bildiriminiz doğrulanamadı. Lütfen bizimle iletişime geçin.');
    auth.audit(ctx, 'havale-red', n.order_no);
    ctx.flash('Bildirim reddedildi.');
  }
  ctx.redirect('/yonetim/havale');
}

// ------------------------------------------------------------------ Ürünler
const products = guard((ctx, a, L) => {
  const q = U.trim(ctx.query.q || '', 60); const cat = U.int(ctx.query.kategori, 0); const f = ctx.query.f || '';
  const where = []; const args = [];
  if (q) { where.push('p.search LIKE ?'); args.push(`%${U.searchKey(q)}%`); }
  if (cat) { where.push('p.category_id=?'); args.push(cat); }
  if (f === 'dusuk') where.push('p.stock<=3'); if (f === 'pasif') where.push('p.active=0');
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const per = 50; const total = ctx.db.prepare(`SELECT COUNT(*) n FROM products p ${w}`).get(...args).n;
  const pages = Math.max(1, Math.ceil(total / per)); const page = U.clamp(U.int(ctx.query.sayfa, 1), 1, pages);
  const rows = ctx.db.prepare(`SELECT p.id,p.name,p.sku,p.price,p.old_price,p.stock,p.active,p.badge,p.kind,p.image,c.name cat FROM products p LEFT JOIN categories c ON c.id=p.category_id ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per);
  const cats = catalog.categories(ctx.db, true);
  L('Ürünler', `<form class="ad-filter" method="get"><input type="search" name="q" value="${e(q)}" placeholder="Ürün adı veya kodu">${sel('kategori', [['', 'Tüm kategoriler'], ...cats.map((c) => [c.id, c.name])], cat)}
${sel('f', [['', 'Hepsi'], ['dusuk', 'Stoğu azalan'], ['pasif', 'Pasif']], f)}<button class="ad-btn">Filtrele</button><a class="ad-btn primary" href="/yonetim/urun/yeni">+ Yeni ürün</a></form><p class="ad-muted">${total} ürün</p>
<table class="ad-t"><thead><tr><th></th><th>Ürün</th><th>Kategori</th><th>Fiyat</th><th>Stok</th><th>Durum</th></tr></thead><tbody>
${rows.map((p) => `<tr class="${p.active ? '' : 'off'}"><td class="ad-thumb">${p.image ? `<img src="/uploads/${e(p.image)}" alt="">` : illu(p.kind, 'light')}</td><td><a href="/yonetim/urun/${p.id}">${e(p.name)}</a><br><small>${e(p.sku || '')} ${p.badge ? '· ' + e(p.badge) : ''}</small></td><td>${e(p.cat || '')}</td>
<td>${tl(p.price)}${p.old_price ? `<br><small><s>${tl(p.old_price)}</s></small>` : ''}</td>
<td><form method="post" action="/yonetim/urun/${p.id}/stok" class="ad-inline">${ctx.csrfField()}<input class="ad-num" type="number" name="stock" value="${p.stock}" min="0" max="99999"><button class="ad-btn">Kaydet</button></form></td><td>${p.active ? 'Yayında' : '<b>Pasif</b>'}</td></tr>`).join('') || '<tr><td colspan="6">Ürün yok.</td></tr>'}</tbody></table>
${pager(page, pages, (n) => `?${new URLSearchParams({ q, kategori: cat || '', f, sayfa: n })}`)}`);
}, '/yonetim/urunler');

function productForm(ctx, a, L, p, errs = '') {
  const cats = catalog.categories(ctx.db, true);
  const isNew = !p.id;
  L(isNew ? 'Yeni ürün' : 'Ürünü düzenle', `<p><a href="/yonetim/urunler">‹ Ürünler</a></p>${errs ? `<div class="ad-alert err">${e(errs)}</div>` : ''}
<form method="post" action="/yonetim/urun/${isNew ? 'yeni' : p.id}" enctype="multipart/form-data" class="ad-form">${ctx.csrfField()}
<div class="ad-grid2">${field('Ürün adı', 'name', p.name, { required: true, max: 160 })}${field('Ürün kodu (SKU)', 'sku', p.sku || '', { max: 40 })}
${field('Kategori', 'category_id', '', { html: sel('category_id', cats.map((c) => [c.id, c.name]), p.category_id) })}
${field('Rozet', 'badge', '', { html: sel('badge', [['', 'Yok'], ['Çok satan', 'Çok satan'], ['Yeni', 'Yeni'], ['İndirim', 'İndirim'], ['Hediyeli', 'Hediyeli']], p.badge || '') })}
${field('Fiyat (₺, KDV dahil)', 'price', p.price != null ? (p.price / 100).toFixed(2).replace('.', ',') : '', { required: true, max: 14, attrs: 'inputmode="decimal"' })}
${field('Eski fiyat (₺, üstü çizili gösterilir)', 'old_price', p.old_price ? (p.old_price / 100).toFixed(2).replace('.', ',') : '', { max: 14, attrs: 'inputmode="decimal"' })}
${field('Stok adedi', 'stock', p.stock != null ? p.stock : 0, { type: 'number', attrs: 'min="0" max="99999" required' })}
${field('Çizim (fotoğraf yoksa gösterilir)', 'kind', '', { html: sel('kind', Object.entries(KINDS), p.kind || 'lift2') })}</div>
${field('Kısa açıklama (kartta görünür)', 'short', p.short || '', { max: 160 })}
${field('Açıklama', 'description', p.description || '', { type: 'textarea', rows: 6, max: 5000 })}
${field('Teknik özellikler (her satır "Ad: değer")', 'specs', p.specs || '', { type: 'textarea', rows: 6, max: 3000 })}
<div class="ad-grid2"><div class="ad-f"><span>Fotoğraf (JPG/PNG/WEBP, en çok 4 MB — site hızlı kalsın diye 1200 px genişliğe küçültüp yükleyin)</span>${p.image ? `<img class="ad-prev" src="/uploads/${e(p.image)}" alt=""><label class="ad-chk"><input type="checkbox" name="remove_image" value="1"> Fotoğrafı kaldır</label>` : ''}<input type="file" name="image" accept="image/jpeg,image/png,image/webp"></div>
<div class="ad-f"><label class="ad-chk"><input type="checkbox" name="active" value="1" ${p.active !== 0 ? 'checked' : ''}> Sitede yayında</label>
<label class="ad-chk"><input type="checkbox" name="featured" value="1" ${p.featured ? 'checked' : ''}> Ana sayfada öne çıkar</label>
<label class="ad-chk"><input type="checkbox" name="staged_ok" value="1" ${p.staged_ok ? 'checked' : ''}> Kademeli ödemeye uygun (yüksek tutarlı ürün)</label></div></div>
<button class="ad-btn primary">Kaydet</button></form>
${isNew ? '' : `<form method="post" action="/yonetim/urun/${p.id}/sil" data-confirm="Ürün silinsin mi? Siparişte geçtiyse silinmez, pasife alınır." class="ad-danger">${ctx.csrfField()}<button class="ad-btn danger">Ürünü sil</button></form>`}`);
}

const productEdit = guard((ctx, a, L) => {
  const id = ctx.params[0];
  if (id === 'yeni') return productForm(ctx, a, L, { stock: 0, active: 1, kind: 'lift2', category_id: 1 });
  const p = ctx.db.prepare('SELECT * FROM products WHERE id=?').get(U.int(id)); if (!p) throw new HttpError(404);
  productForm(ctx, a, L, p);
}, '/yonetim/urunler');

const productSave = guard((ctx, a, L) => {
  const idParam = ctx.params[0]; const isNew = idParam === 'yeni';
  const old = isNew ? null : ctx.db.prepare('SELECT * FROM products WHERE id=?').get(U.int(idParam));
  if (!isNew && !old) throw new HttpError(404);
  const F = ctx.form;
  const price = U.parseMoney(F.price); const oldPrice = F.old_price ? U.parseMoney(F.old_price) : null;
  const d = {
    name: U.trim(F.name, 160), sku: U.trim(F.sku, 40) || null, category_id: U.int(F.category_id) || null, badge: ['Çok satan', 'Yeni', 'İndirim', 'Hediyeli'].includes(F.badge) ? F.badge : null,
    price, old_price: oldPrice, stock: U.clamp(U.int(F.stock), 0, 99999), kind: KINDS[F.kind] ? F.kind : 'lift2', short: U.trim(F.short, 160), description: U.trim(F.description, 5000), specs: U.trim(F.specs, 3000),
    active: F.active === '1' ? 1 : 0, featured: F.featured === '1' ? 1 : 0, staged_ok: F.staged_ok === '1' ? 1 : 0,
  };
  const back = { ...(old || {}), ...d, id: old ? old.id : undefined };
  if (d.name.length < 2) return productForm(ctx, a, L, back, 'Ürün adı girin.');
  if (Number.isNaN(price) || price <= 0) return productForm(ctx, a, L, back, 'Geçerli bir fiyat girin.');
  if (F.old_price && Number.isNaN(oldPrice)) return productForm(ctx, a, L, back, 'Eski fiyat geçersiz.');
  let image = old ? old.image : null;
  const file = ctx.files.find((f) => f.field === 'image');
  if (file) {
    const ext = imageExt(file.data);
    if (!ext) return productForm(ctx, a, L, back, 'Fotoğraf JPG, PNG veya WEBP olmalı.');
    if (file.data.length > 4 * 1024 * 1024) return productForm(ctx, a, L, back, 'Fotoğraf 4 MB’tan büyük olamaz.');
    const dir = path.join(ctx.cfg.DATA_DIR, 'uploads'); fs.mkdirSync(dir, { recursive: true });
    const name = `${U.rid(12)}.${ext}`;
    fs.writeFileSync(path.join(dir, name), file.data);
    if (image) try { fs.unlinkSync(path.join(dir, image)); } catch { /* yok */ }
    image = name;
  } else if (F.remove_image === '1' && image) {
    try { fs.unlinkSync(path.join(ctx.cfg.DATA_DIR, 'uploads', image)); } catch { /* yok */ }
    image = null;
  }
  const now = Date.now();
  try {
    if (isNew) {
      let slug = U.slugify(d.name); let n = 1;
      while (ctx.db.prepare('SELECT 1 FROM products WHERE slug=?').get(slug)) slug = `${U.slugify(d.name)}-${++n}`;
      const r = ctx.db.prepare(`INSERT INTO products(slug,sku,name,category_id,price,old_price,stock,badge,short,description,specs,kind,image,active,featured,staged_ok,sort,created_at,updated_at,search)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`).run(slug, d.sku, d.name, d.category_id, d.price, d.old_price, d.stock, d.badge, d.short, d.description, d.specs, d.kind, image, d.active, d.featured, d.staged_ok, now, now, U.searchKey(`${d.name} ${d.short} ${d.sku || ''}`));
      auth.audit(ctx, 'urun-ekle', d.name);
      ctx.flash('Ürün eklendi.'); return ctx.redirect(`/yonetim/urun/${r.lastInsertRowid}`);
    }
    ctx.db.prepare(`UPDATE products SET sku=?,name=?,category_id=?,price=?,old_price=?,stock=?,badge=?,short=?,description=?,specs=?,kind=?,image=?,active=?,featured=?,staged_ok=?,updated_at=?,search=? WHERE id=?`)
      .run(d.sku, d.name, d.category_id, d.price, d.old_price, d.stock, d.badge, d.short, d.description, d.specs, d.kind, image, d.active, d.featured, d.staged_ok, now, U.searchKey(`${d.name} ${d.short} ${d.sku || ''}`), old.id);
    auth.audit(ctx, 'urun-guncelle', `${old.name} (#${old.id})`);
    ctx.flash('Ürün kaydedildi.'); return ctx.redirect(`/yonetim/urun/${old.id}`);
  } catch (err) {
    log.error('Ürün kaydedilemedi', err);
    return productForm(ctx, a, L, back, 'Kaydedilemedi: ürün kodu veya adres çakışıyor olabilir.');
  }
}, '/yonetim/urunler');

function productStock(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  const id = U.int(ctx.params[0]);
  ctx.db.prepare('UPDATE products SET stock=?, updated_at=? WHERE id=?').run(U.clamp(U.int(ctx.form.stock), 0, 99999), Date.now(), id);
  auth.audit(ctx, 'stok', `#${id} → ${ctx.form.stock}`);
  ctx.flash('Stok güncellendi.'); ctx.redirect(safeBack(ctx.req.headers.referer));
}
const safeBack = (r) => { try { const u = new URL(r); return u.pathname + u.search; } catch { return '/yonetim/urunler'; } };

function productDelete(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  const id = U.int(ctx.params[0]);
  const p = ctx.db.prepare('SELECT * FROM products WHERE id=?').get(id); if (!p) throw new HttpError(404);
  const used = ctx.db.prepare('SELECT 1 FROM order_items WHERE product_id=? LIMIT 1').get(id);
  if (used) { ctx.db.prepare('UPDATE products SET active=0 WHERE id=?').run(id); ctx.flash('Ürün siparişlerde geçtiği için silinmedi, pasife alındı.'); } else {
    ctx.db.prepare('DELETE FROM products WHERE id=?').run(id);
    if (p.image) try { fs.unlinkSync(path.join(ctx.cfg.DATA_DIR, 'uploads', p.image)); } catch { /* yok */ }
    ctx.flash('Ürün silindi.');
  }
  auth.audit(ctx, 'urun-sil', p.name);
  ctx.redirect('/yonetim/urunler');
}

// ------------------------------------------------------------------ Kategoriler
const categories = guard((ctx, a, L) => {
  const cats = catalog.categories(ctx.db, true);
  L('Kategoriler', `<div class="ad-rows"><div class="ad-row head"><span>Sıra</span><span>Ad</span><span>Çizim</span><span>Ürün</span><span>Yayın</span><span></span></div>
${cats.map((c) => `<form class="ad-row" method="post" action="/yonetim/kategori/${c.id}">${ctx.csrfField()}<input class="ad-num" type="number" name="sort" value="${c.sort}" aria-label="Sıra"><input name="name" value="${e(c.name)}" maxlength="60" required aria-label="Ad">
${sel('kind', Object.entries(KINDS), c.kind)}<span>${c.n}</span><label class="ad-chk"><input type="checkbox" name="active" value="1" ${c.active ? 'checked' : ''}> Yayında</label><button class="ad-btn">Kaydet</button></form>`).join('')}
<form class="ad-row" method="post" action="/yonetim/kategori/yeni">${ctx.csrfField()}<input class="ad-num" type="number" name="sort" value="${cats.length + 1}" aria-label="Sıra"><input name="name" placeholder="Yeni kategori adı" maxlength="60" required aria-label="Ad">${sel('kind', Object.entries(KINDS), 'lift2')}<span></span><span></span><button class="ad-btn primary">Ekle</button></form></div>
<p class="ad-muted">Bir kategoriyi kaldırmak için "Yayında" işaretini kaldırıp kaydedin.</p>`);
}, '/yonetim/kategoriler');

function categorySave(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  const name = U.trim(ctx.form.name, 60); if (name.length < 2) { ctx.flash('Kategori adı girin.', 'err'); return ctx.redirect('/yonetim/kategoriler'); }
  const kind = KINDS[ctx.form.kind] ? ctx.form.kind : 'lift2'; const sort = U.clamp(U.int(ctx.form.sort), 0, 9999);
  if (ctx.params[0] === 'yeni') {
    let slug = U.slugify(name); let n = 1; while (ctx.db.prepare('SELECT 1 FROM categories WHERE slug=?').get(slug)) slug = `${U.slugify(name)}-${++n}`;
    ctx.db.prepare('INSERT INTO categories(slug,name,kind,sort) VALUES(?,?,?,?)').run(slug, name, kind, sort);
  } else ctx.db.prepare('UPDATE categories SET name=?, kind=?, sort=?, active=? WHERE id=?').run(name, kind, sort, ctx.form.active === '1' ? 1 : 0, U.int(ctx.params[0]));
  auth.audit(ctx, 'kategori', name); ctx.flash('Kategori kaydedildi.'); ctx.redirect('/yonetim/kategoriler');
}

// ------------------------------------------------------------------ Mesajlar, sayfalar
const messages = guard((ctx, a, L) => {
  const rows = ctx.db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 100').all();
  L('Mesajlar', `<table class="ad-t"><thead><tr><th>Tarih</th><th>Kimden</th><th>Mesaj</th><th></th></tr></thead><tbody>${rows.map((m) => `<tr class="${m.seen ? '' : 'new'}"><td>${U.dateTR(m.created_at)}<br><small>${m.kind === 'danismanlik' ? 'Danışmanlık' : 'İletişim'}</small></td>
<td>${e(m.name)}<br><a href="mailto:${e(m.email)}">${e(m.email)}</a><br><small>${e(m.phone || '')}</small></td><td>${e(m.body).replace(/\n/g, '<br>')}</td>
<td>${m.seen ? '' : `<form method="post" action="/yonetim/mesaj/${m.id}">${ctx.csrfField()}<button class="ad-btn">Okundu</button></form>`}</td></tr>`).join('') || '<tr><td colspan="4">Mesaj yok.</td></tr>'}</tbody></table>`);
}, '/yonetim/mesajlar');
function messageSeen(ctx) { const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf(); ctx.db.prepare('UPDATE messages SET seen=1 WHERE id=?').run(U.int(ctx.params[0])); ctx.redirect('/yonetim/mesajlar'); }

const pagesList = guard((ctx, a, L) => {
  const rows = ctx.db.prepare('SELECT slug,title,updated_at FROM pages ORDER BY title').all();
  L('Sayfalar', `<table class="ad-t"><thead><tr><th>Başlık</th><th>Adres</th><th>Güncelleme</th></tr></thead><tbody>${rows.map((p) => `<tr><td><a href="/yonetim/sayfa/${e(p.slug)}">${e(p.title)}</a></td><td>/sayfa/${e(p.slug)}</td><td>${U.dateTR(p.updated_at)}</td></tr>`).join('')}</tbody></table>
<h2>Yeni sayfa</h2><form method="post" action="/yonetim/sayfa/yeni" class="ad-inline">${ctx.csrfField()}<input name="title" placeholder="Sayfa başlığı" maxlength="80" required><button class="ad-btn primary">Oluştur</button></form>`);
}, '/yonetim/sayfalar');
const pageEdit = guard((ctx, a, L) => {
  const p = ctx.db.prepare('SELECT * FROM pages WHERE slug=?').get(ctx.params[0]); if (!p) throw new HttpError(404);
  L(`Sayfa: ${p.title}`, `<p><a href="/yonetim/sayfalar">‹ Sayfalar</a> · <a href="/sayfa/${e(p.slug)}" target="_blank" rel="noopener">Sayfayı gör ↗</a></p><form method="post" action="/yonetim/sayfa/${e(p.slug)}" class="ad-form">${ctx.csrfField()}
${field('Başlık', 'title', p.title, { required: true, max: 80 })}${field('İçerik (paragraflar arasında boş satır bırakın)', 'body', p.body, { type: 'textarea', rows: 16, max: 20000 })}<button class="ad-btn primary">Kaydet</button></form>`);
}, '/yonetim/sayfalar');
function pageSave(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  const title = U.trim(ctx.form.title, 80); if (title.length < 2) { ctx.flash('Başlık girin.', 'err'); return ctx.redirect('/yonetim/sayfalar'); }
  if (ctx.params[0] === 'yeni') {
    let slug = U.slugify(title); let n = 1; while (ctx.db.prepare('SELECT 1 FROM pages WHERE slug=?').get(slug)) slug = `${U.slugify(title)}-${++n}`;
    ctx.db.prepare('INSERT INTO pages(slug,title,body,updated_at) VALUES(?,?,?,?)').run(slug, title, 'İçerik buraya yazılacak.', Date.now());
    return ctx.redirect(`/yonetim/sayfa/${slug}`);
  }
  ctx.db.prepare('UPDATE pages SET title=?, body=?, updated_at=? WHERE slug=?').run(title, U.trim(ctx.form.body, 20000), Date.now(), ctx.params[0]);
  auth.audit(ctx, 'sayfa', ctx.params[0]); ctx.flash('Sayfa kaydedildi.'); ctx.redirect(`/yonetim/sayfa/${ctx.params[0]}`);
}

// ------------------------------------------------------------------ Ayarlar
const SET_GROUPS = [
  ['Firma', [['shop_name', 'Firma adı'], ['phone', 'Telefon'], ['email', 'E-posta'], ['address', 'Adres', 'textarea'], ['whatsapp', 'WhatsApp numarası (905xxxxxxxxx)']]],
  ['Ana sayfa metinleri', [['announce', 'Duyuru çubuğu'], ['hero_badge', 'Giriş rozeti'], ['hero_title', 'Giriş başlığı'], ['hero_text', 'Giriş metni', 'textarea'], ['camp_title', 'Kampanya başlığı'], ['camp_text', 'Kampanya alt metni'], ['demo_mode', 'Örnek veri uyarısı göster (1 = evet, 0 = hayır)']]],
  ['Kargo ve ödeme', [['shipping_fee', 'Kargo ücreti (₺)', 'money'], ['free_ship_min', 'Ücretsiz kargo alt sınırı (₺, 0 = kapalı)', 'money'], ['staged_min', 'Kademeli ödeme için en düşük sepet (₺)', 'money'], ['staged_pct', 'Kademeli ödeme ön ödeme oranı (%)'], ['hold_hours_havale', 'Havale/kademeli sipariş bekleme süresi (saat)'], ['hold_hours_kart', 'Kart siparişi bekleme süresi (saat)'], ['bank_info', 'Havale/EFT banka bilgileri', 'textarea'], ['currency_note', 'Fiyat notu']]],
];
const settings = guard((ctx, a, L) => {
  const S = ctx.S;
  L('Ayarlar', `<form method="post" action="/yonetim/ayarlar" class="ad-form">${ctx.csrfField()}${SET_GROUPS.map(([g, items]) => `<fieldset><legend>${e(g)}</legend><div class="ad-grid2">${items.map(([k, l, t]) => {
    const v = t === 'money' ? String(S.num(k, 0) / 100).replace('.', ',') : S.get(k);
    return field(l, k, v, t === 'textarea' ? { type: 'textarea', rows: 4, cls: 'wide', max: 600 } : { max: 200 });
  }).join('')}</div></fieldset>`).join('')}<button class="ad-btn primary">Kaydet</button></form>`);
}, '/yonetim/ayarlar');
function settingsSave(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  for (const [, items] of SET_GROUPS) {
    for (const [k, , t] of items) {
      if (ctx.form[k] === undefined) continue;
      let v = U.trim(ctx.form[k], 600);
      if (t === 'money') { const m = U.parseMoney(v || '0'); if (Number.isNaN(m)) { ctx.flash(`Geçersiz tutar: ${k}`, 'err'); return ctx.redirect('/yonetim/ayarlar'); } v = String(m); }
      if (['staged_pct', 'hold_hours_havale', 'hold_hours_kart'].includes(k)) v = String(U.clamp(U.int(v, 1), 1, k === 'staged_pct' ? 90 : 720));
      ctx.S.set(k, v);
    }
  }
  auth.audit(ctx, 'ayarlar', 'güncellendi'); ctx.flash('Ayarlar kaydedildi.'); ctx.redirect('/yonetim/ayarlar');
}

// ------------------------------------------------------------------ Hesap, yedek, kayıtlar
const account = guard((ctx, a, L) => {
  const admins = ctx.db.prepare('SELECT id,username,created_at FROM admins ORDER BY id').all();
  const bks = maint.listBackups();
  L('Hesap ve yedek', `<section class="ad-box"><h2>Şifre değiştir</h2><form method="post" action="/yonetim/yonetici/sifre" class="ad-form narrow">${ctx.csrfField()}
${field('Mevcut şifre', 'old', '', { type: 'password', required: true })}${field('Yeni şifre (en az 10 karakter, harf ve rakam)', 'pw', '', { type: 'password', required: true, attrs: 'autocomplete="new-password"' })}<button class="ad-btn primary">Değiştir</button></form></section>
<section class="ad-box"><h2>Yöneticiler</h2><ul class="ad-list">${admins.map((x) => `<li>${e(x.username)} <small>${U.dateTR(x.created_at)}</small> ${x.id !== a.id ? `<form method="post" action="/yonetim/yonetici/sil" class="ad-inline" data-confirm="Yönetici silinsin mi?">${ctx.csrfField()}<input type="hidden" name="id" value="${x.id}"><button class="ad-btn danger">Sil</button></form>` : '<b>(siz)</b>'}</li>`).join('')}</ul>
<form method="post" action="/yonetim/yonetici/ekle" class="ad-inline">${ctx.csrfField()}<input name="username" placeholder="Kullanıcı adı" maxlength="40" required><input type="password" name="pw" placeholder="Şifre (10+ karakter)" required autocomplete="new-password"><button class="ad-btn primary">Yönetici ekle</button></form></section>
<section class="ad-box"><h2>Yedekler</h2><p class="ad-muted">Veritabanı 6 saatte bir otomatik yedeklenir (son ${ctx.cfg.BACKUP_KEEP} yedek tutulur). Fotoğraflar için <code>data/uploads</code> klasörünü ayrıca yedekleyin. Yedekleri sunucu dışına da kopyalayın.</p>
<form method="post" action="/yonetim/yedek" class="ad-inline">${ctx.csrfField()}<button class="ad-btn primary">Şimdi yedek al</button></form>
<ul class="ad-list">${bks.map((b) => `<li><a href="/yonetim/yedek/${e(b.name)}">${e(b.name)}</a> <small>${(b.size / 1048576).toFixed(1)} MB</small></li>`).join('') || '<li>Henüz yedek yok.</li>'}</ul>
<p><a href="/yonetim/bulten.csv">E-bülten listesini indir (CSV)</a></p></section>`);
}, '/yonetim/yonetici');
async function passwordChange(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf(); ctx.limit('pwchange', 8, 900000);
  const row = ctx.db.prepare('SELECT * FROM admins WHERE id=?').get(a.id);
  if (!(await auth.verifyPassword(String(ctx.form.old || ''), row.pass_hash))) { ctx.flash('Mevcut şifre hatalı.', 'err'); return ctx.redirect('/yonetim/yonetici'); }
  const prob = auth.passwordProblem(String(ctx.form.pw || '')); if (prob) { ctx.flash(prob, 'err'); return ctx.redirect('/yonetim/yonetici'); }
  ctx.db.prepare('UPDATE admins SET pass_hash=? WHERE id=?').run(await auth.hashPassword(ctx.form.pw), a.id);
  const keep = require('../lib/util').sha256(ctx.cookies.psid || '');
  ctx.db.prepare('DELETE FROM sessions WHERE admin_id=? AND token_hash<>?').run(a.id, keep);
  auth.audit(ctx, 'sifre-degistir', a.username); ctx.flash('Şifre değiştirildi.'); ctx.redirect('/yonetim/yonetici');
}
async function adminAdd(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  const u = U.trim(ctx.form.username, 40).toLowerCase();
  const prob = auth.passwordProblem(String(ctx.form.pw || ''));
  if (!/^[a-z0-9._-]{3,40}$/.test(u)) ctx.flash('Kullanıcı adı 3-40 karakter, harf/rakam olmalı.', 'err');
  else if (prob) ctx.flash(prob, 'err');
  else if (ctx.db.prepare('SELECT 1 FROM admins WHERE lower(username)=?').get(u)) ctx.flash('Bu kullanıcı adı kayıtlı.', 'err');
  else { ctx.db.prepare('INSERT INTO admins(username,pass_hash,created_at) VALUES(?,?,?)').run(u, await auth.hashPassword(ctx.form.pw), Date.now()); auth.audit(ctx, 'yonetici-ekle', u); ctx.flash('Yönetici eklendi.'); }
  ctx.redirect('/yonetim/yonetici');
}
function adminDel(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  const id = U.int(ctx.form.id); if (id !== a.id) { ctx.db.prepare('DELETE FROM admins WHERE id=?').run(id); auth.audit(ctx, 'yonetici-sil', `#${id}`); ctx.flash('Yönetici silindi.'); }
  ctx.redirect('/yonetim/yonetici');
}
function backupNow(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return; ctx.checkCsrf();
  try {
    // dakika içinde tekrar basılırsa yeni dosya oluşmaz; saniye damgalı kopya al
    const f = maint.backup(ctx.db); ctx.flash(`Yedek hazır: ${path.basename(f)}`);
  } catch (err) { log.error('Yedek alınamadı', err); ctx.flash('Yedek alınamadı. Disk dolu olabilir.', 'err'); }
  auth.audit(ctx, 'yedek', 'elle'); ctx.redirect('/yonetim/yonetici');
}
function backupDownload(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return;
  const name = ctx.params[0]; if (!/^magaza-\d{12}\.sqlite$/.test(name)) throw new HttpError(404);
  const f = path.join(maint.backupDir, name); if (!fs.existsSync(f)) throw new HttpError(404);
  auth.audit(ctx, 'yedek-indir', name);
  ctx.sent = true; ctx.res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': fs.statSync(f).size, 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(ctx.res);
}
function newsletterCsv(ctx) {
  const a = auth.requireAdmin(ctx); if (!a) return;
  const rows = ctx.db.prepare('SELECT email,created_at FROM newsletter ORDER BY created_at').all();
  ctx.sent = true;
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bulten.csv"', 'Cache-Control': 'no-store' });
  ctx.res.end('﻿E-posta;Tarih\n' + rows.map((r) => `${r.email.replace(/^[=+\-@]/, "'$&")};${new Date(r.created_at).toISOString()}`).join('\n') + '\n');
}

const logs = guard((ctx, a, L) => {
  const au = ctx.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all();
  const ob = ctx.db.prepare('SELECT id,to_addr,subject,status,tries,error,created_at FROM outbox ORDER BY id DESC LIMIT 50').all();
  L('Kayıtlar', `<section class="ad-box"><h2>Yönetici işlemleri (son 100)</h2><table class="ad-t"><tbody>${au.map((x) => `<tr><td>${U.dateTR(x.at)}</td><td>${e(x.admin)}</td><td>${e(x.action)}</td><td>${e(x.detail)}</td></tr>`).join('') || '<tr><td>Kayıt yok</td></tr>'}</tbody></table></section>
<section class="ad-box"><h2>E-posta kuyruğu (son 50)</h2><table class="ad-t"><thead><tr><th>Tarih</th><th>Alıcı</th><th>Konu</th><th>Durum</th></tr></thead><tbody>${ob.map((x) => `<tr><td>${U.dateTR(x.created_at)}</td><td>${e(x.to_addr)}</td><td>${e(x.subject)}</td><td>${e(x.status)}${x.error ? `<br><small>${e(x.error)}</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="4">Kayıt yok</td></tr>'}</tbody></table>
<p class="ad-muted">Sunucu günlükleri <code>data/logs</code> klasöründedir (${ctx.cfg.LOG_KEEP_DAYS} gün tutulur).</p></section>`);
}, '/yonetim/kayitlar');

module.exports = [
  ['GET', '/yonetim', dashboard], ['GET', '/yonetim/giris', (ctx) => (auth.currentAdmin(ctx) ? ctx.redirect('/yonetim') : loginForm(ctx))], ['POST', '/yonetim/giris', loginPost], ['POST', '/yonetim/cikis', logout],
  ['GET', '/yonetim/siparisler', ordersList], ['GET', '/yonetim/siparisler.csv', ordersCsv],
  [['GET'], /^\/yonetim\/siparis\/(\d+)$/, orderDetail], [['POST'], /^\/yonetim\/siparis\/(\d+)\/durum$/, orderStatus], [['POST'], /^\/yonetim\/siparis\/(\d+)\/odeme$/, orderPay], [['POST'], /^\/yonetim\/siparis\/(\d+)\/not$/, orderNote],
  ['GET', '/yonetim/havale', havale], [['POST'], /^\/yonetim\/havale\/(\d+)$/, havaleAct],
  ['GET', '/yonetim/urunler', products], [['GET'], /^\/yonetim\/urun\/(yeni|\d+)$/, productEdit], [['POST'], /^\/yonetim\/urun\/(yeni|\d+)$/, productSave],
  [['POST'], /^\/yonetim\/urun\/(\d+)\/stok$/, productStock], [['POST'], /^\/yonetim\/urun\/(\d+)\/sil$/, productDelete],
  ['GET', '/yonetim/kategoriler', categories], [['POST'], /^\/yonetim\/kategori\/(yeni|\d+)$/, categorySave],
  ['GET', '/yonetim/mesajlar', messages], [['POST'], /^\/yonetim\/mesaj\/(\d+)$/, messageSeen],
  ['GET', '/yonetim/sayfalar', pagesList], [['GET'], /^\/yonetim\/sayfa\/([a-z0-9-]+)$/, pageEdit], [['POST'], /^\/yonetim\/sayfa\/(yeni|[a-z0-9-]+)$/, pageSave],
  ['GET', '/yonetim/ayarlar', settings], ['POST', '/yonetim/ayarlar', settingsSave],
  ['GET', '/yonetim/yonetici', account], ['POST', '/yonetim/yonetici/sifre', passwordChange], ['POST', '/yonetim/yonetici/ekle', adminAdd], ['POST', '/yonetim/yonetici/sil', adminDel],
  ['POST', '/yonetim/yedek', backupNow], [['GET'], /^\/yonetim\/yedek\/(magaza-\d{12}\.sqlite)$/, backupDownload], ['GET', '/yonetim/bulten.csv', newsletterCsv],
  ['GET', '/yonetim/kayitlar', logs],
];
