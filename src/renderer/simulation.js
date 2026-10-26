'use strict';

/* global S, M, h, icon, call, api, ask, toast, promptText, plural, planState, PLAN_EQUIPES, planCode, presentLe, presentEntre,
   equipeEff, serviceHabituel, dimancheOuvert, jourNormal, hsType, hsVide, typeHsDefaut, corrigerReg, HS_TYPES, fmtHs, HS_FERIE, HS_DIMANCHE, renderPlanning, planSemCache, ROLES, roleInfo, rolesDe, pastillesRoles, fondRoles, titreRoles */
// Onglet « Simulation » du planning : un brouillon du mois pour organiser les
// jours travaillés en gardant un œil sur la limite d'heures supp (35h par mois,
// toutes HS confondues ; report possible pour les responsables). On choisit un
// agent (il « colle » à la souris) puis on clique sur les jours pour l'ajouter ou
// le retirer. Plusieurs scénarios par mois, enregistrés et partagés ; le planning
// réel n'est modifié que par « Appliquer au planning ».

const SIM_LIMITE = 35;
const simState = { equipe: 'total', mois: null, sims: [], id: null, pinceau: null, rolePinceau: null, reel: {}, minuterie: null, inclurePonct: true };
// Rôle d'un agent un jour donné : celui posé dans la simulation, sinon son rôle habituel.
const roleJour = (sim, a, d) => ((sim.roles || {})[a.id] || {})[d] || a.role || '';
// Couleur d'un agent dans un jour : celle de son rôle ce jour-là (sinon de son équipe).
const couleurChip = (sim, a, d) => (roleJour(sim, a, d) ? roleInfo(roleJour(sim, a, d)).couleur : couleurEquipe(a));
// Agent à plusieurs rôles sans rôle précis choisi ce jour-là : dégradé de ses rôles.
const multiJour = (sim, a, d) => rolesDe(a).length > 1 && !((sim.roles || {})[a.id] || {})[d];
const styleChip = (sim, a, d) => (multiJour(sim, a, d) ? { '--c': couleurChip(sim, a, d), '--fond': fondRoles(a) } : { '--c': couleurChip(sim, a, d) });
const classeChip = (sim, a, d) => (multiJour(sim, a, d) ? ' multi' : '');

const isoMois = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const simCourante = () => simState.sims.find((x) => x.id === simState.id) || null;
const joursDuMois = (y, m) => M.daysInMonth(y, m);
const agentsSim = (debut, fin) => planState.agents.filter((a) => presentEntre(a, debut, fin));
const couleurEquipe = (a) => (PLAN_EQUIPES.find((e) => e.id === equipeEff(a)) || PLAN_EQUIPES.find((e) => e.id === a.equipe) || { couleur: () => '#64748b' }).couleur();

// Jour réellement travaillé d'après le planning : code autre qu'une absence,
// ou case vide un jour normalement travaillé.
function travailleReel(a, d, val) {
  if (!presentLe(a, d)) return false;
  const c = val && planCode(val.code);
  if (c) return !c.absence;
  if (val && val.texte) return true;
  return jourNormal(a, d, val);
}

// Heures supp d'un jour posé dans la simulation (+ ponctuelles déjà saisies au planning).
// HS automatiques d'un jour posé (avant correction).
// Service tenu un jour dans la simulation : choisi au pinceau (dimanche,
// renfort…), sinon celui du planning réel, sinon le service habituel.
const svcJour = (sim, a, d) => ((sim && sim.services) || {})[a.id]?.[d] || equipeEff(a, (simState.reel[a.id] || {})[d]);
function regSim(a, d, sim = simCourante()) {
  const out = hsVide();
  const j = M.parseISODate(d).getDay();
  if (M.ferie(d)) out.rouge += HS_FERIE;
  else if (j === 0) out.rouge += HS_DIMANCHE;
  else if (j === 6) out.bleu += 7;
  else if (['matin', 'nuit'].includes(svcJour(sim, a, d))) out.vert += 1;
  return out;
}
// Correction de ces HS : celle de la simulation, sinon celle du planning.
function regCorrige(a, d, val, sim = simCourante()) {
  const s = sim && ((sim.hsReg || {})[a.id] || {})[d];
  if (s != null) return s;
  return val && val.hsReg != null ? val.hsReg : null;
}
function hsSimJour(a, d, pose, val, sim) {
  const out = hsVide();
  if (pose) {
    Object.assign(out, regSim(a, d, sim));
    const n = regCorrige(a, d, val, sim);
    if (n != null) Object.assign(out, corrigerReg(out, { hsReg: n }, d));
  }
  if (simState.inclurePonct && val && val.hs) out[hsType(val.hsType || typeHsDefaut(d)).id] += val.hs;
  return out;
}

function compteurAgent(a, sim, jours) {
  const poses = new Set((sim.jours || {})[a.id] || []);
  const t = hsVide();
  let nb = 0;
  for (const d of jours) {
    if (poses.has(d)) nb += 1;
    const hj = hsSimJour(a, d, poses.has(d), (simState.reel[a.id] || {})[d], sim);
    for (const k of Object.keys(t)) t[k] += hj[k];
  }
  const hs = t.bleu + t.rouge + t.vert;
  const report = a.equipe === 'responsables' ? Number((sim.reports || {})[a.id] || 0) : 0;
  return { nb, parType: t, hs, report, total: hs + report };
}

async function chargerSimulations() {
  const { y, m } = simState.mois;
  const mois = isoMois(y, m);
  const jours = joursDuMois(y, m);
  simState.sims = await call(api.planSimList(mois)).catch(() => []);
  simState.reel = await call(api.planEntre(jours[0], jours[jours.length - 1])).catch(() => ({}));
  if (!simState.sims.some((x) => x.id === simState.id)) simState.id = simState.sims.length ? simState.sims[0].id : null;
}

function enregistrerSim() {
  const sim = simCourante();
  if (!sim) return;
  planState.loadedAt = Date.now(); // pas de rechargement pendant la saisie
  clearTimeout(simState.minuterie);
  simState.minuterie = setTimeout(async () => {
    simState.minuterie = null;
    try {
      const r = await call(api.planSimSave(sim, S.user));
      Object.assign(sim, { id: r.id, majLe: r.majLe });
    } catch (err) {
      toast(`Simulation non enregistrée : ${err.message}`);
    }
  }, 500);
}

async function nouvelleSimulation({ depuisReel = false } = {}) {
  const { y, m } = simState.mois;
  const nom = (await promptText('Nouveau scénario', `Scénario ${String.fromCharCode(65 + simState.sims.length)}`) || '').trim();
  if (!nom) return;
  const sim = { mois: isoMois(y, m), nom, jours: {}, reports: {} };
  if (depuisReel) remplirDepuisReel(sim);
  try {
    const r = await call(api.planSimSave(sim, S.user));
    simState.sims.push(r);
    simState.id = r.id;
  } catch (err) {
    toast(`Non créé : ${err.message}`);
  }
  renderPlanning({ reload: false });
}

function remplirDepuisReel(sim) {
  const { y, m } = simState.mois;
  const jours = joursDuMois(y, m);
  sim.jours = {};
  for (const a of agentsSim(jours[0], jours[jours.length - 1])) {
    const liste = jours.filter((d) => travailleReel(a, d, (simState.reel[a.id] || {})[d]));
    if (liste.length) sim.jours[a.id] = liste;
  }
}

// Clic sur un jour avec le pinceau : ajoute l'agent (avec le rôle choisi),
// change son rôle s'il y est déjà avec un autre, sinon le retire.
// Service voulu pour un jour posé : celui choisi au pinceau, sinon le service
// affiché (vue Matin / Nuit…), sinon le matin pour un agent d'après-midi le
// dimanche (pas d'après-midi le dimanche), sinon son service habituel.
function serviceVoulu(a, d) {
  if (simState.pinceau === a.id && simState.svcPinceau) return simState.svcPinceau;
  if (simState.equipe !== 'total') return simState.equipe;
  const hab = serviceHabituel(a);
  return M.parseISODate(d).getDay() === 0 && hab === 'apresmidi' ? 'matin' : hab;
}
function basculer(agentId, d, { retirer = false } = {}) {
  const sim = simCourante();
  if (!sim) return;
  const a = planState.agents.find((x) => x.id === agentId);
  const liste = new Set(sim.jours[agentId] || []);
  const roles = { ...((sim.roles || {})[agentId] || {}) };
  const services = { ...((sim.services || {})[agentId] || {}) };
  const voulu = (!retirer && simState.pinceau === agentId && simState.rolePinceau) || (a && a.role) || '';
  const svc = serviceVoulu(a, d);
  const poserService = () => { if (svc && svc !== equipeEff(a, (simState.reel[a.id] || {})[d])) services[d] = svc; else delete services[d]; };
  const changeRole = voulu && roleJour(sim, a, d) !== voulu;
  const changeSvc = svc && svcJour(sim, a, d) !== svc;
  if (liste.has(d) && !retirer && (changeRole || changeSvc)) {
    if (changeRole) { if (voulu === (a && a.role)) delete roles[d]; else roles[d] = voulu; }
    if (changeSvc) poserService();
  } else if (liste.has(d)) {
    liste.delete(d);
    delete roles[d];
    delete services[d];
  } else {
    liste.add(d);
    if (voulu && voulu !== (a && a.role)) roles[d] = voulu;
    poserService();
  }
  sim.jours[agentId] = [...liste].sort();
  sim.roles = { ...(sim.roles || {}), [agentId]: roles };
  sim.services = { ...(sim.services || {}), [agentId]: services };
  enregistrerSim();
  renderPlanning({ reload: false });
}

// Pinceau : l'agent choisi suit la souris.
let simCurseur = null;
function majCurseur() {
  const a = planState.agents.find((x) => x.id === simState.pinceau);
  if (!a) {
    if (simCurseur) simCurseur.remove();
    simCurseur = null;
    document.body.classList.remove('sim-pinceau');
    return;
  }
  if (!simCurseur) {
    simCurseur = h('div', { class: 'sim-curseur' });
    document.body.append(simCurseur);
  }
  simCurseur.textContent = a.nom;
  simCurseur.style.setProperty('--c', couleurEquipe(a));
  document.body.classList.add('sim-pinceau');
}
document.addEventListener('mousemove', (e) => {
  if (!simCurseur) return;
  simCurseur.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && simState.pinceau) { simState.pinceau = null; majCurseur(); if (planState.vue === 'simulation') renderPlanning({ reload: false }); }
});
function lacherPinceau() {
  if (!simState.pinceau) return;
  simState.pinceau = null;
  majCurseur();
}

async function vueSimulation(head, { reload = true } = {}) {
  fermerDetailJour();
  cacherSurvol();
  if (!simState.mois) {
    const d = new Date();
    const suivant = new Date(d.getFullYear(), d.getMonth() + 1, 1); // on prépare souvent le mois suivant
    simState.mois = { y: suivant.getFullYear(), m: suivant.getMonth() + 1 };
  }
  if (reload || !simState.reel) await chargerSimulations();
  const { y, m } = simState.mois;
  const jours = joursDuMois(y, m);
  const aller = async (n) => {
    const d = new Date(y, m - 1 + n, 1);
    simState.mois = { y: d.getFullYear(), m: d.getMonth() + 1 };
    simState.id = null;
    lacherPinceau();
    renderPlanning();
  };
  const sim = simCourante();
  head.append(
    h('button', { class: 'btn', title: 'Mois précédent', onclick: () => aller(-1) }, icon('chevronLeft', 16)),
    h('div', { class: 'plan-periode mois' }, new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))),
    h('button', { class: 'btn', title: 'Mois suivant', onclick: () => aller(1) }, icon('chevronRight', 16)));

  if (!sim) {
    majCurseur();
    return h('div', { class: 'j-empty' }, icon('clock', 32), h('p', {}, 'Aucune simulation pour ce mois.'),
      h('p', { class: 'muted' }, 'Préparez les jours travaillés en surveillant la limite de 35h d\'heures supp par agent.'),
      h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } },
        h('button', { class: 'btn accent', onclick: () => nouvelleSimulation({ depuisReel: true }) }, icon('plus', 15), 'Partir du planning réel'),
        h('button', { class: 'btn', onclick: () => nouvelleSimulation() }, icon('plus', 15), 'Simulation vide')));
  }

  const agents = agentsSim(jours[0], jours[jours.length - 1]);
  // Vue par service (matin, après-midi, nuit, responsables rattachés compris) ou totale.
  const parService = simState.equipe !== 'total';
  // Vue d'un service : ses agents, plus ceux qui viennent le renforcer un jour (dimanche…).
  const visibles = parService ? agents.filter((a) => serviceHabituel(a) === simState.equipe || ((sim.jours || {})[a.id] || []).some((d) => svcJour(sim, a, d) === simState.equipe)) : agents;
  simState.visibles = visibles;
  const choixService = h('div', { class: 'seg sim-seg' }, [...PLAN_EQUIPES.filter((e) => ['matin', 'apresmidi', 'nuit'].includes(e.id)).map((e) => [e.id, e.label, e.couleur()]), ['total', 'Total', '#1e293b']].map(([id, label, c]) => h('button', {
    class: simState.equipe === id ? 'on' : '', style: { '--c': c },
    onclick: () => {
      simState.equipe = id;
      const p = planState.agents.find((x) => x.id === simState.pinceau);
      if (p && id !== 'total' && equipeEff(p) !== id) lacherPinceau();
      renderPlanning({ reload: false });
    },
  }, label)));
  const compteurs = new Map(agents.map((a) => [a.id, compteurAgent(a, sim, jours)]));

  // Barre d'outils : scénarios et actions.
  const choix = h('select', { class: 'sim-scenarios', title: 'Scénario', onchange: (e) => { simState.id = e.target.value; lacherPinceau(); renderPlanning({ reload: false }); } },
    simState.sims.map((x) => h('option', { value: x.id, selected: x.id === sim.id }, x.nom)));
  const outils = h('div', { class: 'sim-outils' },
    choixService,
    h('span', { class: 'muted' }, 'Scénario'), choix,
    h('button', { class: 'o-btn', title: 'Renommer', onclick: async () => {
      const n = ((await promptText('Renommer le scénario', sim.nom)) || '').trim();
      if (n) { sim.nom = n; enregistrerSim(); renderPlanning({ reload: false }); }
    } }, icon('edit', 14)),
    h('button', { class: 'btn small ghost', onclick: () => nouvelleSimulation({ depuisReel: true }) }, icon('plus', 13), 'Scénario'),
    h('span', { class: 'spacer' }),
    h('label', { class: 'sim-option', title: 'Ajouter les heures supp ponctuelles déjà saisies au planning' },
      h('input', { type: 'checkbox', checked: simState.inclurePonct, onchange: (e) => { simState.inclurePonct = e.target.checked; renderPlanning({ reload: false }); } }), 'HS ponctuelles du planning'),
    h('button', { class: 'btn small ghost', title: 'Repartir des jours travaillés du planning', onclick: async () => {
      if (await ask('Repartir du planning réel ?', 'Les jours de ce scénario seront remplacés par ceux du planning.', [{ label: 'Annuler', value: 'no' }, { label: 'Remplacer', value: 'yes', cls: 'primary' }]) !== 'yes') return;
      remplirDepuisReel(sim); enregistrerSim(); renderPlanning({ reload: false });
    } }, 'Planning réel'),
    h('button', { class: 'btn small ghost', onclick: async () => {
      if (await ask('Tout effacer ?', 'Tous les jours de ce scénario seront retirés.', [{ label: 'Annuler', value: 'no' }, { label: 'Effacer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
      sim.jours = {}; enregistrerSim(); renderPlanning({ reload: false });
    } }, 'Tout effacer'),
    h('button', { class: 'btn small primary', onclick: () => appliquerSimulation(sim, agents, jours) }, icon('check', 13), 'Appliquer au planning'),
    h('button', { class: 'o-btn rm', title: 'Supprimer ce scénario', onclick: async () => {
      if (await ask('Supprimer ce scénario ?', `« ${sim.nom} » sera supprimé (le planning n'est pas modifié).`, [{ label: 'Annuler', value: 'no' }, { label: 'Supprimer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
      await call(api.planSimDelete(sim.id)).catch(() => {});
      simState.sims = simState.sims.filter((x) => x.id !== sim.id);
      simState.id = simState.sims.length ? simState.sims[0].id : null;
      lacherPinceau();
      renderPlanning({ reload: false });
    } }, icon('trash', 14)));

  // Colonne des agents avec leur compteur d'heures supp.
  const lignesAgents = [];
  for (const eq of PLAN_EQUIPES) {
    const liste = visibles.filter((a) => a.equipe === eq.id);
    if (!liste.length) continue;
    lignesAgents.push(h('div', { class: 'sim-equipe', style: { '--eq': eq.couleur() } }, h('span', { class: 'eq-pastille' }), eq.label));
    for (const a of liste) {
      const c = compteurs.get(a.id);
      const resp = a.equipe === 'responsables';
      const ratio = Math.min(1, c.total / SIM_LIMITE);
      const etat = c.total > SIM_LIMITE ? (resp ? 'report' : 'depasse') : c.total > SIM_LIMITE * 0.85 ? 'proche' : 'ok';
      const detail = HS_TYPES.filter((t) => c.parType[t.id]).map((t) => `${t.label} ${fmtHs(c.parType[t.id])}`).join(' · ');
      const ligne = h('div', {
        class: `sim-agent${simState.pinceau === a.id ? ' actif' : ''} ${etat}`, style: { '--c': couleurEquipe(a) },
        title: `${a.nom} : ${plural(c.nb, 'jour')} posé(s)${detail ? ` · ${detail}` : ''}${c.report ? ` · report ${fmtHs(c.report)}` : ''}${etat === 'report' ? ` · ${fmtHs(c.total - SIM_LIMITE)} à reporter` : ''}\nCliquer pour le poser sur les jours`,
        onclick: (e) => { if (e.target.closest('input')) return; simState.pinceau = simState.pinceau === a.id ? null : a.id; simState.rolePinceau = a.role || null; majCurseur(); renderPlanning({ reload: false }); },
      },
      h('span', { class: 'sim-nom' }, a.nom, pastillesRoles(a), h('small', {}, `${c.nb} j`)),
      h('span', { class: 'sim-jauge' }, h('i', { style: { width: `${Math.round(ratio * 100)}%` } })),
      h('b', { class: 'sim-hs' }, `${fmtHs(c.total).replace('+', '')}`, h('small', {}, ` / ${SIM_LIMITE}h`)),
      resp ? h('input', {
        class: 'sim-report', type: 'text', inputMode: 'decimal', value: c.report || '', placeholder: 'report', title: 'Report d\'heures du mois précédent (responsables)',
        onchange: (e) => { const v = Number(String(e.target.value).replace(',', '.')); sim.reports = { ...(sim.reports || {}), [a.id]: Number.isFinite(v) ? v : 0 }; enregistrerSim(); renderPlanning({ reload: false }); },
      }) : null);
      lignesAgents.push(ligne);
    }
  }

  // Calendrier du mois.
  const decal = (M.parseISODate(jours[0]).getDay() + 6) % 7;
  const cellules = [...Array(decal).fill(null), ...jours];
  const pinceau = simState.pinceau && planState.agents.find((x) => x.id === simState.pinceau);
  const cal = h('div', { class: 'sim-cal', oncontextmenu: (e) => { if (simState.pinceau) { e.preventDefault(); lacherPinceau(); renderPlanning({ reload: false }); } } },
    ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((j) => h('div', { class: 'sim-j' }, j)),
    cellules.map((d) => {
      if (!d) return h('div', { class: 'sim-vide' });
      const presents = visibles.filter((a) => ((sim.jours || {})[a.id] || []).includes(d) && (!parService || svcJour(sim, a, d) === simState.equipe));
      const jour = M.parseISODate(d).getDay();
      const ferie = M.ferie(d);
      const parEquipe = PLAN_EQUIPES.map((e) => ({ e, n: presents.filter((a) => a.equipe === e.id).length })).filter((x) => x.n);
      const parSvc = parService ? [] : servicesDuJour(presents, d, sim);
      const parRole = [...ROLES.map((x) => x.id), ''].map((rid) => ({ r: roleInfo(rid), n: presents.filter((a) => (roleJour(sim, a, d) || '') === rid).length })).filter((x) => x.n && x.r);
      const avecPinceau = pinceau && presents.includes(pinceau);
      const absentReel = pinceau && (() => { const v = (simState.reel[pinceau.id] || {})[d]; const c = v && planCode(v.code); return c && c.absence ? c.label : ''; })();
      return h('div', {
        class: `sim-case${jour === 0 || jour === 6 ? ' we' : ''}${ferie ? ' ferie' : ''}${avecPinceau ? ' pose' : ''}${pinceau ? ' cible' : ''}${jour === 0 ? (dimancheOuvert(d) ? ' dim-ouvert' : ' dim-ferme') : ''}`,
        'data-date': d,
        onmouseenter: (e) => survolJour(e.currentTarget, sim, d, presents, absentReel),
        onmouseleave: cacherSurvol,
        onclick: (e) => { if (pinceau) basculer(pinceau.id, d); else detailJour(e.currentTarget, sim, d, visibles); },
      },
      h('div', { class: 'sim-date' }, h('b', {}, Number(d.slice(8))), ferie ? h('span', { class: 'sim-ferie' }, 'Férié') : null,
        jour === 0 && dimancheOuvert(d) ? h('span', { class: 'sim-ouvert', title: 'Dimanche ouvert : matin 6h-12h, nuit 20h30-2h30 (6h rouges)' }, 'ouvert') : null,
        absentReel ? h('span', { class: 'sim-alerte', title: `${absentReel} au planning` }, '!') : null,
        h('span', { class: 'sim-total' }, presents.length || '')),
      // Seulement les rôles (qui est là : au survol).
      // Vue d'un service : une ligne par rôle. Vue Total : une ligne par
      // service (matin, après-midi, nuit) avec ses rôles en pastilles.
      parService
        ? h('div', { class: 'sim-roles-liste' }, [...parRole, ...(sansRole(presents, sim, d) ? [{ r: { id: 'Sans rôle', couleur: '#94a3b8' }, n: sansRole(presents, sim, d) }] : [])]
          .map((x) => h('div', { class: 'sim-role-ligne', style: { '--c': x.r.couleur } }, h('span', {}, x.r.id), h('b', {}, x.n))))
        : h('div', { class: 'sim-svc-liste' }, parSvc.map((g) => h('div', { class: 'sim-svc-ligne', style: { '--c': g.eq.couleur() }, title: `${g.eq.label} : ${plural(g.liste.length, 'présent')}` },
          h('span', { class: 'sim-svc-nom' }, g.eq.court), h('b', {}, g.liste.length),
          h('span', { class: 'sim-svc-roles' }, rolesCompte(g.liste, sim, d).map((x) => h('span', { style: { '--r': x.r.couleur }, title: `${x.r.id} : ${x.n}` }, x.n)))))),
      avecPinceau ? h('span', { class: `sim-chip moi${classeChip(sim, pinceau, d)}`, style: styleChip(sim, pinceau, d) }, pinceau.nom) : null);
    }));

  majCurseur();
  const total = visibles.map((a) => compteurs.get(a.id));
  const depasse = visibles.filter((a) => compteurs.get(a.id).total > SIM_LIMITE && a.equipe !== 'responsables').length;
  return h('div', { class: 'sim' },
    outils,
    h('div', { class: 'sim-corps' },
      h('div', { class: 'card sim-agents' },
        h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('users', 16)), 'Agents',
          h('span', { class: `hint${depasse ? ' sim-alerte-txt' : ''}` }, depasse ? `${plural(depasse, 'agent')} au-delà de ${SIM_LIMITE}h` : `limite ${SIM_LIMITE}h d'HS / mois`)),
        h('div', { class: 'card-body' }, lignesAgents.length ? lignesAgents : h('p', { class: 'muted' }, 'Aucun agent ce mois-ci.'))),
      h('div', { class: 'card sim-calendrier' },
        h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('list', 16)), sim.nom,
          pinceau ? h('span', { class: 'sim-roles-choix' }, 'Rôle :', (rolesDe(pinceau).length > 1 ? ROLES.filter((x) => rolesDe(pinceau).includes(x.id)) : ROLES).map((x) => h('button', {
            class: `sim-role-btn${(simState.rolePinceau || pinceau.role) === x.id ? ' on' : ''}`, style: { '--c': x.couleur }, title: x.id === pinceau.role ? 'Rôle habituel' : 'Rôle pour les jours posés maintenant',
            onclick: (e) => { e.stopPropagation(); simState.rolePinceau = x.id; renderPlanning({ reload: false }); },
          }, x.id, x.id === pinceau.role ? ' ·' : ''))) : null,
          pinceau ? h('span', { class: 'sim-roles-choix' }, 'Service :', [['', 'Auto'], ['matin', 'Matin'], ['apresmidi', 'APM'], ['nuit', 'Nuit']].map(([id, label]) => h('button', {
            class: `sim-role-btn${(simState.svcPinceau || '') === id ? ' on' : ''}`, style: { '--c': id ? (PLAN_EQUIPES.find((e) => e.id === id) || { couleur: () => '#64748b' }).couleur() : '#64748b' },
            title: id ? `Les jours posés maintenant : ${label}` : 'Auto : service affiché, sinon habituel (le dimanche, un agent d\'après-midi passe au matin)',
            onclick: (e) => { e.stopPropagation(); simState.svcPinceau = id || null; renderPlanning({ reload: false }); },
          }, label))) : null,
          h('span', { class: 'hint' }, pinceau ? `${pinceau.nom} : cliquer sur les jours pour l'ajouter, changer son rôle ou le retirer · Échap ou clic droit pour lâcher` : 'Cliquer sur un agent à gauche, puis sur les jours')),
        h('div', { class: 'card-body' }, cal,
          h('p', { class: 'muted sim-legende' }, h('span', { class: 'sim-legende-roles' }, ROLES.map((x) => h('span', {}, h('i', { class: 'sim-role', style: { '--c': x.couleur } }), x.id))), `HS d'un jour posé : matin et nuit +1h verte en semaine · samedi +7h bleues · dimanche ${HS_DIMANCHE}h rouges · férié ${HS_FERIE}h rouges. Total HS du scénario : ${fmtHs(total.reduce((a, c) => a + c.hs, 0)).replace('+', '')}`)))));
}

const sansRole = (presents, sim, d) => presents.filter((a) => !roleJour(sim, a, d)).length;
// Présents d'un jour regroupés par service (un responsable compte dans le
// service qu'il tient ce jour-là).
function servicesDuJour(presents, d, sim = simCourante()) {
  const svcDe = (a) => svcJour(sim, a, d);
  return PLAN_EQUIPES.filter((e) => e.id !== 'responsables').map((eq) => ({
    eq: { ...eq, court: eq.id === 'apresmidi' ? 'APM' : eq.label.slice(0, 5) },
    liste: presents.filter((a) => (svcDe(a) === eq.id) || (eq.id === 'autres' && !['matin', 'apresmidi', 'nuit'].includes(svcDe(a)))),
  })).filter((g) => g.liste.length);
}
function rolesCompte(liste, sim, d) {
  return [...ROLES.map((x) => ({ r: x, n: liste.filter((a) => roleJour(sim, a, d) === x.id).length })),
    { r: { id: 'Sans rôle', couleur: '#94a3b8' }, n: liste.filter((a) => !roleJour(sim, a, d)).length }].filter((x) => x.n);
}

// Encadré au survol d'un jour : qui est là, rangé par rôle.
let simSurvol = null;
let simSurvolMinuterie = null;
function cacherSurvol() {
  clearTimeout(simSurvolMinuterie);
  if (simSurvol) simSurvol.remove();
  simSurvol = null;
}
function survolJour(cellule, sim, d, presents, absentReel) {
  cacherSurvol();
  if (simPop) return;
  simSurvolMinuterie = setTimeout(() => {
    if (!cellule.isConnected || simPop) return;
    const titre = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(M.parseISODate(d));
    const parRoles = (liste) => [...ROLES.map((x) => ({ r: x, liste: liste.filter((a) => roleJour(sim, a, d) === x.id) })),
      { r: { id: 'Sans rôle', couleur: '#94a3b8' }, liste: liste.filter((a) => !roleJour(sim, a, d)) }].filter((g) => g.liste.length);
    const groupes = parRoles(presents);
    const noms = (liste) => h('div', { class: 'sim-survol-noms' }, liste.map((a) => h('span', { style: { '--eq': couleurChip(sim, a, d) }, title: multiJour(sim, a, d) ? titreRoles(a) : roleJour(sim, a, d) }, a.nom, multiJour(sim, a, d) ? h('i', { class: 'sim-role multi', style: { '--fond': fondRoles(a) } }) : null)));
    // Vue Total : d'abord par service, puis par rôle (nom à la couleur du rôle).
    const corps = simState.equipe === 'total'
      ? servicesDuJour(presents, d, sim).map((g) => h('div', { class: 'sim-survol-groupe', style: { '--c': g.eq.couleur() } },
        h('div', { class: 'sim-survol-role' }, h('i', {}), g.eq.label, h('small', {}, g.liste.length)),
        noms(g.liste.slice().sort((a, b) => (roleJour(sim, a, d) || 'zz').localeCompare(roleJour(sim, b, d) || 'zz')))))
      : groupes.map((g) => h('div', { class: 'sim-survol-groupe', style: { '--c': g.r.couleur } },
        h('div', { class: 'sim-survol-role' }, h('i', {}), g.r.id, h('small', {}, g.liste.length)), noms(g.liste)));
    simSurvol = h('div', { class: 'sim-survol' },
      h('div', { class: 'sim-survol-titre' }, h('b', {}, titre.replace(/^./, (c) => c.toUpperCase())), h('span', {}, plural(presents.length, 'présent'))),
      absentReel ? h('div', { class: 'sim-survol-alerte' }, `${(planState.agents.find((x) => x.id === simState.pinceau) || {}).nom || 'Agent en main'} : ${absentReel} au planning`) : null,
      presents.length ? corps : h('div', { class: 'sim-survol-vide' }, 'Personne ce jour-là'),
      h('div', { class: 'sim-survol-aide' }, simState.pinceau ? 'Clic : poser / retirer l\'agent en main' : 'Clic : détail et HS du jour'));
    document.body.append(simSurvol);
    const r = cellule.getBoundingClientRect();
    const w = simSurvol.offsetWidth;
    let left = r.right + 8;
    if (left + w > window.innerWidth - 8) left = r.left - w - 8;
    simSurvol.style.left = `${Math.max(8, left)}px`;
    simSurvol.style.top = `${Math.max(8, Math.min(window.innerHeight - simSurvol.offsetHeight - 8, r.top))}px`;
  }, 180);
}

// Petite fenêtre au clic sur un jour (sans pinceau) : présents par service et
// par rôle, HS du jour de chacun, retrait possible.
let simPop = null;
function fermerDetailJour() {
  if (simPop) simPop.remove();
  simPop = null;
}
// Après une correction : la vue est redessinée, la fenêtre rouverte sur le même jour.
async function rouvrirDetail(d) {
  await renderPlanning({ reload: false });
  const cel = document.querySelector(`.sim-case[data-date="${d}"]`);
  const sim = simCourante();
  if (cel && sim) detailJour(cel, sim, d, simState.visibles || []);
}
function detailJour(cellule, sim, d, visibles) {
  fermerDetailJour();
  cacherSurvol();
  const presents = visibles.filter((a) => ((sim.jours || {})[a.id] || []).includes(d) && (simState.equipe === 'total' || svcJour(sim, a, d) === simState.equipe));
  const titre = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(M.parseISODate(d));
  const groupes = PLAN_EQUIPES.map((eq) => ({ eq, liste: presents.filter((a) => (a.equipe === 'responsables' && !(sim.services || {})[a.id]?.[d] ? eq.id === 'responsables' : svcJour(sim, a, d) === eq.id)) })).filter((g) => g.liste.length);
  const parRole = [...ROLES.map((x) => x.id), ''].map((rid) => ({ r: roleInfo(rid) || { id: 'Sans rôle', court: '?', couleur: '#94a3b8' }, n: presents.filter((a) => (roleJour(sim, a, d) || '') === rid).length })).filter((x) => x.n);
  const hsTotal = presents.reduce((t, a) => { const hj = hsSimJour(a, d, true, (simState.reel[a.id] || {})[d], sim); return t + hj.bleu + hj.rouge + hj.vert; }, 0);
  simPop = h('div', { class: 'plan-pop sim-pop', role: 'dialog', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'pop-titre' }, h('b', {}, titre.replace(/^./, (c) => c.toUpperCase())), M.ferie(d) ? h('span', { class: 'sim-ferie' }, M.ferie(d)) : null,
      h('span', { class: 'muted' }, ` · ${plural(presents.length, 'présent')}${hsTotal ? ` · ${fmtHs(hsTotal).replace('+', '')} d'HS` : ''}`)),
    parRole.length ? h('div', { class: 'sim-roles sim-pop-roles' }, parRole.map((x) => h('span', { class: 'sim-badge', style: { '--c': x.r.couleur } }, `${x.r.id} : ${x.n}`))) : null,
    presents.length ? groupes.map((g) => h('div', { class: 'sim-pop-groupe' },
      h('div', { class: 'sim-equipe', style: { '--eq': g.eq.couleur() } }, h('span', { class: 'eq-pastille' }), `${g.eq.label} (${g.liste.length})`),
      g.liste.map((a) => {
        const role = roleJour(sim, a, d);
        const hj = hsSimJour(a, d, true, (simState.reel[a.id] || {})[d], sim);
        const v = (simState.reel[a.id] || {})[d];
        const auto = regSim(a, d, sim);
        const autoTot = HS_TYPES.reduce((t, x) => t + auto[x.id], 0);
        const corrige = regCorrige(a, d, v, sim);
        const autoType = HS_TYPES.find((x) => auto[x.id]) || hsType(typeHsDefaut(d));
        const ponct = simState.inclurePonct && v && v.hs ? v.hs : 0;
        // Change les HS automatiques de cet agent ce jour-là (null = calcul).
        const corriger = (n) => {
          const parJour = { ...((sim.hsReg || {})[a.id] || {}) };
          if (n == null || Math.abs(n - autoTot) < 0.001) delete parJour[d];
          else parJour[d] = n;
          sim.hsReg = { ...(sim.hsReg || {}), [a.id]: parJour };
          enregistrerSim();
          rouvrirDetail(d);
        };
        const champ = h('input', {
          type: 'text', class: 'sim-pop-reg', value: String(corrige != null ? corrige : autoTot).replace('.', ','), maxLength: 5, inputMode: 'decimal',
          style: { '--c': autoType.couleur }, title: `HS automatiques ce jour (calcul : ${fmtHs(autoTot)} ${autoType.label.toLowerCase()}) · 0 pour les retirer`,
          onchange: (e) => {
            const x = e.target.value.trim().replace(',', '.');
            const n = x === '' ? null : Number(x);
            if (n != null && !(Number.isFinite(n) && n >= 0 && n <= 24)) { toast('HS : un nombre d\'heures, ex. 0, 1 ou 0,5.'); return; }
            corriger(n);
          },
          onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
        });
        const c = v && planCode(v.code);
        return h('div', { class: 'sim-pop-ligne' },
          multiJour(sim, a, d) ? h('i', { class: 'sim-role multi', style: { '--fond': fondRoles(a) }, title: titreRoles(a) }) : h('i', { class: 'sim-role', style: { '--c': role ? roleInfo(role).couleur : '#cbd5e1' }, title: role || 'Sans rôle' }),
          h('span', { class: 'sim-pop-nom' }, a.nom, c && c.absence ? h('small', { class: 'sim-pop-abs' }, ` ${c.label} au planning`) : null),
          // Service tenu ce jour (renfort du dimanche, remplacement…).
          h('select', { class: 'sim-pop-svc', title: 'Service ce jour', onchange: (e) => {
            const parJour = { ...((sim.services || {})[a.id] || {}) };
            if (e.target.value === equipeEff(a, v)) delete parJour[d]; else parJour[d] = e.target.value;
            sim.services = { ...(sim.services || {}), [a.id]: parJour };
            enregistrerSim();
            rouvrirDetail(d);
          } }, [['matin', 'Matin'], ['apresmidi', 'APM'], ['nuit', 'Nuit']].map(([id, l]) => h('option', { value: id, selected: svcJour(sim, a, d) === id }, l))),
          h('span', { class: `sim-pop-hs${corrige != null ? ' modif' : ''}` },
            h('label', { class: 'sim-pop-champ', style: { '--c': autoType.couleur } }, '+', champ, 'h'),
            autoTot && (corrige == null || corrige > 0) ? h('button', { class: 'sim-pop-mini', title: 'Retirer les HS automatiques de ce jour', onclick: () => corriger(0) }, '0') : null,
            corrige != null ? h('button', { class: 'sim-pop-mini', title: `Revenir au calcul (${fmtHs(autoTot)})`, onclick: () => corriger(null) }, 'auto') : null,
            ponct ? h('span', { style: { color: hsType(v.hsType || typeHsDefaut(d)).couleur }, title: 'HS ponctuelles du planning' }, fmtHs(ponct)) : null),
          h('button', { class: 'o-btn rm', title: 'Retirer ce jour', onclick: () => { fermerDetailJour(); basculer(a.id, d, { retirer: true }); } }, icon('x', 13)));
      })))
      : h('p', { class: 'muted' }, 'Personne ce jour-là. Cliquer sur un agent à gauche puis sur ce jour pour l\'y poser.'));
  document.body.append(simPop);
  const r = cellule.getBoundingClientRect();
  const w = 340;
  simPop.style.width = `${w}px`;
  simPop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  const bas = r.bottom + 6 + simPop.offsetHeight < window.innerHeight;
  simPop.style.top = `${bas ? r.bottom + 6 : Math.max(8, r.top - simPop.offsetHeight - 6)}px`;
  setTimeout(() => document.addEventListener('mousedown', function dehors(e) {
    if (!simPop || simPop.contains(e.target)) return;
    fermerDetailJour();
    document.removeEventListener('mousedown', dehors);
  }), 0);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerDetailJour(); });

// Report dans le planning : jours posés hors jours normaux → « T » ; jours
// normaux non posés → « R ». Seules les cases vides sont remplies.
async function appliquerSimulation(sim, agents, jours) {
  const changements = [];
  let conflits = 0;
  for (const a of agents) {
    const poses = new Set((sim.jours || {})[a.id] || []);
    for (const d of jours) {
      if (!presentLe(a, d)) continue;
      const val = (simState.reel[a.id] || {})[d];
      const vide = !val || (!val.code && !val.texte && !val.hs);
      const reel = travailleReel(a, d, val);
      // Service tenu ce jour s'il diffère de celui du planning (dimanche, renfort).
      const svc = poses.has(d) && svcJour(sim, a, d) !== equipeEff(a, val) ? svcJour(sim, a, d) : null;
      if (poses.has(d) && !reel) {
        if (vide) changements.push({ agentId: a.id, date: d, code: 'T', ...(svc || M.parseISODate(d).getDay() === 0 ? { service: svcJour(sim, a, d) } : {}) });
        else conflits += 1;
      } else if (poses.has(d) && svc) {
        changements.push({ agentId: a.id, date: d, service: svc });
      } else if (!poses.has(d) && reel) {
        if (vide) changements.push({ agentId: a.id, date: d, code: 'R' });
        else conflits += 1;
      }
    }
  }
  // HS automatiques corrigées dans le scénario → reportées sur la case du planning.
  let corrections = 0;
  for (const [agentId, parJour] of Object.entries(sim.hsReg || {})) {
    for (const [date, n] of Object.entries(parJour)) {
      if (!((sim.jours || {})[agentId] || []).includes(date)) continue;
      changements.push({ agentId, date, hsReg: n });
      corrections += 1;
    }
  }
  if (!changements.length) {
    toast(conflits ? `Rien à appliquer automatiquement (${plural(conflits, 'case')} déjà remplie(s) à revoir à la main).` : 'Le planning correspond déjà à ce scénario.');
    return;
  }
  const t = changements.filter((c) => c.code === 'T').length;
  const r = changements.filter((c) => c.code === 'R').length;
  const sv = changements.filter((c) => !c.code && c.service).length;
  const lignes = [t ? `${plural(t, 'jour')} travaillé(s) en plus → « T »` : '', r ? `${plural(r, 'jour')} non travaillé(s) → « R »` : '', sv ? `${plural(sv, 'changement')} de service (dimanche, renfort)` : '', corrections ? `${plural(corrections, 'correction')} d'HS automatiques` : ''].filter(Boolean).join('\n');
  if (await ask('Appliquer au planning ?', `${lignes}${conflits ? `\n\n${plural(conflits, 'case')} déjà remplie(s) ne sera pas modifiée.` : ''}${t || r ? '\n\nSeules les cases vides du planning sont remplies.' : ''}`,
    [{ label: 'Annuler', value: 'no' }, { label: 'Appliquer', value: 'yes', cls: 'primary' }]) !== 'yes') return;
  try {
    const res = await call(api.planAppliquer(changements, S.user));
    planSemCache.clear();
    toast(`Planning mis à jour : ${plural(res.poses, 'case')}.`);
  } catch (err) {
    toast(`Non appliqué : ${err.message}`);
  }
  renderPlanning();
}
