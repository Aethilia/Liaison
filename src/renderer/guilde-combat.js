'use strict';

// La Guilde — moteur de combat automatique sur plateau hexagonal.
// Inspiré du fonctionnement de Guildrun : placement avant le combat, puis
// tout se joue seul (ciblage du plus proche, mana par impulsions de 2 s,
// compétence quand la jauge est pleine, statuts, Rush / Stall / Renfort).
// Fichier sans DOM : utilisable dans l'appli et dans les tests (Node).

(function (racine) {
  const G = racine.Guilde = racine.Guilde || {};

  // Plateau : 8 colonnes × 6 lignes, hexagones « pointe en haut », lignes
  // impaires décalées. Ennemis en haut (lignes 0-2), alliés en bas (3-5) ;
  // on place ses héros sur les deux dernières lignes.
  G.COLS = 8;
  G.LIGNES = 6;
  G.LIGNES_ALLIES = [4, 5];
  G.LIGNES_ENNEMIS = [0, 1];

  const cube = (p) => { const x = p.c - (p.l - (p.l & 1)) / 2; return { x, z: p.l, y: -x - p.l }; };
  G.dist = (a, b) => { const A = cube(a); const B = cube(b); return Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z)); };
  G.voisins = (p) => {
    const d = p.l & 1 ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
    return d.map(([dc, dl]) => ({ c: p.c + dc, l: p.l + dl })).filter((q) => q.c >= 0 && q.c < G.COLS && q.l >= 0 && q.l < G.LIGNES);
  };

  // Hasard reproductible (même graine → même combat).
  G.hasard = (graine) => {
    let a = graine >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Ordre de ciblage à distance égale (comme Guildrun).
  G.PRIORITE = ['tank', 'avantgarde', 'guerrier', 'duelliste', 'assassin', 'mage', 'mystique', 'monstre'];
  const STATS = ['pv', 'atk', 'def', 'mag', 'mana', 'regen', 'vit', 'portee', 'crit', 'critdeg', 'mvt', 'soins', 'esquive', 'vol', 'regenPv'];
  G.STATS = STATS;
  // Chiffres calés sur Guildrun : la défense divise les dégâts par
  // (100 + déf) / 100 (pas les dégâts « vrais » : poison, brûlure…), le
  // critique plafonne à 100 % (le surplus s'ajoute aux dégâts critiques),
  // la mana vient des impulsions de 2 s ET des attaques.
  G.MANA_PAR_ATTAQUE = 10;
  const DUREE_MAX = 120;
  const FUREUR = 60;

  class Combat {
    // fiches : { nom, num, classes, stats, comp, effets, pos, boss? } ; options :
    // graine, renforts (fiches du banc allié, pour les effets « Renfort »),
    // equipe (effets d'équipe : reliques avec debutEquipe).
    constructor(allies, ennemis, opts = {}) {
      this.t = 0;
      this.rng = G.hasard(opts.graine || 1);
      this.unites = [];
      this.journal = [];
      this.fx = [];
      this.fini = false;
      this.gagnant = null;
      this.fureur = 1;
      this.seq = 0;
      for (const f of allies) this.ajouter(f, 'allies');
      for (const f of ennemis) this.ajouter(f, 'ennemis');
      // Effets d'équipe (reliques) et Renforts du banc.
      for (const e of opts.equipeAllies || []) if (e.debutEquipe) e.debutEquipe(this, 'allies');
      for (const e of opts.equipeEnnemis || []) if (e.debutEquipe) e.debutEquipe(this, 'ennemis');
      for (const f of opts.renforts || []) {
        for (const e of f.effets || []) if (e.renfort) e.renfort(this, 'allies', f);
      }
      for (const u of this.unites) this.declencher(u, 'debut');
    }

    ajouter(f, cote, pos) {
      const base = {};
      for (const s of STATS) base[s] = Number(f.stats[s] || 0);
      if (!base.mvt) base.mvt = 1.5;
      if (!base.critdeg) base.critdeg = 50;
      const u = {
        uid: ++this.seq, cote, nom: f.nom, num: f.num, ref: f.ref, classes: f.classes || ['monstre'], boss: !!f.boss,
        base, mods: [], pv: 0, mana: Number(f.manaDepart || 0), bouclier: 0, pos: { ...(pos || f.pos) },
        comp: f.comp, effets: (f.effets || []).slice(), cible: null, cdAtk: 0.3 + this.rng() * 0.3, cdMvt: 0, cdCible: 0, impulsion: 2,
        st: { poison: 0, poisonSrc: null, brulure: 0, brulureFin: 0, gel: 0, gelDecr: 0, etourdi: 0, furtif: 0, provoc: null, provocFin: 0, insensible: false },
        mort: false, stallFaits: new Set(), compteur: 0, invoque: !!f.invoque,
      };
      // Une case occupée → la plus proche libre.
      if (this.occupe(u.pos)) u.pos = this.caseLibrePres(u.pos) || u.pos;
      this.unites.push(u);
      u.pv = this.s(u, 'pv');
      return u;
    }

    // ---------- Stats ----------
    s(u, nom) {
      let add = 0;
      let mul = 0;
      for (const m of u.mods) {
        if (m.fin != null && this.t >= m.fin) continue;
        if (m.stat !== nom) continue;
        add += m.add || 0;
        mul += m.mul || 0;
      }
      const v = (u.base[nom] + add) * (1 + mul);
      if (nom === 'vit') return Math.max(0.1, v * (1 - 0.08 * Math.min(6, u.st.gel)));
      if (nom === 'portee') return Math.max(1, Math.round(v));
      return Math.max(0, v);
    }

    // Bonus de stat, définitif (duree null) ou temporaire.
    buff(u, stat, { add = 0, mul = 0 } = {}, duree = null) {
      const avantPv = stat === 'pv' ? this.s(u, 'pv') : 0;
      u.mods.push({ stat, add, mul, fin: duree == null ? null : this.t + duree });
      if (stat === 'pv') u.pv += Math.max(0, this.s(u, 'pv') - avantPv);
    }

    // ---------- Requêtes ----------
    vivants(cote) { return this.unites.filter((u) => !u.mort && (!cote || u.cote === cote)); }
    ennemisDe(u) { return this.vivants(u.cote === 'allies' ? 'ennemis' : 'allies'); }
    alliesDe(u, soi = true) { return this.vivants(u.cote).filter((x) => soi || x !== u); }
    occupe(p, sauf) { return this.unites.some((x) => !x.mort && x !== sauf && x.pos.c === p.c && x.pos.l === p.l); }
    caseLibrePres(p, sauf) {
      const vus = new Set([`${p.c},${p.l}`]);
      let file = [p];
      while (file.length) {
        const suivante = [];
        for (const q of file) {
          if (!this.occupe(q, sauf)) return q;
          for (const v of G.voisins(q)) if (!vus.has(`${v.c},${v.l}`)) { vus.add(`${v.c},${v.l}`); suivante.push(v); }
        }
        file = suivante;
      }
      return null;
    }
    ciblable(x) { return !x.mort && this.t >= x.st.furtif; }
    plusProche(u, liste) {
      return liste.filter((x) => this.ciblable(x)).sort((a, b) => G.dist(u.pos, a.pos) - G.dist(u.pos, b.pos)
        || G.PRIORITE.indexOf(a.classes[0]) - G.PRIORITE.indexOf(b.classes[0])
        || a.pv / this.s(a, 'pv') - b.pv / this.s(b, 'pv'))[0] || null;
    }
    plusLoin(u, liste) { return liste.filter((x) => this.ciblable(x)).sort((a, b) => G.dist(u.pos, b.pos) - G.dist(u.pos, a.pos))[0] || null; }
    plusFaible(liste) { return liste.filter((x) => !x.mort).sort((a, b) => a.pv / this.s(a, 'pv') - b.pv / this.s(b, 'pv'))[0] || null; }
    plusFort(liste) { return liste.filter((x) => this.ciblable(x)).sort((a, b) => b.pv - a.pv)[0] || null; }
    autour(p, rayon, liste) { return liste.filter((x) => !x.mort && G.dist(p, x.pos) <= rayon); }
    cibleDe(u) { return u.cible && this.ciblable(u.cible) ? u.cible : this.plusProche(u, this.ennemisDe(u)); }
    rush(sec) { return this.t < sec; }

    // ---------- Actions ----------
    log(txt, type = 'info') { this.journal.push({ t: this.t, txt, type }); }
    effet(type, u, extra = {}) { this.fx.push({ t: this.t, type, uid: u.uid, ...extra }); }

    declencher(u, crochet, ...args) {
      for (const e of u.effets) if (e[crochet]) e[crochet](this, u, ...args);
    }

    degats(src, cible, montant, type = 'phys', opts = {}) {
      if (!cible || cible.mort || !(montant > 0)) return 0;
      const info = { montant, type, crit: false, auto: !!opts.auto, src, esquive: false };
      if (opts.peutCrit !== false && src && (opts.auto || opts.peutCrit)) {
        const crit = opts.critForce ? 100 : this.s(src, 'crit');
        if (this.rng() * 100 < Math.min(100, crit)) { info.crit = true; info.montant *= 1 + (this.s(src, 'critdeg') + Math.max(0, crit - 100)) / 100; }
      }
      if (src) this.declencher(src, 'avantDegats', cible, info);
      this.declencher(cible, 'subit', src, info);
      if (info.auto && this.rng() * 100 < this.s(cible, 'esquive')) {
        this.effet('esquive', cible);
        return 0;
      }
      let m = info.montant;
      if (type !== 'vrai') m *= 100 / (100 + this.s(cible, 'def'));
      m *= this.fureur;
      m = Math.max(1, Math.round(m));
      if (cible.bouclier > 0) {
        const a = Math.min(cible.bouclier, m);
        cible.bouclier -= a;
        m -= a;
        if (a) this.effet('absorbe', cible, { montant: a });
      }
      cible.pv -= m;
      if (this.enLancer && src === this.enLancer.u) { this.enLancer.total += m; this.enLancer.cibles.add(cible.nom); }
      this.effet('degat', cible, { montant: m, crit: info.crit, typeDeg: type, src: src && src.uid });
      if (src && src.cote !== cible.cote) {
        const vol = this.s(src, 'vol');
        if (vol && type !== 'vrai') this.soin(src, src, (m * vol) / 100, { discret: true });
        this.declencher(src, 'touche', cible, m, info);
      }
      if (cible.pv <= 0) this.tuer(cible, src);
      return m;
    }

    tuer(cible, src) {
      this.declencher(cible, 'meurt', src);
      if (cible.pv > 0) return; // ressuscité / sauvé par un effet
      cible.mort = true;
      cible.pv = 0;
      this.effet('mort', cible);
      this.log(`${cible.nom} est K.O.`, 'mort');
      if (src && !src.mort) this.declencher(src, 'tue', cible);
      for (const a of this.vivants(cible.cote)) this.declencher(a, 'mortAllie', cible);
      for (const a of this.vivants(cible.cote === 'allies' ? 'ennemis' : 'allies')) this.declencher(a, 'mortEnnemi', cible);
    }

    soin(src, cible, montant, { discret = false } = {}) {
      if (!cible || cible.mort || !(montant > 0)) return 0;
      const m = Math.round(montant * (1 + (src ? this.s(src, 'soins') : 0) / 100));
      const reel = Math.min(m, this.s(cible, 'pv') - cible.pv);
      cible.pv += reel;
      if (this.enLancer && src === this.enLancer.u) this.enLancer.soin += reel;
      if (reel > 0 && !discret) this.effet('soin', cible, { montant: reel });
      return reel;
    }

    proteger(cible, montant) {
      if (!cible || cible.mort) return;
      cible.bouclier += Math.round(montant);
      this.effet('bouclier', cible, { montant: Math.round(montant) });
    }

    ressusciter(u, pct) {
      if (!u.mort) return;
      u.mort = false;
      u.pv = Math.round(this.s(u, 'pv') * pct);
      u.pos = this.caseLibrePres(u.pos) || u.pos;
      u.st.poison = 0; u.st.brulure = 0; u.st.gel = 0;
      this.effet('resu', u);
      this.log(`${u.nom} revient au combat !`, 'soin');
    }

    // Statuts : poison (cumuls, dégâts par seconde), brûlure (dps, durée),
    // gel (cumuls, ralentit l'attaque de 8 % chacun), étourdi, furtif, provoc.
    statut(cible, nom, valeur, duree = 0, src = null) {
      if (!cible || cible.mort) return;
      const s = cible.st;
      if (nom === 'poison') { s.poison += valeur; s.poisonSrc = src; }
      else if (nom === 'brulure') { s.brulure = Math.max(s.brulure, valeur); s.brulureFin = Math.max(s.brulureFin, this.t + duree); }
      else if (nom === 'gel') { s.gel = Math.min(6, s.gel + valeur); s.gelDecr = 2; }
      else if (nom === 'etourdi') { if (!s.insensible) s.etourdi = Math.max(s.etourdi, this.t + duree); }
      else if (nom === 'furtif') s.furtif = Math.max(s.furtif, this.t + duree);
      else if (nom === 'provoc') { s.provoc = src; s.provocFin = this.t + duree; }
      this.effet('statut', cible, { statut: nom });
    }

    purifier(u) { u.st.poison = 0; u.st.brulure = 0; u.st.gel = 0; u.st.etourdi = 0; }

    deplacer(u, p) {
      const q = this.occupe(p, u) ? this.caseLibrePres(p, u) : p;
      if (q) { u.pos = { ...q }; this.effet('saut', u); }
    }

    invoquer(cote, fiche, pres) {
      const p = this.caseLibrePres(pres) || pres;
      const u = this.ajouter({ ...fiche, invoque: true }, cote, p);
      this.declencher(u, 'debut');
      this.effet('invoque', u);
      return u;
    }

    lancerComp(u) {
      if (!u.comp) return;
      u.mana = 0;
      this.effet('lance', u, { nom: u.comp.nom });
      this.enLancer = { u, total: 0, soin: 0, cibles: new Set() };
      u.comp.lancer(this, u);
      const { total, soin, cibles } = this.enLancer;
      this.enLancer = null;
      const detail = [total ? `${total} dégâts${cibles.size === 1 ? ` à ${[...cibles][0]}` : cibles.size ? ` (${cibles.size} cibles)` : ''}` : '', soin ? `${soin} soins` : ''].filter(Boolean).join(', ');
      this.log(`${u.nom} lance ${u.comp.nom}${detail ? ` : ${detail}` : ''}`, u.cote === 'allies' ? 'allie' : 'ennemi');
      this.declencher(u, 'lance');
    }

    // ---------- Boucle ----------
    pas(dt = 0.1) {
      if (this.fini) return;
      this.t = Math.round((this.t + dt) * 1000) / 1000;
      if (this.t > FUREUR) this.fureur = 1 + 0.05 * (this.t - FUREUR);
      for (const u of this.unites.slice()) {
        if (u.mort) continue;
        this.tickUnite(u, dt);
        if (this.verifierFin()) return;
      }
      if (this.t >= DUREE_MAX) this.terminer('ennemis');
    }

    tickUnite(u, dt) {
      const s = u.st;
      // Poison et brûlure, chaque seconde.
      const avant = Math.floor((this.t - dt) + 1e-9);
      const seconde = Math.floor(this.t + 1e-9) > avant;
      if (seconde && s.poison > 0) this.degats(s.poisonSrc && !s.poisonSrc.mort ? s.poisonSrc : null, u, s.poison * 6, 'vrai');
      if (u.mort) return;
      if (seconde && s.brulure > 0 && this.t <= s.brulureFin) this.degats(null, u, s.brulure, 'vrai');
      if (u.mort) return;
      if (s.gel > 0) { s.gelDecr -= dt; if (s.gelDecr <= 0) { s.gel -= 1; s.gelDecr = 2; } }
      // Stall : une fois, après X secondes.
      for (const e of u.effets) {
        if (e.stall && this.t >= e.stall.apres && !u.stallFaits.has(e)) { u.stallFaits.add(e); e.stall.fn(this, u); this.effet('stall', u); }
      }
      this.declencher(u, 'tick', dt);
      if (u.mort) return;
      // Mana : impulsion toutes les 2 secondes.
      u.impulsion -= dt;
      if (u.impulsion <= 0) {
        u.impulsion += 2;
        u.mana = Math.min(this.s(u, 'mana') || 0, u.mana + this.s(u, 'regen'));
      }
      if (this.t < s.etourdi) return;
      const manaMax = this.s(u, 'mana');
      if (u.comp && manaMax > 0 && u.mana >= manaMax) { this.lancerComp(u); return; }
      // Cible : provocation, sinon la plus proche (réévaluée régulièrement).
      u.cdCible -= dt;
      if (s.provoc && this.t < s.provocFin && !s.provoc.mort) u.cible = s.provoc;
      else if (!u.cible || !this.ciblable(u.cible) || u.cdCible <= 0) { u.cible = this.plusProche(u, this.ennemisDe(u)); u.cdCible = 0.6; }
      const c = u.cible;
      if (!c) return;
      if (G.dist(u.pos, c.pos) <= this.s(u, 'portee')) {
        u.cdAtk -= dt;
        if (u.cdAtk <= 0) {
          u.cdAtk = 1 / this.s(u, 'vit');
          u.compteur += 1;
          const info = { mult: 1, bonus: 0 };
          this.declencher(u, 'attaque', c, info);
          this.effet('attaque', u, { cible: c.uid });
          const m = this.degats(u, c, this.s(u, 'atk') * info.mult + info.bonus, 'phys', { auto: true });
          if (m) this.log(`${u.nom} a infligé ${m} dégâts à ${c.nom}`, `coup ${u.cote}`);
          if (this.s(u, 'mana') > 0) u.mana = Math.min(this.s(u, 'mana'), u.mana + G.MANA_PAR_ATTAQUE);
          this.declencher(u, 'apresAttaque', c);
        }
      } else {
        u.cdMvt -= dt;
        if (u.cdMvt <= 0) {
          u.cdMvt = 1 / this.s(u, 'mvt');
          const d0 = G.dist(u.pos, c.pos);
          const pas = G.voisins(u.pos).filter((q) => !this.occupe(q, u)).sort((a, b) => G.dist(a, c.pos) - G.dist(b, c.pos))[0];
          if (pas && G.dist(pas, c.pos) <= d0) { u.pos = pas; this.effet('bouge', u); }
          else u.cdCible = 0; // bloqué : on change de cible
        }
      }
    }

    verifierFin() {
      const a = this.vivants('allies').length;
      const e = this.vivants('ennemis').length;
      if (!a || !e) { this.terminer(a ? 'allies' : 'ennemis'); return true; }
      return false;
    }

    terminer(g) {
      if (this.fini) return;
      this.fini = true;
      this.gagnant = g;
      this.log(g === 'allies' ? 'Victoire !' : 'Défaite…', g === 'allies' ? 'victoire' : 'defaite');
    }

    // Combat joué jusqu'au bout d'un coup (tests, simulation).
    jusquAuBout() {
      while (!this.fini) this.pas(0.1);
      return this.gagnant;
    }
  }
  G.Combat = Combat;

  if (typeof module !== 'undefined' && module.exports) module.exports = G;
}(typeof window !== 'undefined' ? window : globalThis));
