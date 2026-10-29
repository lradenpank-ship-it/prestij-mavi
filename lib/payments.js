'use strict';
// Kart ödemesi sağlayıcıları. Kart bilgisi bu sitede ASLA saklanmaz veya günlüğe yazılmaz.
//  - demo : Yalnızca gösterim/test içindir; gerçek tahsilat yapmaz.
//  - paytr: PayTR iFrame API (canlı mağaza anahtarı gerekir).
const https = require('https');
const crypto = require('crypto');
const cfg = require('./config');
const U = require('./util');

const provider = cfg.PAYMENT_PROVIDER;

function cardAvailable() {
  if (provider === 'demo') return true;
  if (provider === 'paytr') return !!(cfg.PAYTR_MERCHANT_ID && cfg.PAYTR_KEY && cfg.PAYTR_SALT);
  return false;
}
const isDemo = () => provider === 'demo';

function postForm(host, path, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request({ host, path, method: 'POST', timeout: 15000, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('Ödeme sağlayıcısı zaman aşımı')));
    req.on('error', reject); req.end(body);
  });
}

/** PayTR iFrame belirteci al. merchant_oid yalnızca harf/rakam olmalı. */
async function paytrToken(ctx, order, payment) {
  const oid = `${order.no}P${payment.id}`;
  const amount = String(payment.amount); // kuruş
  const items = ctx.db.prepare('SELECT name,qty,unit_price FROM order_items WHERE order_id=?').all(order.id);
  const basket = items.map((i) => [i.name, (i.unit_price / 100).toFixed(2), i.qty]);
  if (payment.kind !== 'full') basket.length = 0, basket.push([`Sipariş ${order.no} (${payment.kind === 'deposit' ? 'ön ödeme' : 'kalan tutar'})`, (payment.amount / 100).toFixed(2), 1]);
  const userBasket = Buffer.from(JSON.stringify(basket)).toString('base64');
  const ip = String(ctx.ip).replace('::ffff:', '');
  const noInstallment = '0'; const maxInstallment = '0'; const currency = 'TL'; const test = cfg.PAYTR_TEST;
  const hashStr = cfg.PAYTR_MERCHANT_ID + ip + oid + order.email + amount + userBasket + noInstallment + maxInstallment + currency + test;
  const token = crypto.createHmac('sha256', cfg.PAYTR_KEY).update(hashStr + cfg.PAYTR_SALT).digest('base64');
  const base = cfg.BASE_URL || `http://${ctx.req.headers.host}`;
  const out = await postForm('www.paytr.com', '/odeme/api/get-token', {
    merchant_id: cfg.PAYTR_MERCHANT_ID, user_ip: ip, merchant_oid: oid, email: order.email, payment_amount: amount,
    paytr_token: token, user_basket: userBasket, debug_on: test === '1' ? '1' : '0', no_installment: noInstallment,
    max_installment: maxInstallment, user_name: order.name, user_address: order.address.slice(0, 400), user_phone: order.phone,
    merchant_ok_url: `${base}/siparis/${order.token}?odeme=ok`, merchant_fail_url: `${base}/siparis/${order.token}?odeme=hata`,
    timeout_limit: '30', currency, test_mode: test, lang: 'tr',
  });
  let j; try { j = JSON.parse(out); } catch { throw new Error('PayTR yanıtı çözülemedi'); }
  if (j.status !== 'success') throw new Error('PayTR: ' + (j.reason || 'bilinmeyen hata'));
  return j.token;
}

/** PayTR bildirim imzasını doğrular. */
function paytrVerify(form) {
  const h = crypto.createHmac('sha256', cfg.PAYTR_KEY).update(String(form.merchant_oid) + cfg.PAYTR_SALT + form.status + form.total_amount).digest('base64');
  return U.safeEq(h, String(form.hash || ''));
}

function demoCardCheck(number, name, exp, cvc) {
  const digits = String(number).replace(/\D/g, '');
  if (!U.luhn(digits)) return { ok: false, msg: 'Kart numarası geçersiz.' };
  if (!/^[\p{L} .'-]{3,60}$/u.test(String(name).trim())) return { ok: false, msg: 'Kart üzerindeki ismi girin.' };
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(exp).trim());
  if (!m || +m[1] < 1 || +m[1] > 12) return { ok: false, msg: 'Son kullanma tarihini AA/YY girin.' };
  const now = new Date(); const y = 2000 + +m[2];
  if (y < now.getFullYear() || (y === now.getFullYear() && +m[1] < now.getMonth() + 1)) return { ok: false, msg: 'Kartın son kullanma tarihi geçmiş.' };
  if (!/^\d{3,4}$/.test(String(cvc))) return { ok: false, msg: 'Güvenlik kodunu girin.' };
  if (digits.startsWith('4000')) return { ok: false, msg: 'Bankanız işlemi reddetti (demo: 4000 ile başlayan kartlar reddedilir).' };
  return { ok: true, last4: digits.slice(-4) };
}

module.exports = { provider, cardAvailable, isDemo, paytrToken, paytrVerify, demoCardCheck };
