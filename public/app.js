/* Küçük, bağımlılıksız geliştirmeler. JavaScript kapalıyken tüm formlar yine çalışır. */
(function () {
  'use strict';
  var toastEl = document.getElementById('toast');
  var toastTimer;
  function toast(msg, isErr) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = ''; }, 3200);
  }
  function setText(sel, val) {
    document.querySelectorAll(sel).forEach(function (el) { el.textContent = val; });
  }
  function applyCart(j) {
    setText('[data-cart-count]', j.count);
    setText('[data-cart-total]', j.total);
    var drawerBody = document.querySelector('[data-mini]');
    if (drawerBody && j.mini) drawerBody.innerHTML = j.mini;
    document.querySelectorAll('[data-cart-badge]').forEach(function (el) { el.hidden = !j.count; });
  }
  function openDrawer(open) {
    var d = document.querySelector('[data-drawer]');
    if (!d) return false;
    d.hidden = !open;
    document.documentElement.classList.toggle('drawer-open', open);
    if (open) { var c = d.querySelector('[data-drawer-close]'); if (c) c.focus(); }
    return true;
  }

  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (f.matches && f.matches('form[data-once]')) return;
    if (!f.hasAttribute || !f.hasAttribute('data-ajax') || !window.fetch) return;
    ev.preventDefault();
    var btn = f.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    fetch(f.action, { method: 'POST', body: new URLSearchParams(new FormData(f)), headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (btn) btn.disabled = false;
        if (typeof j.count !== 'undefined') applyCart(j);
        if (j.msg) toast(j.msg, !j.ok);
        if (j.ok && f.action.indexOf('/sepet/ekle') > -1) {
          if (btn && btn.classList.contains('addbtn')) { btn.classList.add('done'); setTimeout(function () { btn.classList.remove('done'); }, 1200); }
          if (document.body.hasAttribute('data-cart-drawer')) openDrawer(true);
        }
      })
      .catch(function () { if (btn) btn.disabled = false; f.removeAttribute('data-ajax'); f.submit(); });
  });

  // tek tıkla gönder (çift sipariş önleme)
  document.addEventListener('submit', function (ev) {
    var f = ev.target; if (!f.querySelector) return;
    var b = f.querySelector('button[data-once]');
    if (b) setTimeout(function () { b.disabled = true; b.textContent = 'İşleniyor…'; }, 0);
  });

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-drawer-open],[data-drawer-close],[data-print],[data-nav-toggle]') : null;
    if (!t) return;
    if (t.hasAttribute('data-drawer-open')) { if (openDrawer(true)) ev.preventDefault(); }
    else if (t.hasAttribute('data-drawer-close')) { ev.preventDefault(); openDrawer(false); }
    else if (t.hasAttribute('data-print')) { ev.preventDefault(); window.print(); }
    else if (t.hasAttribute('data-nav-toggle')) {
      var nav = document.querySelector('[data-nav]'); if (nav) { var o = nav.classList.toggle('open'); t.setAttribute('aria-expanded', o ? 'true' : 'false'); }
    }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') openDrawer(false); });

  document.addEventListener('change', function (ev) {
    var f = ev.target.form;
    if (f && f.hasAttribute('data-autosubmit')) f.submit();
  });

  // yönetim: onay penceresi
  document.addEventListener('submit', function (ev) {
    var msg = ev.target.getAttribute && ev.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) ev.preventDefault();
  }, true);
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('button[data-confirm]') : null;
    if (b && !window.confirm(b.getAttribute('data-confirm'))) ev.preventDefault();
  }, true);

  // ödeme: kurumsal fatura alanlarını göster/gizle
  function syncInvoice() {
    var corp = document.querySelector('.corp'); if (!corp) return;
    var sel = document.querySelector('input[name=invoice_type]:checked');
    corp.style.display = sel && sel.value === 'kurumsal' ? '' : 'none';
  }
  document.addEventListener('change', function (ev) { if (ev.target.name === 'invoice_type') syncInvoice(); });
  syncInvoice();
  // ödeme: kart numarası biçimi
  var cc = document.getElementById('f-cc_number');
  if (cc) cc.addEventListener('input', function () { cc.value = cc.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim(); });
  var exp = document.getElementById('f-cc_exp');
  if (exp) exp.addEventListener('input', function () { var d = exp.value.replace(/\D/g, '').slice(0, 4); exp.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; });
})();
