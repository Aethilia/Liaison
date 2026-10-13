'use strict';

/* global S, M, SVC, h, icon, call, api, ask, toast, promptText, plural */
// Onglet « Planning » : agents du site par équipe, semaine du lundi au
// dimanche avec un code par jour (repos, CP, maladie…), notes de la semaine,
// synthèse mensuelle par agent et gestion de la liste des agents.

const PLAN_EQUIPES = [
  { id: 'matin', label: 'Matin', heures: '5H-13H', couleur: () => SVC.matin.couleur },
  { id: 'apresmidi', label: 'Après-midi', heures: '13H-20H', couleur: () => SVC.apresmidi.couleur },
  { id: 'nuit', label: 'Nuit', heures: '20H → 4H', couleur: () => SVC.nuit.couleur },
  { id: 'responsables', label: 'Responsables', heures: '', couleur: () => '#0f766e' },
  { id: 'autres', label: 'Autres', heures: '', couleur: () => '#64748b' },
];
// Codes du planning. `absence` : l'agent n'est pas là (compte dans « Agents absents »).
const PLAN_CODES = [
  { code: 'R', label: 'Repos', couleur: '#94a3b8', absence: true },
  { code: 'CP', label: 'Congés payés', couleur: '#1baf7a', absence: true },
  { code: 'MAL', label: 'Maladie', couleur: '#e34948', absence: true },
  { code: 'ABS', label: 'Absence', couleur: '#eb6834', absence: true },
  { code: 'CN', label: 'Naissance', couleur: '#e87ba4', absence: true },
  { code: 'FOR', label: 'Formation', couleur: '#4a3aa7', absence: true },
  { code: 'VM', label: 'Visite médicale', couleur: '#2a78d6' },
  { code: 'INT', label: 'Intempéries', couleur: '#5b6b7f', absence: true },
  { code: 'T', label: 'Travaille (WE)', couleur: '#0f766e' },
  { code: 'H', label: 'Horaire / note', couleur: '#eda100' },
];
const planCode = (c) => PLAN_CODES.find((x) => x.code === c);
const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const planState = { vue: 'semaine', date: null, agents: [], semaine: null, mois: null, loadedAt: 0 };

const isoAjout = (iso, n) => M.addDays(iso, n);
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
  return planState.agents;
}

async function renderPlanning({ reload = true } = {}) {
  if (!planState.date) planState.date = aujourdhui();
  if (!planState.mois) {
    const d = M.parseISODate(planState.date);
    planState.mois = { y: d.getFullYear(), m: d.getMonth() + 1 };
  }
  if (reload) {
    await loadPlanAgents();
    if (planState.vue === 'semaine') planState.semaine = await call(api.planSemaine(planState.date)).catch(() => null);
    planState.loadedAt = Date.now();
  }
  const root = document.getElementById('planning');
  const onglets = h('div', { class: 'seg plan-seg' }, [['semaine', 'Semaine', 'list'], ['synthese', 'Synthèse', 'chart'], ['agents', 'Agents', 'users']].map(([id, label, ic]) => h('button', {
    class: planState.vue === id ? 'on' : '', onclick: () => { planState.vue = id; renderPlanning(); },
  }, icon(ic, 14), label)));
  const head = h('div', { class: 'recap-head plan-head' }, h('h2', {}, `Planning${S.siteName ? ` · ${S.siteName}` : ''}`), onglets, h('span', { class: 'spacer' }));
  let corps;
  if (!planState.agents.length && planState.vue !== 'agents') {
    corps = h('div', { class: 'j-empty' }, icon('users', 32), h('p', {}, 'Aucun agent dans le planning.'),
      h('p', { class: 'muted' }, 'Commencez par ajouter vos agents et leur équipe.'),
      h('button', { class: 'btn accent', onclick: () => { planState.vue = 'agents'; renderPlanning({ reload: false }); } }, icon('plus', 15), 'Ajouter les agents'));
  } else if (planState.vue === 'semaine') corps = vueSemaine(head);
  else if (planState.vue === 'synthese') corps = await vueSynthese(head);
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
    const agents = planState.agents.filter((a) => a.equipe === eq.id);
    if (!agents.length) continue;
    // Bandeau d'équipe : présents / effectif pour chaque jour.
    lignes.push(h('tr', { class: 'plan-equipe', style: { '--eq': eq.couleur() } },
      h('th', { class: 'c-agent' }, h('span', { class: 'eq-pastille' }), eq.label, eq.heures ? h('small', {}, ` ${eq.heures}`) : null),
      jours.map((d) => {
        const absents = agents.filter((a) => { const c = (sem.cases[a.id] || {})[d]; return c && planCode(c.code) && planCode(c.code).absence; }).length;
        const presents = agents.length - absents;
        return h('td', { class: `${estWeekEnd(d) ? 'we' : ''}${d === auj ? ' auj' : ''}`, title: `${presents} présent(s) sur ${agents.length}` },
          h('span', { class: `eq-compte${absents ? ' manque' : ''}` }, `${presents}/${agents.length}`));
      })));
    for (const a of agents) {
      lignes.push(h('tr', { class: 'plan-agent', style: { '--eq': eq.couleur() } },
        h('th', { class: 'c-agent' }, a.nom),
        jours.map((d) => caseAgent(a, d, (sem.cases[a.id] || {})[d], { we: estWeekEnd(d), auj: d === auj, nuit: eq.id === 'nuit' }))));
    }
  }
  const legende = h('div', { class: 'plan-legende' }, PLAN_CODES.map((c) => h('span', { class: 'leg' }, h('i', { style: { background: c.couleur } }, c.code), c.label)),
    h('span', { class: 'leg muted' }, 'Case vide = travaille normalement'),
    h('span', { class: 'leg muted' }, 'Nuit : une case = une vacation, du soir 20H au lendemain 4H'));
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
    h('div', { class: 'card plan-notes' }, h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('note', 16)), 'Notes de la semaine'),
      h('div', { class: 'card-body' }, notes)));
}

// Nuit : une seule vacation, rattachée au jour où elle commence (20H → 4H le lendemain).
const libelleJour = (date, nuit) => (nuit ? `nuit du ${fmtJourCourt(date)} au ${fmtJourCourt(isoAjout(date, 1))}` : fmtJour(date));
const fmtJourCourt = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' }).format(M.parseISODate(iso));

function caseAgent(agent, date, val, { we, auj, nuit = false }) {
  const c = val && planCode(val.code);
  const td = h('td', {
    class: `plan-case${we ? ' we' : ''}${auj ? ' auj' : ''}${c ? ' rempli' : ''}`,
    tabIndex: 0, title: `${agent.nom} — ${libelleJour(date, nuit)}${c ? ` : ${c.label}` : ''}${val && val.texte ? ` (${val.texte})` : ''}`,
    onclick: (e) => ouvrirPalette(e.currentTarget, agent, date, val, nuit),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirPalette(e.currentTarget, agent, date, val, nuit); } },
  });
  if (c) td.append(h('span', { class: 'plan-code', style: { '--c': c.couleur } }, val.code === 'H' && val.texte ? val.texte : c.code));
  else if (val && val.texte) td.append(h('span', { class: 'plan-texte' }, val.texte));
  if (c && val.texte && val.code !== 'H') td.append(h('small', { class: 'plan-texte' }, val.texte));
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
  const texte = h('input', { type: 'text', placeholder: 'Horaire ou note (ex. 13H-18H, +3h30)', value: (val && val.texte) || '', maxLength: 40 });
  const choisir = async (code) => {
    const t = texte.value.trim();
    fermerPalette();
    try {
      planState.semaine = await call(api.planSetCase(agent.id, date, { code: code === null ? '' : code || (t ? 'H' : ''), texte: code === null ? '' : t }, S.user));
      planSemCache.delete(lundiDe(date));
    } catch (err) {
      toast(`Non enregistré : ${err.message}`);
    }
    renderPlanning({ reload: false });
  };
  texte.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); choisir((val && val.code && val.code !== 'H') ? val.code : 'H'); } if (e.key === 'Escape') fermerPalette(); });
  planPop = h('div', { class: 'plan-pop', role: 'dialog' },
    h('div', { class: 'pop-titre' }, h('b', {}, agent.nom), h('span', { class: 'muted' }, ` · ${libelleJour(date, nuit)}`)),
    h('div', { class: 'pop-codes' }, PLAN_CODES.map((c) => h('button', {
      class: `pop-code${val && val.code === c.code ? ' on' : ''}`, style: { '--c': c.couleur }, title: c.label, onclick: () => choisir(c.code),
    }, h('b', {}, c.code), h('span', {}, c.label)))),
    h('div', { class: 'pop-texte' }, texte, h('button', { class: 'btn small', onclick: () => choisir((val && val.code && val.code !== 'H') ? val.code : 'H') }, 'OK')),
    h('button', { class: 'btn ghost small pop-effacer', onclick: () => choisir(null) }, icon('x', 13), 'Effacer (travaille normalement)'));
  document.body.append(planPop);
  const r = td.getBoundingClientRect();
  const w = 340;
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
  const r = { travailles: 0, codes: {} };
  for (let d = debut; d <= fin; d = isoAjout(d, 1)) {
    const v = cases[d];
    const c = v && planCode(v.code);
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
  const totaux = { travailles: 0, codes: {} };
  for (const eq of PLAN_EQUIPES) {
    const agents = planState.agents.filter((a) => a.equipe === eq.id);
    if (!agents.length) continue;
    lignes.push(h('tr', { class: 'syn-equipe', style: { '--eq': eq.couleur() } }, h('td', { colSpan: 3 + codesUtiles.length }, h('span', { class: 'eq-pastille' }), eq.label, eq.heures ? h('small', {}, ` ${eq.heures}`) : null)));
    for (const a of agents) {
      const s = syntheseAgent(cases[a.id] || {}, debut, fin);
      totaux.travailles += s.travailles;
      for (const [c, n] of Object.entries(s.codes)) totaux.codes[c] = (totaux.codes[c] || 0) + n;
      // Barre : composition du mois (travaillé + chaque code).
      const barre = h('div', { class: 'syn-barre', title: `${s.travailles} jour(s) travaillé(s)` },
        h('i', { style: { flex: s.travailles, background: eq.couleur() } }),
        PLAN_CODES.filter((c) => s.codes[c.code]).map((c) => h('i', { style: { flex: s.codes[c.code], background: c.couleur }, title: `${c.label} : ${s.codes[c.code]}` })),
        h('i', { class: 'vide', style: { flex: Math.max(0, nbJours - s.travailles - Object.values(s.codes).reduce((x, n) => x + n, 0)) } }));
      lignes.push(h('tr', { class: 'syn-agent', onclick: () => detailAgent(a, cases[a.id] || {}, debut, fin) },
        h('th', {}, a.nom),
        h('td', { class: 'num' }, h('b', {}, s.travailles)),
        codesUtiles.map((c) => h('td', { class: 'num' }, s.codes[c.code] ? h('span', { class: 'syn-badge', style: { '--c': c.couleur } }, s.codes[c.code]) : h('span', { class: 'muted' }, '·'))),
        h('td', {}, barre)));
    }
  }
  return h('div', { class: 'card plan-synthese' },
    h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('chart', 16)), `Synthèse par agent · ${fmtMois(y, m)}`,
      h('span', { class: 'hint' }, 'Cliquer sur un agent pour le détail du mois')),
    h('div', { class: 'card-body plan-scroll' }, h('table', { class: 'grid syn-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Agent'), h('th', { class: 'num', title: 'Du lundi au vendredi sans absence, plus les jours codés T, H ou VM' }, 'Travaillés'),
        codesUtiles.map((c) => h('th', { class: 'num', title: c.label }, h('span', { class: 'syn-badge', style: { '--c': c.couleur } }, c.code))), h('th', {}, 'Répartition du mois'))),
      h('tbody', {}, lignes),
      h('tfoot', {}, h('tr', {}, h('th', {}, 'Total'), h('td', { class: 'num' }, h('b', {}, totaux.travailles)),
        codesUtiles.map((c) => h('td', { class: 'num' }, h('b', {}, totaux.codes[c.code] || 0))), h('td', {})))),
    codesUtiles.length ? null : h('p', { class: 'muted syn-vide' }, 'Aucun code saisi ce mois-ci : tout le monde travaille normalement.')));
}

// Détail d'un agent : mini calendrier du mois.
function detailAgent(agent, cases, debut, fin) {
  const eq = PLAN_EQUIPES.find((e) => e.id === agent.equipe) || PLAN_EQUIPES[4];
  const premier = M.parseISODate(debut);
  const decal = (premier.getDay() + 6) % 7;
  const cellules = [...Array(decal).fill(null)];
  for (let d = debut; d <= fin; d = isoAjout(d, 1)) cellules.push(d);
  const s = syntheseAgent(cases, debut, fin);
  const dlg = h('dialog', { class: 'plan-detail' }, h('div', { class: 'dialog-body' },
    h('h2', {}, agent.nom, h('small', { class: 'muted' }, ` · ${eq.label}${eq.heures ? ` ${eq.heures}` : ''}`)),
    h('div', { class: 'det-resume' }, h('span', { class: 'syn-badge', style: { '--c': eq.couleur() } }, `${s.travailles} travaillés`),
      PLAN_CODES.filter((c) => s.codes[c.code]).map((c) => h('span', { class: 'syn-badge', style: { '--c': c.couleur } }, `${s.codes[c.code]} ${c.label.toLowerCase()}`))),
    h('div', { class: 'det-cal' }, JOURS_COURTS.map((j) => h('div', { class: 'det-j' }, j)), cellules.map((d) => {
      if (!d) return h('div', { class: 'det-vide' });
      const v = cases[d];
      const c = v && planCode(v.code);
      return h('div', { class: `det-case${estWeekEnd(d) ? ' we' : ''}`, style: c ? { '--c': c.couleur } : null, title: c ? `${c.label}${v.texte ? ` (${v.texte})` : ''}` : '' },
        h('span', { class: 'det-num' }, Number(d.slice(8))), c ? h('b', {}, v.code === 'H' && v.texte ? v.texte : c.code) : null);
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
    const agents = liste.filter((a) => a.equipe === eq.id);
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
          const memes = liste.filter((x) => x.equipe === a.equipe);
          const pos = memes.indexOf(a);
          const deplacer = (sens) => {
            const autre = memes[pos + sens];
            if (!autre) return;
            const j = liste.indexOf(autre);
            [liste[i], liste[j]] = [liste[j], liste[i]];
            enregistrer();
          };
          return h('div', { class: 'ag-ligne' },
            h('span', { class: 'ag-nom' }, a.nom),
            h('select', { title: 'Équipe', onchange: (e) => { a.equipe = e.target.value; enregistrer(); } }, PLAN_EQUIPES.map((x) => h('option', { value: x.id, selected: x.id === a.equipe }, x.label))),
            h('button', { class: 'o-btn haut', title: 'Monter', disabled: pos === 0, onclick: () => deplacer(-1) }, icon('chevronLeft', 14)),
            h('button', { class: 'o-btn bas', title: 'Descendre', disabled: pos === memes.length - 1, onclick: () => deplacer(1) }, icon('chevronRight', 14)),
            h('button', { class: 'o-btn', title: 'Renommer', onclick: async () => {
              const n = ((await promptText('Renommer l’agent', a.nom)) || '').trim();
              if (n && n !== a.nom) { a.nom = n; enregistrer(); }
            } }, icon('edit', 14)),
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
    h('p', { class: 'muted plan-info' }, icon('users', 14), ' Ces agents sont aussi ceux proposés dans « Agents absents » de la main courante.'),
    h('div', { class: 'ag-grille' }, groupes));
}

// La liste « Agents absents » de la saisie suit le planning quand il a des agents.
async function rafraichirAgentsAbsents() {
  if (!planState.agents.length) return;
  S.agents = planState.agents.map((a) => a.nom).sort((a, b) => a.localeCompare(b, 'fr'));
  S.agentsPlanning = true;
}

// Absents d'un service d'après le planning : agents de l'équipe du service
// dont la case du jour porte un code d'absence. null si pas de planning.
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
  for (const a of planState.agents.filter((x) => x.equipe === service)) {
    const v = (entree.sem.cases[a.id] || {})[date];
    const c = v && planCode(v.code);
    if (c && c.absence) out.push({ nom: a.nom, motif: v.texte ? `${c.label} · ${v.texte}` : c.label, code: c.code });
  }
  return out;
}
const couleurMotif = (motif) => {
  const c = PLAN_CODES.find((x) => String(motif || '').startsWith(x.label));
  return c ? c.couleur : '#94a3b8';
};
