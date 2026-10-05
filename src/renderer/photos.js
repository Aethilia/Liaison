'use strict';

/* global h, icon, call, api, S, toast */
// Photos jointes aux observations et aux déchets non conformes : miniatures,
// ajout (bouton, glisser-déposer, Ctrl+V) et affichage en grand.

const photoCache = new Map();

function photoSrc(rel, thumb = true) {
  const key = `${thumb ? 't' : 'f'}:${rel}`;
  if (!photoCache.has(key)) photoCache.set(key, call(api.readPhoto(rel, thumb)).catch(() => null));
  return photoCache.get(key);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function savePhotoFiles(files) {
  const rels = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    rels.push(await call(api.savePhotoData(await readFileAsDataUrl(f), S.date)));
  }
  return rels;
}

async function pickPhotos() {
  try {
    return await call(api.pickPhotos(S.date));
  } catch (err) {
    toast(`Photo non ajoutée : ${err.message}`);
    return [];
  }
}

// Les éléments marqués acceptent les photos glissées ou collées (Ctrl+V).
const photoTargets = new WeakMap();

function photoTarget(el, onAdd) {
  el.dataset.photoTarget = '1';
  photoTargets.set(el, onAdd);
  el.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) {
      e.preventDefault();
      el.classList.add('drop-over');
    }
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-over'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('drop-over');
    const rels = await savePhotoFiles([...e.dataTransfer.files]);
    if (rels.length) onAdd(rels);
  });
  return el;
}

document.addEventListener('paste', async (e) => {
  const target = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-photo-target]');
  if (!target || !photoTargets.has(target)) return;
  const files = [...e.clipboardData.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile());
  if (!files.length) return;
  e.preventDefault();
  const rels = await savePhotoFiles(files);
  if (rels.length) photoTargets.get(target)(rels);
});

function photoStrip(list, { editable = false, onRemove = null } = {}) {
  if (!list || !list.length) return null;
  return h('div', { class: 'photo-strip' }, list.map((rel, i) => {
    const img = h('img', { alt: `Photo ${i + 1}`, loading: 'lazy' });
    photoSrc(rel).then((src) => { if (src) img.src = src; });
    return h('div', { class: 'photo-thumb' },
      h('button', { class: 'pt-open', title: 'Voir en grand', onclick: () => openLightbox(list, i) }, img),
      editable && onRemove ? h('button', { class: 'pt-del', title: 'Retirer la photo', 'aria-label': 'Retirer la photo', onclick: () => onRemove(i) }, icon('x', 12)) : null);
  }));
}

function photoButton(onAdd, label = '') {
  return h('button', {
    class: 'o-btn photo-btn', title: 'Ajouter une photo (ou glisser-déposer / Ctrl+V)',
    onclick: async () => {
      const rels = await pickPhotos();
      if (rels.length) onAdd(rels);
    },
  }, icon('camera', 16), label);
}

let lightbox = null;

function openLightbox(list, index) {
  if (!lightbox) {
    lightbox = h('dialog', { class: 'lightbox' });
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
    document.body.append(lightbox);
  }
  const show = async (i) => {
    const rel = list[i];
    const img = h('img', { alt: `Photo ${i + 1}` });
    lightbox.replaceChildren(
      h('div', { class: 'lb-bar' },
        h('span', {}, `Photo ${i + 1} / ${list.length}`),
        h('span', { class: 'spacer' }),
        list.length > 1 ? h('button', { class: 'icon-btn', title: 'Précédente', onclick: () => show((i - 1 + list.length) % list.length) }, icon('chevronLeft')) : null,
        list.length > 1 ? h('button', { class: 'icon-btn', title: 'Suivante', onclick: () => show((i + 1) % list.length) }, icon('chevronRight')) : null,
        h('button', { class: 'btn small', onclick: () => call(api.openPhoto(rel)) }, 'Ouvrir avec Windows'),
        h('button', { class: 'icon-btn', title: 'Fermer', onclick: () => lightbox.close() }, icon('x'))),
      h('div', { class: 'lb-img' }, img));
    const src = await photoSrc(rel, false);
    if (src) img.src = src;
  };
  show(index);
  if (!lightbox.open) lightbox.showModal();
}
