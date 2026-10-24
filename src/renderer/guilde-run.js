'use strict';

// La Guilde — déroulé d'une partie (« run ») : départ, combats, boutique,
// carrefours (événement / feu de camp / combat défi), rangs C → B → A → S,
// spécialisations, améliorations, enchères de fin d'acte, rembobinage
// d'urgence, boss, mode Endless et score. L'état est un simple objet JSON
// (sauvegardé tel quel) ; les écrans le lisent et appellent ces fonctions.

(function (racine) {
  const G = racine.Guilde = racine.Guilde || {};
  const R = G.Run = {};

  R.ETAGES_PAR_ACTE = 6;
  R.TOTAL_ETAGES = 12;
  R.MAX_HEROS = 6;
  R.MAX_OBJETS_HEROS = 2;
  R.MAX_INVENTAIRE = 8;

  // ---------- Hasard ----------
  R.rng = (r) => G.hasard((r.graine + 7919 * (r.tirages = (r.tirages || 0) + 1)) >>> 0)();
  const tirer = (r, liste) => liste[Math.floor(R.rng(r) * liste.length)];
  const melanger = (r, liste) => { const l = liste.slice(); for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(R.rng(r) * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };
  const pondere = (r, poids) => { const tot = Object.values(poids).reduce((a, b) => a + b, 0); let x = R.rng(r) * tot; for (const [k, v] of Object.entries(poids)) { x -= v; if (x <= 0) return k; } return Object.keys(poids)[0]; };
  const uid = (r) => `u${(r.seq = (r.seq || 0) + 1)}`;
  R.niveau = (r) => r.etage + (r.endless || 0);
  R.acteDe = (etage) => (etage <= R.ETAGES_PAR_ACTE ? 1 : 2);

  // ---------- Création ----------
  R.nouvellePartie = (nom, difficulte = 1, graine = Date.now() % 2147483647) => {
    const r = {
      v: 1, nom, difficulte, graine, tirages: 0, seq: 0, etage: 1, eclats: 0, places: 3,
      heros: [], objets: [], reliques: [], rembobinage: { dispo: true, reserve: 0 },
      boss1: null, endless: 0, malediction: 0, reliqueTemp: null, enAttente: [],
      historique: [], victoires: 0, fini: false, gagne: false, debut: new Date().toISOString(),
    };
    r.boss1 = tirer(r, ['b1', 'b2']);
    const p1 = melanger(r, G.HEROS.filter((h) => h.palier === 1)).slice(0, 3).map((h) => h.id);
    const kits = melanger(r, G.RELIQUES.filter((x) => x.kit)).slice(0, 3).map((x) => x.id);
    r.ecran = { type: 'depart', heros: p1, kits };
    return r;
  };

  // Départ : un héros au choix, un kit, quelques éclats et une première boutique.
  R.ECLATS_DEPART = 8;
  R.choisirDepart = (r, heroId, kitId) => {
    R.ajouterHeros(r, heroId);
    r.eclats += R.ECLATS_DEPART;
    R.donnerReliqueId(r, kitId);
    R.ouvrirBoutique(r);
    r.ecran.retour = 'combat';
  };

  // ---------- Héros ----------
  R.placeLibre = (r) => r.heros.length < R.MAX_HEROS;
  R.enCombat = (r) => r.heros.filter((h) => h.pos);
  R.auBanc = (r) => r.heros.filter((h) => !h.pos);
  R.caseOccupee = (r, p, sauf) => r.heros.some((h) => h !== sauf && h.pos && h.pos.c === p.c && h.pos.l === p.l);

  // Place automatiquement un héros s'il reste des places en combat.
  R.placerAuto = (r, h) => {
    if (R.enCombat(r).length >= r.places) return;
    const def = G.heros(h.id);
    const lignes = def.stats.portee > 1 ? [G.LIGNES_ALLIES[1], G.LIGNES_ALLIES[0]] : [G.LIGNES_ALLIES[0], G.LIGNES_ALLIES[1]];
    for (const l of lignes) {
      for (const c of [3, 4, 2, 5, 1, 6, 0, 7]) {
        if (!R.caseOccupee(r, { c, l })) { h.pos = { c, l }; return; }
      }
    }
  };

  R.ajouterHeros = (r, id, rang = 'C') => {
    const h = { uid: uid(r), id, rang, spec: null, ups: [], objets: [], pos: null, entrainement: 0 };
    r.heros.push(h);
    R.placerAuto(r, h);
    const ri = G.RANGS.indexOf(rang);
    if (ri >= 1) R.proposerSpec(r, h);
    return h;
  };

  R.deplacerHeros = (r, h, pos) => {
    if (!pos) { h.pos = null; return true; }
    if (!G.LIGNES_ALLIES.includes(pos.l) || pos.c < 0 || pos.c >= G.COLS) return false;
    const autre = r.heros.find((x) => x !== h && x.pos && x.pos.c === pos.c && x.pos.l === pos.l);
    if (autre) { autre.pos = h.pos ? { ...h.pos } : null; h.pos = { ...pos }; return true; }
    if (!h.pos && R.enCombat(r).length >= r.places) return false;
    h.pos = { ...pos };
    return true;
  };

  R.prixHeros = (r, id) => Math.max(1, G.PRIX_PALIER[G.heros(id).palier] - R.bonusRun(r, 'remise'));
  R.prixVente = (h) => Math.max(1, Math.floor((G.PRIX_PALIER[G.heros(h.id).palier] * (G.RANGS.indexOf(h.rang) + 1)) / 2));

  R.vendreHeros = (r, h) => {
    r.eclats += R.prixVente(h);
    for (const o of h.objets) if (r.objets.length < R.MAX_INVENTAIRE) r.objets.push(o);
    r.heros = r.heros.filter((x) => x !== h);
    r.enAttente = r.enAttente.filter((x) => x.uid !== h.uid);
  };

  // Monte d'un rang (doublon, feu de camp, fontaine…).
  R.monterRang = (r, h) => {
    const ri = G.RANGS.indexOf(h.rang);
    if (ri >= 3) { r.eclats += 3; return `${G.heros(h.id).nom} est déjà au rang S : +3 éclats.`; }
    h.rang = G.RANGS[ri + 1];
    if (ri + 1 === 1) R.proposerSpec(r, h);
    else R.proposerAmelioration(r, h);
    return `${G.heros(h.id).nom} passe au rang ${h.rang} !`;
  };

  R.proposerSpec = (r, h) => {
    r.enAttente.push({ type: 'spec', uid: h.uid, options: G.heros(h.id).specs.map((s) => s.id) });
  };

  const poidsRarete = (r) => {
    const n = R.niveau(r);
    if (n <= 4) return { c: 70, r: 25, e: 5 };
    if (n <= 8) return { c: 45, r: 40, e: 15 };
    return { c: 25, r: 45, e: 30 };
  };
  R.classesHeros = (h) => {
    const def = G.heros(h.id);
    const spec = h.spec && def.specs.find((s) => s.id === h.spec);
    return [...def.classes, ...(spec && spec.classe2 ? [spec.classe2] : [])];
  };
  R.proposerAmelioration = (r, h) => {
    const classes = R.classesHeros(h);
    const pool = G.AMELIORATIONS.filter((a) => classes.includes(a.classe) && !h.ups.includes(a.id));
    const options = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      const rar = pondere(r, poidsRarete(r));
      const l = pool.filter((a) => a.rarete === rar && !options.includes(a.id));
      const a = l.length ? tirer(r, l) : tirer(r, pool.filter((x) => !options.includes(x.id)));
      if (a) options.push(a.id);
    }
    if (options.length) r.enAttente.push({ type: 'amelioration', uid: h.uid, options });
  };

  R.resoudreAttente = (r, choixId) => {
    const a = r.enAttente.shift();
    if (!a) return;
    const h = r.heros.find((x) => x.uid === a.uid);
    if (!h) return;
    if (a.type === 'spec') h.spec = choixId;
    else if (a.type === 'amelioration') {
      if (a.relance) h.ups = h.ups.filter((x) => x !== a.relance);
      h.ups.push(choixId);
    }
  };

  R.oublierSpec = (r, h) => {
    h.spec = null;
    R.proposerSpec(r, h);
    return `${G.heros(h.id).nom} va choisir une nouvelle spécialisation.`;
  };

  // ---------- Objets et reliques ----------
  R.donnerObjet = (r, rarete, ids) => {
    const pool = ids ? G.OBJETS.filter((o) => ids.includes(o.id)) : G.OBJETS.filter((o) => o.rarete === rarete);
    const o = tirer(r, pool);
    if (r.objets.length < R.MAX_INVENTAIRE) r.objets.push(o.id);
    return o;
  };
  R.equiper = (r, h, idx) => {
    if (h.objets.length >= R.MAX_OBJETS_HEROS) return false;
    const [o] = r.objets.splice(idx, 1);
    if (o) h.objets.push(o);
    return !!o;
  };
  R.desequiper = (r, h, idx) => {
    if (r.objets.length >= R.MAX_INVENTAIRE) return false;
    const [o] = h.objets.splice(idx, 1);
    if (o) r.objets.push(o);
    return !!o;
  };
  R.ameliorerObjet = (r) => {
    const ordre = ['c', 'r', 'e', 'l'];
    const sources = [...r.heros.flatMap((h) => h.objets.map((id, i) => ({ liste: h.objets, i, id }))), ...r.objets.map((id, i) => ({ liste: r.objets, i, id }))]
      .filter((x) => G.objet(x.id).rarete !== 'l');
    if (!sources.length) return 'Aucun objet à améliorer.';
    const s = sources.sort((a, b) => ordre.indexOf(G.objet(a.id).rarete) - ordre.indexOf(G.objet(b.id).rarete))[0];
    const avant = G.objet(s.id);
    const nouv = tirer(r, G.OBJETS.filter((o) => o.rarete === ordre[ordre.indexOf(avant.rarete) + 1]));
    s.liste[s.i] = nouv.id;
    return `${avant.nom} devient ${nouv.nom}.`;
  };

  R.donnerReliqueId = (r, id) => {
    const x = G.relique(id);
    if (!x) return null;
    if (!x.kit) r.reliques.push(id);
    else r.reliques.push(id);
    if (x.run && x.run.gain) x.run.gain(r, R);
    return x;
  };
  const reliquesDispo = (r, rarete) => G.RELIQUES.filter((x) => !x.kit && !x.enchere && !r.reliques.includes(x.id) && (!rarete || x.rarete === rarete));
  R.donnerRelique = (r, rarete) => {
    const pool = reliquesDispo(r, rarete);
    const x = tirer(r, pool.length ? pool : reliquesDispo(r));
    return x ? R.donnerReliqueId(r, x.id) : { nom: 'rien' };
  };
  R.bonusRun = (r, cle) => r.reliques.reduce((t, id) => t + ((G.relique(id).run || {})[cle] || 0), 0);
  R.donnerHeros = (r, palier) => {
    const def = tirer(r, G.HEROS.filter((h) => h.palier === palier));
    if (!R.placeLibre(r)) { r.eclats += G.PRIX_PALIER[palier]; return def; }
    R.ajouterHeros(r, def.id);
    return def;
  };
  R.monterPremier = (r) => { if (r.heros[0]) R.monterRang(r, r.heros[0]); };

  // ---------- Fiches de combat ----------
  R.ficheHeros = (r, h) => {
    const def = G.heros(h.id);
    const ri = G.RANGS.indexOf(h.rang);
    const m = G.MULT_RANG[ri] * (1 + 0.06 * (h.entrainement || 0));
    const stats = { ...def.stats };
    for (const k of ['pv', 'atk', 'mag']) stats[k] = Math.round((stats[k] || 0) * m);
    const classes = R.classesHeros(h);
    classes.forEach((cl, i) => {
      for (const [k, v] of Object.entries(G.CLASSES[cl].croissance)) stats[k] = (stats[k] || 0) + v * ri * (i ? 0.5 : 1);
    });
    const spec = h.spec && def.specs.find((s) => s.id === h.spec);
    const effets = [...G.EFFETS_COMMUNS];
    if (spec) effets.push(...spec.effets);
    for (const a of h.ups) effets.push(G.AMELIORATIONS.find((x) => x.id === a).effet);
    for (const o of h.objets) effets.push(...[].concat(G.objet(o).effet));
    const reliques = [...r.reliques, ...(r.reliqueTemp ? [r.reliqueTemp] : [])];
    const ficheFiltre = { classes };
    for (const id of reliques) {
      const x = G.relique(id);
      if (x.effet && (!x.filtre || x.filtre(ficheFiltre))) effets.push(...[].concat(x.effet));
      if (x.banc) {
        const n = R.auBanc(r).length;
        if (n) effets.push(G.E.stats({}, { pv: 0.03 * n, atk: 0.03 * n }));
      }
    }
    return { nom: def.nom, num: def.num, ref: h.uid, classes, stats, comp: def.comp, effets, pos: h.pos };
  };

  G.ficheMonstre = (id, niveau, difficulte, variante = null) => {
    const def = G.monstre(id) || G.BOSS.find((b) => b.id === id);
    const k = (1 + 0.11 * (niveau - 1)) * (1 + 0.12 * (difficulte - 1));
    const stats = { ...def.stats };
    for (const s of ['pv', 'atk', 'mag']) stats[s] = Math.round((stats[s] || 0) * k);
    stats.def = (stats.def || 0) + 2 * (niveau - 1);
    const effets = [...(def.effets || [])];
    let nom = def.nom;
    const v = variante && G.VARIANTES.find((x) => x.id === variante);
    if (v) {
      nom = `${def.nom} ${v.nom}`;
      for (const [s, x] of Object.entries(v.add || {})) stats[s] = (stats[s] || 0) + x;
      for (const [s, x] of Object.entries(v.mul || {})) stats[s] = (stats[s] || 0) * (1 + x);
      for (const s of ['pv', 'atk', 'mag']) stats[s] = Math.round(stats[s] * 1.35);
      effets.push(...(v.effets || []));
    }
    return { nom, ref: id, classes: def.classes || ['monstre'], boss: !!def.boss, stats, comp: def.comp, effets };
  };

  // ---------- Rencontres ----------
  const placerEnnemis = (r, liste) => {
    const prises = new Set();
    return liste.map((e) => {
      const def = G.monstre(e.id) || G.BOSS.find((b) => b.id === e.id);
      const ligne = e.boss ? 0 : def.stats.portee > 1 ? 0 : 1;
      const cols = melanger(r, [3, 4, 2, 5, 1, 6, 0, 7]);
      let col = e.boss ? 3 : cols.find((c) => !prises.has(`${c},${ligne}`));
      if (col == null) col = cols.find((c) => !prises.has(`${c},${1 - ligne}`));
      prises.add(`${col},${ligne}`);
      return { ...e, pos: { c: col, l: ligne } };
    });
  };

  R.preparerCombat = (r, type) => {
    const n = R.niveau(r);
    const acte = R.acteDe(Math.min(r.etage, R.TOTAL_ETAGES));
    const pool = G.ACTES[acte - 1].monstres;
    let liste;
    if (type === 'boss') {
      const bossId = r.etage === R.ETAGES_PAR_ACTE ? r.boss1 : 'b3';
      liste = [{ id: bossId, boss: true }, { id: tirer(r, pool) }, { id: tirer(r, pool) }];
    } else {
      const nb = Math.min(6, 1 + Math.ceil(n / 2) + (type === 'defi' ? 1 : 0));
      const elites = type === 'defi' ? 2 : (r.difficulte >= 4 && R.rng(r) < 0.3 ? 1 : 0) + (type === 'endless' ? Math.min(3, Math.floor(r.endless / 2)) : 0);
      liste = Array.from({ length: nb }, (_, i) => ({ id: tirer(r, pool), variante: i < elites ? tirer(r, G.VARIANTES).id : null }));
    }
    r.combat = { type, ennemis: placerEnnemis(r, liste) };
    r.ecran = { type: 'preparation' };
  };

  R.fichesEnnemis = (r) => {
    const n = R.niveau(r);
    const k = r.malediction ? 1.2 : 1;
    return r.combat.ennemis.map((e) => {
      const f = G.ficheMonstre(e.id, n, r.difficulte, e.variante);
      if (k !== 1) for (const s of ['pv', 'atk', 'mag']) f.stats[s] = Math.round(f.stats[s] * k);
      return { ...f, pos: e.pos };
    });
  };

  R.creerCombat = (r) => {
    const allies = R.enCombat(r).map((h) => R.ficheHeros(r, h));
    const renforts = R.auBanc(r).map((h) => R.ficheHeros(r, h));
    const equipe = [...r.reliques, ...(r.reliqueTemp ? [r.reliqueTemp] : [])].map((id) => G.relique(id)).filter((x) => x.debutEquipe);
    return new G.Combat(allies, R.fichesEnnemis(r), { graine: (r.graine + r.etage * 977 + (r.endless || 0) * 131 + (r.tirages || 0)) >>> 0, renforts, equipeAllies: equipe });
  };

  // ---------- Après le combat ----------
  R.resultatCombat = (r, gagne) => {
    const type = r.combat.type;
    r.reliqueTemp = null;
    r.malediction = 0;
    r.historique.push({ etage: r.etage, endless: r.endless, type, gagne });
    if (gagne) {
      r.victoires += 1;
      let gain = 3 + R.acteDe(Math.min(r.etage, 12)) + (type === 'defi' ? 3 : 0) + (type === 'boss' ? 8 : 0);
      if (type === 'endless') gain = 6;
      r.eclats += gain;
      for (const id of r.reliques) { const x = G.relique(id); if (x.run && x.run.victoire) x.run.victoire(r, R); }
      if (r.rembobinage.dispo && type !== 'endless') r.rembobinage.reserve += 5;
      r.message = `Victoire ! +${gain} éclats.`;
      if (type === 'boss' && r.etage === R.ETAGES_PAR_ACTE) return R.recompenseRelique(r, ['r', 'e'], 'finActe1');
      if (type === 'boss') { r.gagne = true; r.ecran = { type: 'victoireFinale' }; return r; }
      if (type === 'defi') return R.recompenseRelique(r, ['r', 'e'], 'suite');
      if (type === 'endless' && r.endless % 3 === 0) return R.recompenseRelique(r, ['e', 'l'], 'boutique');
      return R.ouvrirBoutique(r);
    }
    if (r.rembobinage.dispo && type !== 'endless') {
      r.rembobinage.dispo = false;
      const rendu = r.rembobinage.reserve;
      r.eclats += rendu;
      r.rembobinage.reserve = 0;
      r.message = `Défaite… Le rembobinage d'urgence s'active : +${rendu} éclats, la partie continue.`;
      if (type === 'boss') { r.ecran = { type: 'preparation' }; return r; }
      if (type === 'defi') return R.etageSuivant(r);
      return R.ouvrirBoutique(r);
    }
    return R.terminer(r, false);
  };

  R.recompenseRelique = (r, raretes, suite) => {
    const opts = [];
    for (const rar of [...raretes, raretes[raretes.length - 1]]) {
      const pool = reliquesDispo(r, rar).filter((x) => !opts.includes(x.id));
      if (pool.length) opts.push(tirer(r, pool).id);
    }
    r.ecran = { type: 'recompense', reliques: opts.slice(0, 3), suite };
    return r;
  };
  R.choisirRecompense = (r, id) => {
    if (id) R.donnerReliqueId(r, id);
    const suite = r.ecran.suite;
    if (suite === 'finActe1') {
      for (const x of r.reliques) { const rel = G.relique(x); if (rel.run && rel.run.finActe) rel.run.finActe(r, R); }
      return R.ouvrirEnchere(r);
    }
    if (suite === 'boutique') return R.ouvrirBoutique(r);
    return R.etageSuivant(r);
  };

  // ---------- Boutique ----------
  const poidsPalier = (n) => (n <= 3 ? { 1: 70, 2: 30, 3: 0 } : n <= 6 ? { 1: 40, 2: 45, 3: 15 } : n <= 9 ? { 1: 20, 2: 45, 3: 35 } : { 1: 10, 2: 40, 3: 50 });
  const poidsObjet = (n) => (n <= 3 ? { c: 65, r: 30, e: 5, l: 0 } : n <= 7 ? { c: 40, r: 40, e: 17, l: 3 } : { c: 20, r: 40, e: 30, l: 10 });
  const poidsRelique = (n) => (n <= 4 ? { c: 70, r: 30, e: 0, l: 0 } : n <= 8 ? { c: 40, r: 45, e: 15, l: 0 } : { c: 20, r: 45, e: 30, l: 5 });

  R.genererOffres = (r) => {
    const n = R.niveau(r);
    const nbHeros = 3 + R.bonusRun(r, 'offreBonus');
    const heros = Array.from({ length: nbHeros }, () => tirer(r, G.HEROS.filter((h) => h.palier === Number(pondere(r, poidsPalier(n))))).id);
    const objets = Array.from({ length: 2 }, () => { const rar = pondere(r, poidsObjet(n)); return tirer(r, G.OBJETS.filter((o) => o.rarete === rar)).id; });
    const rar = pondere(r, poidsRelique(n));
    const pool = reliquesDispo(r, rar);
    const relique = (pool.length ? tirer(r, pool) : tirer(r, reliquesDispo(r)) || {}).id || null;
    return { heros: heros.map((id) => ({ id, vendu: false })), objets: objets.map((id) => ({ id, vendu: false })), reliques: relique ? [{ id: relique, vendu: false }] : [] };
  };
  R.ouvrirBoutique = (r) => {
    r.ecran = { type: 'boutique', offres: R.genererOffres(r), relances: 0, gratuites: R.bonusRun(r, 'relanceGratuite') };
    return r;
  };
  R.prixRelance = (r) => (r.ecran.gratuites > 0 ? 0 : 2 + r.ecran.relances);
  R.relancer = (r) => {
    const p = R.prixRelance(r);
    if (r.eclats < p) return false;
    r.eclats -= p;
    if (r.ecran.gratuites > 0) r.ecran.gratuites -= 1;
    else r.ecran.relances += 1;
    r.ecran.offres = R.genererOffres(r);
    return true;
  };
  R.acheterHeros = (r, i) => {
    const o = r.ecran.offres.heros[i];
    if (!o || o.vendu) return 'Déjà acheté.';
    const prix = R.prixHeros(r, o.id);
    if (r.eclats < prix) return 'Pas assez d\'éclats.';
    const double = r.heros.find((h) => h.id === o.id && h.rang !== 'S');
    if (!double && !R.placeLibre(r)) return 'Guilde complète (6 héros) : vendez-en un d\'abord.';
    r.eclats -= prix;
    o.vendu = true;
    if (double) return R.monterRang(r, double);
    R.ajouterHeros(r, o.id);
    return `${G.heros(o.id).nom} rejoint la guilde.`;
  };
  R.acheterObjet = (r, i) => {
    const o = r.ecran.offres.objets[i];
    if (!o || o.vendu) return 'Déjà acheté.';
    const prix = G.PRIX_RARETE_OBJET[G.objet(o.id).rarete];
    if (r.eclats < prix) return 'Pas assez d\'éclats.';
    if (r.objets.length >= R.MAX_INVENTAIRE) return 'Inventaire plein.';
    r.eclats -= prix;
    o.vendu = true;
    r.objets.push(o.id);
    return `${G.objet(o.id).nom} ajouté à l'inventaire.`;
  };
  R.acheterRelique = (r, i) => {
    const o = r.ecran.offres.reliques[i];
    if (!o || o.vendu) return 'Déjà achetée.';
    const prix = G.PRIX_RARETE_RELIQUE[G.relique(o.id).rarete];
    if (r.eclats < prix) return 'Pas assez d\'éclats.';
    r.eclats -= prix;
    o.vendu = true;
    R.donnerReliqueId(r, o.id);
    return `${G.relique(o.id).nom} obtenue.`;
  };
  R.quitterBoutique = (r) => {
    if (r.ecran.retour === 'combat') { R.preparerCombat(r, 'normal'); return r; }
    if (r.ecran.retour === 'endless' || r.endless) { r.endless += 1; R.preparerCombat(r, 'endless'); return r; }
    return R.ouvrirCarrefour(r);
  };

  // ---------- Carrefour : événement, feu de camp ou combat défi ----------
  R.ouvrirCarrefour = (r) => {
    if (r.etage >= R.TOTAL_ETAGES) return R.etageSuivant(r);
    const fixe = G.EVENEMENTS.find((e) => e.fixe === r.etage);
    if (fixe) { r.ecran = { type: 'carrefour', options: [{ type: 'evenement', id: fixe.id }] }; return r; }
    const types = melanger(r, ['evenement', 'feu', 'defi']).slice(0, 2);
    const pool = G.EVENEMENTS.filter((e) => !e.fixe);
    r.ecran = { type: 'carrefour', options: types.map((t) => (t === 'evenement' ? { type: t, id: tirer(r, pool).id } : { type: t })) };
    return r;
  };
  R.choisirCarrefour = (r, i) => {
    const o = r.ecran.options[i];
    if (o.type === 'evenement') r.ecran = { type: 'evenement', id: o.id };
    else if (o.type === 'feu') r.ecran = { type: 'feu' };
    else { r.defiFait = true; R.preparerCombat(r, 'defi'); }
    return r;
  };

  R.choixEvenement = (r, i, heroUid) => {
    const ev = G.EVENEMENTS.find((e) => e.id === r.ecran.id);
    const ch = ev.choix[i];
    const h = heroUid && r.heros.find((x) => x.uid === heroUid);
    const msg = ch.fn(r, R, h);
    r.ecran = { type: 'resultatEvenement', nom: ev.nom, msg };
    return r;
  };

  R.FEU = [
    { id: 'rang', nom: 'S\'entraîner', desc: 'Un héros monte d\'un rang', heros: (h) => h.rang !== 'S' },
    { id: 'relancer', nom: 'Méditer', desc: 'Relancer la dernière amélioration d\'un héros (rang A ou S)', heros: (h) => h.ups.length > 0 },
    { id: 'rembobinage', nom: 'Veiller', desc: 'Recharger le rembobinage d\'urgence', cond: (r) => !r.rembobinage.dispo },
    { id: 'relique', nom: 'Raconter des légendes', desc: 'Une relique rare pour le prochain combat seulement' },
  ];
  R.feuDeCamp = (r, id, heroUid) => {
    const h = heroUid && r.heros.find((x) => x.uid === heroUid);
    let msg = '';
    if (id === 'rang' && h) msg = R.monterRang(r, h);
    else if (id === 'relancer' && h) {
      const dernier = h.ups[h.ups.length - 1];
      R.proposerAmelioration(r, h);
      const a = r.enAttente[r.enAttente.length - 1];
      if (a) a.relance = dernier;
      msg = `${G.heros(h.id).nom} reconsidère son entraînement.`;
    } else if (id === 'rembobinage') { r.rembobinage.dispo = true; msg = 'Le rembobinage d\'urgence est rechargé.'; }
    else if (id === 'relique') {
      const pool = reliquesDispo(r, 'r').filter((x) => x.effet || x.debutEquipe);
      r.reliqueTemp = tirer(r, pool).id;
      msg = `Pour le prochain combat : ${G.relique(r.reliqueTemp).nom}.`;
    }
    r.ecran = { type: 'resultatEvenement', nom: 'Feu de camp', msg };
    return r;
  };

  // ---------- Fin d'acte : enchères ----------
  R.ouvrirEnchere = (r) => {
    const lotHeros = tirer(r, G.HEROS.filter((h) => h.palier === 3)).id;
    const lotObjet = tirer(r, G.OBJETS.filter((o) => o.rarete === 'l')).id;
    const exp = G.RELIQUES.filter((x) => x.enchere && !r.reliques.includes(x.id));
    const lotRelique = (exp.length && r.places < 5 ? tirer(r, exp) : tirer(r, reliquesDispo(r, 'l')) || tirer(r, reliquesDispo(r))).id;
    r.ecran = { type: 'enchere', lots: [
      { type: 'heros', id: lotHeros, prix: 12, vendu: false },
      { type: 'objet', id: lotObjet, prix: 15, vendu: false },
      { type: 'relique', id: lotRelique, prix: 18, vendu: false },
    ] };
    return r;
  };
  R.acheterLot = (r, i) => {
    const lot = r.ecran.lots[i];
    if (!lot || lot.vendu) return 'Déjà adjugé.';
    if (r.eclats < lot.prix) return 'Pas assez d\'éclats.';
    if (lot.type === 'heros' && !R.placeLibre(r)) return 'Guilde complète.';
    if (lot.type === 'objet' && r.objets.length >= R.MAX_INVENTAIRE) return 'Inventaire plein.';
    r.eclats -= lot.prix;
    lot.vendu = true;
    if (lot.type === 'heros') { R.ajouterHeros(r, lot.id, 'B'); return `Adjugé : ${G.heros(lot.id).nom} (rang B).`; }
    if (lot.type === 'objet') { r.objets.push(lot.id); return `Adjugé : ${G.objet(lot.id).nom}.`; }
    R.donnerReliqueId(r, lot.id);
    return `Adjugé : ${G.relique(lot.id).nom}.`;
  };
  R.quitterEnchere = (r) => R.etageSuivant(r);

  // ---------- Progression ----------
  R.etageSuivant = (r) => {
    r.etage += 1;
    if (r.etage > R.TOTAL_ETAGES) return R.terminer(r, true);
    R.preparerCombat(r, r.etage % R.ETAGES_PAR_ACTE === 0 ? 'boss' : 'normal');
    return r;
  };
  R.lancerEndless = (r) => {
    r.endless = 1;
    r.rembobinage.dispo = false;
    r.gagne = true;
    R.preparerCombat(r, 'endless');
    return r;
  };
  R.score = (r) => (r.etage - 1) * 100 + (r.gagne ? 500 : 0) + r.endless * 150 + r.victoires * 10 + (r.difficulte - 1) * 200;
  R.terminer = (r, gagne) => {
    r.fini = true;
    r.gagne = r.gagne || gagne;
    r.ecran = { type: 'fin', gagne: r.gagne };
    return r;
  };

  R.titreEtage = (r) => (r.endless ? `Endless — manche ${r.endless}` : `Acte ${R.acteDe(r.etage)} · étage ${((r.etage - 1) % R.ETAGES_PAR_ACTE) + 1}/${R.ETAGES_PAR_ACTE}`);

  if (typeof module !== 'undefined' && module.exports) module.exports = G;
}(typeof window !== 'undefined' ? window : globalThis));
