'use strict';

// Liste de suggestions sous un champ texte, avec une croix pour supprimer une
// entrée mémorisée par erreur (remplace les <datalist> du navigateur, qui ne le
// permettent pas).
(function () {
  let open = null; // { input, box, items, active }

  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function close() {
    if (!open) return;
    open.box.remove();
    open = null;
  }

  function place(box, input) {
    const r = input.getBoundingClientRect();
    box.style.left = `${r.left + window.scrollX}px`;
    box.style.top = `${r.bottom + window.scrollY + 4}px`;
    box.style.minWidth = `${r.width}px`;
  }

  function render(input, opts) {
    const q = norm(input.value.trim());
    const all = opts.items();
    const list = all.filter((it) => !q || norm(it.label).includes(q)).slice(0, 10);
    if (!list.length || (list.length === 1 && norm(list[0].label) === q)) {
      close();
      return;
    }
    if (!open || open.input !== input) {
      close();
      const box = document.createElement('div');
      box.className = 'suggest-box';
      box.addEventListener('mousedown', (e) => e.preventDefault()); // garde le focus dans le champ
      document.body.append(box);
      open = { input, box, items: [], active: -1, opts };
    }
    open.items = list;
    open.active = Math.min(open.active, list.length - 1);
    open.box.replaceChildren(...list.map((it, i) => {
      const row = document.createElement('div');
      row.className = `suggest-item${i === open.active ? ' active' : ''}`;
      const label = document.createElement('span');
      label.className = 'sg-label';
      label.textContent = it.label;
      row.append(label);
      if (it.meta) {
        const meta = document.createElement('span');
        meta.className = 'sg-meta';
        meta.textContent = it.meta;
        row.append(meta);
      }
      if (opts.onDelete) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'sg-del';
        del.title = `Oublier « ${it.label} »`;
        del.setAttribute('aria-label', del.title);
        del.textContent = '×';
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          await opts.onDelete(it);
          render(input, opts);
        });
        row.append(del);
      }
      row.addEventListener('click', () => pick(it));
      return row;
    }));
    place(open.box, input);
  }

  function pick(it) {
    if (!open) return;
    const { input, opts } = open;
    close();
    input.value = it.label;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (opts.onPick) opts.onPick(it, input);
  }

  // opts : { items: () => [{ label, meta?, data? }], onPick?, onDelete? }
  function attach(input, opts) {
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('focus', () => render(input, opts));
    input.addEventListener('input', () => render(input, opts));
    input.addEventListener('blur', () => setTimeout(() => { if (open && open.input === input) close(); }, 120));
    input.addEventListener('keydown', (e) => {
      if ((!open || open.input !== input) && e.key === 'ArrowDown') render(input, opts);
      if (!open || open.input !== input) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = open.items.length;
        open.active = (open.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        render(input, opts);
      } else if (e.key === 'Enter' && open.active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        pick(open.items[open.active]);
      } else if (e.key === 'Escape') {
        close();
      }
    });
  }

  window.addEventListener('resize', close);
  // La liste suit son champ quand la page défile.
  document.addEventListener('scroll', () => { if (open) place(open.box, open.input); }, true);

  window.Suggest = { attach, close };
})();
