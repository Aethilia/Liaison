'use strict';

/* global h, call, api, toast */
// Accès caché au jeu : pour les deux joueurs, un clic sur leur nom demande
// leur code secret, puis une fenêtre en pixel art propose « Travail » ou
// « Jeu ». Pour tous les autres, rien ne change.

// ---------- Petit moteur de dessin pixel art ----------

const JEU_PIX = {
  '.': null,
  k: '#14121c', K: '#2b2838', g: '#5c6270', G: '#8a93a3', w: '#e8ecf2', W: '#ffffff',
  s: '#f2c39b', S: '#d99a6c', b: '#2f6fd6', B: '#7fb2ff', r: '#d83a3a', R: '#ff7a6b',
  v: '#2f9e44', V: '#8ce99a', y: '#f7c948', Y: '#fff3a3', o: '#f28c38', O: '#ffb870',
  p: '#7048e8', P: '#b197fc', m: '#8b5a2b', M: '#c08552', c: '#3fb8c9', C: '#a5e9f2',
};

function jpx(ctx, x, y, w, hgt, c) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, hgt);
}

function sprite(ctx, lignes, x, y, flip = false) {
  lignes.forEach((l, j) => [...l].forEach((ch, i) => {
    const c = JEU_PIX[ch];
    if (c) jpx(ctx, flip ? x + l.length - 1 - i : x + i, y + j, 1, 1, c);
  }));
}

const HEROS = {
  chevalier: [
    '..GGGG..',
    '.GGGGGG.',
    '.GkGGkG.',
    '.GsssssG',
    '..ssss..',
    '.bbBBbb.',
    'wbbBBbbG',
    'wbbbbbbG',
    'w.bbbb.G',
    '..b..b..',
    '..b..b..',
    '.kk..kk.',
  ],
  archere: [
    '..vvvv..',
    '.vvvvvv.',
    '.vkssks.',
    '..ssss.m',
    '..vvvv.m',
    '.vvVVvvm',
    'svvVVvvm',
    '..vvvv.m',
    '..vvvv..',
    '..m..m..',
    '..m..m..',
    '.kk..kk.',
  ],
  mage: [
    '...pp...',
    '..pppp..',
    '.pppppp.',
    'ppkssksp',
    '..ssss.Y',
    '.rrrrr.m',
    'srrRrrrm',
    '.rrRrr.m',
    '.rrrrrrm',
    'rrrrrrrm',
    'rrrrrrr.',
    '.kk..kk.',
  ],
  pretre: [
    '..wwww..',
    '.wwwwww.',
    '.wkssksw',
    '..ssss..',
    '.wwyyww.',
    'swwyywws',
    '.wyyyyw.',
    '.wwyyww.',
    '.wwwwww.',
    '.wwwwww.',
    '..w..w..',
    '.kk..kk.',
  ],
};
const SLIME = [
  '...VVVV...',
  '..VvvvvV..',
  '.VvvvvvvV.',
  'VvWkvvWkvV',
  'VvvvvvvvvV',
  'VvvvvvvvvV',
  '.vvvvvvvv.',
];

// Scène de la fenêtre de choix : 192 × 108 pixels, quai à gauche, donjon à droite.
function dessinerChoix(ctx, t) {
  const W = 192;
  const H = 108;
  ctx.clearRect(0, 0, W, H);
  // --- Gauche : le quai au petit matin ---
  const ciel = ['#ffd8a8', '#ffc9a0', '#ffb59a', '#a5d8ff', '#74c0fc'];
  ciel.forEach((c, i) => jpx(ctx, 0, i * 12, 96, 12, c));
  jpx(ctx, 0, 60, 96, 4, '#74c0fc');
  jpx(ctx, 14, 12, 10, 10, '#fff3a3'); // soleil
  jpx(ctx, 12, 14, 14, 6, '#fff3a3');
  jpx(ctx, 16, 10, 6, 14, '#fff3a3');
  // nuages qui glissent
  const nx = (t / 120) % 120;
  [[nx - 20, 8], [nx + 30, 18]].forEach(([x, y]) => { jpx(ctx, (x % 120) - 10, y, 16, 3, '#ffffff'); jpx(ctx, (x % 120) - 6, y - 2, 8, 2, '#ffffff'); });
  // hangar
  jpx(ctx, 40, 26, 56, 38, '#8a93a3');
  jpx(ctx, 38, 22, 60, 5, '#5c6270');
  for (let i = 0; i < 6; i += 1) jpx(ctx, 50, 34 + i * 5, 26, 4, i % 2 ? '#c5ccd6' : '#aab3c0'); // porte roulante
  jpx(ctx, 80, 36, 10, 8, '#a5d8ff');
  jpx(ctx, 84, 36, 1, 8, '#5c6270');
  // sol / quai
  jpx(ctx, 0, 64, 96, 44, '#4b5262');
  jpx(ctx, 0, 64, 96, 3, '#f7c948');
  for (let x = 2; x < 96; x += 14) jpx(ctx, x, 86, 8, 2, '#f8f9fa');
  // bennes
  const benne = (x, y, c, cc) => { jpx(ctx, x, y, 22, 12, c); jpx(ctx, x - 2, y - 2, 26, 3, cc); jpx(ctx, x + 2, y + 12, 3, 2, '#14121c'); jpx(ctx, x + 17, y + 12, 3, 2, '#14121c'); };
  benne(6, 54, '#2f9e44', '#237032');
  benne(34, 56, '#f7c948', '#c99a1c');
  // camion
  const cx = 52;
  jpx(ctx, cx, 70, 30, 14, '#cfd5de');
  jpx(ctx, cx + 1, 71, 28, 2, '#e8ecf2');
  jpx(ctx, cx + 30, 73, 12, 11, '#f28c38');
  jpx(ctx, cx + 33, 75, 7, 4, '#a5e9f2');
  jpx(ctx, cx, 84, 42, 2, '#2b2838');
  [cx + 4, cx + 22, cx + 35].forEach((x) => { jpx(ctx, x, 85, 5, 5, '#14121c'); jpx(ctx, x + 2, 87, 1, 1, '#8a93a3'); });
  // main courante (classeur) posée sur une palette
  jpx(ctx, 10, 92, 18, 3, '#c08552');
  jpx(ctx, 12, 80, 14, 12, '#ffffff');
  jpx(ctx, 12, 80, 14, 2, '#2f6fd6');
  for (let i = 0; i < 4; i += 1) jpx(ctx, 14, 84 + i * 2, 10 - (i % 2) * 3, 1, '#8a93a3');

  // --- Droite : le donjon et la faille ---
  jpx(ctx, 96, 0, 96, H, '#1d1a2b');
  for (let y = 0; y < 72; y += 6) {
    for (let x = 96 + ((y / 6) % 2) * 6; x < W; x += 12) jpx(ctx, x, y, 11, 5, '#2b2740');
  }
  jpx(ctx, 96, 72, 96, 36, '#24203a');
  for (let x = 96; x < W; x += 8) jpx(ctx, x, 72, 7, 1, '#3a3456');
  // faille : anneaux qui pulsent
  const pulse = Math.sin(t / 300) * 2;
  const fx = 160;
  const fy = 40;
  [[22 + pulse, 28 + pulse, '#3b1d7a'], [18 + pulse, 24 + pulse, '#5f3dc4'], [13 + pulse / 2, 18 + pulse / 2, '#9775fa'], [8, 12, '#d0bfff'], [3, 6, '#ffffff']].forEach(([rx, ry, c]) => {
    for (let dy = -ry; dy <= ry; dy += 1) {
      const lx = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
      jpx(ctx, fx - lx / 2, fy + dy, lx, 1, c);
    }
  });
  // étincelles
  for (let i = 0; i < 8; i += 1) {
    const a = t / 700 + i * 0.8;
    jpx(ctx, Math.round(fx + Math.cos(a) * 18), Math.round(fy + Math.sin(a) * 22), 1, 1, i % 2 ? '#d0bfff' : '#ffffff');
  }
  // torches
  [104, 186].forEach((x, i) => {
    jpx(ctx, x, 30, 2, 8, '#8b5a2b');
    const f = Math.floor(t / 160 + i) % 2;
    jpx(ctx, x - 1, 25 + f, 4, 5 - f, '#f28c38');
    jpx(ctx, x, 26 + f, 2, 3, '#fff3a3');
  });
  // héros devant la faille (petit rebond chacun son tour)
  const rebond = (i) => (Math.floor(t / 250 + i) % 4 === 0 ? -1 : 0);
  sprite(ctx, HEROS.chevalier, 112, 78 + rebond(0));
  sprite(ctx, HEROS.archere, 122, 80 + rebond(1));
  sprite(ctx, HEROS.mage, 132, 78 + rebond(2));
  sprite(ctx, HEROS.pretre, 102, 82 + rebond(3));
  sprite(ctx, SLIME, 168, 86 + (Math.floor(t / 400) % 2));
  // séparation en escalier
  for (let y = 0; y < H; y += 2) jpx(ctx, 95 + ((y / 2) % 2), y, 2, 2, '#14121c');
}

function animer(canvas, dessin) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let stop = false;
  let dernier = 0;
  const boucle = (t) => {
    if (stop || !canvas.isConnected) return;
    if (t - dernier > 60) { dessin(ctx, t); dernier = t; }
    requestAnimationFrame(boucle);
  };
  requestAnimationFrame(boucle);
  return () => { stop = true; };
}

// ---------- Fenêtres ----------

function dialogueJeu(classe, contenu) {
  const dlg = h('dialog', { class: `jeu-dialog ${classe}` }, contenu);
  document.body.append(dlg);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
  dlg.showModal();
  return dlg;
}

// Code secret : création (deux fois) ou saisie. Résout 'ok', 'travail' ou null.
function demanderCode(nom, { creer }) {
  return new Promise((resolve) => {
    const code = h('input', { type: 'password', class: 'jeu-code', maxLength: 20, placeholder: creer ? 'Nouveau code' : 'Code secret', autocomplete: 'off' });
    const code2 = creer ? h('input', { type: 'password', class: 'jeu-code', maxLength: 20, placeholder: 'Encore une fois', autocomplete: 'off' }) : null;
    const msg = h('p', { class: 'jeu-msg' }, '');
    let fini = false;
    const finir = (v) => { fini = true; resolve(v); dlg.close(); };
    const valider = async () => {
      if (creer) {
        if (code.value.length < 4) { msg.textContent = 'Au moins 4 caractères.'; code.focus(); return; }
        if (code.value !== code2.value) { msg.textContent = 'Les deux codes ne sont pas pareils.'; code2.focus(); return; }
        try {
          await call(api.jeuDefinir(nom, code.value, ''));
          finir('ok');
        } catch (err) {
          msg.textContent = err.message;
        }
        return;
      }
      const ok = await call(api.jeuVerifier(nom, code.value)).catch(() => false);
      if (ok) finir('ok');
      else {
        msg.textContent = 'Code incorrect.';
        code.value = '';
        code.classList.remove('secoue');
        void code.offsetWidth;
        code.classList.add('secoue');
        code.focus();
      }
    };
    for (const c of [code, code2].filter(Boolean)) c.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); valider(); } });
    const dlg = dialogueJeu('jeu-code-dlg', h('div', { class: 'jeu-code-corps' },
      h('div', { class: 'jeu-cadenas' }, h('i'), h('b')),
      h('h2', {}, creer ? 'Choisis ton code secret' : 'Code secret'),
      h('p', { class: 'jeu-sous' }, creer ? 'Il te sera demandé à chaque fois que tu cliques sur ton nom.' : nom),
      code, code2, msg,
      h('button', { class: 'jeu-btn', onclick: valider }, creer ? 'Enregistrer' : 'Entrer'),
      h('button', { class: 'jeu-lien', onclick: () => finir('travail') }, 'Continuer vers le travail')));
    dlg.addEventListener('close', () => { if (!fini) resolve(null); });
    code.focus();
  });
}

// Changement de code (ancien puis nouveau, deux fois).
function changerCode(nom) {
  return new Promise((resolve) => {
    const ancien = h('input', { type: 'password', class: 'jeu-code', maxLength: 20, placeholder: 'Code actuel', autocomplete: 'off' });
    const code = h('input', { type: 'password', class: 'jeu-code', maxLength: 20, placeholder: 'Nouveau code', autocomplete: 'off' });
    const code2 = h('input', { type: 'password', class: 'jeu-code', maxLength: 20, placeholder: 'Encore une fois', autocomplete: 'off' });
    const msg = h('p', { class: 'jeu-msg' }, '');
    const valider = async () => {
      if (code.value.length < 4) { msg.textContent = 'Au moins 4 caractères.'; code.focus(); return; }
      if (code.value !== code2.value) { msg.textContent = 'Les deux codes ne sont pas pareils.'; code2.focus(); return; }
      try {
        await call(api.jeuDefinir(nom, code.value, ancien.value));
        toast('Code secret changé.');
        dlg.close();
      } catch (err) {
        msg.textContent = err.message;
      }
    };
    for (const c of [ancien, code, code2]) c.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); valider(); } });
    const dlg = dialogueJeu('jeu-code-dlg', h('div', { class: 'jeu-code-corps' },
      h('div', { class: 'jeu-cadenas' }, h('i'), h('b')),
      h('h2', {}, 'Changer mon code'),
      ancien, code, code2, msg,
      h('button', { class: 'jeu-btn', onclick: valider }, 'Enregistrer'),
      h('button', { class: 'jeu-lien', onclick: () => dlg.close() }, 'Annuler')));
    dlg.addEventListener('close', () => resolve());
    ancien.focus();
  });
}

// Fenêtre de choix : l'image coupée en deux. Résout 'travail', 'jeu', 'code' ou null.
function fenetreChoix(nom) {
  return new Promise((resolve) => {
    let choix = null;
    const canvas = h('canvas', { class: 'jeu-scene', width: 192, height: 108 });
    const stop = animer(canvas, dessinerChoix);
    const moitie = (id, titre, sous) => h('button', { class: `jeu-moitie ${id}`, onclick: () => { choix = id; dlg.close(); } },
      h('span', { class: 'jeu-etiquette' }, h('b', {}, titre), h('small', {}, sous)));
    const dlg = dialogueJeu('jeu-choix-dlg', h('div', { class: 'jeu-choix' },
      h('div', { class: 'jeu-choix-titre' }, `Salut ${nom.split(' ')[0]} !`, h('small', {}, 'On fait quoi ?')),
      h('div', { class: 'jeu-cadre' }, canvas, moitie('travail', 'TRAVAIL', 'Main courante'), moitie('jeu', 'JEU', 'La guilde')),
      h('div', { class: 'jeu-choix-pied' },
        h('button', { class: 'jeu-lien', onclick: () => { choix = 'code'; dlg.close(); } }, 'Changer mon code secret'))));
    dlg.addEventListener('close', () => { stop(); resolve(choix); });
  });
}

// Écran du jeu (en construction pour l'instant). Résout au retour.
function ecranJeu(nom) {
  return new Promise((resolve) => {
    // Le côté « donjon » de la scène, en grand.
    const canvas = h('canvas', { class: 'jeu-scene grand', width: 96, height: 108 });
    const stop = animer(canvas, (ctx, t) => {
      ctx.save();
      ctx.translate(-96, 0);
      dessinerChoix(ctx, t);
      ctx.restore();
    });
    const fermer = () => { stop(); document.removeEventListener('keydown', echap); ecran.remove(); resolve(); };
    const echap = (e) => { if (e.key === 'Escape') fermer(); };
    const ecran = h('div', { class: 'jeu-ecran' },
      h('div', { class: 'jeu-ecran-titre' }, 'LA GUILDE', h('small', {}, `Joueur : ${nom}`)),
      canvas,
      h('p', { class: 'jeu-ecran-txt' }, 'En construction · on le développe ensemble'),
      h('button', { class: 'jeu-btn', onclick: fermer }, '◀ Retour'));
    document.body.append(ecran);
    document.addEventListener('keydown', echap);
  });
}

// Point d'entrée, appelé au clic sur un nom. Résout 'travail' (suite normale)
// ou null (annulé : on reste sur le choix du responsable).
async function accesJeu(nom) {
  const st = await call(api.jeuStatut(nom)).catch(() => ({ joueur: false }));
  if (!st.joueur) return 'travail';
  const r = await demanderCode(nom, { creer: !st.code });
  if (r !== 'ok') return r;
  for (;;) {
    const c = await fenetreChoix(nom);
    if (c === 'jeu') await ecranJeu(nom);
    else if (c === 'code') await changerCode(nom);
    else return c;
  }
}
