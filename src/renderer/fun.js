'use strict';

/* global h */
// Intro « fun » pour un responsable choisi dans les paramètres : parodie
// ringarde des génériques de cinéma. Anneau doré, ruban, bandes de film,
// et au centre la photo de la personne qui rugit… puis WordArt (textes libres),
// flammes et fanfare. Environ 3,5 secondes ; un clic ou Échap la passe. Le décor
// est dessiné et le son est généré.

const FUN_DEFAUT = { titre: '', soustitre: '', bulle: '', ruban: 'RUGIT · GRATIA · LIAISON' };
const FUN_DUREE = 3600;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(markup, viewBox, cls) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  if (cls) svg.setAttribute('class', cls);
  svg.innerHTML = markup;
  return svg;
}

// Anneau doré, ruban et bandes de film (dessin original, façon générique ciné).
function funEmbleme(ruban) {
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const film = (x, flip) => `
    <g transform="translate(${x} 0) scale(${flip ? -1 : 1} 1)">
      <path d="M0 330 C60 300, 120 360, 190 330 S300 300, 330 345 L330 395 C300 352, 250 380, 190 380 S60 350, 0 380 Z" fill="url(#or)" stroke="#5c3b00" stroke-width="3"/>
      ${Array.from({ length: 9 }, (_, i) => `<rect x="${12 + i * 35}" y="${343 + Math.sin(i) * 6}" width="14" height="9" rx="2" fill="#2a1600" opacity=".75"/>`).join('')}
    </g>`;
  const defs = `
    <defs>
      <linearGradient id="or" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff6c2"/><stop offset=".25" stop-color="#e8b923"/><stop offset=".5" stop-color="#8a5a00"/>
        <stop offset=".72" stop-color="#ffd84d"/><stop offset="1" stop-color="#7a4b00"/>
      </linearGradient>
      <radialGradient id="fond" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="#ffcf3a"/><stop offset=".6" stop-color="#ff5a00"/><stop offset="1" stop-color="#7a0f00"/></radialGradient>
      <path id="arc" d="M128 200 A215 200 0 0 1 532 200"/>
    </defs>`;
  // Deux calques : l'anneau sous la photo, le ruban par-dessus.
  const dessous = svgEl(`${defs}
    <g class="fun-films">${film(0, false)}${film(660, true)}</g>
    <circle cx="330" cy="250" r="150" fill="url(#fond)"/>
    <circle cx="330" cy="250" r="168" fill="none" stroke="url(#or)" stroke-width="36"/>
    <circle cx="330" cy="250" r="186" fill="none" stroke="#5c3b00" stroke-width="3"/>
    <circle cx="330" cy="250" r="150" fill="none" stroke="#5c3b00" stroke-width="3"/>`, '0 0 660 450', 'fun-embleme');
  const dessus = svgEl(`${defs.replace(/id="(or|fond|arc)"/g, 'id="$1-2"').replace(/url\(#or\)/g, 'url(#or-2)')}
    <path d="M118 210 Q330 20 542 210 L560 150 Q330 -30 100 150 Z" fill="url(#or-2)" stroke="#5c3b00" stroke-width="3"/>
    <text font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${ruban.length > 22 ? 23 : 28}" letter-spacing="2" fill="#4a2c00">
      <textPath href="#arc-2" startOffset="50%" text-anchor="middle">${esc(ruban)}</textPath>
    </text>`, '0 0 660 450', 'fun-embleme dessus');
  return [dessous, dessus];
}

// La star : la photo de la personne (ronde), ou un lion en emoji s'il n'y en a pas.
function funStar(photoUrl) {
  return photoUrl
    ? h('div', { class: 'fun-star photo' }, h('img', { src: photoUrl, alt: '' }), h('div', { class: 'fun-crocs' }))
    : h('div', { class: 'fun-star emoji' }, '🦁');
}

// Rugissement (grondement + souffle), puis fanfare ringarde, grésillement.
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
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const noiseBuf = (sec, amp = 1) => {
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * amp;
    return b;
  };
  const env = (g, t, a, peak, dur) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  };

  // Rugissement à 1,0 s : deux scies graves modulées + souffle filtré.
  const tr = t0 + 1.0;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 23;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 18;
  lfo.connect(lfoGain);
  const roarGain = ctx.createGain();
  env(roarGain, tr, 0.08, 0.6, 1.1);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(600, tr);
  lp.frequency.linearRampToValueAtTime(1400, tr + 0.25);
  lp.frequency.linearRampToValueAtTime(350, tr + 1.1);
  lp.Q.value = 6;
  for (const f of [70, 105]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 1.3, tr);
    o.frequency.exponentialRampToValueAtTime(f, tr + 1.1);
    lfoGain.connect(o.frequency);
    o.connect(lp);
    o.start(tr);
    o.stop(tr + 1.2);
  }
  const souffle = ctx.createBufferSource();
  souffle.buffer = noiseBuf(1.2);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 500;
  bp.Q.value = 0.8;
  const sg = ctx.createGain();
  env(sg, tr, 0.06, 0.5, 1.1);
  souffle.connect(bp).connect(sg).connect(master);
  souffle.start(tr);
  lp.connect(roarGain).connect(master);
  lfo.start(tr);
  lfo.stop(tr + 1.2);

  // Grésillement de barbecue tout du long.
  const gr = ctx.createBufferSource();
  gr.buffer = noiseBuf(3.5, 0.3);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3000;
  const gg = ctx.createGain();
  env(gg, t0, 0.3, 0.25, 3.5);
  gr.connect(hp).connect(gg).connect(master);
  gr.start(t0);

  // Fanfare 8 bits à 2,1 s : ta-ta-ta-taaa !
  const tf = t0 + 2.1;
  const notes = [[523, 0, 0.12], [523, 0.14, 0.12], [523, 0.28, 0.12], [659, 0.42, 0.22], [784, 0.68, 0.14], [659, 0.84, 0.12], [1047, 1.0, 0.5],
    [262, 0, 0.36], [330, 0.42, 0.24], [392, 1.0, 0.5]];
  for (const [f, d, dur] of notes) {
    const o = ctx.createOscillator();
    o.type = f > 300 ? 'square' : 'sawtooth';
    o.frequency.value = f;
    const g = ctx.createGain();
    env(g, tf + d, 0.015, f > 300 ? 0.16 : 0.1, dur);
    o.connect(g).connect(master);
    o.start(tf + d);
    o.stop(tf + d + dur + 0.05);
  }
  setTimeout(() => ctx.close().catch(() => {}), 5000);
}

function playFunIntro(cfg = {}, photoUrl = null) {
  const c = { ...FUN_DEFAUT, ...Object.fromEntries(Object.entries(cfg).filter(([k, v]) => v && k !== 'photo')) };
  return new Promise((resolve) => {
    const lettres = (txt, cls, delai) => (txt ? h('div', { class: cls }, [...txt].map((ch, i) => h('span', { style: { animationDelay: `${delai + i * 0.05}s` } }, ch === ' ' ? '\u00a0' : ch))) : null);
    const flammes = h('div', { class: 'fun-flammes' },
      Array.from({ length: 24 }, (_, i) => h('span', { style: { left: `${(i * 4.3) % 100}%`, animationDelay: `${1.0 + (i % 6) * 0.1}s`, fontSize: `${40 + (i * 13) % 60}px` } }, '🔥')));
    const etoiles = h('div', { class: 'fun-etoiles' },
      Array.from({ length: 14 }, (_, i) => h('span', { style: { left: `${(i * 37) % 100}%`, top: `${(i * 53) % 90}%`, animationDelay: `${1.1 + (i % 5) * 0.15}s` } }, i % 2 ? '✨' : '⭐')));
    const avecTexte = !!(c.titre || c.soustitre);
    const scene = h('div', { class: `fun-scene${avecTexte ? '' : ' seule'}` }, ...(([dessous, dessus]) => [dessous, h('div', { class: 'fun-star-box' }, funStar(photoUrl)), dessus])(funEmbleme(c.ruban)));
    const el = h('div', { class: 'fun-intro', role: 'presentation' },
      h('div', { class: 'fun-spots' }),
      flammes,
      etoiles,
      scene,
      avecTexte ? h('div', { class: 'fun-textes' }, lettres(c.titre, 'fun-titre', 1.9), lettres(c.soustitre, 'fun-sous', 2.15)) : null,
      c.bulle ? h('div', { class: 'fun-bulle' }, h('span', {}, c.bulle)) : null,
      h('div', { class: 'fun-rugit' }, 'GRRRRRR !!'),
      h('div', { class: 'fun-flash' }),
      h('div', { class: 'fun-advisory' }, h('b', {}, 'MAIN COURANTE'), h('span', {}, 'ADVISORY'), h('small', {}, 'RUGISSEMENT EXPLICITE')));
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      el.classList.add('out');
      setTimeout(() => { el.remove(); resolve(); }, 300);
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
