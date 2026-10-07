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

// Emblème façon générique de cinéma (dessin original) : anneau doré en relief,
// ruban gravé à pans repliés, pellicules enroulées, reflet qui balaie l'or.
// Repère : viewBox 660×450, centre (330, 250), ouverture de rayon 150.
const CX = 330;
const CY = 250;
const pt = (r, deg) => [CX + r * Math.cos(deg * Math.PI / 180), CY - r * Math.sin(deg * Math.PI / 180)];
const f1 = (n) => n.toFixed(1);

// Dégradés partagés (suffixe pour garder des id uniques par calque).
function funDefs(k) {
  return `
    <linearGradient id="or${k}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff8d6"/><stop offset=".18" stop-color="#f3cf63"/><stop offset=".38" stop-color="#b9861f"/>
      <stop offset=".5" stop-color="#7a520c"/><stop offset=".62" stop-color="#d9ab3c"/><stop offset=".8" stop-color="#fff0b0"/><stop offset="1" stop-color="#a87418"/>
    </linearGradient>
    <linearGradient id="orV${k}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3c4"/><stop offset=".3" stop-color="#e8bf4f"/><stop offset=".55" stop-color="#9b6a14"/>
      <stop offset=".75" stop-color="#e3b648"/><stop offset="1" stop-color="#7a4f0a"/>
    </linearGradient>
    <linearGradient id="orSombre${k}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8a5c10"/><stop offset=".5" stop-color="#5a3a05"/><stop offset="1" stop-color="#3d2603"/>
    </linearGradient>
    <linearGradient id="reflet${k}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>`;
}

// Pellicule enroulée : bande le long d'une courbe de Bézier, largeur qui « vrille ».
function funPellicule(P, k) {
  const N = 60;
  const at = (t) => {
    const u = 1 - t;
    const x = u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0];
    const y = u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1];
    const dx = 3 * u * u * (P[1][0] - P[0][0]) + 6 * u * t * (P[2][0] - P[1][0]) + 3 * t * t * (P[3][0] - P[2][0]);
    const dy = 3 * u * u * (P[1][1] - P[0][1]) + 6 * u * t * (P[2][1] - P[1][1]) + 3 * t * t * (P[3][1] - P[2][1]);
    const l = Math.hypot(dx, dy) || 1;
    return { x, y, nx: -dy / l, ny: dx / l };
  };
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N;
    const w = 21 * (0.3 + 0.7 * Math.abs(Math.cos(t * Math.PI * 1.25 + 0.5)));
    return { ...at(t), w, t };
  });
  // Tronçons : clairs quand la bande est de face, sombres quand elle vrille.
  let seg = '';
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const face = a.w / 21;
    const fill = face > 0.7 ? `url(#orV${k})` : face > 0.5 ? `url(#or${k})` : `url(#orSombre${k})`;
    seg += `<path d="M${f1(a.x + a.nx * a.w)} ${f1(a.y + a.ny * a.w)} L${f1(b.x + b.nx * b.w)} ${f1(b.y + b.ny * b.w)} L${f1(b.x - b.nx * b.w)} ${f1(b.y - b.ny * b.w)} L${f1(a.x - a.nx * a.w)} ${f1(a.y - a.ny * a.w)} Z" fill="${fill}" stroke="${fill}" stroke-width=".6"/>`;
  }
  const bord = (sg) => `<path d="M${pts.map((q) => `${f1(q.x + sg * q.nx * q.w)} ${f1(q.y + sg * q.ny * q.w)}`).join(' L')}" fill="none" stroke="#4a3003" stroke-width="1.6"/>`;
  // Perforations près des deux bords, seulement là où la bande est assez de face.
  let trous = '';
  for (let i = 1; i < N; i += 2) {
    const q = pts[i];
    if (q.w < 11) continue;
    for (const sg of [1, -1]) {
      const x = q.x + sg * q.nx * q.w * 0.68;
      const y = q.y + sg * q.ny * q.w * 0.68;
      const ang = Math.atan2(q.ny, q.nx) * 180 / Math.PI;
      trous += `<rect x="${f1(x - 2.6)}" y="${f1(y - 2 * q.w / 21)}" width="5.2" height="${f1(4 * q.w / 21)}" rx="1" fill="#2a1800" transform="rotate(${f1(ang)} ${f1(x)} ${f1(y)})"/>`;
    }
  }
  return `<g filter="url(#ombre${k})">${seg}${bord(1)}${bord(-1)}${trous}</g>`;
}

function funEmbleme(ruban) {
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // Perles tout autour de l'anneau.
  const perles = Array.from({ length: 48 }, (_, i) => {
    const [x, y] = pt(205, i * 7.5);
    return `<circle cx="${f1(x)}" cy="${f1(y)}" r="3.6" fill="url(#orV0)" stroke="#5a3a05" stroke-width=".8"/>`;
  }).join('');
  const ombre = (k) => `<filter id="ombre${k}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity=".6"/></filter>`;

  const dessous = svgEl(`
    <defs>${funDefs(0)}${ombre(0)}
      <radialGradient id="halo0" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="#ffd76a" stop-opacity=".55"/><stop offset=".6" stop-color="#ff9a1a" stop-opacity=".15"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <radialGradient id="fond0" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#3b2a10"/><stop offset=".7" stop-color="#140c03"/><stop offset="1" stop-color="#000"/></radialGradient>
      <clipPath id="clipOr0"><circle cx="${CX}" cy="${CY}" r="212"/></clipPath>
    </defs>
    <ellipse cx="${CX}" cy="${CY}" rx="330" ry="225" fill="url(#halo0)"/>
    <g class="fun-films">
      ${funPellicule([[250, 420], [120, 500], [-30, 430], [30, 300]], 0)}
      ${funPellicule([[410, 420], [540, 500], [690, 430], [630, 300]], 0)}
    </g>
    <g filter="url(#ombre0)">
      <circle cx="${CX}" cy="${CY}" r="150" fill="url(#fond0)"/>
      <circle cx="${CX}" cy="${CY}" r="173" fill="none" stroke="url(#or0)" stroke-width="46"/>
      <circle cx="${CX}" cy="${CY}" r="190" fill="none" stroke="#fff6cf" stroke-width="2" opacity=".55"/>
      <circle cx="${CX}" cy="${CY}" r="157" fill="none" stroke="#fff6cf" stroke-width="2" opacity=".45"/>
      <circle cx="${CX}" cy="${CY}" r="173" fill="none" stroke="#6b4508" stroke-width="1.5" stroke-dasharray="2 6" opacity=".7"/>
      <circle cx="${CX}" cy="${CY}" r="196" fill="none" stroke="#3d2603" stroke-width="3"/>
      <circle cx="${CX}" cy="${CY}" r="150" fill="none" stroke="#3d2603" stroke-width="4"/>
      ${perles}
      <circle cx="${CX}" cy="${CY}" r="212" fill="none" stroke="url(#or0)" stroke-width="5"/>
    </g>
    <g clip-path="url(#clipOr0)"><rect class="fun-reflet" x="-200" y="-40" width="420" height="540" fill="url(#reflet0)" opacity=".7"/></g>`, '0 -40 660 540', 'fun-embleme');

  // Ruban : arc épais au-dessus de l'anneau, pans repliés en queue d'aronde.
  const R1 = 214;
  const R2 = 262;
  const A1 = 150;
  const A2 = 30;
  const [ax1, ay1] = pt(R2, A1); const [bx1, by1] = pt(R2, A2);
  const [bx2, by2] = pt(R1, A2); const [ax2, ay2] = pt(R1, A1);
  const bande = `M${f1(ax1)} ${f1(ay1)} A${R2} ${R2} 0 0 1 ${f1(bx1)} ${f1(by1)} L${f1(bx2)} ${f1(by2)} A${R1} ${R1} 0 0 0 ${f1(ax2)} ${f1(ay2)} Z`;
  // Pans du ruban : rubans pliés qui pendent derrière les extrémités, encoche en V.
  const pan = (side) => {
    const A = side < 0 ? A1 : A2;
    const dec = side < 0 ? -7 : 7;
    const E1 = pt(R2 - 6, A + dec);
    const E2 = pt(R1 + 2, A + dec);
    const d = [side * 100, 58];
    const M = [(E1[0] + E2[0]) / 2 + d[0] * 0.72, (E1[1] + E2[1]) / 2 + d[1] * 0.72];
    const q = (p) => `${f1(p[0])} ${f1(p[1])}`;
    const add = (p) => [p[0] + d[0], p[1] + d[1]];
    const bout = side < 0 ? [ax2, ay2] : [bx2, by2];
    return {
      queue: `M${q(E1)} L${q(add(E1))} L${q(M)} L${q(add(E2))} L${q(E2)} Z`,
      pli: `M${q(bout)} L${q(E2)} L${q(pt(R1 - 6, A + dec * 0.4))} Z`,
    };
  };
  const L = pan(-1);
  const R = pan(1);
  const [tx1, ty1] = pt(238, A1 + 2); const [tx2, ty2] = pt(238, A2 - 2);
  const taille = Math.max(16, Math.min(30, 560 / Math.max(10, ruban.length)));
  const dessus = svgEl(`
    <defs>${funDefs(1)}${ombre(1)}
      <path id="arc1" d="M${f1(tx1)} ${f1(ty1)} A238 238 0 0 1 ${f1(tx2)} ${f1(ty2)}"/>
      <clipPath id="clipRuban1"><path d="${bande}"/></clipPath>
    </defs>
    <g filter="url(#ombre1)">
      <path d="${L.queue}" fill="url(#orSombre1)" stroke="#3d2603" stroke-width="2"/>
      <path d="${R.queue}" fill="url(#orSombre1)" stroke="#3d2603" stroke-width="2"/>
      <path d="${L.pli}" fill="#4a2f04"/><path d="${R.pli}" fill="#4a2f04"/>
      <path d="${bande}" fill="url(#orV1)" stroke="#3d2603" stroke-width="2.5"/>
    </g>
    <path d="M${f1(pt(R2 - 5, A1 - 1)[0])} ${f1(pt(R2 - 5, A1 - 1)[1])} A${R2 - 5} ${R2 - 5} 0 0 1 ${f1(pt(R2 - 5, A2 + 1)[0])} ${f1(pt(R2 - 5, A2 + 1)[1])}" fill="none" stroke="#fff6cf" stroke-width="1.6" opacity=".7"/>
    <path d="M${f1(pt(R1 + 5, A1 - 1)[0])} ${f1(pt(R1 + 5, A1 - 1)[1])} A${R1 + 5} ${R1 + 5} 0 0 1 ${f1(pt(R1 + 5, A2 + 1)[0])} ${f1(pt(R1 + 5, A2 + 1)[1])}" fill="none" stroke="#5a3a05" stroke-width="1.2" opacity=".7"/>
    <g font-family="'Trajan Pro', 'Cinzel', Georgia, 'Times New Roman', serif" font-weight="700" font-size="${f1(taille)}" letter-spacing="3">
      <text fill="#fff4c8" opacity=".75" transform="translate(0 1.4)"><textPath href="#arc1" startOffset="50%" text-anchor="middle" dominant-baseline="middle">${esc(ruban)}</textPath></text>
      <text fill="#3a2302"><textPath href="#arc1" startOffset="50%" text-anchor="middle" dominant-baseline="middle">${esc(ruban)}</textPath></text>
    </g>
    <g clip-path="url(#clipRuban1)"><rect class="fun-reflet" x="-200" y="-40" width="420" height="540" fill="url(#reflet1)" opacity=".7"/></g>`, '0 -40 660 540', 'fun-embleme dessus');
  return [dessous, dessus];
}

// La star : la photo de la personne, animée en « papier découpé » : la mâchoire
// (sous la bouche) se détache et s'ouvre sur une gueule sombre pendant le
// rugissement. `bouche` = position de la bouche dans la photo (0..1).
const FUN_BOUCHE = { x: 0.5, y: 0.68 };

function funStar(photo, bouche) {
  if (!photo) return h('div', { class: 'fun-star emoji' }, '🦁');
  const b = { ...FUN_BOUCHE, ...(bouche || {}) };
  const a = photo.width / photo.height || 1;
  // Photo « cover » dans le carré de l'ouverture (en % de ce carré).
  const g = a < 1 ? { w: 100, h: 100 / a, l: 0, t: (100 - 100 / a) / 2 } : { w: 100 * a, h: 100, l: (100 - 100 * a) / 2, t: 0 };
  const mx = g.l + b.x * g.w;
  const my = g.t + b.y * g.h;
  const rx = 21;
  const ry = 24;
  const calque = () => h('div', { class: 'fun-img', style: { left: `${g.l}%`, top: `${g.t}%`, width: `${g.w}%`, height: `${g.h}%` } }, h('img', { src: photo.url, alt: '' }));
  // Mâchoire : demi-ellipse sous la ligne de la bouche.
  const poly = Array.from({ length: 19 }, (_, i) => {
    const t = Math.PI * (i / 18);
    return `${(mx + rx * Math.cos(t)).toFixed(1)}% ${(my + ry * Math.sin(t)).toFixed(1)}%`;
  });
  const jaw = h('div', { class: 'fun-machoire', style: { clipPath: `polygon(${poly.join(', ')})`, transformOrigin: `${mx}% ${my}%` } }, calque());
  const gueule = h('div', { class: 'fun-gueule', style: { left: `${mx - rx * 0.86}%`, top: `${my - 1.5}%`, width: `${rx * 1.72}%` } },
    h('i', { class: 'dents' }), h('i', { class: 'langue' }));
  return h('div', { class: 'fun-star photo' }, calque(), gueule, jaw);
}

// Charge la photo pour connaître ses proportions (null si illisible).
function funPhoto(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
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

async function playFunIntro(cfg = {}, photoUrl = null) {
  const photo = await funPhoto(photoUrl);
  const c = { ...FUN_DEFAUT, ...Object.fromEntries(Object.entries(cfg).filter(([k, v]) => v && k !== 'photo' && k !== 'bouche')) };
  return new Promise((resolve) => {
    // Lettres qui tombent une \u00e0 une (en 0,5 s au plus) ; un texte long est r\u00e9duit pour tenir \u00e0 l'\u00e9cran.
    const lettres = (txt, cls, delai) => (txt ? h('div', { class: cls, style: { fontSize: txt.length > 10 ? `calc(var(--fun-fs) * ${(10 / txt.length).toFixed(2)})` : null } },
      [...txt].map((ch, i) => h('span', { style: { animationDelay: `${delai + i * Math.min(0.05, 0.5 / txt.length)}s` } }, ch === ' ' ? '\u00a0' : ch))) : null);
    const flammes = h('div', { class: 'fun-flammes' },
      Array.from({ length: 24 }, (_, i) => h('span', { style: { left: `${(i * 4.3) % 100}%`, animationDelay: `${1.0 + (i % 6) * 0.1}s`, fontSize: `${40 + (i * 13) % 60}px` } }, '🔥')));
    const etoiles = h('div', { class: 'fun-etoiles' },
      Array.from({ length: 14 }, (_, i) => h('span', { style: { left: `${(i * 37) % 100}%`, top: `${(i * 53) % 90}%`, animationDelay: `${1.1 + (i % 5) * 0.15}s` } }, i % 2 ? '✨' : '⭐')));
    const avecTexte = !!(c.titre || c.soustitre);
    const scene = h('div', { class: `fun-scene${avecTexte ? '' : ' seule'}` }, ...(([dessous, dessus]) => [dessous, h('div', { class: 'fun-star-box' }, funStar(photo, cfg.bouche)), dessus])(funEmbleme(c.ruban)));
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
