'use strict';
const { e } = require('./util');

/** Tüm sayfaların ortak HTML iskeleti. Üst/alt bölümü aktif tema üretir. */
function doc(ctx, o = {}) {
  const t = ctx.theme; const S = ctx.S; const app = ctx.app;
  const shopName = S.get('shop_name');
  const title = o.title ? `${o.title} · ${shopName}` : `${shopName} | Oto servis ve sanayi ekipmanları`;
  const desc = o.description || 'Araç liftleri, kriko ve presler, kompresörler, takım arabaları ve el aletleri. Güvenli ödeme, kademeli ödeme ve kurulum desteği.';
  const base = ctx.cfg.BASE_URL || `http://${ctx.req.headers.host || 'localhost'}`;
  const canon = o.canonical ? base + o.canonical : '';
  const flash = ctx.takeFlash();
  const flashHtml = flash ? `<div class="container"><div class="alert alert-${flash.kind === 'err' ? 'err' : 'ok'}" role="status">${e(flash.msg)}</div></div>` : '';
  return `<!doctype html>
<html lang="tr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(desc)}">
<meta name="theme-color" content="${t.themeColor}">
${o.noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
${canon ? `<link rel="canonical" href="${e(canon)}">` : ''}
<meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:type" content="${o.ogType || 'website'}"><meta property="og:site_name" content="${e(shopName)}">
${o.ogImage ? `<meta property="og:image" content="${e(base + o.ogImage)}">` : ''}
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${t.fonts}">
<link rel="stylesheet" href="${app.asset('/static/base.css')}">
<link rel="stylesheet" href="${app.asset('/static/theme.css')}">
${o.jsonld ? `<script type="application/ld+json">${JSON.stringify(o.jsonld).replace(/</g, '\\u003c')}</script>` : ''}
<script src="${app.asset('/static/app.js')}" defer></script>
</head>
<body class="t-${t.id} ${o.bodyClass || ''}" ${t.bodyAttrs || ''}>
<a class="skip" href="#main">İçeriğe geç</a>
${t.header(ctx)}
<main id="main">${flashHtml}${o.body}</main>
${t.footer(ctx)}
${t.drawer ? t.drawer(ctx) : ''}
<div id="toast" role="status" aria-live="polite"></div>
</body></html>`;
}

module.exports = { doc };
