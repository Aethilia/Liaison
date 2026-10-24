'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/renderer/guilde-combat.js');
require('../src/renderer/guilde-data.js');
const G = require('../src/renderer/guilde-run.js');
const R = G.Run;

const golem = (pos = { c: 3, l: 1 }) => ({ ...G.ficheMonstre('m9', 1, 1), pos });

// Partie minimale avec un héros donné (rang, spec, objets, reliques au choix).
function partie(id, { rang = 'C', spec = null, ups = [], objets = [], reliques = [], graine = 7 } = {}) {
  const r = R.nouvellePartie('Test', 1, graine);
  const h = R.ajouterHeros(r, id, 'C');
  h.rang = rang; h.spec = spec; h.ups = ups; h.objets = objets;
  r.enAttente = [];
  r.reliques = reliques;
  return { r, h };
}

test('guilde : hexagones (distance, voisins)', () => {
  assert.equal(G.dist({ c: 0, l: 0 }, { c: 0, l: 0 }), 0);
  assert.equal(G.dist({ c: 3, l: 4 }, { c: 3, l: 3 }), 1);
  assert.equal(G.dist({ c: 0, l: 5 }, { c: 7, l: 0 }), 9);
  for (const v of G.voisins({ c: 3, l: 3 })) assert.equal(G.dist(v, { c: 3, l: 3 }), 1);
  assert.equal(G.voisins({ c: 0, l: 0 }).length, 2);
});

test('guilde : chaque héros combat et lance sa compétence', () => {
  for (const def of G.HEROS) {
    const { r, h } = partie(def.id);
    h.pos = { c: 3, l: 4 };
    const c = new G.Combat([R.ficheHeros(r, h)], [golem()], { graine: 3 });
    for (let i = 0; i < 300 && !c.fini; i++) c.pas(0.1);
    assert.ok(c.fx.some((f) => f.type === 'lance' && f.uid === 1), `${def.nom} n'a jamais lancé ${def.comp.nom}`);
    c.jusquAuBout();
    assert.ok(c.fini && ['allies', 'ennemis'].includes(c.gagnant));
  }
});

test('guilde : toutes les spécialisations, améliorations, objets et reliques fonctionnent', () => {
  const ennemis = () => [golem({ c: 3, l: 1 }), { ...G.ficheMonstre('m8', 3, 1), pos: { c: 5, l: 0 } }, { ...G.ficheMonstre('m1', 3, 1), pos: { c: 1, l: 1 } }];
  const jouer = (r, heros) => {
    const c = new G.Combat(heros.map((h) => R.ficheHeros(r, h)), ennemis(), { graine: 11, renforts: [R.ficheHeros(r, heros[0])], equipeAllies: r.reliques.map(G.relique).filter((x) => x.debutEquipe) });
    c.jusquAuBout();
    assert.ok(c.fini);
  };
  for (const def of G.HEROS) {
    for (const s of def.specs) {
      const { r, h } = partie(def.id, { rang: 'B', spec: s.id });
      h.pos = { c: 3, l: 4 };
      const { h: h2 } = (() => { const x = R.ajouterHeros(r, 'h22'); x.pos = { c: 4, l: 5 }; return { h: x }; })();
      jouer(r, [h, h2]);
    }
  }
  for (const a of G.AMELIORATIONS) {
    const def = G.HEROS.find((x) => x.classes[0] === a.classe);
    const { r, h } = partie(def.id, { rang: 'A', spec: def.specs[0].id, ups: [a.id] });
    h.pos = { c: 3, l: 4 };
    jouer(r, [h]);
  }
  for (const o of G.OBJETS) {
    const { r, h } = partie('h17', { objets: [o.id] });
    h.pos = { c: 3, l: 5 };
    jouer(r, [h]);
  }
  for (const x of G.RELIQUES) {
    const { r, h } = partie('h1');
    R.donnerReliqueId(r, x.id);
    r.enAttente = [];
    h.pos = { c: 3, l: 4 };
    jouer(r, r.heros.filter((y) => y.pos));
  }
});

test('guilde : les trois boss', () => {
  for (const b of G.BOSS) {
    const r = R.nouvellePartie('Test', 1, 5);
    for (const id of ['h8', 'h1', 'h18', 'h22', 'h17']) { const h = R.ajouterHeros(r, id, 'S'); h.spec = G.heros(id).specs[0].id; }
    r.places = 5;
    for (const h of r.heros) R.placerAuto(r, h);
    r.enAttente = [];
    const c = new G.Combat(R.enCombat(r).map((h) => R.ficheHeros(r, h)), [{ ...G.ficheMonstre(b.id, b.acte === 1 ? 6 : 12, 1), pos: { c: 3, l: 0 } }], { graine: 9 });
    c.jusquAuBout();
    assert.ok(c.fini, b.nom);
    if (b.id === 'b3') assert.ok(c.unites.length > 6, 'le Seigneur invoque des serviteurs');
  }
});

test('guilde : mana par impulsions de 2 s, Rush et Stall', () => {
  const { r, h } = partie('h21');
  h.pos = { c: 3, l: 5 };
  const c = new G.Combat([R.ficheHeros(r, h)], [golem()], { graine: 1 });
  const u = c.unites[0];
  c.pas(0.1);
  assert.equal(u.mana, 0);
  for (let i = 0; i < 19; i++) c.pas(0.1);
  assert.equal(u.mana, 20); // une impulsion à 2 s
  const rush = G.E.rush(5, { atk: 100 });
  const v = c.ajouter({ nom: 'x', stats: { pv: 100, atk: 10 }, effets: [rush, G.E.stall(3, (cc, uu) => { uu.stallOk = true; })], pos: { c: 0, l: 5 } }, 'allies');
  c.declencher(v, 'debut');
  assert.equal(c.s(v, 'atk'), 110);
  for (let i = 0; i < 60; i++) c.pas(0.1);
  assert.equal(c.s(v, 'atk'), 10);
  assert.ok(v.stallOk);
});

test('guilde : boutique, doublon → rang B et spécialisation, vente', () => {
  const r = R.nouvellePartie('Test', 1, 21);
  R.choisirDepart(r, r.ecran.heros[0], 'k3');
  assert.equal(r.eclats, 12 + R.ECLATS_DEPART);
  assert.equal(r.ecran.type, 'boutique');
  R.quitterBoutique(r);
  assert.equal(r.ecran.type, 'preparation');
  R.ouvrirBoutique(r);
  r.ecran.offres.heros[0] = { id: r.heros[0].id, vendu: false };
  r.eclats = 50;
  R.acheterHeros(r, 0);
  assert.equal(r.heros.length, 1);
  assert.equal(r.heros[0].rang, 'B');
  assert.equal(r.enAttente[0].type, 'spec');
  R.resoudreAttente(r, r.enAttente[0].options[1]);
  assert.equal(r.heros[0].spec, G.heros(r.heros[0].id).specs[1].id);
  R.monterRang(r, r.heros[0]);
  assert.equal(r.enAttente[0].type, 'amelioration');
  assert.equal(r.enAttente[0].options.length, 3);
  const avant = r.eclats;
  R.vendreHeros(r, r.heros[0]);
  assert.ok(r.eclats > avant && r.heros.length === 0 && r.enAttente.length === 0);
});

test('guilde : rembobinage d\'urgence puis fin de partie', () => {
  const r = R.nouvellePartie('Test', 1, 3);
  R.choisirDepart(r, r.ecran.heros[0], 'k1');
  R.quitterBoutique(r);
  R.resultatCombat(r, true);
  assert.equal(r.rembobinage.reserve, 5);
  R.quitterBoutique(r);
  R.etageSuivant(r);
  R.resultatCombat(r, false);
  assert.equal(r.rembobinage.dispo, false);
  assert.equal(r.fini, false);
  R.preparerCombat(r, 'normal');
  R.resultatCombat(r, false);
  assert.equal(r.fini, true);
  assert.equal(r.ecran.type, 'fin');
});

// Robot simple : achète ce qu'il peut, place tout le monde, choisit au hasard.
function robot(graine, difficulte = 1) {
  const r = R.nouvellePartie('Robot', difficulte, graine);
  let garde = 0;
  while (!r.fini && garde++ < 400) {
    while (r.enAttente.length) R.resoudreAttente(r, r.enAttente[0].options[0]);
    const e = r.ecran;
    if (e.type === 'depart') R.choisirDepart(r, e.heros[0], e.kits[0]);
    else if (e.type === 'preparation') {
      for (const h of r.heros) R.placerAuto(r, h);
      for (const h of r.heros) while (r.objets.length && h.objets.length < 2) R.equiper(r, h, 0);
      const c = R.creerCombat(r);
      R.resultatCombat(r, c.jusquAuBout() === 'allies');
    } else if (e.type === 'boutique') {
      e.offres.heros.forEach((_, i) => R.acheterHeros(r, i));
      e.offres.objets.forEach((_, i) => R.acheterObjet(r, i));
      e.offres.reliques.forEach((_, i) => R.acheterRelique(r, i));
      R.quitterBoutique(r);
    } else if (e.type === 'carrefour') R.choisirCarrefour(r, 0);
    else if (e.type === 'evenement') {
      const ev = G.EVENEMENTS.find((x) => x.id === e.id);
      const i = ev.choix.findIndex((ch) => !ch.cond || ch.cond(r, R));
      R.choixEvenement(r, i, ev.choix[i].heros ? r.heros[0] && r.heros[0].uid : null);
    } else if (e.type === 'feu') R.feuDeCamp(r, 'rang', r.heros[0] && r.heros[0].uid);
    else if (e.type === 'resultatEvenement') R.etageSuivant(r);
    else if (e.type === 'recompense') R.choisirRecompense(r, e.reliques[0]);
    else if (e.type === 'enchere') { e.lots.forEach((_, i) => R.acheterLot(r, i)); R.quitterEnchere(r); }
    else if (e.type === 'victoireFinale') { R.lancerEndless(r); }
    else throw new Error(`écran inconnu ${e.type}`);
    JSON.parse(JSON.stringify(r)); // l'état reste sauvegardable
  }
  return r;
}

test('guilde : des parties entières jouées par un robot', () => {
  const res = [];
  for (let g = 1; g <= 12; g++) {
    const r = robot(g * 101);
    assert.ok(r.fini, `partie ${g} terminée`);
    res.push(r.endless ? `E${r.endless}` : r.etage);
  }
  console.log('# étages atteints par le robot :', res.join(' '));
});
