'use strict';

/* global M, SVC, S, h, icon, call, api, ask, toast, fmtDateTime, fmtShortDate, isClosed, cur, renderTabs */
// Tâches de relève (remplacent les consignes) : une tâche reste affichée aux
// services suivants tant qu'elle n'est pas validée.

const SERVICE_ORDER = Object.fromEntries(window.LiaisonModel.SERVICES.map((d, i) => [d.id, i]));
const serviceKey = (date, service) => `${date}#${SERVICE_ORDER[service]}`;

// Tâches à afficher pour un service : celles créées dans ce service, et celles
// créées avant qui étaient encore en attente à ce moment-là.
function tasksForService(tasks, date, service) {
  const k = serviceKey(date, service);
  return tasks.filter((t) => {
    const origin = serviceKey(t.origine.date, t.origine.service);
    if (origin === k) return true;
    if (origin > k) return false;
    return !t.faite || serviceKey(t.faite.date, t.faite.service) >= k;
  });
}

const pendingTasks = (tasks) => tasks.filter((t) => !t.faite);
const svcLabel = (date, service) => `${SVC[service].label} ${fmtShortDate(date)}`;

async function loadTasks({ notify = false } = {}) {
  let list;
  try {
    list = await call(api.listTasks());
  } catch {
    return false;
  }
  const before = S.tasks;
  S.tasks = list;
  if (!notify || !before) return true;
  const changed = JSON.stringify(before.map((t) => [t.id, !!t.faite])) !== JSON.stringify(list.map((t) => [t.id, !!t.faite]));
  // Alerte discrète quand quelqu'un d'autre ajoute ou valide une tâche.
  const known = new Map(before.map((t) => [t.id, t]));
  for (const t of list) {
    const old = known.get(t.id);
    if (!old && t.creePar !== S.user) toast(`📋 Nouvelle tâche (${t.creePar || 'autre poste'}) : ${t.texte}`, 6000);
    else if (old && !old.faite && t.faite && t.faite.par !== S.user) toast(`✔ Tâche validée par ${t.faite.par || 'un autre poste'} : ${t.texte}`, 6000);
  }
  return changed;
}

async function createTask(texte) {
  const txt = texte.trim();
  if (!txt) return;
  const task = {
    id: M.newTaskId(),
    texte: txt,
    creeLe: new Date().toISOString(),
    creePar: S.user || '',
    poste: S.config.poste || '',
    origine: { date: S.date, service: S.service },
    faite: null,
  };
  S.tasks.push(await call(api.saveTask(task)));
  renderTasksCard();
  renderTabs();
}

async function toggleTask(id) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.faite) {
    const r = await ask('Remettre en attente ?', `« ${t.texte} » repassera dans les tâches à faire.`, [
      { label: 'Annuler', value: 'no' }, { label: 'Remettre en attente', value: 'yes', cls: 'primary' }]);
    if (r !== 'yes') return;
  }
  const updated = { ...t, faite: t.faite ? null : { le: new Date().toISOString(), par: S.user || '', date: S.date, service: S.service } };
  Object.assign(t, await call(api.saveTask(updated)));
  renderTasksCard();
  renderTabs();
  renderPassation();
  if (document.getElementById('fiche').open && S.fiche) renderFiche();
}

async function removeTask(id) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return;
  const r = await ask('Supprimer la tâche ?', `« ${t.texte} » sera supprimée pour tous les postes.`, [
    { label: 'Annuler', value: 'no' }, { label: 'Supprimer', value: 'yes', cls: 'danger' }]);
  if (r !== 'yes') return;
  await call(api.deleteTask(id));
  S.tasks = S.tasks.filter((x) => x.id !== id);
  renderTasksCard();
  renderTabs();
}

function taskItem(t, { date, service, editable = true, compact = false } = {}) {
  const carried = date && serviceKey(t.origine.date, t.origine.service) < serviceKey(date, service);
  const later = t.faite && date && serviceKey(t.faite.date, t.faite.service) > serviceKey(date, service);
  return h('div', { class: `task${t.faite ? ' done' : ''}${compact ? ' compact' : ''}` },
    h('button', {
      class: 'task-check', title: t.faite ? 'Remettre en attente' : 'Marquer comme faite', disabled: !editable,
      'aria-label': t.faite ? 'Remettre en attente' : 'Marquer comme faite', onclick: () => toggleTask(t.id),
    }, t.faite ? icon('check', 15) : null),
    h('div', { class: 'task-body' },
      h('div', { class: 'task-text' }, t.texte),
      h('div', { class: 'task-meta' },
        carried && !t.faite ? h('span', { class: 'pill draft' }, 'Reportée') : null,
        ` Créée par ${t.creePar || '?'} · ${svcLabel(t.origine.date, t.origine.service)}`,
        t.faite ? h('span', { class: 'task-done-by' }, ` · ✔ ${later ? 'faite plus tard' : 'faite'} par ${t.faite.par || '?'} le ${fmtDateTime(t.faite.le)}`) : null)),
    editable && !compact ? h('button', { class: 'o-btn rm', title: 'Supprimer la tâche', 'aria-label': 'Supprimer la tâche', onclick: () => removeTask(t.id) }, icon('trash', 15)) : null);
}

// Carte « Tâches pour la relève » de la saisie (re-rendue seule, sans toucher au reste du formulaire).
function renderTasksCard() {
  const box = document.getElementById('tasks-card');
  if (!box) return;
  const s = cur();
  const closed = isClosed(s);
  const list = tasksForService(S.tasks, S.date, S.service);
  const pending = list.filter((t) => !t.faite).length;
  const draft = (document.getElementById('task-new') || {}).value || '';
  const input = h('input', {
    type: 'text', id: 'task-new', value: draft, placeholder: 'Nouvelle tâche pour la relève, puis Entrée…', autocomplete: 'off',
    onkeydown: async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = e.target.value;
        e.target.value = '';
        await createTask(v);
        document.getElementById('task-new').focus();
      }
    },
  });
  box.replaceChildren(
    h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('checkSquare', 16)), 'Tâches pour la relève',
      h('span', { class: 'hint' }, pending ? h('span', { class: 'pill draft' }, `${pending} en attente`) : 'Restent affichées jusqu\'à validation')),
    h('div', { class: 'card-body' },
      closed ? null : h('div', { class: 'task-add' }, input,
        h('button', { class: 'btn accent', onclick: async () => { const el = document.getElementById('task-new'); const v = el.value; el.value = ''; await createTask(v); } }, icon('plus', 16), 'Ajouter')),
      list.length
        ? h('div', { class: 'task-list' }, list.map((t) => taskItem(t, { date: S.date, service: S.service })))
        : h('div', { class: 'empty' }, 'Aucune tâche en cours.'),
      s.consignes ? h('div', { class: 'legacy-consigne' },
        h('div', { class: 'pass-consignes' }, h('b', {}, 'Consigne (ancienne version) : '), s.consignes),
        closed ? null : h('button', {
          class: 'btn small', onclick: async () => {
            await createTask(s.consignes);
            s.consignes = '';
            markDirty();
            renderTasksCard();
          },
        }, 'Convertir en tâche')) : null));
}

function tasksCard() {
  const el = h('div', { class: 'card wide tasks-card', id: 'tasks-card' });
  queueMicrotask(renderTasksCard);
  return el;
}
