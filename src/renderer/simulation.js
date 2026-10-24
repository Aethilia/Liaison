'use strict';

/* global S, M, h, icon, call, api, ask, toast, promptText, plural, planState, PLAN_EQUIPES, planCode, presentLe, presentEntre,
   equipeEff, jourNormal, hsType, hsVide, typeHsDefaut, HS_TYPES, fmtHs, HS_FERIE, HS_DIMANCHE, renderPlanning, planSemCache, ROLES, roleInfo */
// Onglet « Simulation » du planning : un brouillon du mois pour organiser les
// jours travaillés en gardant un œil sur la limite d'heures supp (35h par mois,
// toutes HS confondues ; report possible pour les responsables). On choisit un
// agent (il « colle » à la souris) puis on clique sur les jours pour l'ajouter ou
// le retirer. Plusieurs scénarios par mois, enregistrés et partagés ; le planning
// réel n'est modifié que par « Appliquer au planning ».

const SIM_LIMITE = 35;
const simState = { equipe: 'total', mois: null, sims: [], id: null, pinceau: null, rolePinceau: null, reel: {}, minuterie: null, noms: false, inclurePonct: true };
// Rôle d'un agent un jour donné : celui posé dans la simulation, sinon son rôle habituel.
const roleJour = (sim, a, d) => ((sim.roles || {})[a.id] || {})[d] || a.role || '';

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
function hsSimJour(a, d, pose, val) {
  const out = hsVide();
  if (pose) {
    const j = M.parseISODate(d).getDay();
    if (M.ferie(d)) out.rouge += HS_FERIE;
    else if (j === 0) out.rouge += HS_DIMANCHE;
    else if (j === 6) out.bleu += 7;
    else if (['matin', 'nuit'].includes(equipeEff(a))) out.vert += 1;
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
    const hj = hsSimJour(a, d, poses.has(d), (simState.reel[a.id] || {})[d]);
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
function basculer(agentId, d, { retirer = false } = {}) {
  const sim = simCourante();
  if (!sim) return;
  const a = planState.agents.find((x) => x.id === agentId);
  const liste = new Set(sim.jours[agentId] || []);
  const roles = { ...((sim.roles || {})[agentId] || {}) };
  const voulu = (!retirer && simState.pinceau === agentId && simState.rolePinceau) || (a && a.role) || '';
  if (liste.has(d) && !retirer && voulu && roleJour(sim, a, d) !== voulu) {
    if (voulu === (a && a.role)) delete roles[d];
    else roles[d] = voulu;
  } else if (liste.has(d)) {
    liste.delete(d);
    delete roles[d];
  } else {
    liste.add(d);
    if (voulu && voulu !== (a && a.role)) roles[d] = voulu;
  }
  sim.jours[agentId] = [...liste].sort();
  sim.roles = { ...(sim.roles || {}), [agentId]: roles };
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
  const visibles = parService ? agents.filter((a) => equipeEff(a) === simState.equipe) : agents;
  const nomsVisibles = simState.noms || parService;
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
    parService ? null : h('label', { class: 'sim-option' }, h('input', { type: 'checkbox', checked: simState.noms, onchange: (e) => { simState.noms = e.target.checked; renderPlanning({ reload: false }); } }), 'Noms dans les cases'),
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
      h('span', { class: 'sim-nom' }, a.nom, a.role ? h('i', { class: 'sim-role', style: { '--c': roleInfo(a.role).couleur }, title: a.role }, roleInfo(a.role).court) : null, h('small', {}, `${c.nb} j`)),
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
      const presents = visibles.filter((a) => ((sim.jours || {})[a.id] || []).includes(d));
      const jour = M.parseISODate(d).getDay();
      const ferie = M.ferie(d);
      const parEquipe = PLAN_EQUIPES.map((e) => ({ e, n: presents.filter((a) => a.equipe === e.id).length })).filter((x) => x.n);
      const parRole = [...ROLES.map((x) => x.id), ''].map((rid) => ({ r: roleInfo(rid), n: presents.filter((a) => (roleJour(sim, a, d) || '') === rid).length })).filter((x) => x.n && x.r);
      const avecPinceau = pinceau && presents.includes(pinceau);
      const absentReel = pinceau && (() => { const v = (simState.reel[pinceau.id] || {})[d]; const c = v && planCode(v.code); return c && c.absence ? c.label : ''; })();
      return h('div', {
        class: `sim-case${jour === 0 || jour === 6 ? ' we' : ''}${ferie ? ' ferie' : ''}${avecPinceau ? ' pose' : ''}${pinceau ? ' cible' : ''}`,
        title: `${presents.map((a) => a.nom).join(', ') || 'Personne'}${absentReel ? `\n${pinceau.nom} : ${absentReel} au planning` : ''}`,
        onclick: (e) => { if (pinceau) basculer(pinceau.id, d); else detailJour(e.currentTarget, sim, d, visibles); },
      },
      h('div', { class: 'sim-date' }, h('b', {}, Number(d.slice(8))), ferie ? h('span', { class: 'sim-ferie' }, 'Férié') : null,
        absentReel ? h('span', { class: 'sim-alerte', title: `${absentReel} au planning` }, '!') : null,
        h('span', { class: 'sim-total' }, presents.length || '')),
      nomsVisibles
        ? h('div', { class: 'sim-chips' }, presents.map((a) => h('span', { class: `sim-chip${pinceau === a ? ' moi' : ''}`, style: { '--c': couleurEquipe(a) }, title: `${roleJour(sim, a, d) || 'sans rôle'}${pinceau ? ' · cliquer pour le retirer' : ''}`, onclick: (e) => { if (!pinceau) return; e.stopPropagation(); basculer(a.id, d, { retirer: true }); } }, roleJour(sim, a, d) ? `${roleInfo(roleJour(sim, a, d)).court} · ${a.nom}` : a.nom)))
        : [h('div', { class: 'sim-roles' }, parRole.map((x) => h('span', { class: 'sim-badge', style: { '--c': x.r.couleur }, title: x.r.id }, `${x.r.court} ${x.n}`))),
          h('div', { class: 'sim-equipes' }, parEquipe.map((x) => h('span', { class: 'sim-badge equipe', style: { '--c': x.e.couleur() }, title: x.e.label }, `${x.e.label.slice(0, 1)} ${x.n}`)))],
      avecPinceau && !nomsVisibles ? h('span', { class: 'sim-chip moi', style: { '--c': couleurEquipe(pinceau) } }, roleJour(sim, pinceau, d) ? `${roleInfo(roleJour(sim, pinceau, d)).court} · ${pinceau.nom}` : pinceau.nom) : null);
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
          pinceau ? h('span', { class: 'sim-roles-choix' }, 'Rôle :', ROLES.map((x) => h('button', {
            class: `sim-role-btn${(simState.rolePinceau || pinceau.role) === x.id ? ' on' : ''}`, style: { '--c': x.couleur }, title: x.id === pinceau.role ? 'Rôle habituel' : 'Rôle pour les jours posés maintenant',
            onclick: (e) => { e.stopPropagation(); simState.rolePinceau = x.id; renderPlanning({ reload: false }); },
          }, x.id, x.id === pinceau.role ? ' ·' : ''))) : null,
          h('span', { class: 'hint' }, pinceau ? `${pinceau.nom} : cliquer sur les jours pour l'ajouter, changer son rôle ou le retirer · Échap ou clic droit pour lâcher` : 'Cliquer sur un agent à gauche, puis sur les jours')),
        h('div', { class: 'card-body' }, cal,
          h('p', { class: 'muted sim-legende' }, `HS d'un jour posé : matin et nuit +1h verte en semaine · samedi +7h bleues · dimanche ${HS_DIMANCHE}h rouges · férié ${HS_FERIE}h rouges. Total HS du scénario : ${fmtHs(total.reduce((a, c) => a + c.hs, 0)).replace('+', '')}`)))));
}

// Petite fenêtre au clic sur un jour (sans pinceau) : présents par service et
// par rôle, HS du jour de chacun, retrait possible.
let simPop = null;
function fermerDetailJour() {
  if (simPop) simPop.remove();
  simPop = null;
}
function detailJour(cellule, sim, d, visibles) {
  fermerDetailJour();
  const presents = visibles.filter((a) => ((sim.jours || {})[a.id] || []).includes(d));
  const titre = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(M.parseISODate(d));
  const groupes = PLAN_EQUIPES.map((eq) => ({ eq, liste: presents.filter((a) => (a.equipe === 'responsables' ? eq.id === 'responsables' : equipeEff(a) === eq.id)) })).filter((g) => g.liste.length);
  const parRole = [...ROLES.map((x) => x.id), ''].map((rid) => ({ r: roleInfo(rid) || { id: 'Sans rôle', court: '?', couleur: '#94a3b8' }, n: presents.filter((a) => (roleJour(sim, a, d) || '') === rid).length })).filter((x) => x.n);
  const hsTotal = presents.reduce((t, a) => { const hj = hsSimJour(a, d, true, (simState.reel[a.id] || {})[d]); return t + hj.bleu + hj.rouge + hj.vert; }, 0);
  simPop = h('div', { class: 'plan-pop sim-pop', role: 'dialog', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'pop-titre' }, h('b', {}, titre.replace(/^./, (c) => c.toUpperCase())), M.ferie(d) ? h('span', { class: 'sim-ferie' }, M.ferie(d)) : null,
      h('span', { class: 'muted' }, ` · ${plural(presents.length, 'présent')}${hsTotal ? ` · ${fmtHs(hsTotal).replace('+', '')} d'HS` : ''}`)),
    parRole.length ? h('div', { class: 'sim-roles sim-pop-roles' }, parRole.map((x) => h('span', { class: 'sim-badge', style: { '--c': x.r.couleur } }, `${x.r.id} : ${x.n}`))) : null,
    presents.length ? groupes.map((g) => h('div', { class: 'sim-pop-groupe' },
      h('div', { class: 'sim-equipe', style: { '--eq': g.eq.couleur() } }, h('span', { class: 'eq-pastille' }), `${g.eq.label} (${g.liste.length})`),
      g.liste.map((a) => {
        const role = roleJour(sim, a, d);
        const hj = hsSimJour(a, d, true, (simState.reel[a.id] || {})[d]);
        const v = (simState.reel[a.id] || {})[d];
        const c = v && planCode(v.code);
        return h('div', { class: 'sim-pop-ligne' },
          role ? h('i', { class: 'sim-role', style: { '--c': roleInfo(role).couleur }, title: role }, roleInfo(role).court) : h('i', { class: 'sim-role', style: { '--c': '#cbd5e1' } }, '?'),
          h('span', { class: 'sim-pop-nom' }, a.nom, c && c.absence ? h('small', { class: 'sim-pop-abs' }, ` ${c.label} au planning`) : null),
          h('span', { class: 'sim-pop-hs' }, HS_TYPES.filter((t) => hj[t.id]).map((t) => h('span', { style: { color: t.couleur } }, fmtHs(hj[t.id])))),
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
      if (poses.has(d) && !reel) {
        if (vide) changements.push({ agentId: a.id, date: d, code: 'T' });
        else conflits += 1;
      } else if (!poses.has(d) && reel) {
        if (vide) changements.push({ agentId: a.id, date: d, code: 'R' });
        else conflits += 1;
      }
    }
  }
  if (!changements.length) {
    toast(conflits ? `Rien à appliquer automatiquement (${plural(conflits, 'case')} déjà remplie(s) à revoir à la main).` : 'Le planning correspond déjà à ce scénario.');
    return;
  }
  const t = changements.filter((c) => c.code === 'T').length;
  const r = changements.length - t;
  if (await ask('Appliquer au planning ?', `${plural(t, 'jour')} travaillé(s) en plus → « T »\n${plural(r, 'jour')} non travaillé(s) → « R »${conflits ? `\n\n${plural(conflits, 'case')} déjà remplie(s) ne sera pas modifiée.` : ''}\n\nSeules les cases vides du planning sont remplies.`,
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
