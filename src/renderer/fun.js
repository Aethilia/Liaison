'use strict';

/* global h, call, api */
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

// Bande-son façon générique de cinéma, entièrement synthétisée :
// coup sourd (0 s), grognement (0,45 s), grand rugissement (1 s), accord de
// cuivres (2 s), le tout dans l'écho d'une grande salle.
function funSon(AC = window.AudioContext || window.webkitAudioContext, { rugissement = true } = {}) {
  if (!AC) return null;
  let ctx;
  try {
    ctx = typeof AC === 'function' ? new AC() : AC;
  } catch {
    return null;
  }
  const sr = ctx.sampleRate;
  const t0 = ctx.currentTime + 0.05;
  const rnd = (() => { let x = 1234567; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); })();

  // Sortie : compresseur + réverbération de salle (réponse impulsionnelle générée).
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  comp.connect(master).connect(ctx.destination);
  const dry = ctx.createGain();
  dry.gain.value = 0.85;
  dry.connect(comp);
  const conv = ctx.createConvolver();
  const irLen = Math.floor(sr * 2.4);
  const ir = ctx.createBuffer(2, irLen, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < irLen; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / irLen, 3.2) * (i < sr * 0.01 ? i / (sr * 0.01) : 1);
  }
  conv.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  conv.connect(wet).connect(comp);
  const out = ctx.createGain();
  out.connect(dry);
  out.connect(conv);

  const bruit = (sec) => {
    const b = ctx.createBuffer(1, Math.max(1, Math.floor(sr * sec)), sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = b;
    return src;
  };
  const filtre = (type, f, q = 1) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  };
  const sature = (k) => {
    const w = ctx.createWaveShaper();
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    w.curve = c;
    return w;
  };

  // 1) Coup sourd de cinéma : sinus qui plonge + choc de bruit grave.
  {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t0);
    o.frequency.exponentialRampToValueAtTime(32, t0 + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 1.5);
    const n = bruit(0.6);
    const lp = filtre('lowpass', 260, 0.7);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.7, t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    n.connect(lp).connect(gn).connect(out);
    n.start(t0);
  }

  // Voix de fauve : cordes vocales « rugueuses » (hauteur qui tremble, grain,
  // sous-harmonique), saturées, filtrées par la gueule (formants), + souffle.
  const voix = (t, dur, f0, fPic, fFin, fort, ouverture) => {
    const corps = ctx.createGain();
    corps.gain.value = 0;
    // Tremblement de hauteur et grain d'amplitude (bruit très grave).
    const jit = bruit(dur + 0.2);
    const jlp = filtre('lowpass', 28, 0.5);
    const jg = ctx.createGain();
    jg.gain.value = f0 * 0.12;
    jit.connect(jlp).connect(jg);
    const am = bruit(dur + 0.2);
    const alp = filtre('lowpass', 70, 0.5);
    const ag = ctx.createGain();
    ag.gain.value = fort * 0.55;
    am.connect(alp).connect(ag).connect(corps.gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(fort, t + dur * 0.12);
    env.gain.setValueAtTime(fort, t + dur * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    corps.gain.setValueAtTime(fort, t);
    for (const [mul, type, vol] of [[1, 'sawtooth', 1], [0.5, 'sawtooth', 0.6], [1.007, 'square', 0.25], [1.5, 'sawtooth', 0.2]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * mul, t);
      o.frequency.linearRampToValueAtTime(fPic * mul, t + dur * 0.32);
      o.frequency.exponentialRampToValueAtTime(fFin * mul, t + dur);
      const jm = ctx.createGain();
      jm.gain.value = mul;
      jg.connect(jm).connect(o.frequency);
      const ov = ctx.createGain();
      ov.gain.value = vol;
      o.connect(ov).connect(corps);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    const sat = sature(3.5);
    corps.connect(sat);
    // Gueule : formants qui s'ouvrent puis se referment.
    const sortie = ctx.createGain();
    sortie.gain.value = 0.22;
    for (const [f, fo, q, g] of [[320, 680 * ouverture, 5, 1], [1050, 1350, 6, 0.55], [2400, 2700, 8, 0.25]]) {
      const bp = filtre('bandpass', f, q);
      bp.frequency.setValueAtTime(f, t);
      bp.frequency.linearRampToValueAtTime(fo, t + dur * 0.3);
      bp.frequency.linearRampToValueAtTime(f * 0.9, t + dur);
      const gg = ctx.createGain();
      gg.gain.value = g;
      sat.connect(bp).connect(gg).connect(sortie);
    }
    const corpsBas = filtre('lowpass', 700, 0.8);
    const cb = ctx.createGain();
    cb.gain.value = 0.5;
    sat.connect(corpsBas).connect(cb).connect(sortie);
    sortie.connect(env).connect(out);
    // Souffle rauque de la gueule.
    const souffle = bruit(dur + 0.3);
    const sbp = filtre('bandpass', 700, 0.6);
    sbp.frequency.setValueAtTime(500, t);
    sbp.frequency.linearRampToValueAtTime(1300, t + dur * 0.35);
    sbp.frequency.linearRampToValueAtTime(600, t + dur + 0.3);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(fort * 0.5, t + dur * 0.15);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    souffle.connect(sbp).connect(sg).connect(out);
    for (const n of [jit, am, souffle]) { n.start(t); n.stop(t + dur + 0.3); }
  };

  // 2) Grognement quand la photo apparaît, 3) grand rugissement.
  if (rugissement) {
    voix(t0 + 0.42, 0.4, 85, 110, 70, 0.55, 0.8);
    voix(t0 + 1.0, 1.35, 105, 190, 78, 1, 1.15);
  }

  // 4) Accord de cuivres majestueux (do majeur) qui enfle puis s'éteint.
  const tc = t0 + 2.05;
  for (const [f, v] of [[65.4, 0.5], [130.8, 0.6], [196, 0.45], [261.6, 0.45], [329.6, 0.35], [392, 0.25]]) {
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const lp = filtre('lowpass', 400, 1.2);
      lp.frequency.setValueAtTime(350, tc);
      lp.frequency.linearRampToValueAtTime(2600, tc + 0.5);
      lp.frequency.linearRampToValueAtTime(900, tc + 1.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tc);
      g.gain.exponentialRampToValueAtTime(v * 0.09, tc + 0.35);
      g.gain.setValueAtTime(v * 0.09, tc + 1.1);
      g.gain.exponentialRampToValueAtTime(0.0001, tc + 1.7);
      o.connect(lp).connect(g).connect(out);
      o.start(tc);
      o.stop(tc + 1.8);
    }
  }
  // Roulement de timbale sous l'accord.
  {
    const n = bruit(1.5);
    const bp = filtre('bandpass', 90, 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, tc);
    g.gain.exponentialRampToValueAtTime(0.5, tc + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, tc + 1.5);
    n.connect(bp).connect(g).connect(out);
    n.start(tc);
  }
  if (typeof AC === 'function') setTimeout(() => ctx.close().catch(() => {}), 5500);
  return ctx;
}

// Vrai son fourni par l'utilisateur : joué quand la mâchoire s'ouvre (1 s),
// coupé en fondu à la fin de l'intro.
function funSonPerso(url) {
  if (!url) return null;
  const a = new Audio(url);
  a.preload = 'auto';
  const timer = setTimeout(() => a.play().catch(() => {}), 950);
  return {
    stop: () => {
      clearTimeout(timer);
      const fin = setInterval(() => {
        a.volume = Math.max(0, a.volume - 0.1);
        if (a.volume <= 0.01) { a.pause(); clearInterval(fin); }
      }, 40);
    },
  };
}

async function playFunIntro(cfg = {}, photoUrl = null, sonUrl = null) {
  const photo = await funPhoto(photoUrl);
  const c = { ...FUN_DEFAUT, ...Object.fromEntries(Object.entries(cfg).filter(([k, v]) => v && !['photo', 'bouche', 'son'].includes(k))) };
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
      if (perso) perso.stop();
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
    const perso = funSonPerso(sonUrl);
    funSon(undefined, { rugissement: !perso });
    setTimeout(end, perso ? FUN_DUREE + 600 : FUN_DUREE);
  });
}

// Farce : faux « écran bleu » Windows (en français), plein écran pendant 10 s,
// au choix du site. Rien n'est touché sur le PC ; Échap l'arrête.
function playEcranBleu(duree = 10000) {
  return new Promise((resolve) => {
    const pct = h('span', {}, '0');
    const el = h('div', { class: 'ecran-bleu', role: 'presentation' },
      h('div', { class: 'eb-contenu' },
        h('div', { class: 'eb-smiley' }, ':('),
        h('p', { class: 'eb-texte' }, 'Votre ordinateur a rencontré un problème et doit redémarrer. Nous recueillons simplement certaines informations relatives à l’erreur, puis nous allons redémarrer l’ordinateur pour vous. (', pct, ' % effectué)'),
        h('p', { class: 'eb-petit' }, 'Pour en savoir plus, vous pourrez rechercher ultérieurement en ligne l’erreur suivante : HAL_INITIALIZATION_FAILED')));
    // Progression irrégulière, comme le vrai.
    const paliers = [[0, 0], [0.12, 0], [0.2, 11], [0.38, 23], [0.5, 37], [0.62, 52], [0.74, 68], [0.86, 85], [0.95, 100]];
    const timers = paliers.map(([t, v]) => setTimeout(() => { pct.textContent = String(v); }, t * duree));
    let fini = false;
    const fin = () => {
      if (fini) return;
      fini = true;
      timers.forEach(clearTimeout);
      document.removeEventListener('keydown', onKey, true);
      call(api.setFullScreen(false)).catch(() => {});
      el.remove();
      resolve();
    };
    const onKey = (e) => {
      e.preventDefault();
      if (e.key === 'Escape') fin();
    };
    document.addEventListener('keydown', onKey, true);
    (document.querySelector('dialog[open]') || document.body).append(el);
    call(api.setFullScreen(true)).catch(() => {});
    setTimeout(fin, duree);
  });
}

// Petit caca souriant (dessin original) qui tombe le long de la barre d'une
// benne quand on y saisit un pourcentage.
const CACA_SVG = `
  <defs>
    <linearGradient id="cacaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9763e"/><stop offset=".55" stop-color="#8a4f22"/><stop offset="1" stop-color="#6a3a16"/></linearGradient>
  </defs>
  <g stroke="#4a2408" stroke-width="5" stroke-linejoin="round" fill="url(#cacaG)">
    <path d="M14 150 C2 150 2 116 30 112 L170 112 C198 116 198 150 186 150 Z"/>
    <path d="M30 116 C14 112 16 82 42 80 L158 80 C184 82 186 112 170 116 Z"/>
    <path d="M46 84 C32 80 36 54 60 52 L140 52 C164 54 168 80 154 84 Z"/>
    <path d="M62 56 C56 40 78 26 100 28 C110 10 96 4 92 2 C122 4 134 26 126 42 C142 42 146 54 138 56 Z"/>
  </g>
  <path d="M40 120 C80 124 130 124 168 118 M52 88 C90 92 124 92 150 88 M68 60 C92 63 116 63 134 60" stroke="#d99a5e" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55"/>
  <ellipse cx="74" cy="92" rx="17" ry="20" fill="#fff" stroke="#4a2408" stroke-width="3"/><ellipse cx="126" cy="92" rx="17" ry="20" fill="#fff" stroke="#4a2408" stroke-width="3"/>
  <ellipse cx="76" cy="95" rx="7" ry="10" fill="#1b0c02"/><ellipse cx="124" cy="95" rx="7" ry="10" fill="#1b0c02"/>
  <path d="M66 122 Q100 148 134 122 Z" fill="#fff" stroke="#4a2408" stroke-width="4" stroke-linejoin="round"/>`;

function cacaTombe(champ) {
  // Accroché à la ligne de la benne (suit le défilement), juste à droite du %.
  const ligne = champ.closest('.box-row');
  const hote = ligne || document.body;
  const taille = 42;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 200 155');
  el.setAttribute('class', `caca-tombe${ligne ? '' : ' libre'}`);
  el.innerHTML = CACA_SVG;
  el.style.width = `${taille}px`;
  el.style.height = `${taille * 0.78}px`;
  if (ligne) {
    const pct = ligne.querySelector('.pct') || champ;
    el.style.left = `${pct.offsetLeft + pct.offsetWidth + 2}px`;
    el.style.top = `${pct.offsetTop + pct.offsetHeight / 2 - taille * 0.39}px`;
  } else {
    const r = champ.getBoundingClientRect();
    el.style.left = `${r.right + 6}px`;
    el.style.top = `${r.top}px`;
  }
  hote.append(el);
  el.addEventListener('animationend', () => el.remove());
}

// ---------- Petit bonhomme en pixel art (tenue haute visibilité) ----------
// Une lettre = un pixel. Palette : cheveux, peau, barbe, gilet jaune et bandes
// réfléchissantes, haut marine, pantalon jaune, chaussures de sécurité.
const PIX = {
  K: '#1b1b1b', H: '#2a1b12', h: '#43301f', S: '#c98d62', s: '#a8704a', B: '#3a281c', W: '#ffffff', E: '#141414', M: '#7a2e22',
  Y: '#ffe417', y: '#d6bd00', R: '#d9dde2', r: '#9aa1a8', N: '#1f3557', n: '#162741', P: '#f4d20a', p: '#c7a900',
  O: '#202020', o: '#5c5c5c', G: '#8a8f96',
};
const PIX_TETE = [
  '......HHHH......',
  '....HHHHHHHH....',
  '...HHHhhhhHHH...',
  '...HHSSSSSSHH...',
  '...HSSSSSSSSH...',
  '...sSESSSSESs...',
  '...sSSSSSSSSs...',
  '....SSSssSSS....',
  '....BSWWWWSB....',
  '....BBMMMMBB....',
  '.....BBBBBB.....',
  '......SSSS......',
];
const PIX_CORPS_BAS = [ // bras le long du corps
  '...NYYYYYYYYN...',
  '..NNYYyYYyYYNN..',
  '..NNRRRRRRRRNN..',
  '..NnYYYYYYYYnN..',
  '..NnYYyYYyYYnN..',
  '..SSRRRRRRRRSS..',
  '..SSYYYYYYYYSS..',
  '....KKKKKKKK....',
];
const PIX_CORPS_HAUT = [ // bras levés (tient la pancarte)
  '....YYYYYYYY....',
  '....YYyYYyYY....',
  '....RRRRRRRR....',
  '....YYYYYYYY....',
  '....YYyYYyYY....',
  '....RRRRRRRR....',
  '....YYYYYYYY....',
  '....KKKKKKKK....',
];
const PIX_JAMBES = {
  droit: ['....PPPPPPPP....', '....PPP..PPP....', '....PPp..pPP....', '....RRR..RRR....', '....PPP..PPP....', '....PPp..pPP....', '...OOOO..OOOO...', '...GOOo..oOOG...'],
  pas1: ['....PPPPPPPP....', '...PPP...PPP....', '...PPp....pPP...', '..RRR......RRR..', '..PPP......PPP..', '..PPp......pPP..', '.OOOO......OOOO.', '.GOOo......oOOG.'],
  pas2: ['....PPPPPPPP....', '....PPP.PPP.....', '.....PPPPPp.....', '.....RRRRRR.....', '.....PPPPPP.....', '.....PPpPPp.....', '....OOOOOOO.....', '....GOOoOOG.....'],
};
// Bras levés : manches qui montent le long de la tête jusqu'aux mains.
function pixBrasLeves(lignes) {
  const out = lignes.map((l) => l.split(''));
  for (let r = 0; r <= 13; r++) {
    for (const c of [1, 2, 13, 14]) out[r][c] = r <= 1 ? 'S' : (c === 2 || c === 13 ? 'N' : 'n');
  }
  // Épaules : relient les bras levés au gilet.
  for (const r of [12, 13]) for (const c of [3, 12]) out[r][c] = 'N';
  return out.map((l) => l.join(''));
}
function pixFrame(jambes, brasLeves = false) {
  const lignes = [...PIX_TETE, ...(brasLeves ? PIX_CORPS_HAUT : PIX_CORPS_BAS), ...PIX_JAMBES[jambes]];
  return brasLeves ? pixBrasLeves(lignes) : lignes;
}
function pixSvg(lignes, cls) {
  const w = lignes[0].length;
  const rects = [];
  lignes.forEach((l, y) => [...l].forEach((ch, x) => { if (PIX[ch]) rects.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${PIX[ch]}"/>`); }));
  return `<svg class="${cls}" viewBox="0 0 ${w} ${lignes.length}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}
// Police pixel 5×7 pour la pancarte.
const PIX_FONT = {
  "A": [".111.", "1...1", "1...1", "11111", "1...1", "1...1", "1...1"],
  "B": ["1111.", "1...1", "1...1", "1111.", "1...1", "1...1", "1111."],
  "C": [".1111", "1....", "1....", "1....", "1....", "1....", ".1111"],
  "D": ["1111.", "1...1", "1...1", "1...1", "1...1", "1...1", "1111."],
  "E": ["11111", "1....", "1....", "1111.", "1....", "1....", "11111"],
  "F": ["11111", "1....", "1....", "1111.", "1....", "1....", "1...."],
  "G": [".111.", "1...1", "1....", "1.111", "1...1", "1...1", ".111."],
  "H": ["1...1", "1...1", "1...1", "11111", "1...1", "1...1", "1...1"],
  "I": ["111", ".1.", ".1.", ".1.", ".1.", ".1.", "111"],
  "J": ["..111", "...1.", "...1.", "...1.", "1..1.", "1..1.", ".11.."],
  "K": ["1...1", "1..1.", "1.1..", "11...", "1.1..", "1..1.", "1...1"],
  "L": ["1....", "1....", "1....", "1....", "1....", "1....", "11111"],
  "M": ["1...1", "11.11", "1.1.1", "1.1.1", "1...1", "1...1", "1...1"],
  "N": ["1...1", "11..1", "1.1.1", "1..11", "1...1", "1...1", "1...1"],
  "O": [".111.", "1...1", "1...1", "1...1", "1...1", "1...1", ".111."],
  "P": ["1111.", "1...1", "1...1", "1111.", "1....", "1....", "1...."],
  "Q": [".111.", "1...1", "1...1", "1...1", "1.1.1", "1..1.", ".11.1"],
  "R": ["1111.", "1...1", "1...1", "1111.", "1.1..", "1..1.", "1...1"],
  "S": [".1111", "1....", "1....", ".111.", "....1", "....1", "1111."],
  "T": ["11111", "..1..", "..1..", "..1..", "..1..", "..1..", "..1.."],
  "U": ["1...1", "1...1", "1...1", "1...1", "1...1", "1...1", ".111."],
  "V": ["1...1", "1...1", "1...1", "1...1", "1...1", ".1.1.", "..1.."],
  "W": ["1...1", "1...1", "1...1", "1.1.1", "1.1.1", "11.11", "1...1"],
  "X": ["1...1", "1...1", ".1.1.", "..1..", ".1.1.", "1...1", "1...1"],
  "Y": ["1...1", "1...1", ".1.1.", "..1..", "..1..", "..1..", "..1.."],
  "Z": ["11111", "....1", "...1.", "..1..", ".1...", "1....", "11111"],
  "0": [".111.", "1...1", "1..11", "1.1.1", "11..1", "1...1", ".111."],
  "1": [".1.", "11.", ".1.", ".1.", ".1.", ".1.", "111"],
  "2": [".111.", "1...1", "....1", "...1.", "..1..", ".1...", "11111"],
  "3": ["1111.", "....1", "....1", ".111.", "....1", "....1", "1111."],
  "4": ["...1.", "..11.", ".1.1.", "1..1.", "11111", "...1.", "...1."],
  "5": ["11111", "1....", "1111.", "....1", "....1", "1...1", ".111."],
  "6": [".111.", "1....", "1....", "1111.", "1...1", "1...1", ".111."],
  "7": ["11111", "....1", "...1.", "..1..", ".1...", ".1...", ".1..."],
  "8": [".111.", "1...1", "1...1", ".111.", "1...1", "1...1", ".111."],
  "9": [".111.", "1...1", "1...1", ".1111", "....1", "....1", ".111."],
  "'": ["1", "1", ".", ".", ".", ".", "."],
  "!": ["1", "1", "1", "1", "1", ".", "1"],
  "?": [".111.", "1...1", "....1", "...1.", "..1..", ".....", "..1.."],
  "-": ["...", "...", "...", "111", "...", "...", "..."],
  ".": [".", ".", ".", ".", ".", ".", "1"],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
};
function pixPancarte(texte) {
  const sansAccent = texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’`]/g, "'").toUpperCase();
  const glyphes = [...sansAccent].map((c) => PIX_FONT[c] || PIX_FONT[' ']);
  const largeurTexte = glyphes.reduce((a, g) => a + g[0].length + 1, -1);
  const W = largeurTexte + 6;
  const lignes = [];
  const H = 13;
  for (let y = 0; y < H; y++) {
    let l = '';
    for (let x = 0; x < W; x++) l += (y === 0 || y === H - 1 || x === 0 || x === W - 1) ? 'K' : 'C';
    lignes.push(l.split(''));
  }
  let x0 = 3;
  for (const g of glyphes) {
    g.forEach((row, y) => [...row].forEach((v, dx) => { if (v === '1') lignes[y + 3][x0 + dx] = 'X'; }));
    x0 += g[0].length + 1;
  }
  // Manche en bois sous la pancarte.
  for (let y = 0; y < 3; y++) {
    const l = '.'.repeat(W).split('');
    l[Math.floor(W / 2)] = 'b';
    lignes.push(l);
  }
  const pal = { ...PIX, C: '#f6ecd2', X: '#d0101a', b: '#8a5a2b' };
  const rects = [];
  lignes.forEach((l, y) => l.forEach((ch, x) => { if (pal[ch]) rects.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${pal[ch]}"/>`); }));
  return { svg: `<svg class="pix-pancarte" viewBox="0 0 ${W} ${lignes.length}" shape-rendering="crispEdges">${rects.join('')}</svg>`, w: W, h: lignes.length };
}

// Il entre à gauche, marche jusqu'au milieu, lève la pancarte, puis repart à droite.
function playBonhomme(texte = "LET'S GO") {
  return new Promise((resolve) => {
    const echelle = Math.max(5, Math.round(window.innerHeight / 110)); // taille d'un pixel
    const L = 16 * echelle;
    const frames = { pas1: pixSvg(pixFrame('pas1'), 'pix-bonhomme'), droit: pixSvg(pixFrame('droit'), 'pix-bonhomme'), pas2: pixSvg(pixFrame('pas2'), 'pix-bonhomme'), leve: pixSvg(pixFrame('droit', true), 'pix-bonhomme') };
    const panc = pixPancarte(texte);
    const corps = h('div', { class: 'pix-corps', style: { width: `${L}px`, height: `${28 * echelle}px` } });
    const pancarte = h('div', { class: 'pix-panc', style: { width: `${panc.w * echelle}px`, height: `${panc.h * echelle}px`, left: `${(L - panc.w * echelle) / 2}px`, bottom: `${(28 - 2) * echelle}px` } });
    pancarte.innerHTML = panc.svg;
    const perso = h('div', { class: 'pix-perso', style: { width: `${L}px` } }, pancarte, corps);
    const scene = h('div', { class: 'pix-scene', role: 'presentation' }, perso);
    document.body.append(scene);
    const montre = (f) => { corps.innerHTML = frames[f]; };
    const cycle = ['pas1', 'droit', 'pas2', 'droit'];
    let i = 0;
    montre('droit');
    const pas = setInterval(() => { montre(cycle[i++ % 4]); }, 140);
    const milieu = (window.innerWidth - L) / 2;
    const fin = window.innerWidth + 20;
    const marche = (de, a, ms) => perso.animate([{ transform: `translateX(${de}px)` }, { transform: `translateX(${a}px)` }], { duration: ms, fill: 'forwards' }).finished;
    (async () => {
      await marche(-L - 20, milieu, 2600);
      clearInterval(pas);
      montre('leve');
      pancarte.classList.add('on');
      await new Promise((r) => setTimeout(r, 2600));
      pancarte.classList.remove('on');
      montre('droit');
      i = 0;
      const pas2 = setInterval(() => { montre(cycle[i++ % 4]); }, 140);
      await marche(milieu, fin, 2200);
      clearInterval(pas2);
      scene.remove();
      resolve();
    })();
  });
}

// ---------- Sons au clic (menu secret) : une règle = zone + personne + son ----------
// Ordre = priorité : la première zone qui correspond au clic l'emporte.
const ZONES_SON = [
  ['agent', 'Nom de l’agent (absents)', '#form [data-agent]'],
  ['motif', 'Motif d’absence', '#form [data-bind$=".motif"]'],
  ['responsable', 'Responsable du service', '#form [data-bind="responsable"]'],
  ['obs', 'Observations (saisie et texte)', '#qa-texte, #form [data-bind^="observations."]'],
  ['tache', 'Nouvelle tâche pour la relève', '#task-new'],
  ['entrees', 'Entrées (plateaux, PL, tonnage)', '#form [data-bind^="entrees."]'],
  ['sorties', 'Sorties (nombre, tonnage)', '#form [data-bind^="sorties."], #form [data-bind^="sortiesExtra."]'],
  ['bennes', 'Bennes (%)', '#form [data-bind^="bennes."]'],
  ['plateaux', 'Plateaux (%)', '#form [data-bind^="plateaux."]'],
  ['nc', 'Déchets non conformes', '#form [data-bind^="nonConformes."]'],
  ['stockage', 'Stockage', '#form [data-bind^="stockage."], #form .stk-etat button'],
  ['commandes', 'Commandes', '#form [data-bind^="commandes."], #form .cmd-recue'],
  ['onglets', 'Onglets du haut', '.view-btn'],
  ['cloture', 'Clôturer / Rouvrir le service', '.service-banner .btn.solid, .service-banner .btn:has(svg)'],
  ['champs', 'N’importe quelle case de saisie', 'input, textarea, select'],
  ['boutons', 'N’importe quel bouton', 'button'],
  ['partout', 'N’importe où (chaque clic)', '*'],
];
const zoneSon = (id) => ZONES_SON.find((z) => z[0] === id);

// Règles chargées pour la personne connectée : [{ zone, url }], dans l'ordre des zones.
let sonsActifs = [];
function sonPourClic(cible) {
  if (!cible || !cible.closest || cible.closest('dialog, .fun-intro, .ecran-bleu, .coin-discret')) return null;
  for (const r of sonsActifs) {
    const z = zoneSon(r.zone);
    if (z && r.url && cible.closest(z[2])) return r.url;
  }
  return null;
}
