'use strict';
// Sepet, sipariş oluşturma, ödeme kaydı, iptal/stok iadesi: tüm iş kuralları burada.
const U = require('./util');
const { tx } = require('./db');
const mail = require('./mail');

const STATUS = {
  'odeme-bekliyor': 'Ödeme bekleniyor',
  hazirlaniyor: 'Hazırlanıyor',
  kargoda: 'Kargoda',
  'teslim-edildi': 'Teslim edildi',
  iptal: 'İptal edildi',
};
const PAY_STATUS = { bekliyor: 'Ödeme bekleniyor', kismi: 'Kısmi ödendi', odendi: 'Ödendi', iptal: 'İptal' };
const METHOD = { kart: 'Kredi / banka kartı', havale: 'Havale / EFT', kademeli: 'Kademeli ödeme' };
const PAYMENT_KIND = { full: 'Ödeme', deposit: 'Ön ödeme', balance: 'Kalan tutar' };
const PAYMENT_STATUS = { pending: 'Bekliyor', paid: 'Ödendi', failed: 'Başarısız', cancelled: 'İptal' };

// ---------- Sepet (çerezde "id.adet_id.adet", sunucuda doğrulanır) ----------
const MAX_LINES = 40; const MAX_QTY = 99;
function parseCart(str) {
  const out = []; const seen = new Set();
  for (const part of String(str || '').split('_')) {
    const m = /^(\d{1,9})\.(\d{1,2})$/.exec(part);
    if (!m) continue;
    const id = +m[1]; const qty = U.clamp(+m[2], 1, MAX_QTY);
    if (seen.has(id)) continue; seen.add(id); out.push({ id, qty });
    if (out.length >= MAX_LINES) break;
  }
  return out;
}
const serializeCart = (lines) => lines.map((l) => `${l.id}.${l.qty}`).join('_');

function loadCart(ctx) {
  if (ctx._cart) return ctx._cart;
  const raw = parseCart(ctx.cookies.cart);
  const lines = []; let subtotal = 0; let count = 0; let allStaged = raw.length > 0;
  if (raw.length) {
    const ph = raw.map(() => '?').join(',');
    const rows = ctx.db.prepare(`SELECT id,slug,name,price,old_price,stock,kind,image,staged_ok,sku FROM products WHERE active=1 AND id IN (${ph})`).all(...raw.map((r) => r.id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of raw) {
      const p = byId.get(r.id);
      if (!p || p.stock <= 0) continue;
      const qty = Math.min(r.qty, p.stock);
      lines.push({ ...p, qty, line: p.price * qty });
      subtotal += p.price * qty; count += qty;
      if (!p.staged_ok) allStaged = false;
    }
  }
  const feeMin = ctx.S.num('free_ship_min', 0); const fee = ctx.S.num('shipping_fee', 0);
  const shipping = lines.length === 0 ? 0 : (feeMin > 0 && subtotal >= feeMin ? 0 : fee);
  const total = subtotal + shipping;
  const stagedMin = ctx.S.num('staged_min', 0);
  const stagedOk = lines.length > 0 && allStaged && total >= stagedMin;
  ctx._cart = { lines, subtotal, shipping, total, count, stagedOk, stagedPct: ctx.S.num('staged_pct', 30), raw };
  return ctx._cart;
}

function saveCart(ctx, lines) {
  const s = serializeCart(lines);
  if (!s) ctx.clearCookie('cart'); else ctx.cookie('cart', s, { maxAge: 86400 * 30 });
  ctx._cart = null; ctx.cookies.cart = s;
}

// ---------- Sipariş ----------
function nextOrderNo(db) {
  db.prepare('INSERT INTO seq(name,val) VALUES(\'order\',1) ON CONFLICT(name) DO UPDATE SET val=val+1').run();
  const n = db.prepare('SELECT val FROM seq WHERE name=\'order\'').get().val;
  const yy = String(new Date().getFullYear()).slice(2);
  return `PS${yy}${String(n).padStart(6, '0')}`;
}

function addEvent(db, orderId, text, internal = 0) {
  db.prepare('INSERT INTO order_events(order_id,at,text,internal) VALUES(?,?,?,?)').run(orderId, Date.now(), text, internal);
}

class OrderError extends Error {}

/**
 * Siparişi tek işlemde oluşturur: stok düşer, ödeme kayıtları açılır.
 * Fiyat ve stok her zaman veritabanından okunur (istemciye güvenilmez).
 */
function createOrder(ctx, d) {
  const { db, S } = ctx;
  return tx(db, () => {
    if (d.idem) {
      const ex = db.prepare('SELECT * FROM orders WHERE idem=?').get(d.idem);
      if (ex) return { order: ex, duplicate: true };
    }
    const now = Date.now();
    let subtotal = 0; const items = []; let allStaged = d.lines.length > 0;
    for (const l of d.lines) {
      const p = db.prepare('SELECT id,name,sku,price,stock,staged_ok FROM products WHERE id=? AND active=1').get(l.id);
      if (!p) throw new OrderError('Sepetinizdeki bir ürün artık satışta değil.');
      if (p.stock < l.qty) throw new OrderError(`"${p.name}" için yeterli stok yok (kalan: ${Math.max(0, p.stock)}).`);
      const r = db.prepare('UPDATE products SET stock=stock-?, sold=sold+?, updated_at=? WHERE id=? AND stock>=?').run(l.qty, l.qty, now, p.id, l.qty);
      if (r.changes !== 1) throw new OrderError(`"${p.name}" stoğu az önce tükendi.`);
      subtotal += p.price * l.qty; items.push({ ...p, qty: l.qty });
      if (!p.staged_ok) allStaged = false;
    }
    const feeMin = S.num('free_ship_min', 0);
    const shipping = feeMin > 0 && subtotal >= feeMin ? 0 : S.num('shipping_fee', 0);
    const total = subtotal + shipping;

    let deposit = 0;
    if (d.payMethod === 'kademeli') {
      if (!allStaged || total < S.num('staged_min', 0)) throw new OrderError('Kademeli ödeme bu sepet için uygun değil.');
      deposit = Math.max(100, Math.round((total * S.num('staged_pct', 30)) / 100 / 100) * 100);
      if (deposit >= total) deposit = Math.floor(total / 2);
    }
    const no = nextOrderNo(db);
    const token = U.rid(12);
    const ins = db.prepare(`INSERT INTO orders(no,token,idem,status,pay_method,pay_status,name,email,phone,city,address,note,
      invoice_type,company,tax_office,tax_no,subtotal,shipping,total,paid_total,deposit,ip,created_at,updated_at,search)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?)`)
      .run(no, token, d.idem || null, 'odeme-bekliyor', d.payMethod, 'bekliyor', d.name, d.email, d.phone, d.city, d.address, d.note,
        d.invoiceType, d.company, d.taxOffice, d.taxNo, subtotal, shipping, total, deposit, d.ip, now, now, U.searchKey(`${no} ${d.name} ${d.email} ${d.phone.replace(/\D/g, '')} ${d.company || ''}`));
    const orderId = Number(ins.lastInsertRowid);
    const insItem = db.prepare('INSERT INTO order_items(order_id,product_id,name,sku,qty,unit_price) VALUES(?,?,?,?,?,?)');
    for (const it of items) insItem.run(orderId, it.id, it.name, it.sku, it.qty, it.price);

    const insPay = db.prepare('INSERT INTO payments(order_id,kind,method,amount,status,provider,created_at) VALUES(?,?,?,?,\'pending\',?,?)');
    const prov = d.provider;
    if (d.payMethod === 'kademeli') {
      insPay.run(orderId, 'deposit', d.depositVia, deposit, d.depositVia === 'kart' ? prov : null, now);
      insPay.run(orderId, 'balance', 'havale', total - deposit, null, now);
    } else {
      insPay.run(orderId, 'full', d.payMethod, total, d.payMethod === 'kart' ? prov : null, now);
    }
    addEvent(db, orderId, 'Sipariş alındı.');
    mail.queue(db, d.email, `Siparişiniz alındı: ${no}`,
      `Merhaba ${d.name},\n\n${no} numaralı siparişiniz alındı. Toplam: ${U.tl(total)}\nÖdeme yöntemi: ${METHOD[d.payMethod]}\n\nSipariş durumunu şu bağlantıdan takip edebilirsiniz:\n${ctx.cfg.BASE_URL || ''}/siparis/${token}\n\n${S.get('shop_name')}`);
    return { order: db.prepare('SELECT * FROM orders WHERE id=?').get(orderId), duplicate: false };
  });
}

/** Ödemeyi onayla. Tekrar çağrılsa da bir kez işler (idempotent). */
function markPaid(db, S, paymentId, ref, note) {
  return tx(db, () => {
    const pay = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!pay) return { ok: false, reason: 'yok' };
    if (pay.status === 'paid') return { ok: true, already: true, orderId: pay.order_id };
    if (pay.status === 'cancelled') return { ok: false, reason: 'iptal' };
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(pay.order_id);
    if (order.status === 'iptal') return { ok: false, reason: 'siparis-iptal' };
    const now = Date.now();
    db.prepare('UPDATE payments SET status=\'paid\', paid_at=?, provider_ref=COALESCE(?,provider_ref), note=COALESCE(?,note) WHERE id=?').run(now, ref || null, note || null, pay.id);
    const paid = order.paid_total + pay.amount;
    const full = paid >= order.total;
    const payStatus = full ? 'odendi' : 'kismi';
    let status = order.status;
    if (status === 'odeme-bekliyor') status = 'hazirlaniyor';
    db.prepare('UPDATE orders SET paid_total=?, pay_status=?, status=?, updated_at=? WHERE id=?').run(paid, payStatus, status, now, order.id);
    addEvent(db, order.id, `${PAYMENT_KIND[pay.kind]} alındı: ${U.tl(pay.amount)} (${METHOD[pay.method] || pay.method}).`);
    if (status !== order.status) addEvent(db, order.id, 'Sipariş onaylandı, hazırlanıyor.');
    mail.queue(db, order.email, `Ödemeniz alındı: ${order.no}`,
      `Merhaba ${order.name},\n\n${order.no} numaralı siparişiniz için ${U.tl(pay.amount)} tutarındaki ${PAYMENT_KIND[pay.kind].toLowerCase()} alındı.${full ? '' : `\nKalan tutar: ${U.tl(order.total - paid)}`}\n\n${S.get('shop_name')}`);
    return { ok: true, orderId: order.id };
  });
}

function failPayment(db, paymentId, note) {
  db.prepare('UPDATE payments SET status=\'failed\', note=? WHERE id=? AND status=\'pending\'').run(note || null, paymentId);
}

/** Siparişi iptal eder ve henüz kargolanmadıysa stoğu geri verir (yalnız bir kez). */
function cancelOrder(db, orderId, reason, internal = 0) {
  return tx(db, () => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!o || o.status === 'iptal') return false;
    const now = Date.now();
    if (o.status !== 'kargoda' && o.status !== 'teslim-edildi') {
      for (const it of db.prepare('SELECT product_id,qty FROM order_items WHERE order_id=?').all(orderId)) {
        if (it.product_id) db.prepare('UPDATE products SET stock=stock+?, sold=MAX(0,sold-?), updated_at=? WHERE id=?').run(it.qty, it.qty, now, it.product_id);
      }
    }
    db.prepare('UPDATE orders SET status=\'iptal\', pay_status=CASE WHEN paid_total>0 THEN pay_status ELSE \'iptal\' END, updated_at=? WHERE id=?').run(now, orderId);
    db.prepare('UPDATE payments SET status=\'cancelled\' WHERE order_id=? AND status IN (\'pending\',\'failed\')').run(orderId);
    addEvent(db, orderId, `Sipariş iptal edildi${reason ? ': ' + reason : '.'}`, internal);
    return true;
  });
}

function setStatus(db, S, orderId, status, extra = {}) {
  if (status === 'iptal') return cancelOrder(db, orderId, extra.reason || 'Yönetici tarafından iptal edildi');
  if (!STATUS[status]) return false;
  return tx(db, () => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!o || o.status === status) return false;
    if (o.status === 'iptal') return false; // iptal geri alınmaz (stok tutarlılığı)
    const now = Date.now();
    db.prepare('UPDATE orders SET status=?, cargo_company=COALESCE(?,cargo_company), cargo_no=COALESCE(?,cargo_no), updated_at=? WHERE id=?')
      .run(status, extra.cargoCompany || null, extra.cargoNo || null, now, orderId);
    addEvent(db, orderId, `Durum: ${STATUS[status]}${status === 'kargoda' && (extra.cargoCompany || extra.cargoNo) ? ` (${extra.cargoCompany || ''} ${extra.cargoNo || ''})` : ''}`);
    if (status === 'kargoda' || status === 'teslim-edildi') {
      mail.queue(db, o.email, `Siparişiniz ${STATUS[status].toLowerCase()}: ${o.no}`,
        `Merhaba ${o.name},\n\n${o.no} numaralı siparişinizin durumu: ${STATUS[status]}.${status === 'kargoda' ? `\nKargo: ${extra.cargoCompany || o.cargo_company || ''} ${extra.cargoNo || o.cargo_no || ''}` : ''}\n\n${S.get('shop_name')}`);
    }
    return true;
  });
}

/** Ödeme süresi dolan siparişleri iptal eder (stok serbest kalır). */
function expireUnpaid(db, S) {
  const now = Date.now();
  const hKart = S.num('hold_hours_kart', 3) * 3600000;
  const hHavale = S.num('hold_hours_havale', 72) * 3600000;
  const rows = db.prepare(`SELECT o.id, o.pay_method, o.created_at,
      (SELECT COUNT(*) FROM havale_notices h WHERE h.order_id=o.id AND h.status='yeni') pend,
      (SELECT COUNT(*) FROM payments p WHERE p.order_id=o.id AND p.method='kart') hasCard
    FROM orders o WHERE o.status='odeme-bekliyor' AND o.paid_total=0 AND o.created_at < ? LIMIT 500`).all(now - Math.min(hKart, hHavale));
  let n = 0;
  for (const r of rows) {
    const hold = r.pay_method === 'kart' ? hKart : hHavale;
    if (now - r.created_at < hold || r.pend > 0) continue;
    if (cancelOrder(db, r.id, 'Ödeme süresi doldu.')) n++;
  }
  return n;
}

module.exports = { STATUS, PAY_STATUS, METHOD, PAYMENT_KIND, PAYMENT_STATUS, parseCart, serializeCart, loadCart, saveCart, createOrder, markPaid, failPayment, cancelOrder, setStatus, expireUnpaid, addEvent, OrderError };
