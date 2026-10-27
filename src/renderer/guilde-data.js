'use strict';

// Workfall — contenu du jeu : classes, héros (25 homunculus provisoires,
// en attendant les vrais personnages et leurs visuels), spécialisations,
// améliorations de classe, objets, reliques, monstres, boss et événements.
// Tout est décrit par des « effets » : stats et crochets appelés par le
// moteur (debut, tick, attaque, touche, subit, tue, meurt, lance,
// mortAllie, stall, renfort, debutEquipe).

(function (racine) {
  const G = racine.Guilde = racine.Guilde || {};

  // ---------- Petits outils pour écrire les effets ----------
  const pct = (x) => `${Math.round(x * 100)} %`;
  const E = {
    stats: (stats, mul = {}) => ({ debut(c, u) { for (const [k, v] of Object.entries(stats)) c.buff(u, k, { add: v }); for (const [k, v] of Object.entries(mul)) c.buff(u, k, { mul: v }); } }),
    rush: (sec, stats, mul = {}) => ({ mot: 'Rush', debut(c, u) { for (const [k, v] of Object.entries(stats)) c.buff(u, k, { add: v }, sec); for (const [k, v] of Object.entries(mul)) c.buff(u, k, { mul: v }, sec); } }),
    stall: (sec, fn) => ({ mot: 'Stall', stall: { apres: sec, fn } }),
    // Stats pour toute l'équipe depuis le banc (Renfort).
    renfort: (fn) => ({ mot: 'Renfort', renfort: fn }),
    surAttaque: (fn) => ({ touche(c, u, cible, m, info) { if (info.auto) fn(c, u, cible, m); } }),
    chaque: (n, fn) => ({ attaque(c, u, cible, info) { if (u.compteur % n === 0) fn(c, u, cible, info); } }),
    epines: (p) => ({ subit(c, u, src, info) { if (src && info.type === 'phys' && src.cote !== u.cote) c.degats(u, src, info.montant * p, 'vrai'); } }),
  };
  G.E = E;
  const mag = (c, u, m) => c.s(u, 'mag') * m;
  const atk = (c, u, m) => c.s(u, 'atk') * m;

  // ---------- Classes ----------
  // croissance : bonus de stats par rang (B, A, S) en plus du multiplicateur commun.
  G.CLASSES = {
    guerrier: { nom: 'Guerrier', couleur: '#e8590c', croissance: { atk: 6, pv: 60 } },
    tank: { nom: 'Tank', couleur: '#1c7ed6', croissance: { def: 8, pv: 120 } },
    avantgarde: { nom: 'Avant-garde', couleur: '#f59f00', croissance: { atk: 4, def: 4, pv: 80 } },
    assassin: { nom: 'Assassin', couleur: '#862e9c', croissance: { atk: 6, crit: 3 } },
    duelliste: { nom: 'Duelliste', couleur: '#c2255c', croissance: { atk: 5, vit: 0.05 } },
    mage: { nom: 'Mage', couleur: '#7048e8', croissance: { mag: 8 } },
    mystique: { nom: 'Mystique', couleur: '#0ca678', croissance: { mag: 5, regen: 2 } },
  };
  G.RANGS = ['C', 'B', 'A', 'S'];
  G.MULT_RANG = [1, 1.25, 1.55, 1.95];

  // Améliorations de classe : proposées (3 au hasard) quand un héros passe A ou S.
  // rarete : c (commune), r (rare), e (épique).
  const AM = (id, classe, rarete, nom, desc, effet) => ({ id, classe, rarete, nom, desc, effet });
  G.AMELIORATIONS = [
    AM('g1', 'guerrier', 'c', 'Force', '+15 attaque', E.stats({ atk: 15 })),
    AM('g2', 'guerrier', 'c', 'Endurance', '+150 PV', E.stats({ pv: 150 })),
    AM('g3', 'guerrier', 'r', 'Fureur', '+15 % vitesse d\'attaque', E.stats({}, { vit: 0.15 })),
    AM('g4', 'guerrier', 'r', 'Saignée', 'Vol de vie 12 %', E.stats({ vol: 12 })),
    AM('g5', 'guerrier', 'e', 'Rage', 'Rush (6) : +35 % attaque', E.rush(6, {}, { atk: 0.35 })),
    AM('g6', 'guerrier', 'e', 'Dernier carré', 'Stall (15) : récupère 35 % de ses PV', E.stall(15, (c, u) => c.soin(u, u, c.s(u, 'pv') * 0.35))),
    AM('t1', 'tank', 'c', 'Carapace', '+15 défense', E.stats({ def: 15 })),
    AM('t2', 'tank', 'c', 'Masse', '+250 PV', E.stats({ pv: 250 })),
    AM('t3', 'tank', 'r', 'Épines', 'Renvoie 12 % des dégâts physiques', E.epines(0.12)),
    AM('t4', 'tank', 'r', 'Régénération', 'Récupère 1 % de ses PV par seconde', { tick(c, u, dt) { c.soin(u, u, c.s(u, 'pv') * 0.01 * dt, { discret: true }); } }),
    AM('t5', 'tank', 'e', 'Forteresse', 'Stall (10) : bouclier de 25 % de ses PV', E.stall(10, (c, u) => c.proteger(u, c.s(u, 'pv') * 0.25))),
    AM('t6', 'tank', 'e', 'Défi', 'Début : provoque les ennemis à 2 cases pendant 3 s', { debut(c, u) { for (const e of c.autour(u.pos, 2, c.ennemisDe(u))) c.statut(e, 'provoc', 0, 3, u); } }),
    AM('v1', 'avantgarde', 'c', 'Élan', '+10 attaque, +0,5 déplacement', E.stats({ atk: 10, mvt: 0.5 })),
    AM('v2', 'avantgarde', 'c', 'Cuirasse', '+10 défense, +100 PV', E.stats({ def: 10, pv: 100 })),
    AM('v3', 'avantgarde', 'r', 'Feu intérieur', 'Ses attaques brûlent (15/s, 2 s)', E.surAttaque((c, u, t) => c.statut(t, 'brulure', 15, 2, u))),
    AM('v4', 'avantgarde', 'r', 'Percée', 'Première attaque : +150 %', { attaque(c, u, t, info) { if (u.compteur === 1) info.mult += 1.5; } }),
    AM('v5', 'avantgarde', 'e', 'Ruée', 'Rush (5) : +45 % vitesse d\'attaque', E.rush(5, {}, { vit: 0.45 })),
    AM('v6', 'avantgarde', 'e', 'Phénix', 'Une fois : revient à 30 % de ses PV', { meurt(c, u) { if (!u.phenix) { u.phenix = true; u.pv = c.s(u, 'pv') * 0.3; c.effet('resu', u); } } }),
    AM('a1', 'assassin', 'c', 'Affûtage', '+8 % critique', E.stats({ crit: 8 })),
    AM('a2', 'assassin', 'c', 'Agilité', '+12 % vitesse d\'attaque', E.stats({}, { vit: 0.12 })),
    AM('a3', 'assassin', 'r', 'Venin', 'Ses attaques empoisonnent (+1)', E.surAttaque((c, u, t) => c.statut(t, 'poison', 1, 0, u))),
    AM('a4', 'assassin', 'r', 'Létalité', '+35 % dégâts critiques', E.stats({ critdeg: 35 })),
    AM('a5', 'assassin', 'e', 'Ombre', 'Rush (3) : furtif', { mot: 'Rush', debut(c, u) { c.statut(u, 'furtif', 0, 3); } }),
    AM('a6', 'assassin', 'e', 'Achèvement', '+50 % dégâts sur les cibles sous 30 % de PV', { avantDegats(c, u, t, info) { if (t.pv / c.s(t, 'pv') < 0.3) info.montant *= 1.5; } }),
    AM('d1', 'duelliste', 'c', 'Précision', '+10 % critique', E.stats({ crit: 10 })),
    AM('d2', 'duelliste', 'c', 'Vivacité', '+12 % vitesse d\'attaque', E.stats({}, { vit: 0.12 })),
    AM('d3', 'duelliste', 'r', 'Parade', '15 % d\'esquive', E.stats({ esquive: 15 })),
    AM('d4', 'duelliste', 'r', 'Contre', '20 % de chances de riposter', { subit(c, u, src, info) { if (src && info.auto && c.rng() < 0.2) c.degats(u, src, c.s(u, 'atk'), 'phys'); } }),
    AM('d5', 'duelliste', 'e', 'Concentration', 'Rush (8) : +25 % critique', E.rush(8, { crit: 25 })),
    AM('d6', 'duelliste', 'e', 'Maîtrise', 'Toutes les 4 attaques : dégâts doublés', E.chaque(4, (c, u, t, info) => { info.mult += 1; })),
    AM('m1', 'mage', 'c', 'Savoir', '+12 magie', E.stats({ mag: 12 })),
    AM('m2', 'mage', 'c', 'Méditation', '+5 régénération de mana', E.stats({ regen: 5 })),
    AM('m3', 'mage', 'r', 'Embrasement', 'Ses sorts brûlent la cible (20/s, 3 s)', { lance(c, u) { const t = c.cibleDe(u); if (t) c.statut(t, 'brulure', 20, 3, u); } }),
    AM('m4', 'mage', 'r', 'Écho', '20 % de chances de récupérer la moitié de sa mana', { lance(c, u) { if (c.rng() < 0.2) u.mana = c.s(u, 'mana') / 2; } }),
    AM('m5', 'mage', 'e', 'Puissance', '+25 % magie', E.stats({}, { mag: 0.25 })),
    AM('m6', 'mage', 'e', 'Préparation', 'Commence avec 60 % de sa mana', { debut(c, u) { u.mana = c.s(u, 'mana') * 0.6; } }),
    AM('y1', 'mystique', 'c', 'Grâce', '+10 magie', E.stats({ mag: 10 })),
    AM('y2', 'mystique', 'c', 'Sérénité', '+6 régénération de mana', E.stats({ regen: 6 })),
    AM('y3', 'mystique', 'r', 'Bienfait', 'Soins +25 %', E.stats({ soins: 25 })),
    AM('y4', 'mystique', 'r', 'Halo', 'Début : alliés à 1 case +10 défense', { debut(c, u) { for (const a of c.autour(u.pos, 1, c.alliesDe(u, false))) c.buff(a, 'def', { add: 10 }); } }),
    AM('y5', 'mystique', 'e', 'Miracle', 'Stall (18) : ressuscite un allié à 40 %', E.stall(18, (c, u) => { const m = c.unites.find((x) => x.cote === u.cote && x.mort && !x.invoque); if (m) c.ressusciter(m, 0.4); })),
    AM('y6', 'mystique', 'e', 'Ferveur', 'Début : alliés +25 mana', { debut(c, u) { for (const a of c.alliesDe(u)) a.mana += 25; } }),
  ];

  // ---------- Compétences (bibliothèque) ----------
  const COMP = {
    coupPuissant: (m, etourdi) => ({ nom: 'Coup puissant', desc: `${pct(m)} de l'attaque à sa cible${etourdi ? `, étourdit ${etourdi} s` : ''}`, lancer(c, u) { const t = c.cibleDe(u); if (!t) return; c.degats(u, t, atk(c, u, m), 'phys', { peutCrit: true }); if (etourdi) c.statut(t, 'etourdi', 0, etourdi * (u.bonusEtourdi || 1)); } }),
    tourbillon: (m) => ({ nom: 'Tourbillon', desc: `${pct(m)} de l'attaque aux ennemis adjacents`, lancer(c, u) { for (const e of c.autour(u.pos, 1 + (u.rayonBonus || 0), c.ennemisDe(u))) { c.degats(u, e, atk(c, u, m), 'phys'); if (u.tourbillonBrule) c.statut(e, 'brulure', 30, 3, u); } } }),
    criDeGuerre: (p, d) => ({ nom: 'Cri de guerre', desc: `Alliés +${pct(p)} attaque pendant ${d} s`, lancer(c, u) { for (const a of c.alliesDe(u)) { c.buff(a, 'atk', { mul: p }, d); if (u.criVitesse) c.buff(a, 'vit', { mul: u.criVitesse }, d); } } }),
    execution: (m) => ({ nom: 'Exécution', desc: `${pct(m)} de l'attaque, double sous 30 % de PV`, lancer(c, u) { const t = c.cibleDe(u); if (!t) return; c.degats(u, t, atk(c, u, m) * (t.pv / c.s(t, 'pv') < 0.3 ? 2 : 1), 'phys', { peutCrit: true }); } }),
    provocation: (r, d, def) => ({ nom: 'Provocation', desc: `Provoque les ennemis à ${r} cases (${d} s), +${def} défense`, lancer(c, u) { for (const e of c.autour(u.pos, r, c.ennemisDe(u))) c.statut(e, 'provoc', 0, d, u); c.buff(u, 'def', { add: def }, d + 1); } }),
    murDeGlace: (m, g) => ({ nom: 'Mur de glace', desc: `${pct(m)} de la magie et ${g} gel aux ennemis à 2 cases`, lancer(c, u) { for (const e of c.autour(u.pos, 2, c.ennemisDe(u))) { c.degats(u, e, mag(c, u, m) * (u.murBonus || 1) + 60, 'mag'); c.statut(e, 'gel', g, 0, u); } } }),
    nuageToxique: (p) => ({ nom: 'Nuage toxique', desc: `${p} poisons aux ennemis adjacents, récupère 10 % de PV`, lancer(c, u) { for (const e of c.autour(u.pos, 1, c.ennemisDe(u))) c.statut(e, 'poison', p, 0, u); c.soin(u, u, c.s(u, 'pv') * 0.1); } }),
    rempart: (b) => ({ nom: 'Rempart', desc: `Bouclier de ${b} à tous les alliés`, lancer(c, u) { for (const a of c.alliesDe(u)) { c.proteger(a, b); if (u.rempartSoin) c.soin(u, a, u.rempartSoin); } } }),
    charge: (m) => ({ nom: 'Charge', desc: `Bondit sur l'ennemi le plus éloigné : ${pct(m)} de l'attaque, étourdit 1 s`, lancer(c, u) { const t = c.plusLoin(u, c.ennemisDe(u)); if (!t) return; c.deplacer(u, t.pos); u.cible = t; c.degats(u, t, atk(c, u, m), 'phys', { peutCrit: true }); c.statut(t, 'etourdi', 0, 1); if (u.chargeImpact) for (const e of c.autour(t.pos, 1, c.ennemisDe(u))) if (e !== t) c.degats(u, e, atk(c, u, m * 0.5), 'phys'); if (u.chargeBrule) c.statut(t, 'brulure', 40, 4, u); } }),
    lanceEnflammee: (m, b) => ({ nom: 'Lance enflammée', desc: `${pct(m)} de l'attaque, brûlure ${b}/s pendant 4 s`, lancer(c, u) { const t = c.cibleDe(u); if (!t) return; c.degats(u, t, atk(c, u, m), 'phys', { peutCrit: true }); c.statut(t, 'brulure', b + (u.brulureMag ? c.s(u, 'mag') : 0), 4, u); } }),
    bondProtecteur: (b) => ({ nom: 'Bond protecteur', desc: `Rejoint l'allié le plus blessé et lui donne un bouclier de ${b}`, lancer(c, u) { const a = c.plusFaible(c.alliesDe(u, false)) || u; c.deplacer(u, a.pos); c.proteger(a, b); if (u.riposte) u.riposteCoups = 3; } }),
    ombre: (m) => ({ nom: 'Pas de l\'ombre', desc: `Se téléporte sur l'ennemi le plus faible : ${pct(m)} de l'attaque, furtif 1,5 s`, lancer(c, u) { const t = c.plusFaible(c.ennemisDe(u).filter((x) => c.ciblable(x))); if (!t) return; c.deplacer(u, t.pos); u.cible = t; c.degats(u, t, atk(c, u, m), 'phys', { peutCrit: true }); c.statut(u, 'furtif', 0, 1.5); } }),
    daguesToxiques: (p) => ({ nom: 'Dagues toxiques', desc: `Les 3 ennemis les plus proches : 90 dégâts et ${p} poisons`, lancer(c, u) { const l = c.ennemisDe(u).filter((x) => c.ciblable(x)).sort((a, b) => Guilde.dist(u.pos, a.pos) - Guilde.dist(u.pos, b.pos)).slice(0, 3); for (const e of l) { c.degats(u, e, u.daguesMag ? mag(c, u, 1.6) : 90, u.daguesMag ? 'mag' : 'phys'); c.statut(e, 'poison', p + (u.poisonBonus || 0), 0, u); } if (u.fumigene) c.statut(u, 'furtif', 0, 2); } }),
    danseDesLames: (n, m) => ({ nom: 'Danse des lames', desc: `${n} coups de ${pct(m)} de l'attaque sur les ennemis à 2 cases`, lancer(c, u) { for (let i = 0; i < n; i++) { const l = c.autour(u.pos, 2, c.ennemisDe(u)).filter((x) => c.ciblable(x)); if (!l.length) return; c.degats(u, l[Math.floor(c.rng() * l.length)], atk(c, u, m), 'phys', { peutCrit: true }); } } }),
    feinte: (n) => ({ nom: 'Feinte', desc: `Ses ${n} prochaines attaques sont critiques`, lancer(c, u) { u.critsGarantis = n; } }),
    estocade: (m, d) => ({ nom: 'Estocade', desc: `${pct(m)} de l'attaque, -${d} défense à la cible (5 s)`, lancer(c, u) { const t = c.cibleDe(u); if (!t) return; c.degats(u, t, atk(c, u, m), 'phys', { peutCrit: true }); c.buff(t, 'def', { add: -d }, 5); if (u.estocadeEtourdit) c.statut(t, 'etourdi', 0, 1); } }),
    tirPrecis: (m) => ({ nom: 'Tir précis', desc: `${pct(m)} de l'attaque à l'ennemi le plus éloigné`, lancer(c, u) { const t = c.plusLoin(u, c.ennemisDe(u)); if (t) c.degats(u, t, atk(c, u, m), 'phys', { peutCrit: true }); } }),
    bouleDeFeu: (m, r) => ({ nom: 'Boule de feu', desc: `${pct(m)} de la magie à la cible et autour (${r} case), brûlure 25/s 3 s`, lancer(c, u) { const t = c.cibleDe(u); if (!t) return; for (const e of c.autour(t.pos, r + (u.rayonBonus || 0), c.ennemisDe(u))) { c.degats(u, e, mag(c, u, m), 'mag', { peutCrit: true }); c.statut(e, 'brulure', 25, 3, u); } } }),
    eclairEnChaine: (n, m) => ({ nom: 'Éclair en chaîne', desc: `Frappe ${n} ennemis : ${pct(m)} de la magie (-15 % par rebond)`, lancer(c, u) { let t = c.cibleDe(u); const touches = new Set(); let k = m; for (let i = 0; i < n + (u.rebonds || 0) && t; i++) { touches.add(t); c.degats(u, t, mag(c, u, k), 'mag', { peutCrit: true }); if (u.surcharge) c.statut(t, 'etourdi', 0, 0.5); k *= 0.85; const prec = t; t = c.plusProche(prec, c.ennemisDe(u).filter((x) => !touches.has(x))); } } }),
    blizzard: (m, g) => ({ nom: 'Blizzard', desc: `${pct(m)} de la magie et ${g} gel autour de la cible (2 cases)`, lancer(c, u) { const t = c.cibleDe(u); if (!t) return; for (const e of c.autour(t.pos, 2, c.ennemisDe(u))) { c.degats(u, e, mag(c, u, m), 'mag'); c.statut(e, 'gel', g, 0, u); } if (u.blizzardSoin) for (const a of c.autour(t.pos, 3, c.alliesDe(u))) c.soin(u, a, u.blizzardSoin); } }),
    rayonArcanique: (m) => ({ nom: 'Rayon arcanique', desc: `${pct(m)} de la magie à sa cible`, lancer(c, u) { const t = c.cibleDe(u); if (!t) return; const d = c.degats(u, t, mag(c, u, m), 'mag', { peutCrit: true }); if (u.siphon) c.soin(u, u, d * u.siphon); } }),
    soin: (m) => ({ nom: 'Soin', desc: `Soigne l'allié le plus blessé de ${pct(m)} de la magie`, lancer(c, u) { const a = c.plusFaible(c.alliesDe(u)); if (!a) return; c.soin(u, a, mag(c, u, m)); if (u.lumiere) { const e = c.plusProche(a, c.ennemisDe(u)); if (e) c.degats(u, e, mag(c, u, 1.5), 'mag'); } if (u.regenSoin) for (const x of c.alliesDe(u)) c.buff(x, 'regenPv', { add: 0.02 }, 5); } }),
    benediction: (m) => ({ nom: 'Bénédiction', desc: `Bouclier de ${pct(m)} de la magie aux 2 alliés les plus blessés`, lancer(c, u) { const l = c.alliesDe(u).sort((a, b) => a.pv / c.s(a, 'pv') - b.pv / c.s(b, 'pv')).slice(0, 2); for (const a of l) { c.proteger(a, mag(c, u, m) * (u.egide || 1)); if (u.benedictionAtk) c.buff(a, 'atk', { mul: 0.15 }, 4); } } }),
    sourceDeMana: (n) => ({ nom: 'Source de mana', desc: `Alliés +${n} mana`, lancer(c, u) { const k = u.sourceDouble && c.rush(8) ? 2 : 1; for (const a of c.alliesDe(u, false)) a.mana = Math.min(c.s(a, 'mana'), a.mana + n * k); } }),
    purification: (m) => ({ nom: 'Purification', desc: `Retire poison, brûlure et gel des alliés et les soigne de ${pct(m)} de la magie`, lancer(c, u) { for (const a of c.alliesDe(u)) { c.purifier(a); c.soin(u, a, mag(c, u, m) * (u.redemption || 1)); } } }),
  };
  G.COMP = COMP;

  // Spécialisation (rang B) : 3 au choix ; classe2 = classe ajoutée.
  const SP = (id, nom, desc, effets, classe2 = null) => ({ id, nom, desc, effets: [].concat(effets), classe2 });
  const flag = (k, v = true) => ({ debut(c, u) { u[k] = v; } });

  // ---------- Héros : 25 homunculus ----------
  // palier : 1 (6 tickets resto), 2 (10), 3 (15). Stats au rang C.
  // Ordres de grandeur de Guildrun (démo) : 575-1000 PV, 25-60 défense,
  // 20-46 d'attaque, 0,39-0,6 attaque/s, 50-110 de mana max.
  const ST = {
    guerrier: { pv: 850, atk: 42, def: 38, mag: 0, mana: 75, regen: 6, vit: 0.48, portee: 1, crit: 8, mvt: 1.6 },
    tank: { pv: 950, atk: 30, def: 58, mag: 10, mana: 105, regen: 6, vit: 0.4, portee: 1, crit: 3, mvt: 1.3 },
    avantgarde: { pv: 900, atk: 38, def: 45, mag: 0, mana: 70, regen: 6, vit: 0.45, portee: 1, crit: 6, mvt: 2 },
    assassin: { pv: 625, atk: 40, def: 28, mag: 0, mana: 50, regen: 6, vit: 0.55, portee: 1, crit: 20, mvt: 2 },
    duelliste: { pv: 750, atk: 38, def: 35, mag: 0, mana: 70, regen: 6, vit: 0.6, portee: 1, crit: 15, mvt: 1.6 },
    mage: { pv: 600, atk: 20, def: 26, mag: 42, mana: 90, regen: 8, vit: 0.43, portee: 4, crit: 10, mvt: 1.3 },
    mystique: { pv: 600, atk: 18, def: 27, mag: 34, mana: 80, regen: 12, vit: 0.42, portee: 3, crit: 3, mvt: 1.3 },
  };
  const H = (num, classe, palier, comp, specs, ajust = {}) => ({
    id: `h${num}`, num, nom: `Homunculus n°${num}`, classes: [classe], palier, stats: { ...ST[classe], ...ajust }, comp, specs,
  });
  G.HEROS = [
    // Guerriers
    H(1, 'guerrier', 1, COMP.coupPuissant(2.2, 1), [
      SP('s1a', 'Berserker', '+25 % vitesse d\'attaque et +20 % attaque sous 50 % de PV', { tick(c, u) { if (!u.berserk && u.pv < c.s(u, 'pv') / 2) { u.berserk = true; c.buff(u, 'vit', { mul: 0.25 }); c.buff(u, 'atk', { mul: 0.2 }); } } }),
      SP('s1b', 'Garde du corps', '+20 défense ; Coup puissant provoque les ennemis adjacents 2 s', [E.stats({ def: 20 }), { lance(c, u) { for (const e of c.autour(u.pos, 1, c.ennemisDe(u))) c.statut(e, 'provoc', 0, 2, u); } }], 'tank'),
      SP('s1c', 'Assaut', 'Rush (8) : +40 % attaque', E.rush(8, {}, { atk: 0.4 })),
    ]),
    H(2, 'guerrier', 1, COMP.tourbillon(1.5), [
      SP('s2a', 'Vampire', 'Vol de vie 20 %', E.stats({ vol: 20 })),
      SP('s2b', 'Moulinet ardent', 'Tourbillon brûle (30/s, 3 s)', flag('tourbillonBrule'), 'avantgarde'),
      SP('s2c', 'Écrasement', 'Tourbillon touche jusqu\'à 2 cases', flag('rayonBonus', 1)),
    ], { pv: 880 }),
    H(3, 'guerrier', 2, COMP.criDeGuerre(0.2, 5), [
      SP('s3a', 'Chef de meute', 'Cri de guerre donne aussi +15 % vitesse d\'attaque', flag('criVitesse', 0.15)),
      SP('s3b', 'Porte-étendard', 'Renfort : toute l\'équipe +8 % attaque (même depuis le banc)', E.renfort((c, cote) => { for (const a of c.vivants(cote)) c.buff(a, 'atk', { mul: 0.08 }); })),
      SP('s3c', 'Second souffle', 'Stall (15) : relance Cri de guerre et récupère 20 % de PV', E.stall(15, (c, u) => { u.comp.lancer(c, u); c.soin(u, u, c.s(u, 'pv') * 0.2); })),
    ]),
    H(4, 'guerrier', 3, COMP.execution(3), [
      SP('s4a', 'Chasseur de têtes', 'Chaque élimination : +40 mana', { tue(c, u) { u.mana += 40; } }),
      SP('s4b', 'Sang-froid', '+20 % critique', E.stats({ crit: 20 }), 'duelliste'),
      SP('s4c', 'Brise-armure', 'Ses attaques retirent 5 défense (cumulable 10 fois)', E.surAttaque((c, u, t) => { t.brise = (t.brise || 0) + 1; if (t.brise <= 10) c.buff(t, 'def', { add: -5 }); })),
    ], { atk: 46 }),
    // Tanks
    H(5, 'tank', 1, COMP.provocation(2, 3, 30), [
      SP('s5a', 'Épines', 'Renvoie 25 % des dégâts physiques', E.epines(0.25)),
      SP('s5b', 'Bastion', 'Renfort : toute l\'équipe +10 % PV', E.renfort((c, cote) => { for (const a of c.vivants(cote)) c.buff(a, 'pv', { mul: 0.1 }); })),
      SP('s5c', 'Mur vivant', 'Stall (12) : bouclier de 30 % de ses PV', E.stall(12, (c, u) => c.proteger(u, c.s(u, 'pv') * 0.3))),
    ]),
    H(6, 'tank', 2, COMP.murDeGlace(1.5, 3), [
      SP('s6a', 'Hiver éternel', 'Ses attaques gèlent (+1)', E.surAttaque((c, u, t) => c.statut(t, 'gel', 1, 0, u))),
      SP('s6b', 'Cœur de glace', '+25 magie, Mur de glace +50 %', [E.stats({ mag: 25 }), flag('murBonus', 1.5)], 'mage'),
      SP('s6c', 'Givre protecteur', 'Début : bouclier de 120 aux alliés adjacents', { debut(c, u) { for (const a of c.autour(u.pos, 1, c.alliesDe(u, false))) c.proteger(a, 120); } }),
    ]),
    H(7, 'tank', 2, COMP.nuageToxique(4), [
      SP('s7a', 'Venin', 'Ses attaques empoisonnent (+1)', E.surAttaque((c, u, t) => c.statut(t, 'poison', 1, 0, u))),
      SP('s7b', 'Peau de crapaud', 'Qui le frappe au corps à corps est empoisonné (+1)', { subit(c, u, src, info) { if (src && info.auto && Guilde.dist(src.pos, u.pos) <= 1) c.statut(src, 'poison', 1, 0, u); } }),
      SP('s7c', 'Mue', 'Stall (20) : remonte à 50 % de PV s\'il est en dessous', E.stall(20, (c, u) => { if (u.pv < c.s(u, 'pv') / 2) u.pv = c.s(u, 'pv') / 2; })),
    ]),
    H(8, 'tank', 3, COMP.rempart(160), [
      SP('s8a', 'Paladin', 'Rempart soigne aussi de 90', flag('rempartSoin', 90), 'mystique'),
      SP('s8b', 'Charge défensive', 'Rush (6) : +60 défense', E.rush(6, { def: 60 })),
      SP('s8c', 'Inébranlable', 'Insensible à l\'étourdissement, +15 % PV', [E.stats({}, { pv: 0.15 }), { debut(c, u) { u.st.insensible = true; } }]),
    ], { pv: 1000 }),
    // Avant-gardes
    H(9, 'avantgarde', 1, COMP.charge(1.8), [
      SP('s9a', 'Impact', 'Charge touche aussi les ennemis autour (50 %)', flag('chargeImpact')),
      SP('s9b', 'Fougue', 'Rush (5) : +50 % vitesse d\'attaque', E.rush(5, {}, { vit: 0.5 })),
      SP('s9c', 'Flambeur', 'Charge brûle la cible (40/s, 4 s)', flag('chargeBrule')),
    ]),
    H(10, 'avantgarde', 2, COMP.lanceEnflammee(2, 35), [
      SP('s10a', 'Brasier', '+20 % dégâts contre les cibles en feu', { avantDegats(c, u, t, info) { if (t.st.brulure > 0 && c.t <= t.st.brulureFin) info.montant *= 1.2; } }),
      SP('s10b', 'Pyromane', '+20 magie, la brûlure ajoute sa magie', [E.stats({ mag: 20 }), flag('brulureMag')], 'mage'),
      SP('s10c', 'Torche', 'Renfort : au début, l\'ennemi le plus proche brûle (30/s, 4 s)', E.renfort((c, cote) => { const l = c.vivants(cote === 'allies' ? 'ennemis' : 'allies'); if (l[0]) c.statut(l[0], 'brulure', 30, 4); })),
    ]),
    H(11, 'avantgarde', 3, COMP.bondProtecteur(250), [
      SP('s11a', 'Gardien', '+20 défense et +15 % PV', E.stats({ def: 20 }, { pv: 0.15 }), 'tank'),
      SP('s11b', 'Riposte', 'Après un bond, ses 3 attaques suivantes font +50 %', [flag('riposte'), { attaque(c, u, t, info) { if (u.riposteCoups > 0) { u.riposteCoups -= 1; info.mult += 0.5; } } }]),
      SP('s11c', 'Ange gardien', 'Stall (10) : relance Bond protecteur', E.stall(10, (c, u) => u.comp.lancer(c, u))),
    ]),
    // Assassins
    H(12, 'assassin', 1, COMP.ombre(2.5), [
      SP('s12a', 'Embuscade', 'Rush (4) : furtif et +30 % critique', [{ mot: 'Rush', debut(c, u) { c.statut(u, 'furtif', 0, 4); } }, E.rush(4, { crit: 30 })]),
      SP('s12b', 'Lame empoisonnée', 'Ses attaques empoisonnent (+1)', E.surAttaque((c, u, t) => c.statut(t, 'poison', 1, 0, u))),
      SP('s12c', 'Coup fatal', '+50 % dégâts critiques', E.stats({ critdeg: 50 })),
    ]),
    H(13, 'assassin', 2, COMP.daguesToxiques(3), [
      SP('s13a', 'Toxicologue', 'Chaque poison qu\'il applique compte double', flag('poisonBonus', 3)),
      SP('s13b', 'Fumigène', 'Après Dagues toxiques : furtif 2 s', flag('fumigene')),
      SP('s13c', 'Pourriture', '+20 magie, les dagues font 160 % de la magie', [E.stats({ mag: 20 }), flag('daguesMag')], 'mage'),
    ], { portee: 2 }),
    H(14, 'assassin', 3, COMP.danseDesLames(4, 0.8), [
      SP('s14a', 'Frénésie', 'Chaque élimination : +15 % vitesse d\'attaque', { tue(c, u) { c.buff(u, 'vit', { mul: 0.15 }); } }),
      SP('s14b', 'Évasion', '20 % d\'esquive', E.stats({ esquive: 20 })),
      SP('s14c', 'Mentor', 'Renfort : toute l\'équipe +5 % critique', E.renfort((c, cote) => { for (const a of c.vivants(cote)) c.buff(a, 'crit', { add: 5 }); })),
    ]),
    // Duellistes
    H(15, 'duelliste', 1, COMP.feinte(3), [
      SP('s15a', 'Maître d\'armes', '+15 % vitesse d\'attaque', E.stats({}, { vit: 0.15 })),
      SP('s15b', 'Riposte', '25 % de chances de riposter', { subit(c, u, src, info) { if (src && info.auto && c.rng() < 0.25) c.degats(u, src, c.s(u, 'atk'), 'phys'); } }),
      SP('s15c', 'Tueur de géants', '+25 % dégâts contre les tanks et les boss', { avantDegats(c, u, t, info) { if (t.boss || t.classes.includes('tank')) info.montant *= 1.25; } }),
    ]),
    H(16, 'duelliste', 2, COMP.estocade(2.5, 20), [
      SP('s16a', 'Concentration', 'Rush (8) : +30 % critique', E.rush(8, { crit: 30 })),
      SP('s16b', 'Lame lourde', '+20 % PV, Estocade étourdit 1 s', [E.stats({}, { pv: 0.2 }), flag('estocadeEtourdit')], 'guerrier'),
      SP('s16c', 'Vol de mana', 'Ses attaques lui rendent 6 mana', E.surAttaque((c, u) => { u.mana += 6; })),
    ]),
    H(17, 'duelliste', 3, COMP.tirPrecis(2.8), [
      SP('s17a', 'Tireur d\'élite', '+1 portée, +10 % critique', E.stats({ portee: 1, crit: 10 })),
      SP('s17b', 'Flèches de glace', 'Ses attaques gèlent (+1)', E.surAttaque((c, u, t) => c.statut(t, 'gel', 1, 0, u))),
      SP('s17c', 'Salve', 'Stall (15) : deux Tirs précis gratuits', E.stall(15, (c, u) => { u.comp.lancer(c, u); u.comp.lancer(c, u); })),
    ], { portee: 5, pv: 675, atk: 37 }),
    // Mages
    H(18, 'mage', 1, COMP.bouleDeFeu(2.2, 1), [
      SP('s18a', 'Combustion', 'Les cibles en feu prennent +20 % de ses dégâts', { avantDegats(c, u, t, info) { if (t.st.brulure > 0 && c.t <= t.st.brulureFin) info.montant *= 1.2; } }),
      SP('s18b', 'Étincelle', 'Commence avec 30 mana', { debut(c, u) { u.mana += 30; } }),
      SP('s18c', 'Météore', 'Boule de feu : rayon +1', flag('rayonBonus', 1)),
    ]),
    H(19, 'mage', 2, COMP.eclairEnChaine(4, 1.6), [
      SP('s19a', 'Surcharge', 'Éclair en chaîne étourdit 0,5 s', flag('surcharge')),
      SP('s19b', 'Conducteur', '+2 rebonds', flag('rebonds', 2)),
      SP('s19c', 'Cercle des mages', 'Renfort : les mages de l\'équipe +10 magie', E.renfort((c, cote) => { for (const a of c.vivants(cote)) if (a.classes.includes('mage')) c.buff(a, 'mag', { add: 10 }); })),
    ]),
    H(20, 'mage', 3, COMP.blizzard(1.2, 2), [
      SP('s20a', 'Engelures', 'Les ennemis gelés perdent 10 PV/s par gel', { tick(c, u, dt) { for (const e of c.ennemisDe(u)) if (e.st.gel) c.degats(u, e, e.st.gel * 10 * dt, 'vrai'); } }),
      SP('s20b', 'Tempête bienveillante', 'Blizzard soigne de 70 les alliés proches', flag('blizzardSoin', 70), 'mystique'),
      SP('s20c', 'Grand froid', 'Stall (15) : Blizzard gratuit', E.stall(15, (c, u) => u.comp.lancer(c, u))),
    ]),
    H(21, 'mage', 3, COMP.rayonArcanique(3.5), [
      SP('s21a', 'Arcaniste', '+25 % magie', E.stats({}, { mag: 0.25 })),
      SP('s21b', 'Siphon', 'Récupère 30 % des dégâts du Rayon', flag('siphon', 0.3)),
      SP('s21c', 'Canalisation', 'Mana max -25', E.stats({ mana: -25 })),
    ]),
    // Mystiques
    H(22, 'mystique', 1, COMP.soin(2.5), [
      SP('s22a', 'Salut', 'Stall (15) : ressuscite le premier allié tombé à 40 %', E.stall(15, (c, u) => { const m = c.unites.find((x) => x.cote === u.cote && x.mort && !x.invoque); if (m) c.ressusciter(m, 0.4); })),
      SP('s22b', 'Lumière', 'Soin inflige aussi 150 % de la magie à l\'ennemi le plus proche', flag('lumiere'), 'mage'),
      SP('s22c', 'Régénération', 'Après un Soin, les alliés récupèrent 2 % de PV/s pendant 5 s', [flag('regenSoin'), { tick(c, u, dt) { for (const a of c.alliesDe(u)) { const r = c.s(a, 'regenPv'); if (r) c.soin(u, a, c.s(a, 'pv') * r * dt, { discret: true }); } } }]),
    ]),
    H(23, 'mystique', 2, COMP.benediction(3), [
      SP('s23a', 'Inspiration', 'Les alliés bénis gagnent +15 % attaque 4 s', flag('benedictionAtk')),
      SP('s23b', 'Aura', 'Renfort : au début, bouclier de 100 à toute l\'équipe', E.renfort((c, cote) => { for (const a of c.vivants(cote)) c.proteger(a, 100); })),
      SP('s23c', 'Égide', 'Boucliers +50 %', flag('egide', 1.5)),
    ]),
    H(24, 'mystique', 3, COMP.sourceDeMana(30), [
      SP('s24a', 'Flux', '+10 régénération de mana', E.stats({ regen: 10 })),
      SP('s24b', 'Harmonie', 'Début : les alliés +3 régénération de mana', { debut(c, u) { for (const a of c.alliesDe(u)) c.buff(a, 'regen', { add: 3 }); } }),
      SP('s24c', 'Déferlante', 'Rush (8) : Source de mana double', flag('sourceDouble')),
    ]),
    H(25, 'mystique', 3, COMP.purification(1), [
      SP('s25a', 'Sanctuaire', '+25 défense et +20 % PV', E.stats({ def: 25 }, { pv: 0.2 }), 'tank'),
      SP('s25b', 'Rédemption', 'Purification soigne +50 %', flag('redemption', 1.5)),
      SP('s25c', 'Renouveau', 'Stall (20) : les alliés récupèrent 25 % de PV', E.stall(20, (c, u) => { for (const a of c.alliesDe(u)) c.soin(u, a, c.s(a, 'pv') * 0.25); })),
    ]),
  ];
  // Les 5 premiers persos de l'équipe (noms, compétences et spécialisations
  // aux couleurs du site) ; les autres restent des homunculus pour l'instant.
  const PERSOS = {
    h1: { nom: 'Le Pelliste', comp: 'Coup de godet', specs: { s1a: ['Heures sup\'', null], s1b: ['Godet bouclier', '+20 défense ; le Coup de godet provoque les ennemis adjacents 2 s'], s1c: ['Café serré', null] } },
    h2: { nom: 'L\'Agent de quai', comp: 'Grand coup de balai', specs: { s2a: ['Récup\' de matériaux', null], s2b: ['Balai brûlant', 'Le coup de balai enflamme (30/s, 3 s)'], s2c: ['Grand ménage', 'Le coup de balai touche jusqu\'à 2 cases'] } },
    h3: { nom: 'Le Chef d\'équipe', comp: 'Briefing de prise de poste', specs: { s3a: ['Esprit d\'équipe', 'Le briefing donne aussi +15 % de vitesse d\'attaque'], s3b: ['Au téléphone', 'Renfort : toute l\'équipe +8 % attaque (même depuis la réserve)'], s3c: ['Débrief de mi-service', 'Stall (15) : refait le briefing et récupère 20 % de PV'] } },
    h4: { nom: 'Le Directeur', comp: 'Rupture conventionnelle', specs: { s4a: ['Chasseur de têtes', null], s4b: ['Négociateur', null], s4c: ['Restructuration', null] } },
    h5: { nom: 'Le Chauffeur PL', comp: 'Coup de klaxon', specs: { s5a: ['Pare-chocs', null], s5b: ['Radio CB', null], s5c: ['Semi en travers', null] } },
  };
  for (const [id, p] of Object.entries(PERSOS)) {
    const def = G.HEROS.find((x) => x.id === id);
    def.nom = p.nom;
    def.comp = { ...def.comp, nom: p.comp };
    def.specs = def.specs.map((sp) => (p.specs[sp.id] ? { ...sp, nom: p.specs[sp.id][0], desc: p.specs[sp.id][1] || sp.desc } : sp));
  }

  // Visuels (pixel art, 84 × 64 par image) : attente, attaque, compétence.
  const VIS = (prefixe, comp, nComp) => ({ idle: [`${prefixe}_idle_spritesheet.png`, 4, 1040], attaque: [`${prefixe}_attaque_spritesheet.png`, 4, 540], comp: [`${prefixe}_${comp}_spritesheet.png`, nComp, 1200] });
  G.VISUELS = {
    h1: VIS('1_pelliste', 'coup_de_godet', 8),
    h2: VIS('2_agent_quai', 'coup_de_balai', 8),
    h3: VIS('3_chef', 'briefing', 7),
    h4: VIS('4_directeur', 'rupture', 8),
    h5: VIS('5_chauffeur', 'klaxon', 7),
  };
  G.VISUEL_L = 84;
  G.VISUEL_H = 64;

  G.heros = (id) => G.HEROS.find((x) => x.id === id);
  G.PRIX_PALIER = { 1: 6, 2: 10, 3: 15 };

  // Feinte : attaques critiques garanties (géré ici pour tous les héros).
  G.EFFETS_COMMUNS = [{
    avantDegats(c, u, t, info) {
      if (info.auto && u.critsGarantis > 0 && !info.crit) { u.critsGarantis -= 1; info.crit = true; info.montant *= 1 + c.s(u, 'critdeg') / 100; }
    },
  }];

  // ---------- Objets (2 par héros) ----------
  // rarete : c, r, e, l ; prix 6 / 10 / 15 / 22.
  const OB = (id, rarete, nom, desc, effet) => ({ id, rarete, nom, desc, effet });
  G.PRIX_RARETE_OBJET = { c: 6, r: 10, e: 15, l: 22 };
  G.OBJETS = [
    OB('o1', 'c', 'Épée courte', '+12 attaque', E.stats({ atk: 12 })),
    OB('o2', 'c', 'Bouclier en bois', '+10 défense', E.stats({ def: 10 })),
    OB('o3', 'c', 'Amulette', '+10 magie', E.stats({ mag: 10 })),
    OB('o4', 'c', 'Bottes légères', '+0,5 déplacement, +5 % vitesse d\'attaque', E.stats({ mvt: 0.5 }, { vit: 0.05 })),
    OB('o5', 'c', 'Gilet rembourré', '+130 PV', E.stats({ pv: 130 })),
    OB('o6', 'c', 'Anneau de mana', '+5 régénération de mana', E.stats({ regen: 5 })),
    OB('o7', 'c', 'Dague', '+7 % critique', E.stats({ crit: 7 })),
    OB('o8', 'c', 'Gants', '+9 % vitesse d\'attaque', E.stats({}, { vit: 0.09 })),
    OB('o9', 'r', 'Hache lourde', '+26 attaque, -5 % vitesse d\'attaque', E.stats({ atk: 26 }, { vit: -0.05 })),
    OB('o10', 'r', 'Cotte de mailles', '+18 défense, +90 PV', E.stats({ def: 18, pv: 90 })),
    OB('o11', 'r', 'Bâton', '+18 magie, +3 régénération', E.stats({ mag: 18, regen: 3 })),
    OB('o12', 'r', 'Lame affûtée', '+12 % critique, +15 % dégâts critiques', E.stats({ crit: 12, critdeg: 15 })),
    OB('o13', 'r', 'Arc court', '+1 portée (héros à distance)', { debut(c, u) { if (u.base.portee > 1) c.buff(u, 'portee', { add: 1 }); } }),
    OB('o14', 'r', 'Fiole de venin', 'Ses attaques empoisonnent (+1)', E.surAttaque((c, u, t) => c.statut(t, 'poison', 1, 0, u))),
    OB('o15', 'r', 'Cape d\'ombre', 'Rush (3) : furtif', { mot: 'Rush', debut(c, u) { c.statut(u, 'furtif', 0, 3); } }),
    OB('o16', 'r', 'Talisman de givre', 'Ses attaques gèlent 1 fois sur 3', E.surAttaque((c, u, t) => { if (c.rng() < 0.33) c.statut(t, 'gel', 1, 0, u); })),
    OB('o17', 'r', 'Torche', 'Ses attaques brûlent (15/s, 2 s)', E.surAttaque((c, u, t) => c.statut(t, 'brulure', 15, 2, u))),
    OB('o18', 'r', 'Médaillon', 'Début : bouclier de 160', { debut(c, u) { c.proteger(u, 160); } }),
    OB('o19', 'e', 'Lame vampirique', '+15 attaque, vol de vie 15 %', E.stats({ atk: 15, vol: 15 })),
    OB('o20', 'e', 'Égide', '+35 défense', E.stats({ def: 35 })),
    OB('o21', 'e', 'Grimoire', '+32 magie', E.stats({ mag: 32 })),
    OB('o22', 'e', 'Cœur de géant', '+380 PV', E.stats({ pv: 380 })),
    OB('o23', 'e', 'Arc long', '+15 attaque, +1 portée (héros à distance)', [E.stats({ atk: 15 }), { debut(c, u) { if (u.base.portee > 1) c.buff(u, 'portee', { add: 1 }); } }]),
    OB('o24', 'e', 'Sablier', 'Stall (12) : +50 % vitesse d\'attaque pendant 6 s', E.stall(12, (c, u) => c.buff(u, 'vit', { mul: 0.5 }, 6))),
    OB('o25', 'e', 'Couronne de mana', 'Début : +40 mana', { debut(c, u) { u.mana += 40; } }),
    OB('o26', 'e', 'Équipement de tank', 'Tanks : +30 défense et +200 PV', { debut(c, u) { if (u.classes.includes('tank')) { c.buff(u, 'def', { add: 30 }); c.buff(u, 'pv', { add: 200 }); } } }),
    OB('o27', 'l', 'Lame légendaire', '+40 attaque, +15 % critique', E.stats({ atk: 40, crit: 15 })),
    OB('o28', 'l', 'Phylactère', 'Une fois par combat : survit à 1 PV', { meurt(c, u) { if (!u.phylactere) { u.phylactere = true; u.pv = 1; c.effet('resu', u); } } }),
    OB('o29', 'l', 'Bâton de l\'archimage', '+50 magie, +8 régénération', E.stats({ mag: 50, regen: 8 })),
    OB('o30', 'l', 'Bouclier du titan', '+50 défense, +400 PV', E.stats({ def: 50, pv: 400 })),
  ];
  G.objet = (id) => G.OBJETS.find((x) => x.id === id);

  // ---------- Reliques (équipe entière) ----------
  // prix : c 10, r 20, e 30, l 40 ; « unique » = kit de départ ; « enchere » = seulement aux enchères.
  // effet : crochets d'unité appliqués à chaque héros (avec filtre) ; debutEquipe ;
  // run : effets sur la partie (victoire, boutique, gain immédiat).
  const RE = (id, rarete, nom, desc, def = {}) => ({ id, rarete, nom, desc, ...def });
  const pourClasse = (cl, effet) => ({ filtre: (h) => h.classes.includes(cl), effet });
  const tous = (effet) => ({ effet });
  G.PRIX_RARETE_RELIQUE = { c: 10, r: 20, e: 30, l: 40 };
  const compter = (c, cote, cl) => c.vivants(cote).filter((u) => u.classes.includes(cl)).length;
  G.RELIQUES = [
    RE('r1', 'c', 'Bannière du guerrier', 'Guerriers : +15 % attaque', pourClasse('guerrier', E.stats({}, { atk: 0.15 }))),
    RE('r2', 'c', 'Blason du tank', 'Tanks : +15 défense', pourClasse('tank', E.stats({ def: 15 }))),
    RE('r3', 'c', 'Cor d\'avant-garde', 'Avant-gardes : +10 % PV et +10 attaque', pourClasse('avantgarde', E.stats({ atk: 10 }, { pv: 0.1 }))),
    RE('r4', 'c', 'Masque d\'assassin', 'Assassins : +10 % critique', pourClasse('assassin', E.stats({ crit: 10 }))),
    RE('r5', 'c', 'Gant de duelliste', 'Duellistes : +12 % vitesse d\'attaque', pourClasse('duelliste', E.stats({}, { vit: 0.12 }))),
    RE('r6', 'c', 'Cristal de mage', 'Mages : +12 magie', pourClasse('mage', E.stats({ mag: 12 }))),
    RE('r7', 'c', 'Encensoir', 'Mystiques : +5 régénération de mana', pourClasse('mystique', E.stats({ regen: 5 }))),
    RE('r8', 'c', 'Pierre de vie', 'Tous : +8 % PV', tous(E.stats({}, { pv: 0.08 }))),
    RE('r9', 'c', 'Pierre de force', 'Tous : +8 attaque', tous(E.stats({ atk: 8 }))),
    RE('r10', 'c', 'Pierre de garde', 'Tous : +7 défense', tous(E.stats({ def: 7 }))),
    RE('r11', 'c', 'Éclat de cristal', 'Tous : +7 magie', tous(E.stats({ mag: 7 }))),
    RE('r12', 'c', 'Plume', 'Tous : +7 % vitesse d\'attaque', tous(E.stats({}, { vit: 0.07 }))),
    RE('r13', 'c', 'Œil de lynx', 'Tous : +5 % critique', tous(E.stats({ crit: 5 }))),
    RE('r14', 'c', 'Bourse', '+2 tickets resto par victoire', { run: { victoire: (r) => { r.eclats += 2; } } }),
    RE('r15', 'c', 'Coffret', '+8 tickets resto tout de suite', { run: { gain: (r) => { r.eclats += 8; } } }),
    RE('r16', 'c', 'Sac de voyage', '+1 objet commun au hasard', { run: { gain: (r, R) => R.donnerObjet(r, 'c') } }),
    RE('r17', 'r', 'Remise', 'Héros 1 ticket resto moins cher en boutique', { run: { remise: 1 } }),
    RE('r18', 'r', 'Dé pipé', 'Une relance gratuite par boutique', { run: { relanceGratuite: 1 } }),
    RE('r19', 'r', 'Intérêts', 'Victoire : +1 ticket resto par tranche de 10 possédés (max 4)', { run: { victoire: (r) => { r.eclats += Math.min(4, Math.floor(r.eclats / 10)); } } }),
    RE('r20', 'r', 'Marchand ami', 'Boutique : une offre de plus', { run: { offreBonus: 1 } }),
    RE('r21', 'r', 'Cor de guerre', 'Rush (6) : tous +25 % vitesse d\'attaque', tous(E.rush(6, {}, { vit: 0.25 }))),
    RE('r22', 'r', 'Totem', 'Stall (15) : tous récupèrent 25 % de PV', tous(E.stall(15, (c, u) => c.soin(null, u, c.s(u, 'pv') * 0.25)))),
    RE('r23', 'r', 'Bénédiction', 'Début : bouclier de 12 % des PV', tous({ debut(c, u) { c.proteger(u, c.s(u, 'pv') * 0.12); } })),
    RE('r24', 'r', 'Braises', 'Les attaques ont 15 % de chances de brûler (20/s, 3 s)', tous(E.surAttaque((c, u, t) => { if (c.rng() < 0.15) c.statut(t, 'brulure', 20, 3, u); }))),
    RE('r25', 'r', 'Fiel', 'Début : tous les ennemis +2 poison', { debutEquipe(c, cote) { for (const e of c.vivants(cote === 'allies' ? 'ennemis' : 'allies')) c.statut(e, 'poison', 2); } }),
    RE('r26', 'r', 'Givre ancien', 'Début : tous les ennemis +2 gel', { debutEquipe(c, cote) { for (const e of c.vivants(cote === 'allies' ? 'ennemis' : 'allies')) c.statut(e, 'gel', 2); } }),
    RE('r27', 'r', 'Premier sang', 'Premier ennemi éliminé : tous +25 mana', tous({ mortEnnemi(c, u) { const k = `premierSang-${u.cote}`; if (c[k] == null) c[k] = c.t; if (c[k] === c.t) u.mana += 25; } })),
    RE('r28', 'r', 'Vengeance', 'Un allié tombe : les autres +15 % attaque 5 s', tous({ mortAllie(c, u) { c.buff(u, 'atk', { mul: 0.15 }, 5); } })),
    RE('r29', 'r', 'Banc chaud', 'Chaque héros en réserve : l\'équipe +3 % PV et attaque', { banc: true }),
    RE('r30', 'r', 'Potion', 'Une fois par combat, le premier héros sous 30 % récupère 300 PV', tous({ tick(c, u) { if (!c.potionBue && u.pv < c.s(u, 'pv') * 0.3) { c.potionBue = true; c.soin(null, u, 300); } } })),
    RE('r31', 'e', 'Front uni', '2 tanks ou plus : tous +15 défense', tous({ debut(c, u) { if (compter(c, u.cote, 'tank') >= 2) c.buff(u, 'def', { add: 15 }); } })),
    RE('r32', 'e', 'Cénacle', '2 mages ou plus : mages +20 magie', tous({ debut(c, u) { if (u.classes.includes('mage') && compter(c, u.cote, 'mage') >= 2) c.buff(u, 'mag', { add: 20 }); } })),
    RE('r33', 'e', 'Meute', '2 guerriers ou plus : guerriers +20 % vitesse d\'attaque', tous({ debut(c, u) { if (u.classes.includes('guerrier') && compter(c, u.cote, 'guerrier') >= 2) c.buff(u, 'vit', { mul: 0.2 }); } })),
    RE('r34', 'e', 'Lame cachée', 'Assassins : commencent furtifs 2 s, +20 % dégâts critiques', pourClasse('assassin', [{ debut(c, u) { c.statut(u, 'furtif', 0, 2); } }, E.stats({ critdeg: 20 })])),
    RE('r35', 'e', 'Plume de phénix', 'Le premier allié qui tombe revient à 40 %', tous({ meurt(c, u) { if (!c.phenixUtilise) { c.phenixUtilise = true; u.pv = c.s(u, 'pv') * 0.4; c.effet('resu', u); } } })),
    RE('r36', 'e', 'Écho arcanique', 'Après une compétence : 20 % de chances de garder la moitié de la mana', tous({ lance(c, u) { if (c.rng() < 0.2) u.mana = c.s(u, 'mana') / 2; } })),
    RE('r37', 'e', 'Diversité', '4 classes différentes ou plus : tous +10 % PV, attaque et magie', tous({ debut(c, u) { if (new Set(c.vivants(u.cote).map((x) => x.classes[0])).size >= 4) { c.buff(u, 'pv', { mul: 0.1 }); c.buff(u, 'atk', { mul: 0.1 }); c.buff(u, 'mag', { mul: 0.1 }); } } })),
    RE('r38', 'e', 'Bouclier de ligne', 'Héros sur la ligne de devant : +20 % PV', tous({ debut(c, u) { if (u.pos.l === Guilde.LIGNES_ALLIES[0] && u.cote === 'allies') c.buff(u, 'pv', { mul: 0.2 }); } })),
    RE('r39', 'e', 'Arrière-garde', 'Héros sur la ligne de derrière : +15 % dégâts', tous({ avantDegats(c, u, t, info) { if (u.pos.l === Guilde.LIGNES_ALLIES[1] && u.cote === 'allies') info.montant *= 1.15; } })),
    RE('r40', 'e', 'Trésor', '+20 tickets resto tout de suite', { run: { gain: (r) => { r.eclats += 20; } } }),
    RE('r41', 'l', 'Cœur de la faille', 'Tous : +15 % à toutes les stats', tous(E.stats({}, { pv: 0.15, atk: 0.15, mag: 0.15, def: 0.15 }))),
    RE('r42', 'l', 'Trèfle', 'Tous : +12 % critique, +25 % dégâts critiques', tous(E.stats({ crit: 12, critdeg: 25 }))),
    RE('r43', 'l', 'Seconde chance', 'Le Rembobinage se recharge à chaque fin d\'acte', { run: { finActe: (r) => { r.rembobinage.dispo = true; } } }),
    RE('r44', 'l', 'Sablier figé', 'Rush plus longs : tous +40 % vitesse d\'attaque pendant 10 s', tous(E.rush(10, {}, { vit: 0.4 }))),
    RE('r45', 'l', 'Couronne', '+1 place en combat', { enchere: true, run: { gain: (r) => { r.places = Math.min(5, r.places + 1); } } }),
    RE('r46', 'l', 'Étendard royal', '+1 place en combat', { enchere: true, run: { gain: (r) => { r.places = Math.min(5, r.places + 1); } } }),
    // Kits de départ (uniques)
    RE('k1', 'unique', 'Kit du soldat', '1 objet commun et 5 tickets resto', { kit: true, run: { gain: (r, R) => { R.donnerObjet(r, 'c'); r.eclats += 5; } } }),
    RE('k2', 'unique', 'Kit du savant', '1 objet rare de mana ou de magie', { kit: true, run: { gain: (r, R) => R.donnerObjet(r, 'r', ['o11', 'o6']) } }),
    RE('k3', 'unique', 'Bourse de départ', '12 tickets resto', { kit: true, run: { gain: (r) => { r.eclats += 12; } } }),
    RE('k4', 'unique', 'Recrue', 'Un héros de palier 2 gratuit', { kit: true, run: { gain: (r, R) => R.donnerHeros(r, 2) } }),
    RE('k5', 'unique', 'Trousse', 'Une relique commune et 3 tickets resto', { kit: true, run: { gain: (r, R) => { R.donnerRelique(r, 'c'); r.eclats += 3; } } }),
    RE('k6', 'unique', 'Kit du vétéran', 'Votre premier héros passe au rang B', { kit: true, run: { gain: (r, R) => R.monterPremier(r) } }),
  ];
  G.relique = (id) => G.RELIQUES.find((x) => x.id === id);

  // ---------- Monstres ----------
  const MO = (id, nom, stats, comp, effets = []) => ({ id, nom, classes: ['monstre'], stats: { mvt: 1.5, critdeg: 50, ...stats }, comp, effets });
  G.MONSTRES = [
    MO('m1', 'Rat géant', { pv: 380, atk: 21, def: 10, vit: 0.66, portee: 1, mvt: 2.2, mana: 0, regen: 0, crit: 5 }, null, [E.surAttaque((c, u, t) => { if (c.rng() < 0.3) c.statut(t, 'poison', 1, 0, u); })]),
    MO('m2', 'Gobelin', { pv: 480, atk: 27, def: 18, vit: 0.51, portee: 1, mana: 60, regen: 6, crit: 10 }, COMP.coupPuissant(1.8, 0)),
    MO('m3', 'Squelette', { pv: 560, atk: 25, def: 40, vit: 0.42, portee: 1, mana: 0, regen: 0, crit: 5 }, null, [{ subit(c, u, s, info) { if (info.type === 'phys') info.montant *= 0.85; } }]),
    MO('m4', 'Slime', { pv: 620, atk: 19, def: 15, vit: 0.36, portee: 1, mvt: 1, mana: 0, regen: 0 }, null, [E.surAttaque((c, u, t) => c.statut(t, 'poison', 1, 0, u))]),
    MO('m5', 'Loup', { pv: 460, atk: 29, def: 15, vit: 0.63, portee: 1, mvt: 2.4, mana: 50, regen: 6, crit: 12 }, { nom: 'Morsure', desc: '', lancer(c, u) { const t = c.cibleDe(u); if (t) { c.degats(u, t, c.s(u, 'atk') * 1.6, 'phys'); c.statut(t, 'brulure', 15, 3, u); } } }),
    MO('m6', 'Orc', { pv: 900, atk: 36, def: 35, vit: 0.36, portee: 1, mana: 70, regen: 6, crit: 5 }, COMP.coupPuissant(2, 1.2)),
    MO('m7', 'Archer squelette', { pv: 420, atk: 25, def: 20, vit: 0.45, portee: 4, mana: 0, regen: 0, crit: 8 }, null),
    MO('m8', 'Sorcier gobelin', { pv: 440, atk: 12, def: 18, mag: 34, vit: 0.36, portee: 4, mana: 80, regen: 6 }, COMP.bouleDeFeu(1.8, 1)),
    MO('m9', 'Golem de pierre', { pv: 1300, atk: 31, def: 60, vit: 0.27, portee: 1, mvt: 1, mana: 100, regen: 6 }, COMP.provocation(2, 3, 20)),
    MO('m10', 'Spectre', { pv: 520, atk: 19, def: 20, mag: 38, vit: 0.42, portee: 2, mvt: 2, mana: 60, regen: 6, esquive: 20 }, { nom: 'Hurlement', desc: '', lancer(c, u) { for (const e of c.autour(u.pos, 2, c.ennemisDe(u))) { c.degats(u, e, c.s(u, 'mag') * 1.4, 'mag'); c.statut(e, 'gel', 1); } } }, [{ debut(c, u) { c.statut(u, 'furtif', 0, 2); } }]),
  ];
  G.monstre = (id) => G.MONSTRES.find((x) => x.id === id);
  // Variantes d'élite.
  G.VARIANTES = [
    { id: 'enrage', nom: 'enragé', mul: { atk: 0.3, vit: 0.2 } },
    { id: 'cuirasse', nom: 'cuirassé', add: { def: 35 }, mul: { pv: 0.2 } },
    { id: 'venimeux', nom: 'venimeux', effets: [E.surAttaque((c, u, t) => c.statut(t, 'poison', 2, 0, u))] },
    { id: 'glacial', nom: 'glacial', effets: [E.surAttaque((c, u, t) => c.statut(t, 'gel', 1, 0, u))] },
    { id: 'regenerant', nom: 'régénérant', effets: [{ tick(c, u, dt) { c.soin(u, u, c.s(u, 'pv') * 0.02 * dt, { discret: true }); } }] },
  ];
  G.ACTES = [
    { nom: 'Les Abords de la Faille', monstres: ['m1', 'm2', 'm3', 'm4', 'm5', 'm7'] },
    { nom: 'Le Cœur de la Faille', monstres: ['m3', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10'] },
  ];

  // ---------- Boss (3) ----------
  G.BOSS = [
    {
      id: 'b1', nom: 'L\'Hydre', acte: 1, classes: ['monstre'], boss: true,
      stats: { pv: 3600, atk: 37, def: 35, mag: 30, vit: 0.48, portee: 2, mvt: 1, mana: 100, regen: 8, crit: 5 },
      comp: { nom: 'Trois têtes', desc: 'Mord les 3 ennemis les plus proches', lancer(c, u) { const l = c.ennemisDe(u).filter((x) => c.ciblable(x)).sort((a, b) => Guilde.dist(u.pos, a.pos) - Guilde.dist(u.pos, b.pos)).slice(0, 3); for (const e of l) { c.degats(u, e, c.s(u, 'atk') * 1.8, 'phys'); c.statut(e, 'poison', 2, 0, u); } } },
      effets: [E.stall(15, (c, u) => { c.soin(u, u, c.s(u, 'pv') * 0.25); c.log('L\'Hydre fait repousser ses têtes !', 'ennemi'); })],
    },
    {
      id: 'b2', nom: 'Le Démon', acte: 1, classes: ['monstre'], boss: true,
      stats: { pv: 3200, atk: 34, def: 30, mag: 45, vit: 0.45, portee: 1, mvt: 1.4, mana: 90, regen: 8, crit: 10 },
      comp: { nom: 'Souffle infernal', desc: 'Brûle tous les ennemis à 2 cases', lancer(c, u) { for (const e of c.autour(u.pos, 2, c.ennemisDe(u))) { c.degats(u, e, c.s(u, 'mag') * 2, 'mag'); c.statut(e, 'brulure', 35, 4, u); } } },
      effets: [{ tick(c, u) { if (!u.enrage && u.pv < c.s(u, 'pv') / 2) { u.enrage = true; c.buff(u, 'atk', { mul: 0.4 }); c.buff(u, 'vit', { mul: 0.3 }); c.log('Le Démon entre en furie !', 'ennemi'); } } }],
    },
    {
      id: 'b3', nom: 'Le Seigneur de la Faille', acte: 2, classes: ['monstre'], boss: true,
      stats: { pv: 6200, atk: 46, def: 45, mag: 60, vit: 0.45, portee: 2, mvt: 1, mana: 110, regen: 8, crit: 10 },
      comp: { nom: 'Vague d\'ombre', desc: 'Frappe tous les ennemis et les gèle', lancer(c, u) { for (const e of c.ennemisDe(u)) { c.degats(u, e, c.s(u, 'mag') * 1.5, 'mag'); c.statut(e, 'gel', 2); } } },
      effets: [{
        tick(c, u) {
          const r = u.pv / c.s(u, 'pv');
          for (const seuil of [0.66, 0.33]) {
            if (r < seuil && !(u.invoc || []).includes(seuil)) {
              u.invoc = [...(u.invoc || []), seuil];
              c.log('Le Seigneur de la Faille appelle des serviteurs !', 'ennemi');
              for (let i = 0; i < 2; i++) c.invoquer(u.cote, Guilde.ficheMonstre('m10', 8, 1), u.pos);
            }
          }
        },
      }],
    },
  ];

  // ---------- Événements ----------
  // choix : { txt, fn(r, R) → message } ; fixe : étage où il revient toujours.
  G.EVENEMENTS = [
    { id: 'e1', nom: 'Marchand ambulant', txt: 'Un marchand vous propose un objet rare à prix cassé.', choix: [
      { txt: 'Acheter un objet rare (6 tickets resto)', cond: (r) => r.eclats >= 6, fn: (r, R) => { r.eclats -= 6; return `Vous obtenez ${R.donnerObjet(r, 'r').nom}.`; } },
      { txt: 'Passer son chemin', fn: () => 'Le marchand hausse les épaules.' }] },
    { id: 'e2', nom: 'Fontaine de jouvence', fixe: 4, txt: 'Une eau claire qui fortifie.', choix: [
      { txt: 'Faire boire un héros (il monte d\'un rang)', heros: true, fn: (r, R, h) => R.monterRang(r, h) },
      { txt: 'Remplir sa gourde (+5 tickets resto)', fn: (r) => { r.eclats += 5; return '+5 tickets resto.'; } }] },
    { id: 'e3', nom: 'Coffre suspect', txt: 'Un coffre au milieu du chemin…', choix: [
      { txt: 'L\'ouvrir', fn: (r, R) => (R.rng(r) < 0.6 ? `Une relique : ${R.donnerRelique(r, 'r').nom} !` : (r.eclats = Math.max(0, r.eclats - 5), 'Piège ! Vous perdez 5 tickets resto.')) },
      { txt: 'Ne pas y toucher', fn: () => 'Prudence est mère de sûreté.' }] },
    { id: 'e4', nom: 'Recrue errante', txt: 'Un aventurier cherche du travail.', choix: [
      { txt: 'L\'engager', cond: (r, R) => R.placeLibre(r), fn: (r, R) => `${R.donnerHeros(r, 1).nom} rejoint l\'équipe.` },
      { txt: 'Lui donner de quoi manger (+4 tickets resto de gratitude)', fn: (r) => { r.eclats += 4; return '+4 tickets resto.'; } }] },
    { id: 'e5', nom: 'Forge abandonnée', txt: 'L\'enclume est encore chaude.', choix: [
      { txt: 'Améliorer un objet (rareté supérieure)', cond: (r) => r.objets.some((o) => o) || r.heros.some((h) => h.objets.length), fn: (r, R) => R.ameliorerObjet(r) },
      { txt: 'Récupérer de la ferraille (+3 tickets resto)', fn: (r) => { r.eclats += 3; return '+3 tickets resto.'; } }] },
    { id: 'e6', nom: 'Pacte obscur', txt: 'Une voix propose un marché…', choix: [
      { txt: 'Accepter (relique épique, prochain combat plus dur)', fn: (r, R) => { r.malediction = 1; return `Vous obtenez ${R.donnerRelique(r, 'e').nom}. Les ennemis seront plus forts au prochain combat.`; } },
      { txt: 'Refuser', fn: () => 'La voix se tait.' }] },
    { id: 'e7', nom: 'Mendiant', txt: 'Un vieil homme tend la main.', choix: [
      { txt: 'Donner 5 tickets resto', cond: (r) => r.eclats >= 5, fn: (r, R) => { r.eclats -= 5; return `En remerciement : ${R.donnerRelique(r, 'c').nom}.`; } },
      { txt: 'L\'ignorer', fn: () => 'Il disparaît dans la brume.' }] },
    { id: 'e8', nom: 'Terrain d\'entraînement', fixe: 9, txt: 'Un instructeur propose ses services.', choix: [
      { txt: 'S\'entraîner (tous les héros +6 % PV et attaque)', fn: (r) => { for (const h of r.heros) h.entrainement = (h.entrainement || 0) + 1; return 'Toute l\'équipe progresse.'; } },
      { txt: 'Vendre ses conseils (+6 tickets resto)', fn: (r) => { r.eclats += 6; return '+6 tickets resto.'; } }] },
    { id: 'e9', nom: 'Puits aux souhaits', txt: 'On dit qu\'il exauce les vœux.', choix: [
      { txt: 'Jeter 3 tickets resto', cond: (r) => r.eclats >= 3, fn: (r, R) => { r.eclats -= 3; if (R.rng(r) < 0.5) { r.eclats += 10; return 'Le puits vous rend 10 tickets resto !'; } return 'Plouf. Rien.'; } },
      { txt: 'Continuer', fn: () => 'Rien ne se passe.' }] },
    { id: 'e10', nom: 'Bibliothèque oubliée', txt: 'Des traités de combat poussiéreux.', choix: [
      { txt: 'Changer la spécialisation d\'un héros (rang B ou plus)', heros: (h) => G.RANGS.indexOf(h.rang) >= 1, fn: (r, R, h) => R.oublierSpec(r, h) },
      { txt: 'Revendre un livre (+4 tickets resto)', fn: (r) => { r.eclats += 4; return '+4 tickets resto.'; } }] },
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = G;
}(typeof window !== 'undefined' ? window : globalThis));
