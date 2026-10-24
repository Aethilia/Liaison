'use strict';

/* global h, call, api, toast */
// La Guilde — interface : accueil, départ, préparation (placement sur le
// plateau hexagonal), combat animé, boutique, carrefours, événements, feu de
// camp, récompenses, enchères, fin de partie. Les homunculus sont des jetons
// neutres numérotés en attendant les vrais visuels.

(function () {
  const G = window.Guilde;
  const R = G.Run;
  const UI = G.UI = {};

  const W = 70; // largeur d'un hexagone
  const HX = W * 1.1547;
  const PAS_Y = HX * 0.75;
  const RARETES = { c: ['Commun', '#adb5bd'], r: ['Rare', '#4dabf7'], e: ['Épique', '#b197fc'], l: ['Légendaire', '#ffa94d'], unique: ['Départ', '#63e6be'] };
  const NOM_ECRAN = { boutique: 'Boutique', carrefour: 'Carrefour', feu: 'Feu de camp', enchere: 'Enchères', recompense: 'Récompense', preparation: 'Préparation' };

  let S = null; // { nom, profil, r, racine, resolve, sel, combat, anim, vitesse }

  // ---------- Sauvegarde ----------
  let minuterie = null;
  function sauver(immediat = false) {
    clearTimeout(minuterie);
    // Au menu (S.r vide), la partie en cours reste celle du profil.
    if (S.r) S.profil.partie = S.r.fini ? null : S.r;
    const donnees = { partie: S.profil.partie, diffMax: S.profil.diffMax };
    const go = () => call(api.jeuSauverProfil(S.nom, donnees)).catch((e) => toast(`Sauvegarde du jeu : ${e.message}`));
    if (immediat) return go();
    minuterie = setTimeout(go, 400);
    return null;
  }

  // ---------- Petits composants ----------
  const couleurClasse = (cl) => (G.CLASSES[cl] || { couleur: '#868e96' }).couleur;
  const nomClasse = (cl) => (G.CLASSES[cl] || { nom: 'Monstre' }).nom;
  const pastille = (rarete, txt) => h('span', { class: 'gd-rar', style: { '--c': RARETES[rarete][1] } }, txt || RARETES[rarete][0]);

  function jeton(def, { rang = null, classes = null, petit = false, ennemi = false, boss = false } = {}) {
    const cl = classes || def.classes || ['monstre'];
    return h('div', { class: `gd-jeton${petit ? ' petit' : ''}${ennemi ? ' ennemi' : ''}${boss ? ' boss' : ''}`, style: { '--c': ennemi ? '#e03131' : couleurClasse(cl[0]), '--c2': cl[1] ? couleurClasse(cl[1]) : 'transparent' } },
      h('span', { class: 'gd-num' }, ennemi ? (def.nom || '?').slice(0, 2).toUpperCase() : def.num),
      rang ? h('span', { class: `gd-rang r${rang}` }, rang) : null);
  }

  const resumeHeros = (r, hr) => {
    const def = G.heros(hr.id);
    const f = R.ficheHeros(r, hr);
    const spec = hr.spec && def.specs.find((s) => s.id === hr.spec);
    return [`${def.nom} — rang ${hr.rang} — ${f.classes.map(nomClasse).join(' / ')}`,
      `PV ${f.stats.pv} · Att ${Math.round(f.stats.atk)} · Déf ${Math.round(f.stats.def)} · Mag ${Math.round(f.stats.mag)} · Vit ${f.stats.vit.toFixed(2)} · Portée ${f.stats.portee}`,
      `${def.comp.nom} : ${def.comp.desc}`, spec ? `Spécialisation : ${spec.nom} — ${spec.desc}` : ''].filter(Boolean).join('\n');
  };

  function carteHeros(id, { prix = null, onclick, choisi = false, desactive = false, rang = 'C' } = {}) {
    const def = G.heros(id);
    return h('button', { class: `gd-carte${choisi ? ' choisi' : ''}`, disabled: desactive, onclick, title: def.specs.map((s) => `• ${s.nom}${s.classe2 ? ` (+${nomClasse(s.classe2)})` : ''} : ${s.desc}`).join('\n') },
      h('div', { class: 'gd-carte-haut' }, jeton(def, { rang }), h('div', {}, h('b', {}, def.nom), h('small', { style: { color: couleurClasse(def.classes[0]) } }, nomClasse(def.classes[0])))),
      h('div', { class: 'gd-carte-stats' }, `PV ${def.stats.pv} · Att ${def.stats.atk} · Mag ${def.stats.mag} · Portée ${def.stats.portee}`),
      h('div', { class: 'gd-carte-txt' }, h('b', {}, def.comp.nom), ` : ${def.comp.desc}`),
      prix != null ? h('div', { class: 'gd-prix' }, `${prix} ◆`) : null);
  }
  function carteObjet(id, { prix = null, onclick, desactive = false } = {}) {
    const o = G.objet(id);
    return h('button', { class: 'gd-carte petite', disabled: desactive, onclick },
      h('div', { class: 'gd-carte-haut' }, h('b', {}, o.nom), pastille(o.rarete)),
      h('div', { class: 'gd-carte-txt' }, o.desc),
      prix != null ? h('div', { class: 'gd-prix' }, `${prix} ◆`) : null);
  }
  function carteRelique(id, { prix = null, onclick, desactive = false, choisi = false } = {}) {
    const x = G.relique(id);
    return h('button', { class: `gd-carte petite${choisi ? ' choisi' : ''}`, disabled: desactive, onclick },
      h('div', { class: 'gd-carte-haut' }, h('b', {}, x.nom), pastille(x.rarete)),
      h('div', { class: 'gd-carte-txt' }, x.desc),
      prix != null ? h('div', { class: 'gd-prix' }, `${prix} ◆`) : null);
  }

  const bouton = (txt, onclick, cls = '') => h('button', { class: `jeu-btn gd-btn ${cls}`, onclick }, txt);

  // ---------- Plateau ----------
  const xy = (p) => ({ x: p.c * W + (p.l & 1 ? W / 2 : 0), y: p.l * PAS_Y });
  function plateau({ cases = true, surCase = null, casesActives = null } = {}) {
    const el = h('div', { class: 'gd-plateau', style: { width: `${G.COLS * W + W / 2}px`, height: `${(G.LIGNES - 1) * PAS_Y + HX}px` } });
    if (cases) {
      for (let l = 0; l < G.LIGNES; l++) {
        for (let c = 0; c < G.COLS; c++) {
          const { x, y } = xy({ c, l });
          const active = casesActives ? casesActives({ c, l }) : false;
          el.append(h('div', {
            class: `gd-case${l >= 3 ? ' allie' : ' adverse'}${active ? ' active' : ''}`, style: { left: `${x}px`, top: `${y}px`, width: `${W}px`, height: `${HX}px` },
            onclick: surCase ? () => surCase({ c, l }) : null,
          }));
        }
      }
    }
    return el;
  }
  const poser = (el, p) => { const { x, y } = xy(p); el.style.left = `${x}px`; el.style.top = `${y}px`; };

  // ---------- Cadre général ----------
  function cadre(contenu, { sansEntete = false } = {}) {
    const r = S.r;
    const entete = sansEntete || !r ? null : h('div', { class: 'gd-entete' },
      h('b', { class: 'gd-logo' }, 'LA GUILDE'),
      h('span', { class: 'gd-etage' }, `${R.titreEtage(r)}${S.combat ? ' · Combat' : NOM_ECRAN[r.ecran.type] ? ` · ${NOM_ECRAN[r.ecran.type]}` : ''}`),
      h('span', { class: 'gd-eclats', title: 'Éclats' }, `◆ ${r.eclats}`),
      h('span', { class: `gd-rembob${r.rembobinage.dispo ? ' ok' : ''}`, title: r.rembobinage.dispo ? `Rembobinage d'urgence prêt (${r.rembobinage.reserve} éclats en réserve) : la première défaite ne termine pas la partie.` : 'Rembobinage d\'urgence utilisé (rechargeable au feu de camp).' }, `⟲ ${r.rembobinage.dispo ? r.rembobinage.reserve : '—'}`),
      h('span', { class: 'gd-reliques' }, r.reliques.map((id) => { const x = G.relique(id); return h('i', { style: { '--c': RARETES[x.rarete][1] }, title: `${x.nom} : ${x.desc}` }, x.nom.slice(0, 1)); }),
        r.reliqueTemp ? h('i', { class: 'temp', title: `Ce combat : ${G.relique(r.reliqueTemp).nom}` }, '✦') : null),
      h('span', { class: 'spacer' }),
      h('button', { class: 'jeu-lien', onclick: () => { sauver(true); S.r = null; rendre(); } }, 'Menu'));
    S.racine.replaceChildren(h('div', { class: 'gd-cadre' }, entete, h('div', { class: 'gd-corps' }, contenu)));
  }

  // ---------- Gestion de la guilde (préparation, boutique) ----------
  function panneauGuilde({ vente = false, ennemis = null } = {}) {
    const r = S.r;
    const sel = S.sel && r.heros.find((x) => x.uid === S.sel);
    const surCase = (p) => {
      if (p.l < 3) return;
      const occupant = r.heros.find((x) => x.pos && x.pos.c === p.c && x.pos.l === p.l);
      if (sel && sel !== occupant) {
        if (!R.deplacerHeros(r, sel, p)) toast(`${r.places} héros maximum en combat (plus de places : reliques d'enchères).`);
        sauver();
      } else S.sel = occupant ? (S.sel === occupant.uid ? null : occupant.uid) : null;
      rendre();
    };
    const plat = plateau({ surCase, casesActives: (p) => G.LIGNES_ALLIES.includes(p.l) });
    for (const e of ennemis || []) {
      const j = jeton(e, { ennemi: true, boss: e.boss });
      j.title = `${e.nom}\nPV ${e.stats.pv} · Att ${e.stats.atk} · Déf ${Math.round(e.stats.def)}${e.comp ? `\n${e.comp.nom}` : ''}`;
      j.classList.add('gd-pose');
      poser(j, e.pos);
      plat.append(j);
    }
    for (const hr of R.enCombat(r)) {
      const def = G.heros(hr.id);
      const j = jeton(def, { rang: hr.rang, classes: R.classesHeros(hr) });
      j.classList.add('gd-pose');
      if (S.sel === hr.uid) j.classList.add('sel');
      j.title = resumeHeros(r, hr);
      j.onclick = (ev) => { ev.stopPropagation(); surCase(hr.pos); };
      poser(j, hr.pos);
      plat.append(j);
    }
    const banc = h('div', { class: 'gd-banc', onclick: () => { if (sel && sel.pos) { sel.pos = null; sauver(); rendre(); } } },
      h('div', { class: 'gd-titre-bloc' }, `Réserve (${R.auBanc(r).length}) · en combat ${R.enCombat(r).length}/${r.places}`),
      h('div', { class: 'gd-banc-liste' }, R.auBanc(r).length ? R.auBanc(r).map((hr) => {
        const j = jeton(G.heros(hr.id), { rang: hr.rang, classes: R.classesHeros(hr), petit: true });
        if (S.sel === hr.uid) j.classList.add('sel');
        j.title = resumeHeros(r, hr);
        j.onclick = (ev) => { ev.stopPropagation(); S.sel = S.sel === hr.uid ? null : hr.uid; rendre(); };
        return j;
      }) : h('small', { class: 'gd-vide' }, 'Cliquer un héros puis ici pour le mettre en réserve. Les effets « Renfort » marchent depuis la réserve.')));
    const inventaire = h('div', { class: 'gd-inventaire' },
      h('div', { class: 'gd-titre-bloc' }, `Inventaire (${r.objets.length}/${R.MAX_INVENTAIRE})`),
      r.objets.length ? r.objets.map((id, i) => {
        const o = G.objet(id);
        return h('button', { class: 'gd-objet', style: { '--c': RARETES[o.rarete][1] }, title: `${o.desc}${sel ? '\nCliquer pour équiper le héros sélectionné' : '\nSélectionner un héros pour l\'équiper'}`, onclick: () => { if (!sel) return toast('Sélectionnez d\'abord un héros.'); if (!R.equiper(r, sel, i)) toast('2 objets maximum par héros.'); sauver(); rendre(); return null; } }, o.nom);
      }) : h('small', { class: 'gd-vide' }, 'Aucun objet.'));
    return h('div', { class: 'gd-guilde' }, h('div', { class: 'gd-plateau-cadre' }, plat), h('div', { class: 'gd-cote' }, banc, sel ? ficheSelection(sel, { vente }) : h('div', { class: 'gd-aide' }, 'Cliquer un héros pour voir sa fiche, le déplacer (puis cliquer une case) ou l\'équiper.'), inventaire));
  }

  function ficheSelection(hr, { vente }) {
    const r = S.r;
    const def = G.heros(hr.id);
    const f = R.ficheHeros(r, hr);
    const spec = hr.spec && def.specs.find((s) => s.id === hr.spec);
    return h('div', { class: 'gd-fiche' },
      h('div', { class: 'gd-fiche-haut' }, jeton(def, { rang: hr.rang, classes: f.classes }), h('div', {}, h('b', {}, def.nom), h('small', {}, f.classes.map(nomClasse).join(' / ')))),
      h('div', { class: 'gd-stats' }, [['PV', f.stats.pv], ['Att', f.stats.atk], ['Déf', f.stats.def], ['Mag', f.stats.mag], ['Vit', f.stats.vit.toFixed(2)], ['Portée', f.stats.portee], ['Crit', `${f.stats.crit} %`], ['Mana', `${f.stats.mana} (+${f.stats.regen}/2 s)`]]
        .map(([k, v]) => h('span', {}, h('small', {}, k), typeof v === 'number' ? Math.round(v) : v))),
      h('p', {}, h('b', {}, def.comp.nom), ` : ${def.comp.desc}`),
      spec ? h('p', {}, h('b', {}, `Spé. ${spec.nom}`), ` : ${spec.desc}`) : h('p', { class: 'gd-vide' }, 'Spécialisation au rang B (achetez un doublon ou passez au feu de camp).'),
      hr.ups.map((id) => { const a = G.AMELIORATIONS.find((x) => x.id === id); return h('p', {}, pastille(a.rarete, a.nom), ` ${a.desc}`); }),
      h('div', { class: 'gd-titre-bloc' }, `Objets (${hr.objets.length}/${R.MAX_OBJETS_HEROS})`),
      hr.objets.map((id, i) => { const o = G.objet(id); return h('button', { class: 'gd-objet', style: { '--c': RARETES[o.rarete][1] }, title: `${o.desc}\nCliquer pour retirer`, onclick: () => { R.desequiper(r, hr, i); sauver(); rendre(); } }, `${o.nom} ✕`); }),
      h('div', { class: 'gd-fiche-actions' },
        hr.pos ? bouton('En réserve', () => { hr.pos = null; sauver(); rendre(); }, 'petit') : null,
        vente ? bouton(`Vendre +${R.prixVente(hr)} ◆`, () => { R.vendreHeros(r, hr); S.sel = null; sauver(); rendre(); }, 'petit rouge') : null));
  }

  // ---------- Choix en attente (spécialisation / amélioration) ----------
  function choixEnAttente() {
    const r = S.r;
    const a = r.enAttente[0];
    const hr = r.heros.find((x) => x.uid === a.uid);
    if (!hr) { r.enAttente.shift(); return rendre(); }
    const def = G.heros(hr.id);
    const cartes = a.type === 'spec'
      ? a.options.map((id) => { const s = def.specs.find((x) => x.id === id); return h('button', { class: 'gd-carte', onclick: () => { R.resoudreAttente(r, id); sauver(); rendre(); } }, h('div', { class: 'gd-carte-haut' }, h('b', {}, s.nom), s.classe2 ? h('span', { class: 'gd-rar', style: { '--c': couleurClasse(s.classe2) } }, `+ ${nomClasse(s.classe2)}`) : null), h('div', { class: 'gd-carte-txt' }, s.desc)); })
      : a.options.map((id) => { const x = G.AMELIORATIONS.find((y) => y.id === id); return h('button', { class: 'gd-carte petite', onclick: () => { R.resoudreAttente(r, id); sauver(); rendre(); } }, h('div', { class: 'gd-carte-haut' }, h('b', {}, x.nom), pastille(x.rarete)), h('div', { class: 'gd-carte-txt' }, x.desc), h('small', { style: { color: couleurClasse(x.classe) } }, nomClasse(x.classe))); });
    cadre(h('div', { class: 'gd-centre' },
      jeton(def, { rang: hr.rang, classes: R.classesHeros(hr) }),
      h('h2', {}, a.type === 'spec' ? `${def.nom} passe au rang B : choisis sa spécialisation` : `${def.nom} passe au rang ${hr.rang} : choisis une amélioration`),
      h('div', { class: 'gd-cartes' }, cartes)));
    return null;
  }

  // ---------- Écrans ----------
  function ecranAccueil() {
    const p = S.profil;
    let diff = Math.min(p.diffMax, S.diffChoisie || p.diffMax);
    const choixDiff = h('div', { class: 'gd-diffs' }, Array.from({ length: 8 }, (_, i) => i + 1).map((d) => h('button', {
      class: `gd-diff${d === diff ? ' on' : ''}`, disabled: d > p.diffMax, title: d > p.diffMax ? 'Gagnez une partie au niveau précédent pour débloquer' : `Difficulté ${d} : ennemis +${(d - 1) * 12} %`,
      onclick: () => { S.diffChoisie = d; rendre(); },
    }, d)));
    const scores = h('div', { class: 'gd-scores' }, h('div', { class: 'gd-titre-bloc' }, 'Meilleurs scores'), S.scores && S.scores.length
      ? h('table', {}, h('tbody', {}, S.scores.slice(0, 8).map((s, i) => h('tr', {}, h('td', {}, `${i + 1}.`), h('td', {}, s.joueur), h('td', { class: 'num' }, s.score), h('td', {}, s.gagne ? (s.endless ? `Endless ${s.endless}` : 'Victoire') : `Étage ${s.etage}`), h('td', {}, `Diff. ${s.difficulte}`)))))
      : h('small', { class: 'gd-vide' }, 'Aucune partie terminée pour l\'instant.'));
    cadre(h('div', { class: 'gd-accueil' },
      h('div', { class: 'jeu-ecran-titre' }, 'LA GUILDE', h('small', {}, `Joueur : ${S.nom}`)),
      p.partie ? bouton(`Continuer (${R.titreEtage(p.partie)})`, () => { S.r = p.partie; S.sel = null; rendre(); }) : null,
      h('div', { class: 'gd-nouvelle' }, h('span', {}, 'Difficulté'), choixDiff,
        bouton('Nouvelle partie', () => {
          if (p.partie && !window.confirm('Abandonner la partie en cours ?')) return;
          S.r = R.nouvellePartie(S.nom, diff);
          p.partie = S.r;
          S.sel = null;
          sauver();
          rendre();
        })),
      scores,
      h('details', { class: 'gd-regles' }, h('summary', {}, 'Comment ça marche ?'),
        h('p', {}, 'Monte ta guilde et referme la Faille : 2 actes de 6 étages, un boss à la fin de chacun, puis le mode Endless.'),
        h('p', {}, 'Avant chaque combat, place tes héros sur les deux lignes du bas. Le combat se joue tout seul : chacun frappe l\'ennemi le plus proche, la mana se recharge toutes les 2 secondes et la compétence part quand la jauge est pleine.'),
        h('p', {}, 'Entre les combats : boutique (héros, objets, reliques contre des éclats ◆), carrefours (événement, feu de camp ou combat défi). Un héros acheté en double monte de rang : B = spécialisation (3 au choix), A et S = amélioration de classe.'),
        h('p', {}, 'Le rembobinage d\'urgence ⟲ garde 5 éclats par victoire et sauve la première défaite. Rush (X) : actif les X premières secondes. Stall (X) : se déclenche une fois après X secondes. Renfort : marche même depuis la réserve.')),
      bouton('◀ Retour', fermer, 'gris')), { sansEntete: true });
  }

  function ecranDepart() {
    const r = S.r;
    const e = r.ecran;
    S.depart = S.depart || {};
    cadre(h('div', { class: 'gd-centre' },
      h('h2', {}, 'Choisis ton premier héros'),
      h('div', { class: 'gd-cartes' }, e.heros.map((id) => carteHeros(id, { choisi: S.depart.heros === id, onclick: () => { S.depart.heros = id; rendre(); } }))),
      h('h2', {}, 'et ton kit de départ'),
      h('div', { class: 'gd-cartes' }, e.kits.map((id) => carteRelique(id, { choisi: S.depart.kit === id, onclick: () => { S.depart.kit = id; rendre(); } }))),
      bouton('C\'est parti !', () => {
        if (!S.depart.heros || !S.depart.kit) return toast('Choisis un héros et un kit.');
        R.choisirDepart(r, S.depart.heros, S.depart.kit);
        S.depart = null;
        sauver();
        rendre();
        return null;
      })));
  }

  function ecranPreparation() {
    const r = S.r;
    const ennemis = R.fichesEnnemis(r);
    const type = r.combat.type;
    cadre(h('div', { class: 'gd-prep' },
      h('div', { class: 'gd-bandeau' }, h('b', {}, type === 'boss' ? `Boss : ${ennemis[0].nom}` : type === 'defi' ? 'Combat défi (élites, meilleure récompense)' : type === 'endless' ? `Endless — manche ${r.endless}` : `${ennemis.length} ennemis`),
        r.message ? h('span', { class: 'gd-msg' }, r.message) : null, r.malediction ? h('span', { class: 'gd-msg rouge' }, 'Pacte : ennemis +20 %') : null,
        h('span', { class: 'spacer' }),
        bouton('Combattre !', () => {
          if (!R.enCombat(r).length) return toast('Place au moins un héros sur le plateau.');
          r.message = '';
          lancerCombat();
          return null;
        })),
      panneauGuilde({ vente: true, ennemis })));
  }

  function lancerCombat() {
    const r = S.r;
    const c = R.creerCombat(r);
    S.combat = c;
    S.vitesse = S.vitesse || 1;
    const plat = plateau();
    const els = new Map();
    const fiche = (u) => {
      const j = jeton(u.cote === 'allies' ? { num: u.num } : { nom: u.nom }, { classes: u.classes, ennemi: u.cote === 'ennemis', boss: u.boss, rang: u.cote === 'allies' ? (r.heros.find((x) => x.uid === u.ref) || {}).rang : null });
      j.classList.add('gd-pose', 'gd-u');
      j.append(h('span', { class: 'gd-barres' }, h('i', { class: 'pv' }), h('i', { class: 'bouclier' }), h('i', { class: 'mana' })), h('span', { class: 'gd-statuts' }));
      j.title = u.nom;
      plat.append(j);
      els.set(u.uid, j);
      return j;
    };
    const journal = h('div', { class: 'gd-journal' });
    const vitesses = h('div', { class: 'gd-vitesses' }, [1, 2, 3].map((v) => h('button', { class: `gd-diff${S.vitesse === v ? ' on' : ''}`, onclick: (e) => { S.vitesse = v; e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, `×${v}`)));
    const chrono = h('span', { class: 'gd-chrono' }, '0 s');
    cadre(h('div', { class: 'gd-combat' },
      h('div', { class: 'gd-bandeau' }, chrono, vitesses, h('span', { class: 'spacer' }), bouton('Passer ▶▶', () => { c.jusquAuBout(); }, 'petit gris')),
      h('div', { class: 'gd-combat-corps' }, h('div', { class: 'gd-plateau-cadre' }, plat), journal)));
    let fxVu = 0;
    let logVu = 0;
    let dernier = performance.now();
    let accu = 0;
    const majUnites = () => {
      for (const u of c.unites) {
        const j = els.get(u.uid) || fiche(u);
        poser(j, u.pos);
        const pvMax = c.s(u, 'pv');
        j.querySelector('.pv').style.width = `${Math.max(0, (u.pv / pvMax) * 100)}%`;
        j.querySelector('.bouclier').style.width = `${Math.min(100, (u.bouclier / pvMax) * 100)}%`;
        const mm = c.s(u, 'mana');
        j.querySelector('.mana').style.width = mm ? `${Math.min(100, (u.mana / mm) * 100)}%` : '0';
        j.classList.toggle('mort', u.mort);
        j.classList.toggle('furtif', c.t < u.st.furtif);
        j.classList.toggle('etourdi', c.t < u.st.etourdi);
        const st = [];
        if (u.st.poison) st.push(h('i', { class: 'poison', title: 'Poison' }, u.st.poison));
        if (u.st.brulure && c.t <= u.st.brulureFin) st.push(h('i', { class: 'brulure', title: 'Brûlure' }, '✸'));
        if (u.st.gel) st.push(h('i', { class: 'gel', title: 'Gel' }, u.st.gel));
        if (c.t < u.st.etourdi) st.push(h('i', { class: 'etourdi', title: 'Étourdi' }, '✦'));
        j.querySelector('.gd-statuts').replaceChildren(...st);
      }
      for (; fxVu < c.fx.length; fxVu++) {
        const f = c.fx[fxVu];
        const j = els.get(f.uid);
        if (!j) continue;
        if (f.type === 'degat' || f.type === 'soin' || f.type === 'lance' || f.type === 'esquive' || f.type === 'resu') {
          const txt = f.type === 'degat' ? `${f.montant}${f.crit ? '!' : ''}` : f.type === 'soin' ? `+${f.montant}` : f.type === 'lance' ? f.nom : f.type === 'esquive' ? 'esquive' : 'debout !';
          const b = h('span', { class: `gd-flottant ${f.type}${f.crit ? ' crit' : ''}${f.typeDeg ? ` ${f.typeDeg}` : ''}` }, txt);
          b.style.left = `${j.offsetLeft + W / 2 + (Math.random() * 20 - 10)}px`;
          b.style.top = `${j.offsetTop + 4}px`;
          plat.append(b);
          setTimeout(() => b.remove(), f.type === 'lance' ? 1300 : 900);
        }
        if (f.type === 'attaque') { j.classList.remove('frappe'); void j.offsetWidth; j.classList.add('frappe'); }
      }
      for (; logVu < c.journal.length; logVu++) {
        const e = c.journal[logVu];
        journal.prepend(h('div', { class: `gd-log ${e.type}` }, h('small', {}, `${e.t.toFixed(1)} s`), ` ${e.txt}`));
        while (journal.childElementCount > 80) journal.lastChild.remove();
      }
      chrono.textContent = `${Math.floor(c.t)} s${c.fureur > 1 ? ' · FUREUR' : ''}`;
    };
    majUnites();
    const boucle = (t) => {
      if (S.combat !== c || !plat.isConnected) return;
      const dt = Math.min(0.1, (t - dernier) / 1000);
      dernier = t;
      accu += dt * S.vitesse;
      while (accu >= 0.1 && !c.fini) { c.pas(0.1); accu -= 0.1; }
      majUnites();
      if (c.fini) return finCombat(c);
      S.anim = requestAnimationFrame(boucle);
      return null;
    };
    S.anim = requestAnimationFrame(boucle);
  }

  function finCombat(c) {
    const r = S.r;
    const gagne = c.gagnant === 'allies';
    const bandeau = h('div', { class: `gd-fin-combat ${gagne ? 'ok' : 'ko'}` },
      h('b', {}, gagne ? 'VICTOIRE' : 'DÉFAITE'),
      bouton('Continuer', () => {
        S.combat = null;
        R.resultatCombat(r, gagne);
        if (r.fini) finPartie();
        sauver();
        rendre();
      }));
    S.racine.querySelector('.gd-plateau-cadre').append(bandeau);
  }

  async function finPartie() {
    const r = S.r;
    const p = S.profil;
    if (r.gagne && r.difficulte === p.diffMax && p.diffMax < 8) p.diffMax += 1;
    p.partie = null;
    try {
      S.scores = await call(api.jeuAjouterScore(S.nom, { score: R.score(r), etage: Math.min(r.etage, 12), endless: r.endless, difficulte: r.difficulte, gagne: r.gagne, equipe: r.heros.map((x) => `${G.heros(x.id).num}${x.rang}`) }));
    } catch { /* hors ligne */ }
    sauver(true);
  }

  function ecranBoutique() {
    const r = S.r;
    const e = r.ecran;
    const msg = (m) => { if (m) toast(m); sauver(); rendre(); };
    cadre(h('div', { class: 'gd-boutique' },
      h('div', { class: 'gd-bandeau' }, r.message ? h('span', { class: 'gd-msg' }, r.message) : null, h('span', { class: 'spacer' }),
        bouton(`Relancer (${R.prixRelance(r)} ◆)`, () => { if (!R.relancer(r)) toast('Pas assez d\'éclats.'); msg(); }, 'petit gris'),
        bouton(e.retour === 'combat' ? 'Au combat ▶' : 'Continuer ▶', () => { r.message = ''; R.quitterBoutique(r); S.sel = null; sauver(); rendre(); })),
      h('div', { class: 'gd-etals' },
        h('div', { class: 'gd-cartes' }, e.offres.heros.map((o, i) => (o.vendu ? h('div', { class: 'gd-carte vendu' }, 'Vendu') : carteHeros(o.id, { prix: R.prixHeros(r, o.id), desactive: r.eclats < R.prixHeros(r, o.id), onclick: () => msg(R.acheterHeros(r, i)) })))),
        h('div', { class: 'gd-cartes' },
          e.offres.objets.map((o, i) => (o.vendu ? h('div', { class: 'gd-carte petite vendu' }, 'Vendu') : carteObjet(o.id, { prix: G.PRIX_RARETE_OBJET[G.objet(o.id).rarete], desactive: r.eclats < G.PRIX_RARETE_OBJET[G.objet(o.id).rarete], onclick: () => msg(R.acheterObjet(r, i)) }))),
          e.offres.reliques.map((o, i) => (o.vendu ? h('div', { class: 'gd-carte petite vendu' }, 'Vendu') : carteRelique(o.id, { prix: G.PRIX_RARETE_RELIQUE[G.relique(o.id).rarete], desactive: r.eclats < G.PRIX_RARETE_RELIQUE[G.relique(o.id).rarete], onclick: () => msg(R.acheterRelique(r, i)) }))))),
      panneauGuilde({ vente: true })));
  }

  function ecranCarrefour() {
    const r = S.r;
    const icones = { evenement: ['?', 'Événement', 'Une rencontre inattendue'], feu: ['♨', 'Feu de camp', 'Monter un héros de rang, méditer, veiller…'], defi: ['⚔', 'Combat défi', 'Élites : plus dur, mais une relique à la clé'] };
    cadre(h('div', { class: 'gd-centre' },
      h('h2', {}, 'Le chemin se sépare…'),
      h('div', { class: 'gd-cartes' }, r.ecran.options.map((o, i) => {
        const [ic, nom, desc] = icones[o.type];
        const ev = o.type === 'evenement' && G.EVENEMENTS.find((x) => x.id === o.id);
        return h('button', { class: 'gd-carte gd-noeud', onclick: () => { R.choisirCarrefour(r, i); sauver(); rendre(); } }, h('span', { class: 'gd-noeud-ic' }, ic), h('b', {}, ev ? ev.nom : nom), h('small', {}, ev ? ev.txt : desc));
      }))));
  }

  // Choix d'un héros (événement, feu de camp).
  function choisirHeros(titre, filtre, fn) {
    const r = S.r;
    const liste = r.heros.filter(filtre || (() => true));
    if (!liste.length) return toast('Aucun héros éligible.');
    cadre(h('div', { class: 'gd-centre' }, h('h2', {}, titre),
      h('div', { class: 'gd-cartes' }, liste.map((hr) => h('button', { class: 'gd-carte petite', title: resumeHeros(r, hr), onclick: () => fn(hr) }, h('div', { class: 'gd-carte-haut' }, jeton(G.heros(hr.id), { rang: hr.rang, classes: R.classesHeros(hr) }), h('b', {}, G.heros(hr.id).nom))))),
      bouton('Annuler', rendre, 'gris')));
    return null;
  }

  function ecranEvenement() {
    const r = S.r;
    const ev = G.EVENEMENTS.find((x) => x.id === r.ecran.id);
    cadre(h('div', { class: 'gd-centre' },
      h('span', { class: 'gd-noeud-ic grand' }, '?'),
      h('h2', {}, ev.nom), h('p', { class: 'gd-recit' }, ev.txt),
      h('div', { class: 'gd-choix' }, ev.choix.map((ch, i) => {
        const ok = !ch.cond || ch.cond(r, R);
        return bouton(ch.txt, () => {
          if (!ok) return;
          if (ch.heros) return choisirHeros(ch.txt, typeof ch.heros === 'function' ? ch.heros : null, (hr) => { R.choixEvenement(r, i, hr.uid); sauver(); rendre(); });
          R.choixEvenement(r, i);
          sauver();
          rendre();
          return null;
        }, ok ? '' : 'gris desactive');
      }))));
  }

  function ecranFeu() {
    const r = S.r;
    cadre(h('div', { class: 'gd-centre' },
      h('span', { class: 'gd-noeud-ic grand feu' }, '♨'), h('h2', {}, 'Feu de camp'), h('p', { class: 'gd-recit' }, 'La guilde reprend son souffle. Une seule action :'),
      h('div', { class: 'gd-choix' }, R.FEU.map((o) => {
        const ok = !o.cond || o.cond(r);
        return bouton(`${o.nom} — ${o.desc}`, () => {
          if (!ok) return;
          if (o.heros) return choisirHeros(o.desc, o.heros, (hr) => { R.feuDeCamp(r, o.id, hr.uid); sauver(); rendre(); });
          R.feuDeCamp(r, o.id);
          sauver();
          rendre();
          return null;
        }, ok ? '' : 'gris desactive');
      }))));
  }

  function ecranResultatEvenement() {
    const r = S.r;
    cadre(h('div', { class: 'gd-centre' }, h('h2', {}, r.ecran.nom), h('p', { class: 'gd-recit' }, r.ecran.msg),
      bouton('Continuer ▶', () => { R.etageSuivant(r); sauver(); rendre(); })));
  }

  function ecranRecompense() {
    const r = S.r;
    cadre(h('div', { class: 'gd-centre' }, h('h2', {}, 'Choisis une relique'),
      h('div', { class: 'gd-cartes' }, r.ecran.reliques.map((id) => carteRelique(id, { onclick: () => { R.choisirRecompense(r, id); sauver(); rendre(); } }))),
      bouton('Passer', () => { R.choisirRecompense(r, null); sauver(); rendre(); }, 'gris')));
  }

  function ecranEnchere() {
    const r = S.r;
    const msg = (m) => { if (m) toast(m); sauver(); rendre(); };
    cadre(h('div', { class: 'gd-centre' },
      h('h2', {}, 'Fin d\'acte : la grande enchère'), h('p', { class: 'gd-recit' }, 'Des lots exceptionnels, à saisir avant de plonger au cœur de la Faille.'),
      h('div', { class: 'gd-cartes' }, r.ecran.lots.map((lot, i) => {
        if (lot.vendu) return h('div', { class: 'gd-carte vendu' }, 'Adjugé');
        const o = { prix: lot.prix, desactive: r.eclats < lot.prix, onclick: () => msg(R.acheterLot(r, i)) };
        return lot.type === 'heros' ? carteHeros(lot.id, { ...o, rang: 'B' }) : lot.type === 'objet' ? carteObjet(lot.id, o) : carteRelique(lot.id, o);
      })),
      bouton('Acte 2 ▶', () => { R.quitterEnchere(r); sauver(); rendre(); })));
  }

  function ecranVictoireFinale() {
    const r = S.r;
    cadre(h('div', { class: 'gd-centre' },
      h('div', { class: 'jeu-ecran-titre' }, 'LA FAILLE EST SCELLÉE', h('small', {}, `Difficulté ${r.difficulte} · score ${R.score(r)}`)),
      h('p', { class: 'gd-recit' }, 'Continuer en mode Endless ? Plus de rembobinage, une relique toutes les 3 manches, le score monte à chaque manche.'),
      h('div', { class: 'gd-choix' },
        bouton('Mode Endless ▶', () => { R.lancerEndless(r); sauver(); rendre(); }),
        bouton('Terminer la partie', async () => { R.terminer(r, true); await finPartie(); rendre(); }, 'gris'))));
  }

  function ecranFin() {
    const r = S.r;
    cadre(h('div', { class: 'gd-centre' },
      h('div', { class: 'jeu-ecran-titre' }, r.gagne ? 'VICTOIRE' : 'FIN DE PARTIE', h('small', {}, `Score ${R.score(r)}`)),
      h('p', { class: 'gd-recit' }, r.gagne ? (r.endless ? `Faille scellée, puis ${r.endless - 1} manche(s) d'Endless tenue(s).` : 'La Faille est scellée !') : `La guilde est tombée à l'étage ${r.etage} (${R.titreEtage(r)}).`),
      h('div', { class: 'gd-banc-liste' }, r.heros.map((hr) => jeton(G.heros(hr.id), { rang: hr.rang, classes: R.classesHeros(hr) }))),
      bouton('Retour au menu', () => { S.r = null; rendre(); })));
  }

  function rendre() {
    if (!S) return;
    cancelAnimationFrame(S.anim);
    if (!S.r) return ecranAccueil();
    const r = S.r;
    if (r.enAttente.length && !r.fini) return choixEnAttente();
    const t = r.ecran.type;
    const ecrans = { depart: ecranDepart, preparation: ecranPreparation, boutique: ecranBoutique, carrefour: ecranCarrefour, evenement: ecranEvenement, feu: ecranFeu, resultatEvenement: ecranResultatEvenement, recompense: ecranRecompense, enchere: ecranEnchere, victoireFinale: ecranVictoireFinale, fin: ecranFin };
    return (ecrans[t] || ecranAccueil)();
  }

  let fermer = () => {};

  // Ouvre le jeu en plein écran ; résout quand le joueur revient.
  UI.ouvrir = (nom) => new Promise((resolve) => {
    const racine = h('div', { class: 'jeu-ecran gd' });
    document.body.append(racine);
    S = { nom, profil: { partie: null, diffMax: 1 }, r: null, racine, sel: null, scores: [] };
    const echap = (e) => { if (e.key === 'Escape' && !S.combat) fermer(); };
    fermer = () => {
      cancelAnimationFrame(S.anim);
      sauver(true);
      document.removeEventListener('keydown', echap);
      racine.remove();
      S = null;
      resolve();
    };
    document.addEventListener('keydown', echap);
    Promise.all([call(api.jeuProfil(nom)).catch(() => null), call(api.jeuScores()).catch(() => [])]).then(([p, sc]) => {
      if (!S) return;
      if (p) S.profil = { partie: p.partie || null, diffMax: p.diffMax || 1 };
      S.scores = sc;
      rendre();
    });
    racine.append(h('div', { class: 'jeu-ecran-txt' }, 'Chargement…'));
  });
}());
