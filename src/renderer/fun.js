'use strict';

/* global h */
// Intro « fun » (ringarde à souhait) pour un responsable choisi dans les
// paramètres : flammes, WordArt arc-en-ciel, merguez volantes et fanfare.
// Environ 3 secondes ; un clic ou Échap la passe.

const FUN_DEFAUT = { titre: 'Merguez', soustitre: 'de salopard', bulle: 'GROSSE MERGUEZ À VOLONTÉ !' };
const FUN_DUREE = 3200;

const merguezSvg = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 220 40');
  svg.innerHTML = `
    <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c8672f"/><stop offset=".45" stop-color="#8f3b17"/><stop offset="1" stop-color="#4e1d08"/></linearGradient></defs>
    <path d="M10 22 C40 4, 90 10, 120 18 S190 34, 212 16 C216 24, 206 34, 190 36 C150 40, 110 28, 80 26 S30 40, 10 30 C4 28, 4 24, 10 22Z" fill="url(#mg)"/>
    <path d="M30 20 C60 12, 100 16, 130 22" stroke="#f0a36b" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>
    <path d="M60 30 l6 -8 M100 30 l6 -8 M140 32 l6 -8 M175 30 l6 -8" stroke="#2b0d02" stroke-width="3" stroke-linecap="round" opacity=".6"/>`;
  return svg;
};

// Fanfare ringarde + grésillement de barbecue, générés (aucun fichier son).
function funSon() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  let ctx;
  try {
    ctx = new AC();
  } catch {
    return;
  }
  const t0 = ctx.currentTime + 0.05;
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  // Grésillement : bruit filtré.
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (Math.random() < 0.02 ? 1 : 0.25);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t0);
  ng.gain.exponentialRampToValueAtTime(0.5, t0 + 0.2);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 3);
  noise.connect(hp).connect(ng).connect(master);
  noise.start(t0);
  noise.stop(t0 + 3);
  // Fanfare 8 bits : ta-ta-ta-taaa !
  const notes = [[523, 0, 0.12], [523, 0.15, 0.12], [523, 0.3, 0.12], [659, 0.45, 0.25], [784, 0.75, 0.15], [659, 0.92, 0.12], [784, 1.08, 0.7],
    [392, 0, 0.3], [330, 0.45, 0.3], [392, 1.08, 0.7]];
  for (const [f, d, dur] of notes) {
    const o = ctx.createOscillator();
    o.type = f > 500 ? 'square' : 'sawtooth';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(f > 500 ? 0.22 : 0.12, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + dur);
    o.connect(g).connect(master);
    o.start(t0 + d);
    o.stop(t0 + d + dur + 0.05);
  }
  // Klaxon de fin (deux tons qui montent).
  for (const [f, d] of [[440, 1.9], [554, 1.9], [660, 2.15]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.9, t0 + d);
    o.frequency.exponentialRampToValueAtTime(f, t0 + d + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.14, t0 + d + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.6);
    o.connect(g).connect(master);
    o.start(t0 + d);
    o.stop(t0 + d + 0.7);
  }
  setTimeout(() => ctx.close().catch(() => {}), 4000);
}

function playFunIntro(cfg = {}) {
  const c = { ...FUN_DEFAUT, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v)) };
  return new Promise((resolve) => {
    const flammes = h('div', { class: 'fun-flammes' },
      Array.from({ length: 26 }, (_, i) => h('span', { style: { left: `${(i * 4) % 100}%`, animationDelay: `${(i % 7) * 0.12}s`, fontSize: `${40 + (i * 13) % 60}px` } }, '🔥')));
    const merguez = Array.from({ length: 6 }, (_, i) => {
      const m = h('div', { class: `fun-merguez m${i}` });
      m.append(merguezSvg());
      return m;
    });
    const lettres = (txt, cls) => h('div', { class: cls }, [...txt].map((ch, i) => h('span', { style: { animationDelay: `${0.25 + i * 0.06}s` } }, ch === ' ' ? ' ' : ch)));
    const grill = h('div', { class: 'fun-grill' }, h('div', { class: 'fun-grill-m' }));
    grill.firstChild.append(merguezSvg());
    const el = h('div', { class: 'fun-intro', role: 'presentation' },
      flammes,
      h('div', { class: 'fun-rayons' }),
      lettres(c.titre, 'fun-titre'),
      lettres(c.soustitre, 'fun-sous'),
      h('div', { class: 'fun-bulle' }, h('span', {}, c.bulle)),
      h('div', { class: 'fun-studio' }, h('b', {}, 'studio'), h('i', {}, 'Liaison')),
      ...merguez,
      grill,
      h('div', { class: 'fun-flash' }),
      h('div', { class: 'fun-advisory' }, h('b', {}, 'MAIN COURANTE'), h('span', {}, 'ADVISORY'), h('small', {}, 'EXPLICIT MERGUEZ')));
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      el.classList.add('out');
      setTimeout(() => { el.remove(); resolve(); }, 250);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        end();
      }
    };
    el.addEventListener('click', end);
    document.addEventListener('keydown', onKey, true);
    // Dans une fenêtre modale ouverte (bouton « Tester »), sinon elle resterait dessous.
    (document.querySelector('dialog[open]') || document.body).append(el);
    funSon();
    setTimeout(end, FUN_DUREE);
  });
}
