'use strict';
// E-posta kuyruğu + küçük, bağımlılıksız SMTP istemcisi (465 TLS, 587 STARTTLS veya düz).
const net = require('net');
const tls = require('tls');
const cfg = require('./config');

function queue(db, to, subject, body) {
  if (!to) return;
  db.prepare('INSERT INTO outbox(to_addr,subject,body,created_at) VALUES(?,?,?,?)').run(to, subject, body, Date.now());
}

const enabled = () => !!(cfg.SMTP_HOST && cfg.SMTP_FROM);

function replyReader(sock) {
  let buf = ''; let err = null; const replies = []; const waiters = [];
  const flushW = () => {
    while (waiters.length && (replies.length || err)) {
      const w = waiters.shift();
      if (replies.length) w.resolve(replies.shift()); else w.reject(err);
    }
  };
  const onData = (d) => {
    buf += d.toString('utf8');
    let idx;
    let cur = [];
    while ((idx = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
      cur.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) { replies.push({ code: parseInt(line.slice(0, 3), 10), text: cur.join('\n') }); cur = []; }
    }
    flushW();
  };
  const onErr = (e) => { err = e || new Error('SMTP bağlantısı kapandı'); flushW(); };
  sock.on('data', onData); sock.on('error', onErr); sock.on('close', () => onErr(new Error('SMTP bağlantısı kapandı')));
  return {
    read: () => new Promise((resolve, reject) => { waiters.push({ resolve, reject }); flushW(); }),
    detach: () => { sock.removeListener('data', onData); },
  };
}

async function smtpSend({ to, subject, body }) {
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const from = (/<([^>]+)>/.exec(cfg.SMTP_FROM) || [null, cfg.SMTP_FROM])[1];
  const msg = [
    `From: ${cfg.SMTP_FROM}`, `To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
    `Date: ${new Date().toUTCString()}`, '', b64(body).replace(/(.{76})/g, '$1\r\n'),
  ].join('\r\n');

  const connect = () => new Promise((resolve, reject) => {
    const s = cfg.SMTP_SECURE === 'tls'
      ? tls.connect({ host: cfg.SMTP_HOST, port: cfg.SMTP_PORT, servername: cfg.SMTP_HOST }, () => resolve(s))
      : net.connect({ host: cfg.SMTP_HOST, port: cfg.SMTP_PORT }, () => resolve(s));
    s.once('error', reject);
  });
  const timer = setTimeout(() => { try { sock.destroy(); } catch { /* yok */ } }, 25000);
  let sock = await connect();
  try {
    let rd = replyReader(sock);
    const expect = async (code) => { const r = await rd.read(); if (r.code !== code) throw new Error(`SMTP: ${r.text}`); return r; };
    const cmd = async (line, code) => { sock.write(line + '\r\n'); return expect(code); };
    await expect(220);
    await cmd('EHLO magaza.local', 250);
    if (cfg.SMTP_SECURE === 'starttls') {
      await cmd('STARTTLS', 220);
      rd.detach();
      sock = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: sock, host: cfg.SMTP_HOST, servername: cfg.SMTP_HOST }, () => resolve(t));
        t.once('error', reject);
      });
      rd = replyReader(sock);
      await cmd('EHLO magaza.local', 250);
    }
    if (cfg.SMTP_USER) {
      await cmd('AUTH LOGIN', 334); await cmd(b64(cfg.SMTP_USER), 334); await cmd(b64(cfg.SMTP_PASS), 235);
    }
    await cmd(`MAIL FROM:<${from}>`, 250);
    await cmd(`RCPT TO:<${to}>`, 250);
    await cmd('DATA', 354);
    await cmd(`${msg.replace(/\r\n\./g, '\r\n..')}\r\n.`, 250);
    try { sock.write('QUIT\r\n'); } catch { /* yok */ }
  } finally { clearTimeout(timer); try { sock.end(); } catch { /* yok */ } }
}

let busy = false;
async function processOutbox(db, log) {
  if (busy) return;
  busy = true;
  try {
    if (!enabled()) {
      db.prepare('UPDATE outbox SET status=\'smtp-yok\' WHERE status=\'bekliyor\'').run();
      return;
    }
    const rows = db.prepare('SELECT * FROM outbox WHERE status=\'bekliyor\' AND tries<5 ORDER BY id LIMIT 10').all();
    for (const r of rows) {
      try {
        await smtpSend({ to: r.to_addr, subject: r.subject, body: r.body });
        db.prepare('UPDATE outbox SET status=\'gonderildi\', sent_at=?, tries=tries+1 WHERE id=?').run(Date.now(), r.id);
      } catch (err) {
        const tries = r.tries + 1;
        db.prepare('UPDATE outbox SET tries=?, error=?, status=? WHERE id=?').run(tries, String(err.message).slice(0, 300), tries >= 5 ? 'hata' : 'bekliyor', r.id);
        log.warn(`E-posta gönderilemedi (#${r.id}): ${err.message}`);
      }
    }
  } finally { busy = false; }
}

function cleanupOutbox(db) {
  db.prepare('DELETE FROM outbox WHERE status IN (\'gonderildi\',\'smtp-yok\') AND created_at < ?').run(Date.now() - 30 * 86400000);
}

module.exports = { queue, processOutbox, cleanupOutbox, enabled, smtpSend };
