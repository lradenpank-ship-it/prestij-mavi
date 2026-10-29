'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

const MIGRATIONS = [
  // v1
  `
  CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE categories(
    id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'lift2', sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE products(
    id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, sku TEXT, name TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    price INTEGER NOT NULL CHECK(price >= 0), old_price INTEGER,
    stock INTEGER NOT NULL DEFAULT 0, badge TEXT, short TEXT, description TEXT, specs TEXT,
    kind TEXT NOT NULL DEFAULT 'lift2', image TEXT, search TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1, featured INTEGER NOT NULL DEFAULT 0,
    staged_ok INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, sold INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_products_cat ON products(category_id, active);
  CREATE INDEX idx_products_feat ON products(active, featured, sort);
  CREATE INDEX idx_products_new ON products(active, created_at);
  CREATE INDEX idx_products_sold ON products(active, sold);

  CREATE TABLE seq(name TEXT PRIMARY KEY, val INTEGER NOT NULL);

  CREATE TABLE orders(
    id INTEGER PRIMARY KEY, no TEXT UNIQUE NOT NULL, token TEXT UNIQUE NOT NULL, idem TEXT UNIQUE,
    status TEXT NOT NULL, pay_method TEXT NOT NULL, pay_status TEXT NOT NULL,
    name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, city TEXT, address TEXT NOT NULL, note TEXT,
    invoice_type TEXT, company TEXT, tax_office TEXT, tax_no TEXT,
    subtotal INTEGER NOT NULL, shipping INTEGER NOT NULL, total INTEGER NOT NULL,
    paid_total INTEGER NOT NULL DEFAULT 0, deposit INTEGER NOT NULL DEFAULT 0,
    cargo_company TEXT, cargo_no TEXT, ip TEXT, search TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_orders_status ON orders(status, created_at);
  CREATE INDEX idx_orders_created ON orders(created_at);
  CREATE INDEX idx_orders_email ON orders(email);
  CREATE INDEX idx_orders_phone ON orders(phone);
  CREATE INDEX idx_orders_pay ON orders(pay_status, status);

  CREATE TABLE order_items(
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER, name TEXT NOT NULL, sku TEXT, qty INTEGER NOT NULL, unit_price INTEGER NOT NULL
  );
  CREATE INDEX idx_items_order ON order_items(order_id);
  CREATE INDEX idx_items_product ON order_items(product_id);

  CREATE TABLE payments(
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, method TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
    provider TEXT, provider_ref TEXT, note TEXT, created_at INTEGER NOT NULL, paid_at INTEGER
  );
  CREATE INDEX idx_payments_order ON payments(order_id);
  CREATE INDEX idx_payments_status ON payments(status, method);

  CREATE TABLE order_events(
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, text TEXT NOT NULL, internal INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_events_order ON order_events(order_id);

  CREATE TABLE havale_notices(
    id INTEGER PRIMARY KEY, order_id INTEGER, order_no TEXT NOT NULL, name TEXT NOT NULL, bank TEXT,
    amount INTEGER, paid_on TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'yeni', ip TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_havale_status ON havale_notices(status, created_at);

  CREATE TABLE admins(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, ip TEXT);
  CREATE INDEX idx_sessions_exp ON sessions(expires_at);

  CREATE TABLE newsletter(email TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
  CREATE TABLE messages(
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'iletisim', name TEXT, email TEXT, phone TEXT, body TEXT,
    seen INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_seen ON messages(seen, created_at);
  CREATE TABLE pages(slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE outbox(
    id INTEGER PRIMARY KEY, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'bekliyor', tries INTEGER NOT NULL DEFAULT 0, error TEXT,
    created_at INTEGER NOT NULL, sent_at INTEGER
  );
  CREATE INDEX idx_outbox_status ON outbox(status, id);
  CREATE TABLE audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, admin TEXT, action TEXT NOT NULL, detail TEXT);
  CREATE INDEX idx_audit_at ON audit(at);
  `,
];

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 8000;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -32000;
    PRAGMA wal_autocheckpoint = 1000;
  `);
  migrate(db);
  return db;
}

function migrate(db) {
  let v = db.prepare('PRAGMA user_version').get().user_version;
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]);
      v += 1;
      db.exec(`PRAGMA user_version = ${v}`);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* yok say */ }
      throw err;
    }
  }
}

/** Tek yazar işlem. node:sqlite eşzamanlı olduğundan aynı süreçte işlemler iç içe geçmez. */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* yok say */ }
    throw err;
  }
}

const DEFAULT_SETTINGS = {
  shop_name: 'Prestij Servis Ekipmanları',
  phone: '[Telefon]',
  email: '[E-posta]',
  address: '[Adres, İlçe / Şehir]',
  whatsapp: '',
  announce: 'Havale/EFT ile ödemede sipariş notunuza özel fırsatlar · Lift siparişlerinde kademeli ödeme',
  hero_badge: 'Yeni sezon',
  hero_title: 'Atölyenizin ihtiyacı olan her ekipman, tek yerde.',
  hero_text: 'Araç liftlerinden takım arabalarına, oto servis ve sanayi ekipmanlarında güvenli alışveriş.',
  camp_title: 'Seçili ekipmanlarda hediye fırsatı',
  camp_text: 'Kampanya bitiş tarihi: [tarih]',
  shipping_fee: '45000',
  free_ship_min: '1500000',
  staged_min: '2000000',
  staged_pct: '30',
  hold_hours_havale: '72',
  hold_hours_kart: '3',
  bank_info: 'Banka: [Banka adı]\nHesap sahibi: [Ünvan]\nIBAN: TR00 0000 0000 0000 0000 0000 00',
  demo_mode: '1',
  currency_note: 'Fiyatlara KDV dahildir.',
};

function settings(db) {
  const cache = new Map();
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  const load = () => { cache.clear(); for (const r of db.prepare('SELECT key,value FROM settings').all()) cache.set(r.key, r.value); };
  load();
  return {
    get: (k, d = '') => (cache.has(k) ? cache.get(k) : d),
    num: (k, d = 0) => { const n = parseInt(cache.get(k), 10); return Number.isFinite(n) ? n : d; },
    all: () => Object.fromEntries(cache),
    set(k, v) {
      db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
      cache.set(k, String(v));
    },
    keys: () => Object.keys(DEFAULT_SETTINGS),
  };
}

function dbFile() { return path.join(cfg.DATA_DIR, 'magaza.sqlite'); }

module.exports = { open, tx, settings, dbFile, DEFAULT_SETTINGS };
