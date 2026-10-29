'use strict';
// Ürün çizimleri ve Prestij logosu (saf SVG). Gerçek fotoğraf yüklenene kadar kullanılır.
const { e } = require('./util');

const KINDS = {
  lift2: 'İki direkli araç lifti', makas: 'Makaslı lift', kriko: 'Hidrolik kriko', kompresor: 'Kompresör',
  takim: 'Takım arabası', lokma: 'Lokma takımı', pres: 'Hidrolik pres', lamba: 'Çalışma lambası', hortum: 'Hortum makarası',
};

const BODY = {
  lift2: (c) => `
<rect x="70" y="36" width="26" height="226" rx="4" fill="${c.c1}"/><rect x="304" y="36" width="26" height="226" rx="4" fill="${c.c1}"/>
<rect x="52" y="256" width="62" height="8" rx="2" fill="${c.c2}"/><rect x="286" y="256" width="62" height="8" rx="2" fill="${c.c2}"/>
<rect x="96" y="154" width="74" height="8" rx="3" fill="${c.ac2}"/><rect x="230" y="154" width="74" height="8" rx="3" fill="${c.ac2}"/>
<rect x="70" y="146" width="26" height="26" rx="3" fill="${c.ac}"/><rect x="304" y="146" width="26" height="26" rx="3" fill="${c.ac}"/>
<rect x="36" y="116" width="24" height="46" rx="3" fill="${c.c2}"/><rect x="41" y="122" width="14" height="10" rx="2" fill="${c.c3}"/>
<rect x="118" y="118" width="164" height="34" rx="10" fill="${c.c2}"/>
<polygon points="150,118 170,92 236,92 258,118" fill="${c.c2}"/>
<polygon points="158,116 174,98 198,98 198,116" fill="${c.c3}"/><polygon points="204,116 204,98 232,98 248,116" fill="${c.c3}"/>
<circle cx="150" cy="154" r="15" fill="${c.c1}"/><circle cx="150" cy="154" r="6" fill="${c.c3}"/>
<circle cx="250" cy="154" r="15" fill="${c.c1}"/><circle cx="250" cy="154" r="6" fill="${c.c3}"/>`,
  makas: (c) => `
<rect x="60" y="250" width="280" height="12" rx="3" fill="${c.c1}"/>
<line x1="110" y1="246" x2="270" y2="190" stroke="${c.c2}" stroke-width="12" stroke-linecap="round"/>
<line x1="270" y1="246" x2="110" y2="190" stroke="${c.c2}" stroke-width="12" stroke-linecap="round"/>
<line x1="116" y1="190" x2="264" y2="132" stroke="${c.c2}" stroke-width="12" stroke-linecap="round"/>
<line x1="264" y1="190" x2="116" y2="132" stroke="${c.c2}" stroke-width="12" stroke-linecap="round"/>
<circle cx="190" cy="218" r="7" fill="${c.ac}"/><circle cx="190" cy="161" r="7" fill="${c.ac}"/>
<rect x="70" y="112" width="260" height="14" rx="3" fill="${c.c1}"/>
<g transform="translate(0,-57)">
<rect x="118" y="118" width="164" height="34" rx="10" fill="${c.c2}"/>
<polygon points="150,118 170,92 236,92 258,118" fill="${c.c2}"/>
<polygon points="158,116 174,98 198,98 198,116" fill="${c.c3}"/><polygon points="204,116 204,98 232,98 248,116" fill="${c.c3}"/>
<circle cx="150" cy="154" r="15" fill="${c.c1}"/><circle cx="150" cy="154" r="6" fill="${c.c3}"/>
<circle cx="250" cy="154" r="15" fill="${c.c1}"/><circle cx="250" cy="154" r="6" fill="${c.c3}"/></g>`,
  kriko: (c) => `
<rect x="60" y="226" width="250" height="22" rx="6" fill="${c.c1}"/><rect x="300" y="232" width="40" height="10" rx="4" fill="${c.c2}"/>
<circle cx="92" cy="248" r="14" fill="${c.c2}"/><circle cx="92" cy="248" r="5" fill="${c.c3}"/>
<circle cx="282" cy="248" r="14" fill="${c.c2}"/><circle cx="282" cy="248" r="5" fill="${c.c3}"/>
<rect x="228" y="168" width="36" height="58" rx="6" fill="${c.c2}"/><rect x="214" y="152" width="64" height="16" rx="5" fill="${c.ac}"/>
<line x1="104" y1="226" x2="52" y2="84" stroke="${c.c1}" stroke-width="10" stroke-linecap="round"/>
<line x1="38" y1="82" x2="70" y2="94" stroke="${c.ac}" stroke-width="12" stroke-linecap="round"/>`,
  kompresor: (c) => `
<path d="M92 150 L62 126 L62 96" stroke="${c.c1}" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="86" y="146" width="228" height="76" rx="38" fill="${c.c1}"/>
<rect x="150" y="104" width="100" height="44" rx="6" fill="${c.c2}"/><rect x="158" y="92" width="84" height="12" rx="3" fill="${c.ac}"/>
<rect x="166" y="112" width="68" height="6" rx="2" fill="${c.c3}"/><rect x="166" y="126" width="68" height="6" rx="2" fill="${c.c3}"/>
<circle cx="286" cy="132" r="18" fill="${c.c3}" stroke="${c.c1}" stroke-width="5"/>
<line x1="286" y1="132" x2="296" y2="124" stroke="${c.ac2}" stroke-width="3" stroke-linecap="round"/>
<rect x="116" y="220" width="14" height="30" rx="3" fill="${c.c1}"/><rect x="270" y="220" width="14" height="30" rx="3" fill="${c.c1}"/>
<rect x="104" y="248" width="38" height="10" rx="3" fill="${c.c2}"/><circle cx="277" cy="252" r="10" fill="${c.c2}"/><circle cx="277" cy="252" r="4" fill="${c.c3}"/>`,
  takim: (c) => `
<rect x="96" y="34" width="208" height="22" rx="6" fill="${c.c1}"/><rect x="100" y="54" width="200" height="176" rx="6" fill="${c.ac}"/>
${[64, 96, 128, 160, 192].map((y) => `<rect x="112" y="${y}" width="176" height="26" rx="4" fill="${c.ac2}"/><rect x="170" y="${y + 10}" width="60" height="6" rx="3" fill="${c.c3}"/>`).join('')}
<rect x="96" y="228" width="208" height="10" rx="3" fill="${c.c1}"/>
<circle cx="124" cy="248" r="14" fill="${c.c1}"/><circle cx="124" cy="248" r="5" fill="${c.c3}"/>
<circle cx="276" cy="248" r="14" fill="${c.c1}"/><circle cx="276" cy="248" r="5" fill="${c.c3}"/>`,
  lokma: (c) => {
    let s = `<rect x="56" y="70" width="288" height="192" rx="14" fill="${c.c1}"/><rect x="72" y="86" width="256" height="160" rx="8" fill="${c.c2}"/><rect x="186" y="62" width="28" height="16" rx="4" fill="${c.ac}"/>`;
    for (const y of [116, 158]) for (const x of [100, 140, 180, 220, 260, 300]) s += `<circle cx="${x}" cy="${y}" r="14" fill="${c.c3}"/><circle cx="${x}" cy="${y}" r="6" fill="${c.c1}"/>`;
    return s + `<rect x="96" y="198" width="150" height="14" rx="7" fill="${c.ac}"/><circle cx="92" cy="205" r="15" fill="${c.ac}"/><circle cx="92" cy="205" r="6" fill="${c.c3}"/><rect x="256" y="200" width="56" height="10" rx="5" fill="${c.c3}"/>`;
  },
  pres: (c) => `
<rect x="90" y="56" width="28" height="206" rx="4" fill="${c.c1}"/><rect x="282" y="56" width="28" height="206" rx="4" fill="${c.c1}"/><rect x="90" y="56" width="220" height="28" rx="4" fill="${c.c1}"/>
<rect x="176" y="84" width="48" height="62" rx="6" fill="${c.ac}"/><rect x="192" y="146" width="16" height="34" rx="3" fill="${c.c2}"/>
<rect x="176" y="178" width="48" height="12" rx="3" fill="${c.c2}"/><rect x="164" y="196" width="72" height="22" rx="3" fill="${c.c3}"/><rect x="118" y="218" width="164" height="14" rx="3" fill="${c.c2}"/>
<circle cx="256" cy="116" r="15" fill="${c.c3}" stroke="${c.c1}" stroke-width="4"/><line x1="256" y1="116" x2="264" y2="109" stroke="${c.ac2}" stroke-width="3" stroke-linecap="round"/>
<rect x="70" y="256" width="72" height="8" rx="2" fill="${c.c2}"/><rect x="258" y="256" width="72" height="8" rx="2" fill="${c.c2}"/>`,
  lamba: (c) => {
    let s = `<line x1="200" y1="150" x2="132" y2="258" stroke="${c.c1}" stroke-width="8" stroke-linecap="round"/><line x1="200" y1="150" x2="268" y2="258" stroke="${c.c1}" stroke-width="8" stroke-linecap="round"/><line x1="200" y1="150" x2="200" y2="258" stroke="${c.c2}" stroke-width="6" stroke-linecap="round"/>
<rect x="196" y="100" width="8" height="56" fill="${c.c2}"/><rect x="176" y="24" width="48" height="10" rx="5" fill="${c.ac2}"/><rect x="130" y="34" width="140" height="74" rx="12" fill="${c.c1}"/><rect x="140" y="44" width="120" height="54" rx="6" fill="${c.c3}"/>`;
    for (const y of [60, 82]) for (const x of [160, 180, 200, 220, 240]) s += `<circle cx="${x}" cy="${y}" r="7" fill="${c.ac}"/>`;
    return s;
  },
  hortum: (c) => `
<rect x="170" y="228" width="60" height="30" rx="4" fill="${c.c2}"/><circle cx="200" cy="130" r="92" fill="${c.c1}"/><circle cx="200" cy="130" r="72" fill="${c.c2}"/>
<circle cx="200" cy="130" r="56" fill="none" stroke="${c.ac}" stroke-width="14"/><circle cx="200" cy="130" r="40" fill="none" stroke="${c.ac2}" stroke-width="10"/>
<circle cx="200" cy="130" r="18" fill="${c.c3}"/><circle cx="200" cy="130" r="6" fill="${c.c1}"/>
<path d="M290 150 C330 170 340 220 300 250" stroke="${c.ac}" stroke-width="10" fill="none" stroke-linecap="round"/><circle cx="298" cy="252" r="9" fill="${c.c2}"/>`,
};

const PAL = {
  light: { c1: '#2E2D7A', c2: '#8F93BC', c3: '#E4E6F0', ac: '#FF5A1F', ac2: '#D94710' },
  dark: { c1: '#C9CDF0', c2: '#6C71A8', c3: '#23264F', ac: '#FF6B35', ac2: '#E0501C' },
};

function illu(kind, tone = 'light', label = '') {
  const k = BODY[kind] ? kind : 'lift2';
  const c = PAL[tone === 'dark' ? 'dark' : 'light'];
  return `<svg viewBox="0 0 400 300" class="illu" role="img" aria-label="${e(label || KINDS[k])}"><rect x="20" y="262" width="360" height="4" rx="2" fill="${c.c3}"/>${BODY[k](c)}</svg>`;
}

let uid = 0;
/** Prestij logosu. tone: light | dark. lockup: yazı ile birlikte. */
function logo(tone = 'light', lockup = true) {
  const id = 'lg' + (uid = (uid + 1) % 100000);
  const dark = tone === 'dark';
  const emblem = dark
    ? `<svg viewBox="0 0 480 300" class="logo-emblem" aria-hidden="true"><defs>
<linearGradient id="${id}a" gradientUnits="userSpaceOnUse" x1="40" y1="30" x2="430" y2="270"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#C9CCF0"/><stop offset="1" stop-color="#7C81C4"/></linearGradient>
<linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="120" y1="70" x2="410" y2="226"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#9A9FD8"/></linearGradient></defs>
<path fill="url(#${id}a)" fill-rule="evenodd" d="M27 150 a205 112 0 1 0 410 0 a205 112 0 1 0 -410 0 z M79 146 a176 92 0 1 0 352 0 a176 92 0 1 0 -352 0 z"/>
<path fill="url(#${id}b)" fill-rule="evenodd" d="M112 148 a150 76 0 1 0 300 0 a150 76 0 1 0 -300 0 z M134 156 a138 62 0 1 0 276 0 a138 62 0 1 0 -276 0 z"/>
<g transform="translate(262 114) skewX(-14) scale(0.88)" fill="#FFFFFF"><path fill-rule="evenodd" d="M0 0 H44 C70 0 84 16 84 36 C84 56 70 72 44 72 H24 V96 H0 Z M24 18 V54 H42 C52 54 58 48 58 36 C58 24 52 18 42 18 Z"/><rect x="-36" y="82" width="32" height="14" fill="#C9CCF0"/></g></svg>`
    : `<svg viewBox="0 0 480 300" class="logo-emblem" aria-hidden="true"><defs>
<linearGradient id="${id}a" gradientUnits="userSpaceOnUse" x1="40" y1="30" x2="430" y2="270"><stop offset="0" stop-color="#26256F"/><stop offset="0.45" stop-color="#46488F"/><stop offset="1" stop-color="#B7B9C9"/></linearGradient>
<linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="120" y1="70" x2="410" y2="226"><stop offset="0" stop-color="#34347F"/><stop offset="0.55" stop-color="#7C7EAA"/><stop offset="1" stop-color="#C6C8D4"/></linearGradient>
<linearGradient id="${id}c" gradientUnits="userSpaceOnUse" x1="204" y1="0" x2="312" y2="0"><stop offset="0" stop-color="#B9BBCB"/><stop offset="0.5" stop-color="#6F719F"/><stop offset="1" stop-color="#2A2A74"/></linearGradient></defs>
<path fill="url(#${id}a)" fill-rule="evenodd" d="M27 150 a205 112 0 1 0 410 0 a205 112 0 1 0 -410 0 z M79 146 a176 92 0 1 0 352 0 a176 92 0 1 0 -352 0 z"/>
<path fill="url(#${id}b)" fill-rule="evenodd" d="M112 148 a150 76 0 1 0 300 0 a150 76 0 1 0 -300 0 z M134 156 a138 62 0 1 0 276 0 a138 62 0 1 0 -276 0 z"/>
<g transform="translate(262 114) skewX(-14) scale(0.88)"><path fill="url(#${id}c)" fill-rule="evenodd" d="M0 0 H44 C70 0 84 16 84 36 C84 56 70 72 44 72 H24 V96 H0 Z M24 18 V54 H42 C52 54 58 48 58 36 C58 24 52 18 42 18 Z"/><rect x="-36" y="82" width="32" height="14" fill="#B9BBCB"/></g></svg>`;
  const text = lockup ? '<span class="logo-text"><b>PRESTİJ</b><i>SERVİS EKİPMANLARI</i></span>' : '';
  return `<span class="logo logo-${dark ? 'dark' : 'light'}" role="img" aria-label="Prestij Servis Ekipmanları">${emblem}${text}</span>`;
}

module.exports = { illu, logo, KINDS };
