'use strict';

// Résumé d'un site pour le tableau de bord du superviseur : services du jour,
// tâches en attente, services non clôturés, alertes des 7 derniers jours.

const M = require('./model');
const { Inventaire } = require('./inventaire');
const { Stockage } = require('./stockage');

const ORDER = Object.fromEntries(M.SERVICES.map((d, i) => [d.id, i]));
const key = (date, service) => `${date}#${ORDER[service]}`;

const boxAlerts = M.boxAlerts;

function summarizeSite(store, now = new Date(), nbJours = 7) {
  const live = M.currentService(now);
  const dates = [];
  for (let i = nbJours - 1; i >= 0; i--) dates.push(M.addDays(live.date, -i));
  const days = store.loadRange(dates);
  const liveKey = key(live.date, live.service);

  const today = M.SERVICES.map((def) => {
    const s = days[days.length - 1].services[def.id];
    const obs = s.observations.filter((o) => o.heure || o.texte);
    return {
      service: def.id,
      etat: s.cloture ? 'clos' : key(live.date, def.id) === liveKey ? 'en-cours' : M.isEmpty(s) ? 'vide' : 'ouvert',
      responsable: s.responsable,
      observations: obs.length,
      importantes: obs.filter((o) => o.important).length,
      alertes: boxAlerts(s).length,
      totaux: M.totals(s),
    };
  });

  const nonClotures = [];
  let vides = 0; // services passés sans aucune saisie
  const importantes = [];
  const nonConformes = [];
  let dernier = null;
  for (const d of days) {
    for (const def of M.SERVICES) {
      const s = d.services[def.id];
      const k = key(d.date, def.id);
      if (k > liveKey) continue;
      if (k < liveKey && !s.cloture) {
        if (M.isEmpty(s)) vides += 1;
        else nonClotures.push({ date: d.date, service: def.id, responsable: s.responsable });
      }
      for (const o of s.observations) if (o.important && o.texte) importantes.push({ date: d.date, service: def.id, heure: o.heure, texte: o.texte, auteur: o.auteur });
      for (const x of s.nonConformes) if (x.type) nonConformes.push({ date: d.date, service: def.id, type: x.type, quantite: x.quantite, unite: x.unite, provenance: x.provenance });
      if (!M.isEmpty(s)) dernier = { date: d.date, service: def.id, alertes: boxAlerts(s) };
    }
  }

  const taches = store.listTasks().filter((t) => !t.faite);
  let stockBas = [];
  try {
    stockBas = new Inventaire(store.dir).list().articles.filter((a) => a.alerte).map((a) => ({ nom: a.nom, stock: a.stock, seuil: a.seuil, unite: a.unite }));
  } catch { /* inventaire illisible : ignoré */ }
  let stockagePlein = [];
  try {
    stockagePlein = new Stockage(store.dir).list().filter((z) => z.remplissage != null && z.remplissage >= M.SEUIL_ALERTE).map((z) => ({ nom: z.nom, remplissage: z.remplissage }));
  } catch { /* dossier illisible : ignoré */ }
  return {
    site: store.loadSite().nom || '',
    live,
    today,
    taches,
    nonClotures: nonClotures.reverse(),
    vides,
    importantes: importantes.reverse(),
    nonConformes: nonConformes.reverse(),
    boxs: dernier,
    stockBas,
    stockagePlein,
  };
}

module.exports = { summarizeSite };
