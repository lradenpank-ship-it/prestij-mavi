'use strict';
// Ürün/kategori sorguları (hepsi sayfalı ve indeksli).
const U = require('./util');

const SORTS = {
  yeni: 'p.created_at DESC, p.id DESC',
  'fiyat-artan': 'p.price ASC, p.id',
  'fiyat-azalan': 'p.price DESC, p.id',
  'cok-satan': 'p.sold DESC, p.id',
  onerilen: 'p.featured DESC, p.sort ASC, p.id',
};
const COLS = `p.id,p.slug,p.sku,p.name,p.category_id,p.price,p.old_price,p.stock,p.badge,p.short,p.kind,p.image,p.featured,p.staged_ok,p.sold,p.created_at,c.name AS cat_name,c.slug AS cat_slug`;

const likeEsc = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m);

function categories(db, all = false) {
  return db.prepare(`SELECT c.id,c.slug,c.name,c.kind,c.sort,c.active,
      (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.active=1) n
    FROM categories c ${all ? '' : 'WHERE c.active=1'} ORDER BY c.sort, c.id`).all();
}

/** opts: cat(slug) q sort page per campaign featured onlyIds limit */
function list(db, o = {}) {
  const where = ['p.active=1']; const args = [];
  if (o.cat) { where.push('c.slug=?'); args.push(o.cat); }
  if (o.q) {
    const k = U.searchKey(o.q);
    if (k) { where.push('(p.search LIKE ? ESCAPE \'\\\' OR c.slug LIKE ? ESCAPE \'\\\')'); args.push(`%${likeEsc(k)}%`, `%${likeEsc(k.replace(/ /g, '-'))}%`); }
  }
  if (o.campaign) where.push('(p.old_price > p.price OR p.badge IN (\'İndirim\',\'Hediyeli\'))');
  if (o.featured) where.push('p.featured=1');
  if (o.badge) { where.push('p.badge=?'); args.push(o.badge); }
  const order = SORTS[o.sort] || SORTS.onerilen;
  const per = U.clamp(o.per || 24, 1, 100);
  const base = `FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...args).n;
  const pages = Math.max(1, Math.ceil(total / per));
  const page = U.clamp(o.page || 1, 1, pages);
  const items = db.prepare(`SELECT ${COLS} ${base} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, o.limit ? Math.min(o.limit, per) : per, (page - 1) * per);
  return { items, total, page, pages, per };
}

function bySlug(db, slug) {
  return db.prepare(`SELECT p.*, c.name AS cat_name, c.slug AS cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.slug=? AND p.active=1`).get(slug);
}

function related(db, p, n = 4) {
  return db.prepare(`SELECT ${COLS} FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1 AND p.id<>? AND p.category_id IS ? ORDER BY p.featured DESC, p.sold DESC LIMIT ?`).all(p.id, p.category_id, n);
}

function newest(db, n = 8) { return list(db, { sort: 'yeni', per: n, limit: n }).items; }
function featured(db, n = 8) {
  const r = list(db, { featured: 1, sort: 'onerilen', per: n, limit: n }).items;
  return r.length >= Math.min(n, 4) ? r : list(db, { sort: 'cok-satan', per: n, limit: n }).items;
}
function campaign(db, n = 8) { return list(db, { campaign: 1, per: n, limit: n }).items; }

module.exports = { categories, list, bySlug, related, newest, featured, campaign, SORTS };
