'use strict';

/* global S, M, SVC, h, icon, call, api, ask, toast, promptText, plural, siteProfil */
// Onglet « Planning » : agents du site par équipe, semaine du lundi au
// dimanche avec un code par jour (repos, CP, maladie…), notes de la semaine,
// synthèse mensuelle par agent et gestion de la liste des agents.

// Équipes : les services du site (CPTP : matin et soir), puis responsables et autres.
const PLAN_EQUIPES = [];
const heuresEquipe = (d) => d.horaires.replace(/\s*-\s*/, d.id === 'nuit' ? ' → ' : '-');
function majPlanEquipes() {
  // Une équipe retirée du site reste affichée tant qu'un agent y est rangé.
  const svcs = M.SERVICES_TOUS.filter((d) => M.SERVICES.some((x) => x.id === d.id) || planState.agents.some((a) => a.equipe === d.id));
  PLAN_EQUIPES.splice(0, PLAN_EQUIPES.length,
    ...svcs.map((d) => ({ id: d.id, label: SVC[d.id].label, heures: heuresEquipe(SVC[d.id]), couleur: () => SVC[d.id].couleur })),
    { id: 'responsables', label: 'Responsables', heures: '', couleur: () => '#0f766e' },
    { id: 'autres', label: 'Autres', heures: '', couleur: () => '#64748b' });
}
// Codes du planning. `absence` : l'agent n'est pas là (compte dans « Agents absents »).
// `signale` : l'agent est là mais apparaît aussi dans « Agents absents » (retard).
const PLAN_CODES_BASE = [
  { code: 'R', label: 'Repos', couleur: '#94a3b8', absence: true },
  { code: 'CP', label: 'Congés payés', couleur: '#1baf7a', absence: true },
  { code: 'MAL', label: 'Maladie', couleur: '#e34948', absence: true },
  { code: 'ABS', label: 'Absence', couleur: '#eb6834', absence: true },
  { code: 'CN', label: 'Naissance', couleur: '#e87ba4', absence: true },
  { code: 'FOR', label: 'Formation', couleur: '#4a3aa7', absence: true },
  { code: 'RET', label: 'Retard', couleur: '#d9480f', signale: true },
  { code: 'HS', label: 'Heures supp', couleur: '#0b7285' },
  { code: 'VM', label: 'Visite médicale', couleur: '#2a78d6' },
  { code: 'INT', label: 'Intempéries', couleur: '#5b6b7f', absence: true },
  { code: 'T', label: 'Travaille (WE)', couleur: '#0f766e' },
  { code: 'H', label: 'Horaire / note', couleur: '#eda100' },
];
// Codes affichés : ceux de base, précisés ou complétés par ceux du site
// (onglet « Codes » : abréviations du classeur comme PAT, AT, APM…).
const PLAN_CODES = [];
function majPlanCodes() {
  const site = planState.codes || [];
  const base = PLAN_CODES_BASE.map((c) => ({ ...c, ...(site.find((x) => x.code === c.code) || {}), base: true }));
  const autres = site.filter((x) => !PLAN_CODES_BASE.some((c) => c.code === x.code));
  PLAN_CODES.splice(0, PLAN_CODES.length, ...base.slice(0, -1), ...autres, base[base.length - 1]); // « H » en dernier
}
// Code inconnu (ajouté par un autre poste, retiré depuis) : affiché tel quel.
const planCode = (c) => PLAN_CODES.find((x) => x.code === c) || (c ? { code: c, label: c, couleur: '#868e96' } : undefined);
// Couleurs proposées pour les repères et les cases (celles du classeur Excel).
const PLAN_COULEURS = ['#ffff00', '#ffff99', '#ffc000', '#ff0000', '#92d050', '#99ff33', '#00b0f0', '#b8cce4', '#cc00ff', '#f078df', '#21dfbf', '#f4b183'];
// Heures supplémentaires : 1 → « +1h », 3.5 → « +3h30 ».
const fmtHs = (n) => `+${Math.floor(n)}h${Math.round((n % 1) * 60) ? String(Math.round((n % 1) * 60)).padStart(2, '0') : ''}`;
// « 2 », « 3h30 », « 1,5 » → nombre d'heures (null si illisible).
function lireHs(t) {
  const x = String(t || '').trim().replace(/^\+/, '');
  if (!x) return null;
  const m = /^(\d{1,2})\s*h\s*(\d{1,2})?$/i.exec(x);
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  const n = Number(x.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const planState = { vue: 'semaine', date: null, agents: [], codes: [], semaine: null, mois: null, loadedAt: 0 };
majPlanCodes();

const isoAjout = (iso, n) => M.addDays(iso, n);
// Arrivée / départ d'un agent (facultatifs) : il ne compte qu'entre ces dates.
const presentLe = (a, d) => (!a.arrivee || d >= a.arrivee) && (!a.depart || d <= a.depart);
const presentEntre = (a, debut, fin) => (!a.arrivee || a.arrivee <= fin) && (!a.depart || a.depart >= debut);
const estParti = (a) => !!a.depart && a.depart < aujourdhui();
const fmtCourt = (iso) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(M.parseISODate(iso));
const datesAgent = (a) => [a.arrivee ? `arrivé le ${fmtCourt(a.arrivee)}` : '', a.depart ? `parti le ${fmtCourt(a.depart)}` : ''].filter(Boolean).join(' · ');
const lundiDe = (iso) => {
  const d = M.parseISODate(iso);
  return isoAjout(iso, -((d.getDay() + 6) % 7));
};
const aujourdhui = () => new Date().toLocaleDateString('fr-CA');
const estWeekEnd = (iso) => [0, 6].includes(M.parseISODate(iso).getDay());
const fmtJour = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(M.parseISODate(iso));
const fmtMois = (y, m) => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));

// Agents du planning (remplacent la liste « Agents absents » quand il y en a).
async function loadPlanAgents() {
  try {
    planState.agents = await call(api.planAgents());
  } catch {
    planState.agents = [];
  }
  planState.codes = await call(api.planCodes()).catch(() => planState.codes);
  majPlanCodes();
  majPlanEquipes();
  return planState.agents;
}

async function renderPlanning({ reload = true } = {}) {
  fermerPalette();
  if (!planState.date) planState.date = aujourdhui();
  if (!planState.mois) {
    const d = M.parseISODate(planState.date);
    planState.mois = { y: d.getFullYear(), m: d.getMonth() + 1 };
  }
  majPlanEquipes();
  if (reload) {
    await loadPlanAgents();
    if (planState.vue === 'semaine') planState.semaine = await call(api.planSemaine(planState.date)).catch(() => null);
    planState.loadedAt = Date.now();
  }
  const root = document.getElementById('planning');
  const onglets = h('div', { class: 'seg plan-seg' }, [['semaine', 'Semaine', 'list'], ['synthese', 'Synthèse', 'chart'], ['agents', 'Agents', 'users'], ['codes', 'Codes', 'palette']].map(([id, label, ic]) => h('button', {
    class: planState.vue === id ? 'on' : '', onclick: () => { planState.vue = id; renderPlanning(); },
  }, icon(ic, 14), label)));
  const head = h('div', { class: 'recap-head plan-head' }, h('h2', {}, `Planning${S.siteName ? ` · ${S.siteName}` : ''}`), onglets, h('span', { class: 'spacer' }));
  let corps;
  if (!planState.agents.length && !['agents', 'codes'].includes(planState.vue)) {
    corps = h('div', { class: 'j-empty' }, icon('users', 32), h('p', {}, 'Aucun agent dans le planning.'),
      h('p', { class: 'muted' }, 'Commencez par ajouter vos agents et leur équipe.'),
      h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } },
        h('button', { class: 'btn accent', onclick: () => { planState.vue = 'agents'; renderPlanning({ reload: false }); } }, icon('plus', 15), 'Ajouter les agents'), boutonImport()));
  } else if (planState.vue === 'semaine') corps = vueSemaine(head);
  else if (planState.vue === 'synthese') corps = await vueSynthese(head);
  else if (planState.vue === 'codes') corps = vueCodes();
  else corps = vueAgents();
  root.replaceChildren(head, corps);
}

/* ---------- Vue semaine ---------- */

function vueSemaine(head) {
  const lundi = lundiDe(planState.date);
  const jours = Array.from({ length: 7 }, (_, i) => isoAjout(lundi, i));
  const auj = aujourdhui();
  const sem = planState.semaine || { cases: {}, notes: '' };
  const aller = (n) => { planState.date = isoAjout(lundi, n); renderPlanning(); };
  head.append(...[
    h('button', { class: 'btn', title: 'Semaine précédente', onclick: () => aller(-7) }, icon('chevronLeft', 16)),
    h('div', { class: 'plan-periode' }, `Semaine du ${fmtJour(lundi)} au ${fmtJour(jours[6])} ${M.parseISODate(jours[6]).getFullYear()}`),
    h('button', { class: 'btn', title: 'Semaine suivante', onclick: () => aller(7) }, icon('chevronRight', 16)),
    lundi === lundiDe(auj) ? null : h('button', { class: 'btn ghost', onclick: () => { planState.date = auj; renderPlanning(); } }, 'Cette semaine')].filter(Boolean));

  const colonnes = h('colgroup', {}, h('col', { class: 'c-agent' }), jours.map(() => h('col')));
  const entete = h('thead', {}, h('tr', {}, h('th', { class: 'c-agent' }, 'Agent'),
    jours.map((d, i) => h('th', { class: `${estWeekEnd(d) ? 'we' : ''}${d === auj ? ' auj' : ''}` },
      h('div', { class: 'j-nom' }, JOURS_COURTS[i]), h('div', { class: 'j-date' }, fmtJour(d))))));
  const lignes = [];
  for (const eq of PLAN_EQUIPES) {
    const agents = planState.agents.filter((a) => a.equipe === eq.id && presentEntre(a, lundi, jours[6]));
    if (!agents.length) continue;
    // Bandeau d'équipe : présents / effectif pour chaque jour (hors arrivées / départs).
    lignes.push(h('tr', { class: 'plan-equipe', style: { '--eq': eq.couleur() } },
      h('th', { class: 'c-agent' }, h('span', { class: 'eq-pastille' }), eq.label, eq.heures ? h('small', {}, ` ${eq.heures}`) : null),
      jours.map((d) => {
        const effectif = agents.filter((a) => presentLe(a, d));
        const absents = effectif.filter((a) => { const c = (sem.cases[a.id] || {})[d]; return c && planCode(c.code) && planCode(c.code).absence; }).length;
        const presents = effectif.length - absents;
        return h('td', { class: `${estWeekEnd(d) ? 'we' : ''}${d === auj ? ' auj' : ''}`, title: `${presents} présent(s) sur ${effectif.length}` },
          h('span', { class: `eq-compte${absents ? ' manque' : ''}` }, `${presents}/${effectif.length}`));
      })));
    for (const a of agents) {
      lignes.push(h('tr', { class: 'plan-agent', style: { '--eq': eq.couleur() } },
        h('th', { class: 'c-agent' }, a.nom),
        jours.map((d) => (presentLe(a, d)
          ? caseAgent(a, d, (sem.cases[a.id] || {})[d], { we: estWeekEnd(d), auj: d === auj, nuit: eq.id === 'nuit' })
          : h('td', { class: 'plan-case hors', title: a.arrivee && d < a.arrivee ? `${a.nom} arrive le ${fmtCourt(a.arrivee)}` : `${a.nom} est parti le ${fmtCourt(a.depart)}` })))));
    }
  }
  const legende = h('div', { class: 'plan-legende' }, PLAN_CODES.map((c) => h('span', { class: 'leg' }, h('i', { style: { background: c.couleur } }, c.code), c.label)),
    h('span', { class: 'leg muted' }, 'Case vide = travaille normalement'),
    h('span', { class: 'leg muted' }, legendeNuit()));
  const notes = h('textarea', { class: 'plan-notes-txt', rows: 4, placeholder: 'Notes de la semaine (formations, travaux, remplacements…)' });
  notes.value = sem.notes || '';
  notes.addEventListener('change', async () => {
    try {
      planState.semaine = await call(api.planSetNotes(lundi, notes.value, S.user));
      toast('Notes enregistrées.');
    } catch (err) {
      toast(`Non enregistré : ${err.message}`);
    }
  });
  return h('div', { class: 'plan-semaine' },
    h('div', { class: 'card plan-grille-card' }, h('div', { class: 'plan-scroll' }, h('table', { class: 'plan-grille' }, colonnes, entete, h('tbody', {}, lignes))), legende),
    h('div', { class: 'plan-cote' }, carteReperes(lundi, sem),
      h('div', { class: 'card plan-notes' }, h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('note', 16)), 'Notes de la semaine'),
        h('div', { class: 'card-body' }, notes))));
}

// Repères de la semaine : textes colorés, la couleur se retrouve sur les cases
// concernées (choisie dans la palette d'une case). Changent d'une semaine à l'autre.
function carteReperes(lundi, sem) {
  const reperes = sem.reperes || [];
  const enregistrer = async (list) => {
    try {
      planState.semaine = await call(api.planSetReperes(lundi, list, S.user));
    } catch (err) {
      toast(`Non enregistré : ${err.message}`);
    }
    renderPlanning({ reload: false });
  };
  let couleur = PLAN_COULEURS.find((c) => !reperes.some((x) => x.couleur === c)) || PLAN_COULEURS[0];
  const texte = h('input', { type: 'text', placeholder: 'Ex. Formation incendie mardi 13H-16H', maxLength: 120 });
  const pastilles = h('div', { class: 'rep-couleurs' }, PLAN_COULEURS.map((c) => h('button', {
    class: `pop-couleur${c === couleur ? ' on' : ''}`, style: { '--c': c }, title: 'Couleur du repère',
    onclick: (e) => { couleur = c; pastilles.querySelectorAll('.pop-couleur').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); },
  })));
  const ajouter = () => {
    const t = texte.value.trim();
    if (t) enregistrer([...reperes, { texte: t, couleur }]);
  };
  texte.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ajouter(); } });
  return h('div', { class: 'card plan-reperes' },
    h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('flag', 16)), 'Repères de la semaine'),
    h('div', { class: 'card-body' },
      reperes.length ? h('div', { class: 'rep-liste' }, reperes.map((x, i) => h('div', { class: 'rep-ligne', style: { '--c': x.couleur } },
        h('span', { class: 'rep-carre' }), h('span', { class: 'rep-texte' }, x.texte),
        h('button', { class: 'o-btn rm', title: 'Retirer ce repère', onclick: () => enregistrer(reperes.filter((_, j) => j !== i)) }, icon('x', 13)))))
        : h('p', { class: 'muted rep-vide' }, 'Aucun repère. La couleur d\'un repère se pose sur les cases depuis leur palette.'),
      h('div', { class: 'rep-ajout' }, texte, pastilles, h('button', { class: 'btn small', onclick: ajouter }, icon('plus', 13), 'Ajouter'))));
}

// Import d'un classeur Excel de planning (format du CTVO).
async function importerPlanningExcel() {
  let ap;
  try {
    ap = await call(api.planImportChoisir());
  } catch (err) {
    toast(`Lecture impossible : ${err.message}`);
    return;
  }
  if (!ap) return;
  const nomEq = (id) => (PLAN_EQUIPES.find((e) => e.id === id) || { label: id }).label;
  const date = (iso) => (iso ? `${fmtJour(iso)} ${iso.slice(0, 4)}` : '?');
  const texte = [
    ap.fichier,
    '',
    `${ap.nbAgents} agents : ${Object.entries(ap.equipes).map(([id, n]) => `${nomEq(id)} ${n}`).join(' · ')}`,
    `${ap.nbSemaines} semaines, du ${date(ap.debut)} au ${date(isoAjout(ap.fin, 6))} · ${ap.nbCases} cases`,
    '',
    'Les agents déjà dans le planning sont retrouvés par leur nom. Sur ces semaines, leurs cases sont remplacées par celles du classeur ; notes et repères s\'ajoutent.',
    ap.partis || ap.arrives ? `\nArrivées / départs repérés : ${plural(ap.arrives || 0, 'arrivée')}, ${plural(ap.partis || 0, 'départ')} (modifiables ensuite).` : '',
    ap.ecartes && ap.ecartes.length ? `Noms écartés (mise en page) : ${ap.ecartes.join(', ')}` : '',
  ].join('\n');
  if (await ask('Importer ce planning ?', texte, [{ label: 'Annuler', value: 'no' }, { label: 'Importer', value: 'yes', cls: 'primary' }]) !== 'yes') return;
  try {
    const r = await call(api.planImportAppliquer(S.user));
    planState.agents = r.agents;
    planState.codes = r.codes || planState.codes;
    majPlanCodes();
    planSemCache.clear();
    await rafraichirAgentsAbsents();
    toast(`Planning importé : ${plural(r.nbSemaines, 'semaine')}, ${plural(r.ajoutes, 'agent')} ajouté(s).`);
    planState.vue = 'semaine';
    renderPlanning();
  } catch (err) {
    toast(`Import impossible : ${err.message}`);
  }
}
const importPossible = () => !M.deuxServices(siteProfil());
const boutonImport = (cls = 'btn') => (importPossible() ? h('button', { class: cls, onclick: importerPlanningExcel, title: 'Reprendre les agents et les semaines d\'un classeur Excel' }, icon('upload', 15), 'Importer un planning Excel') : null);

// Nuit (ou soir au CPTP) : une seule vacation, rattachée au jour où elle commence (20H → 4H le lendemain).
const libelleJour = (date, nuit) => (nuit ? `${SVC.nuit.label.toLowerCase()} du ${fmtJourCourt(date)} au ${fmtJourCourt(isoAjout(date, 1))}` : fmtJour(date));
function legendeNuit() {
  const [debut, fin] = SVC.nuit.horaires.split(/\s*-\s*/);
  return `${SVC.nuit.label} : une case = une vacation, de ${debut} au lendemain ${fin}`;
}
// Durée d'un retard : « 30 » → « 30 min ».
const dureeRetard = (t) => (/^\d+$/.test(t) ? `${t} min` : t);
const fmtJourCourt = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' }).format(M.parseISODate(iso));

function caseAgent(agent, date, val, { we, auj, nuit = false }) {
  const c = val && planCode(val.code);
  const td = h('td', {
    class: `plan-case${we ? ' we' : ''}${auj ? ' auj' : ''}${c ? ' rempli' : ''}${val && val.couleur ? ' colore' : ''}`,
    style: val && val.couleur ? { '--fond': val.couleur } : null,
    tabIndex: 0, title: `${agent.nom} — ${libelleJour(date, nuit)}${c ? ` : ${c.label}` : ''}${val && val.texte ? ` (${val.texte})` : ''}${val && val.hs ? ` · ${fmtHs(val.hs)} supp` : ''}`,
    onclick: (e) => ouvrirPalette(e.currentTarget, agent, date, val, nuit),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirPalette(e.currentTarget, agent, date, val, nuit); } },
  });
  if (c) td.append(h('span', { class: 'plan-code', style: { '--c': c.couleur } }, val.code === 'H' && val.texte ? val.texte : val.code === 'HS' && val.hs ? fmtHs(val.hs) : c.code));
  else if (val && val.texte) td.append(h('span', { class: 'plan-texte' }, val.texte));
  if (c && val.texte && val.code !== 'H') td.append(h('small', { class: 'plan-texte' }, val.texte));
  if (val && val.hs && val.code !== 'HS') td.append(h('span', { class: 'plan-hs', title: 'Heures supplémentaires' }, fmtHs(val.hs)));
  return td;
}

let planPop = null;
function fermerPalette() {
  if (planPop) planPop.remove();
  planPop = null;
}

// Petite palette posée sous la case : un clic sur un code l'enregistre.
function ouvrirPalette(td, agent, date, val, nuit = false) {
  fermerPalette();
  const texte = h('input', { type: 'text', placeholder: val && val.code === 'RET' ? 'Durée du retard (ex. 30 min)' : 'Horaire ou note (ex. 13H-18H, +3h30)', value: (val && val.texte) || '', maxLength: 40 });
  const heures = h('input', { type: 'text', class: 'pop-hs-input', placeholder: 'ex. 1, 3h30', value: val && val.hs ? fmtHs(val.hs).slice(1) : '', maxLength: 6, inputMode: 'decimal' });
  let couleurChoisie = (val && val.couleur) || '';
  let enAttente = null; // code choisi qui attend sa précision (retard → durée, heures supp → nombre)
  const choisir = async (code) => {
    let t = texte.value.trim();
    const hs = lireHs(heures.value);
    if (heures.value.trim() && hs == null) { toast('Heures supp : nombre d\'heures, ex. 1, 2,5 ou 3h30.'); heures.focus(); return; }
    // Heures supp seules : on demande le nombre d'heures.
    if (code === 'HS' && !hs) {
      enAttente = 'HS';
      planPop.querySelectorAll('.pop-code').forEach((b) => b.classList.toggle('on', b.dataset.code === 'HS'));
      heures.focus();
      return;
    }
    // Retard : on demande la durée avant d'enregistrer.
    if (code === 'RET' && !t) {
      enAttente = 'RET';
      planPop.querySelectorAll('.pop-code').forEach((b) => b.classList.toggle('on', b.dataset.code === 'RET'));
      texte.placeholder = 'Durée du retard (ex. 30 min), puis OK';
      texte.focus();
      return;
    }
    if (code === 'RET') t = dureeRetard(t);
    fermerPalette();
    // Seules les heures supp saisies : case « HS ».
    const codeFinal = code === null ? '' : code || (t ? 'H' : hs ? 'HS' : '');
    try {
      planState.semaine = await call(api.planSetCase(agent.id, date, { code: codeFinal, texte: code === null ? '' : t, hs: code === null ? null : hs, couleur: code === null ? '' : couleurChoisie }, S.user));
      planSemCache.delete(lundiDe(date));
    } catch (err) {
      toast(`Non enregistré : ${err.message}`);
    }
    renderPlanning({ reload: false });
  };
  // Couleur de la case (renvoie à un repère de la semaine) : appliquée tout de
  // suite si la case a déjà un contenu, sinon avec le code choisi ensuite.
  function paletteCouleurs() {
    const reperes = (planState.semaine && planState.semaine.reperes) || [];
    const titres = new Map();
    for (const x of reperes) if (!titres.has(x.couleur)) titres.set(x.couleur, x.texte);
    const couleurs = [...new Set([...titres.keys(), ...PLAN_COULEURS])];
    const ligne = h('div', { class: 'pop-couleurs' }, h('span', { class: 'muted' }, 'Couleur'),
      ['', ...couleurs].map((c) => h('button', {
        class: `pop-couleur${c === couleurChoisie ? ' on' : ''}${c ? '' : ' aucune'}${titres.has(c) ? ' repere' : ''}`, style: c ? { '--c': c } : null,
        title: c ? (titres.get(c) || 'Couleur') : 'Sans couleur',
        onclick: (e) => {
          couleurChoisie = c;
          ligne.querySelectorAll('.pop-couleur').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
          if (val && (val.code || val.texte || val.hs)) choisir(val.code || '');
        },
      })));
    return ligne;
  }
  const valider = () => choisir(enAttente || ((val && val.code && !['H', 'HS'].includes(val.code)) ? val.code : texte.value.trim() ? 'H' : ''));
  for (const champ of [texte, heures]) champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); valider(); } if (e.key === 'Escape') fermerPalette(); });
  planPop = h('div', { class: 'plan-pop', role: 'dialog' },
    h('div', { class: 'pop-titre' }, h('b', {}, agent.nom), h('span', { class: 'muted' }, ` · ${libelleJour(date, nuit)}`)),
    h('div', { class: 'pop-codes' }, PLAN_CODES.map((c) => h('button', {
      class: `pop-code${val && val.code === c.code ? ' on' : ''}`, style: { '--c': c.couleur }, title: c.label, 'data-code': c.code, onclick: () => choisir(c.code),
    }, h('b', {}, c.code), h('span', {}, c.label)))),
    paletteCouleurs(),
    h('div', { class: 'pop-texte' }, texte, h('label', { class: 'pop-hs', title: 'Heures supplémentaires' }, h('span', {}, '+'), heures, h('span', {}, 'h supp')), h('button', { class: 'btn small', onclick: valider }, 'OK')),
    h('button', { class: 'btn ghost small pop-effacer', onclick: () => choisir(null) }, icon('x', 13), 'Effacer (travaille normalement)'));
  document.body.append(planPop);
  const r = td.getBoundingClientRect();
  const w = 380;
  planPop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  const bas = r.bottom + 6 + planPop.offsetHeight < window.innerHeight;
  planPop.style.top = `${bas ? r.bottom + 6 : Math.max(8, r.top - planPop.offsetHeight - 6)}px`;
  setTimeout(() => document.addEventListener('mousedown', function dehors(e) {
    if (!planPop || planPop.contains(e.target)) return;
    fermerPalette();
    document.removeEventListener('mousedown', dehors);
  }), 0);
}

/* ---------- Synthèse mensuelle par agent ---------- */

// Jours travaillés : lundi-vendredi sans code d'absence, plus T/H et VM.
function syntheseAgent(cases, debut, fin) {
  const r = { travailles: 0, codes: {}, hs: 0 };
  for (let d = debut; d <= fin; d = isoAjout(d, 1)) {
    const v = cases[d];
    const c = v && planCode(v.code);
    if (v && v.hs) r.hs += v.hs;
    if (c) r.codes[c.code] = (r.codes[c.code] || 0) + 1;
    if (c ? !c.absence : !estWeekEnd(d)) r.travailles += 1;
  }
  return r;
}

async function vueSynthese(head) {
  const { y, m } = planState.mois;
  const debut = `${y}-${String(m).padStart(2, '0')}-01`;
  const fin = isoAjout(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
  const allerMois = (n) => {
    const d = new Date(y, m - 1 + n, 1);
    planState.mois = { y: d.getFullYear(), m: d.getMonth() + 1 };
    renderPlanning({ reload: false });
  };
  head.append(
    h('button', { class: 'btn', title: 'Mois précédent', onclick: () => allerMois(-1) }, icon('chevronLeft', 16)),
    h('div', { class: 'plan-periode mois' }, fmtMois(y, m)),
    h('button', { class: 'btn', title: 'Mois suivant', onclick: () => allerMois(1) }, icon('chevronRight', 16)));
  const cases = await call(api.planEntre(debut, fin)).catch(() => ({}));
  const nbJours = Number(fin.slice(8));
  const codesUtiles = PLAN_CODES.filter((c) => planState.agents.some((a) => Object.values(cases[a.id] || {}).some((v) => v.code === c.code)));
  const lignes = [];
  const totaux = { travailles: 0, codes: {}, hs: 0 };
  for (const eq of PLAN_EQUIPES) {
    const agents = planState.agents.filter((a) => a.equipe === eq.id && presentEntre(a, debut, fin));
    if (!agents.length) continue;
    lignes.push(h('tr', { class: 'syn-equipe', style: { '--eq': eq.couleur() } }, h('td', { colSpan: 4 + codesUtiles.length }, h('span', { class: 'eq-pastille' }), eq.label, eq.heures ? h('small', {}, ` ${eq.heures}`) : null)));
    for (const a of agents) {
      // Seulement sa période de présence dans le mois.
      const deb = a.arrivee && a.arrivee > debut ? a.arrivee : debut;
      const fn = a.depart && a.depart < fin ? a.depart : fin;
      const s = syntheseAgent(cases[a.id] || {}, deb, fn);
      const nbJoursAgent = Math.round((M.parseISODate(fn) - M.parseISODate(deb)) / 864e5) + 1;
      totaux.travailles += s.travailles;
      totaux.hs += s.hs;
      for (const [c, n] of Object.entries(s.codes)) totaux.codes[c] = (totaux.codes[c] || 0) + n;
      // Barre : composition du mois (travaillé + chaque code).
      const barre = h('div', { class: 'syn-barre', title: `${s.travailles} jour(s) travaillé(s)` },
        h('i', { style: { flex: s.travailles, background: eq.couleur() } }),
        PLAN_CODES.filter((c) => s.codes[c.code]).map((c) => h('i', { style: { flex: s.codes[c.code], background: c.couleur }, title: `${c.label} : ${s.codes[c.code]}` })),
        h('i', { class: 'vide', style: { flex: Math.max(0, nbJoursAgent - s.travailles - Object.values(s.codes).reduce((x, n) => x + n, 0)) } }));
      lignes.push(h('tr', { class: 'syn-agent', onclick: () => detailAgent(a, cases[a.id] || {}, debut, fin) },
        h('th', { title: datesAgent(a) }, a.nom, datesAgent(a) ? h('small', { class: 'ag-dates' }, datesAgent(a)) : null),
        h('td', { class: 'num' }, h('b', {}, s.travailles)),
        h('td', { class: 'num' }, s.hs ? h('span', { class: 'syn-badge', style: { '--c': planCode('HS').couleur } }, fmtHs(s.hs)) : h('span', { class: 'muted' }, '·')),
        codesUtiles.map((c) => h('td', { class: 'num' }, s.codes[c.code] ? h('span', { class: 'syn-badge', style: { '--c': c.couleur } }, s.codes[c.code]) : h('span', { class: 'muted' }, '·'))),
        h('td', {}, barre)));
    }
  }
  return h('div', { class: 'card plan-synthese' },
    h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('chart', 16)), `Synthèse par agent · ${fmtMois(y, m)}`,
      h('span', { class: 'hint' }, 'Cliquer sur un agent pour le détail du mois')),
    h('div', { class: 'card-body plan-scroll' }, h('table', { class: 'grid syn-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Agent'), h('th', { class: 'num', title: 'Du lundi au vendredi sans absence, plus les jours codés T, H ou VM' }, 'Travaillés'),
        h('th', { class: 'num', title: 'Heures supplémentaires du mois' }, 'H. supp'),
        codesUtiles.map((c) => h('th', { class: 'num', title: c.label }, h('span', { class: 'syn-badge', style: { '--c': c.couleur } }, c.code))), h('th', {}, 'Répartition du mois'))),
      h('tbody', {}, lignes),
      h('tfoot', {}, h('tr', {}, h('th', {}, 'Total'), h('td', { class: 'num' }, h('b', {}, totaux.travailles)), h('td', { class: 'num' }, h('b', {}, totaux.hs ? fmtHs(totaux.hs) : 0)),
        codesUtiles.map((c) => h('td', { class: 'num' }, h('b', {}, totaux.codes[c.code] || 0))), h('td', {})))),
    codesUtiles.length ? null : h('p', { class: 'muted syn-vide' }, 'Aucun code saisi ce mois-ci : tout le monde travaille normalement.')));
}

// Détail d'un agent : mini calendrier du mois.
function detailAgent(agent, cases, debut, fin) {
  const eq = PLAN_EQUIPES.find((e) => e.id === agent.equipe) || PLAN_EQUIPES[PLAN_EQUIPES.length - 1];
  const premier = M.parseISODate(debut);
  const decal = (premier.getDay() + 6) % 7;
  const cellules = [...Array(decal).fill(null)];
  for (let d = debut; d <= fin; d = isoAjout(d, 1)) cellules.push(d);
  const s = syntheseAgent(cases, debut, fin);
  const dlg = h('dialog', { class: 'plan-detail' }, h('div', { class: 'dialog-body' },
    h('h2', {}, agent.nom, h('small', { class: 'muted' }, ` · ${eq.label}${eq.heures ? ` ${eq.heures}` : ''}`)),
    h('div', { class: 'det-resume' }, h('span', { class: 'syn-badge', style: { '--c': eq.couleur() } }, `${s.travailles} travaillés`),
      s.hs ? h('span', { class: 'syn-badge', style: { '--c': planCode('HS').couleur } }, `${fmtHs(s.hs)} supp`) : null,
      PLAN_CODES.filter((c) => s.codes[c.code]).map((c) => h('span', { class: 'syn-badge', style: { '--c': c.couleur } }, `${s.codes[c.code]} ${c.label.toLowerCase()}`))),
    h('div', { class: 'det-cal' }, JOURS_COURTS.map((j) => h('div', { class: 'det-j' }, j)), cellules.map((d) => {
      if (!d) return h('div', { class: 'det-vide' });
      const v = cases[d];
      const c = v && planCode(v.code);
      return h('div', { class: `det-case${estWeekEnd(d) ? ' we' : ''}`, style: c ? { '--c': c.couleur } : null, title: c ? `${c.label}${v.texte ? ` (${v.texte})` : ''}` : '' },
        h('span', { class: 'det-num' }, Number(d.slice(8))), c ? h('b', {}, v.code === 'H' && v.texte ? v.texte : v.code === 'HS' && v.hs ? fmtHs(v.hs) : c.code) : null,
        v && v.hs && v.code !== 'HS' ? h('small', { class: 'det-hs' }, fmtHs(v.hs)) : null);
    })),
    h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Fermer'))));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/* ---------- Gestion des agents ---------- */

function vueAgents() {
  const liste = planState.agents.map((a) => ({ ...a }));
  const enregistrer = async () => {
    try {
      planState.agents = await call(api.planSaveAgents(liste));
      await rafraichirAgentsAbsents();
      renderPlanning({ reload: false });
    } catch (err) {
      toast(`Non enregistré : ${err.message}`);
    }
  };
  const groupes = PLAN_EQUIPES.map((eq) => {
    const agents = liste.filter((a) => a.equipe === eq.id && !estParti(a));
    const nom = h('input', { type: 'text', placeholder: `Ajouter un agent ${eq.id === 'autres' ? '' : `(${eq.label.toLowerCase()})`}`, maxLength: 40 });
    const ajouter = () => {
      const n = nom.value.trim();
      if (!n) return;
      if (liste.some((x) => x.nom.toLowerCase() === n.toLowerCase())) return toast(`« ${n} » est déjà dans le planning.`);
      liste.push({ nom: n, equipe: eq.id });
      return enregistrer();
    };
    nom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ajouter(); } });
    return h('div', { class: 'card ag-groupe', style: { '--eq': eq.couleur() } },
      h('div', { class: 'card-head' }, h('span', { class: 'eq-pastille' }), eq.label, eq.heures ? h('span', { class: 'hint' }, eq.heures) : null, h('span', { class: 'hint' }, plural(agents.length, 'agent'))),
      h('div', { class: 'card-body' },
        agents.length ? h('div', { class: 'ag-liste' }, agents.map((a) => {
          const i = liste.indexOf(a);
          const memes = liste.filter((x) => x.equipe === a.equipe && !estParti(x));
          const pos = memes.indexOf(a);
          const deplacer = (sens) => {
            const autre = memes[pos + sens];
            if (!autre) return;
            const j = liste.indexOf(autre);
            [liste[i], liste[j]] = [liste[j], liste[i]];
            enregistrer();
          };
          return h('div', { class: 'ag-ligne' },
            h('span', { class: 'ag-nom', title: datesAgent(a) }, a.nom, datesAgent(a) ? h('small', { class: 'ag-dates' }, datesAgent(a)) : null),
            h('select', { title: 'Équipe', onchange: (e) => { a.equipe = e.target.value; enregistrer(); } }, PLAN_EQUIPES.map((x) => h('option', { value: x.id, selected: x.id === a.equipe }, x.label))),
            h('button', { class: 'o-btn haut', title: 'Monter', disabled: pos === 0, onclick: () => deplacer(-1) }, icon('chevronLeft', 14)),
            h('button', { class: 'o-btn bas', title: 'Descendre', disabled: pos === memes.length - 1, onclick: () => deplacer(1) }, icon('chevronRight', 14)),
            h('button', { class: 'o-btn', title: 'Renommer', onclick: async () => {
              const n = ((await promptText('Renommer l’agent', a.nom)) || '').trim();
              if (n && n !== a.nom) { a.nom = n; enregistrer(); }
            } }, icon('edit', 14)),
            h('button', { class: 'o-btn', title: 'Arrivée / départ', onclick: () => datesAgentDialog(a, enregistrer) }, icon('clock', 14)),
            h('button', { class: 'o-btn ag-discret', title: 'Fusionner avec un autre agent (même personne, autre orthographe)', onclick: () => fusionnerAgent(a) }, icon('users', 14)),
            h('button', { class: 'o-btn rm', title: 'Retirer du planning', onclick: async () => {
              if (await ask('Retirer cet agent ?', `« ${a.nom} » ne sera plus dans le planning ni proposé dans « Agents absents ». Ses anciennes cases restent enregistrées.`,
                [{ label: 'Annuler', value: 'no' }, { label: 'Retirer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
              liste.splice(i, 1);
              enregistrer();
            } }, icon('x', 14)));
        })) : h('div', { class: 'muted ag-vide' }, 'Aucun agent.'),
        h('div', { class: 'row ag-ajout' }, nom, h('button', { class: 'btn small', onclick: ajouter }, icon('plus', 13), 'Ajouter'))));
  });
  return h('div', { class: 'plan-agents' },
    h('div', { class: 'row plan-info-ligne' }, h('p', { class: 'muted plan-info' }, icon('users', 14), ' Ces agents sont aussi ceux proposés dans « Agents absents » de la main courante.'), h('span', { class: 'spacer' }), boutonImport('btn small')),
    h('div', { class: 'ag-grille' }, groupes),
    anciensAgents(liste, enregistrer),
    liste.length ? h('div', { class: 'plan-vider' }, h('button', { class: 'lien-discret', onclick: viderPlanning }, 'Vider le planning…')) : null);
}

// Agents partis : repliés en bas de l'onglet, leurs anciennes cases restent visibles.
function anciensAgents(liste, enregistrer) {
  const partis = liste.filter(estParti).sort((a, b) => b.depart.localeCompare(a.depart));
  if (!partis.length) return null;
  return h('details', { class: 'card ag-anciens' },
    h('summary', { class: 'card-head' }, icon('users', 15), `Anciens agents (${partis.length})`, h('span', { class: 'hint' }, 'Partis : visibles seulement sur les semaines où ils étaient là')),
    h('div', { class: 'card-body ag-liste' }, partis.map((a) => h('div', { class: 'ag-ligne' },
      h('span', { class: 'ag-nom' }, a.nom, h('small', { class: 'ag-dates' }, `${(PLAN_EQUIPES.find((e) => e.id === a.equipe) || { label: a.equipe }).label} · ${datesAgent(a)}`)),
      h('button', { class: 'o-btn', title: 'Arrivée / départ', onclick: () => datesAgentDialog(a, enregistrer) }, icon('clock', 14)),
      h('button', { class: 'o-btn ag-discret', title: 'Fusionner avec un autre agent', onclick: () => fusionnerAgent(a) }, icon('users', 14)),
      h('button', { class: 'o-btn rm', title: 'Retirer du planning', onclick: async () => {
        if (await ask('Retirer cet agent ?', `« ${a.nom} » ne sera plus dans le planning. Ses anciennes cases restent enregistrées.`,
          [{ label: 'Annuler', value: 'no' }, { label: 'Retirer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
        liste.splice(liste.indexOf(a), 1);
        enregistrer();
      } }, icon('x', 14))))));
}

// Dates d'arrivée et de départ d'un agent.
function datesAgentDialog(a, enregistrer) {
  const arrivee = h('input', { type: 'date', value: a.arrivee || '' });
  const depart = h('input', { type: 'date', value: a.depart || '' });
  const dlg = h('dialog', { class: 'plan-fusion' }, h('div', { class: 'dialog-body' },
    h('h2', {}, a.nom),
    h('p', { class: 'muted' }, 'Laisser vide si l\'agent est là depuis le début ou toujours présent. En dehors de ces dates, il n\'apparaît pas et ne compte pas dans l\'effectif.'),
    h('div', { class: 'row', style: { gap: '12px' } },
      h('label', { class: 'field' }, h('span', {}, 'Arrivé le'), arrivee),
      h('label', { class: 'field' }, h('span', {}, 'Parti le (dernier jour)'), depart)),
    h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'Annuler'),
      h('button', { class: 'btn primary', onclick: () => {
        if (arrivee.value && depart.value && depart.value < arrivee.value) { toast('Le départ doit être après l\'arrivée.'); return; }
        a.arrivee = arrivee.value || undefined;
        a.depart = depart.value || undefined;
        dlg.close();
        enregistrer();
      } }, 'Enregistrer'))));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// Fusion discrète : l'agent choisi récupère les cases de `a`, qui disparaît.
function fusionnerAgent(a) {
  const autres = planState.agents.filter((x) => x.id !== a.id).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
  if (!autres.length) return;
  const choix = h('select', {}, autres.map((x) => h('option', { value: x.id }, `${x.nom} · ${(PLAN_EQUIPES.find((e) => e.id === x.equipe) || { label: x.equipe }).label}`)));
  const dlg = h('dialog', { class: 'plan-fusion' }, h('div', { class: 'dialog-body' },
    h('h2', {}, 'Fusionner deux agents'),
    h('p', {}, `Même personne écrite autrement ? Les cases de « ${a.nom} » rejoignent l'agent choisi (ses propres cases priment), puis « ${a.nom} » est retiré.`),
    h('label', { class: 'field' }, h('span', {}, 'Garder'), choix),
    h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'Annuler'),
      h('button', { class: 'btn primary', onclick: async () => {
        dlg.close();
        try {
          const r = await call(api.planFusionner(a.id, choix.value, S.user));
          planState.agents = r.agents;
          planSemCache.clear();
          await rafraichirAgentsAbsents();
          toast(`« ${a.nom} » fusionné avec « ${autres.find((x) => x.id === choix.value).nom} ».`);
        } catch (err) {
          toast(`Fusion impossible : ${err.message}`);
        }
        renderPlanning();
      } }, 'Fusionner'))));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// Vider le planning (agents et semaines) avant de réimporter un classeur propre.
async function viderPlanning() {
  if (await ask('Vider le planning ?', 'Tous les agents et toutes les semaines (cases, notes, repères) du planning de ce site seront supprimés, pour tous les postes. Les codes de l\'onglet « Codes » sont gardés.\n\nVous pourrez ensuite réimporter le classeur Excel.',
    [{ label: 'Annuler', value: 'no' }, { label: 'Continuer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
  const mot = await promptText('Confirmer', 'Tapez VIDER', { text: 'Pour confirmer, tapez VIDER en majuscules.' });
  if (mot !== 'VIDER') {
    if (mot != null) toast('Planning conservé (confirmation incorrecte).');
    return;
  }
  try {
    await call(api.planVider());
    planState.agents = [];
    planState.semaine = null;
    planSemCache.clear();
    S.agentsPlanning = false;
    S.agents = await call(api.loadAgents()).catch(() => []);
    toast('Planning vidé.');
  } catch (err) {
    toast(`Non vidé : ${err.message}`);
  }
  renderPlanning();
}

/* ---------- Codes (abréviations) ---------- */

// Chaque abréviation peut être détaillée : libellé, couleur, compte comme absence.
function vueCodes() {
  const site = (planState.codes || []).map((c) => ({ ...c }));
  const enregistrer = async (list) => {
    try {
      planState.codes = await call(api.planSaveCodes(list));
      majPlanCodes();
      planSemCache.clear();
    } catch (err) {
      toast(`Non enregistré : ${err.message}`);
    }
    renderPlanning({ reload: false });
  };
  // Modifie (ou crée) l'entrée du site pour ce code.
  const modifier = (c, champ, valeur) => {
    const list = site.filter((x) => x.code !== c.code);
    const actuel = site.find((x) => x.code === c.code) || { code: c.code, label: c.label, couleur: c.couleur, absence: !!c.absence };
    enregistrer([...list, { ...actuel, [champ]: valeur }]);
  };
  const ligne = (c) => {
    const perso = site.some((x) => x.code === c.code);
    const fixe = ['H', 'HS', 'RET'].includes(c.code);
    const label = h('input', { type: 'text', value: c.label, maxLength: 40, 'aria-label': `Libellé de ${c.code}` });
    label.addEventListener('change', () => modifier(c, 'label', label.value.trim() || c.code));
    const couleur = h('input', { type: 'color', value: c.couleur, title: 'Couleur', 'aria-label': `Couleur de ${c.code}` });
    couleur.addEventListener('change', () => modifier(c, 'couleur', couleur.value));
    return h('div', { class: 'code-ligne' },
      h('span', { class: 'plan-code', style: { '--c': c.couleur } }, c.code),
      label, couleur,
      h('label', { class: 'code-abs', title: fixe ? '' : 'L\'agent apparaît dans « Agents absents » et n\'est pas compté présent' },
        h('input', { type: 'checkbox', checked: !!c.absence, disabled: fixe, onchange: (e) => modifier(c, 'absence', e.target.checked) }), 'Absence'),
      c.base
        ? (perso ? h('button', { class: 'o-btn', title: 'Rétablir le réglage d\'origine', onclick: () => enregistrer(site.filter((x) => x.code !== c.code)) }, icon('arrowLeft', 14)) : h('span', { class: 'code-vide' }))
        : h('button', { class: 'o-btn rm', title: 'Retirer ce code', onclick: async () => {
          if (await ask('Retirer ce code ?', `« ${c.code} » ne sera plus proposé. Les cases qui le portent l'afficheront toujours, en gris.`,
            [{ label: 'Annuler', value: 'no' }, { label: 'Retirer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
          enregistrer(site.filter((x) => x.code !== c.code));
        } }, icon('x', 14)));
  };
  const code = h('input', { type: 'text', placeholder: 'Code (ex. PAT)', maxLength: 5, style: { width: '110px', textTransform: 'uppercase' } });
  const label = h('input', { type: 'text', placeholder: 'Libellé (ex. Paternité)', maxLength: 40 });
  const absence = h('input', { type: 'checkbox' });
  const ajouter = () => {
    const c = code.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,5}$/.test(c)) return toast('Code : 1 à 5 lettres ou chiffres.');
    if (PLAN_CODES.some((x) => x.code === c)) return toast(`« ${c} » existe déjà.`);
    return enregistrer([...site, { code: c, label: label.value.trim() || c, couleur: PLAN_COULEURS[site.length % PLAN_COULEURS.length], absence: absence.checked }]);
  };
  label.addEventListener('keydown', (e) => { if (e.key === 'Enter') ajouter(); });
  const base = PLAN_CODES.filter((c) => c.base);
  const autres = PLAN_CODES.filter((c) => !c.base);
  return h('div', { class: 'plan-codes' },
    h('p', { class: 'muted plan-info' }, icon('palette', 14), ' Détaillez les abréviations : libellé, couleur, et si elles comptent comme absence (« Agents absents », présents par équipe).'),
    h('div', { class: 'ag-grille' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, 'Abréviations du site', h('span', { class: 'hint' }, plural(autres.length, 'code'))),
        h('div', { class: 'card-body' },
          autres.length ? h('div', { class: 'code-liste' }, autres.map(ligne)) : h('p', { class: 'muted' }, 'Aucune. Elles s\'ajoutent ici ou à l\'import d\'un planning Excel.'),
          h('div', { class: 'row code-ajout' }, code, label, h('label', { class: 'code-abs' }, absence, 'Absence'), h('button', { class: 'btn small', onclick: ajouter }, icon('plus', 13), 'Ajouter')))),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, 'Codes de base'),
        h('div', { class: 'card-body' }, h('div', { class: 'code-liste' }, base.map(ligne))))));
}

// La liste « Agents absents » de la saisie suit le planning quand il a des agents.
async function rafraichirAgentsAbsents() {
  if (!planState.agents.length) return;
  S.agents = planState.agents.filter((a) => !estParti(a)).map((a) => a.nom).sort((a, b) => a.localeCompare(b, 'fr'));
  S.agentsPlanning = true;
}

// Absents d'un service d'après le planning : agents de l'équipe du service
// dont la case du jour porte un code d'absence (ou un retard). null si pas de planning.
const planSemCache = new Map(); // lundi → { at, sem }
async function absentsPlanning(date, service) {
  if (!planState.agents.length) return null;
  const lundi = lundiDe(date);
  let entree = planSemCache.get(lundi);
  if (!entree || Date.now() - entree.at > 5000) {
    const sem = await call(api.planSemaine(date)).catch(() => null);
    entree = { at: Date.now(), sem: sem || { cases: {} } };
    planSemCache.set(lundi, entree);
  }
  const out = [];
  for (const a of planState.agents.filter((x) => x.equipe === service && presentLe(x, date))) {
    const v = (entree.sem.cases[a.id] || {})[date];
    const c = v && planCode(v.code);
    if (c && (c.absence || c.signale)) out.push({ nom: a.nom, motif: v.texte ? `${c.label} · ${v.texte}` : c.label, code: c.code });
  }
  return out;
}
const couleurMotif = (motif) => {
  const c = PLAN_CODES.find((x) => String(motif || '').startsWith(x.label));
  return c ? c.couleur : '#94a3b8';
};
