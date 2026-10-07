'use strict';

// Construction d'un onglet « JJ-MM » à hauteur variable : les sections
// (absents, sorties, déchets non conformes, tâches, observations) s'allongent
// selon le contenu. Les styles sont repris de l'onglet « Modèle » d'origine
// pour garder l'apparence du classeur habituel.

const M = require('./model');

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const argb = (hex) => `FF${String(hex).replace('#', '').toUpperCase()}`;
// Teinte claire (mélange avec du blanc) pour colorer toute une ligne.
function lighten(hex, amount = 0.82) {
  const n = String(hex).replace('#', '');
  const ch = [0, 2, 4].map((i) => Math.round(parseInt(n.slice(i, i + 2), 16) + (255 - parseInt(n.slice(i, i + 2), 16)) * amount));
  return `FF${ch.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
const utcDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

function timeToFraction(hhmm) {
  const m = /^(\d{1,2})[:hH](\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2])) / 1440;
}

// Hauteurs de lignes du modèle.
const H = { band: 27.75, gap: 7.5, section: 15, colhead: 15, row: 18.75, entree: 21.75, total: 21.75, obs: 19.5, end: 9.75 };

class SheetBuilder {
  constructor(ws, model) {
    this.ws = ws;
    this.model = model;
    this.row = 1;
    this.cfs = [];
  }

  // Style d'une cellule du modèle, décalé pour le service (couleurs propres à chaque service).
  st(addr, def) {
    const m = /^([A-Z]+)(\d+)$/.exec(addr);
    return clone(this.model.getCell(`${m[1]}${Number(m[2]) + (def ? def.offset : 0)}`).style);
  }

  put(addr, value, style, extra = {}) {
    const c = this.ws.getCell(addr);
    if (style) c.style = clone(style);
    if (value !== undefined && value !== '' && value !== null) c.value = value;
    Object.assign(c, extra);
    return c;
  }

  // Fusion avec le même style sur toutes les cellules (pour les bordures).
  merge(from, to, value, style) {
    const [c1, r] = [from.replace(/\d+/, ''), Number(from.replace(/\D+/, ''))];
    const c2 = to.replace(/\d+/, '');
    for (let c = c1.charCodeAt(0); c <= c2.charCodeAt(0); c++) this.put(`${String.fromCharCode(c)}${r}`, undefined, style);
    if (from !== to) this.ws.mergeCells(`${from}:${to}`);
    if (value !== undefined && value !== '' && value !== null) this.ws.getCell(from).value = value;
  }

  height(h) {
    this.ws.getRow(this.row).height = h;
  }

  next(h) {
    if (h) this.height(h);
    this.row += 1;
  }

  gap() {
    this.next(H.gap);
  }

  section(title, def, from = 'A', to = 'H') {
    this.merge(`${from}${this.row}`, `${to}${this.row}`, title, this.st('A5', def));
  }

  colHeads(spec, def) {
    for (const [from, to, label] of spec) this.merge(`${from}${this.row}`, `${to}${this.row}`, label, this.st('A6', def));
    this.next(H.colhead);
  }
}

// days : [{ date, services }] ; options : { tasks, site, siteName }
function buildDaySheet(ws, model, day, { tasks = [], site = {}, siteName = '' } = {}) {
  const b = new SheetBuilder(ws, model);
  ws.properties = clone(model.properties);
  ws.views = clone(model.views);
  ws.pageSetup = { ...clone(model.pageSetup), printArea: undefined };
  model.columns.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  M.SERVICES.forEach((def, idx) => {
    const s = M.normalize(day.services[def.id], day.date, def.id);
    if (idx > 0) ws.getRow(b.row - 1).addPageBreak();

    // Titre
    b.merge(`A${b.row}`, `H${b.row}`, `MAIN COURANTE  ·  ${(siteName || 'TRONC PRINCIPAL').toUpperCase()}`, b.st('A1'));
    b.next(30);
    b.next(6);

    // Bandeau du service
    b.merge(`A${b.row}`, `B${b.row}`, utcDate(day.date), b.st('A3', def));
    b.merge(`C${b.row}`, `E${b.row}`, def.titre, b.st('C3', def));
    b.put(`F${b.row}`, 'Responsable', b.st('F3', def));
    b.merge(`G${b.row}`, `H${b.row}`, s.responsable, b.st('G3', def));
    b.next(H.band);
    b.gap();

    // Agents absents (2 par ligne, au moins 2 lignes comme sur la feuille)
    b.section('AGENTS ABSENTS', def);
    b.next(H.section);
    b.colHeads([['A', 'B', 'Nom'], ['C', 'D', 'Motif'], ['E', 'F', 'Nom'], ['G', 'H', 'Motif']], def);
    const absents = s.absents.filter((a, i) => i < M.NB_ABSENTS || a.nom || a.motif);
    const motifRanges = [];
    for (let i = 0; i < Math.max(2, Math.ceil(absents.length / 2)); i++) {
      const a = absents[2 * i] || { nom: '', motif: '' };
      const z = absents[2 * i + 1] || { nom: '', motif: '' };
      b.merge(`A${b.row}`, `B${b.row}`, a.nom, b.st('A7', def));
      b.merge(`C${b.row}`, `D${b.row}`, a.motif, b.st('C7', def));
      b.merge(`E${b.row}`, `F${b.row}`, z.nom, b.st('E7', def));
      b.merge(`G${b.row}`, `H${b.row}`, z.motif, b.st('G7', def));
      motifRanges.push(`C${b.row}`, `G${b.row}`);
      b.next(H.row);
    }
    for (const addr of motifRanges) {
      ws.getCell(addr).dataValidation = {
        type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`"${M.MOTIFS.join(',')}"`],
      };
    }
    b.gap();

    // Entrées
    b.section('ENTRÉES  —  passages de véhicules', def);
    b.next(H.section);
    b.merge(`A${b.row}`, `B${b.row}`, 'Plateaux', b.st('A11', def));
    b.put(`C${b.row}`, s.entrees.plateaux, b.st('C11', def));
    b.merge(`D${b.row}`, `E${b.row}`, 'Poids lourds (PL)', b.st('D11', def));
    b.put(`F${b.row}`, s.entrees.pl, b.st('F11', def));
    b.put(`G${b.row}`, 'TOTAL', b.st('G11', def));
    const totalEntrees = (s.entrees.plateaux || 0) + (s.entrees.pl || 0);
    b.put(`H${b.row}`, { formula: `SUM(C${b.row},F${b.row})`, result: totalEntrees }, b.st('H11', def));
    b.next(H.entree);
    if (M.entreesTonnage(site) || s.entrees.tonnage != null) {
      b.merge(`A${b.row}`, `B${b.row}`, 'Tonnage (T)', b.st('A11', def));
      b.put(`C${b.row}`, s.entrees.tonnage, { ...b.st('C11', def), numFmt: '0.000' });
      b.next(H.entree);
    }
    b.gap();

    // Sorties et état des boxs côte à côte
    b.section('SORTIES', def, 'A', 'D');
    b.section('ÉTAT DES BOXS', def, 'E', 'H');
    b.next(H.section);
    b.colHeads([['A', 'B', 'Matière'], ['C', 'C', 'Nb sorties'], ['D', 'D', 'Tonnage'], ['E', 'E', 'Bennes'], ['F', 'F', 'Remplissage'], ['G', 'G', 'Plateaux'], ['H', 'H', 'Remplissage']], def);
    const rows = M.allSorties(s);
    const first = b.row;
    const couleurs = { ...M.COULEURS_DEFAUT, ...(site.couleurs || {}) };
    const noms = M.boxNames(site, s);
    for (let i = 0; i < Math.max(rows.length, noms.bennes.length, noms.plateaux.length); i++) {
      const r = rows[i];
      if (r) {
        const nameStyle = b.st('A15', def);
        const col = r.extra ? (r.data.couleur ? { couleur: r.data.couleur, mode: 'nom' } : null) : couleurs[r.nom];
        const lineFill = col && col.couleur && col.mode === 'ligne' ? { type: 'pattern', pattern: 'solid', fgColor: { argb: lighten(col.couleur) } } : null;
        if (col && col.couleur) nameStyle.font = { ...nameStyle.font, bold: true, color: { argb: argb(col.couleur) } };
        if (lineFill) nameStyle.fill = lineFill;
        b.merge(`A${b.row}`, `B${b.row}`, r.extra ? `${r.nom || 'Sortie ponctuelle'} *` : r.nom, nameStyle);
        const nbStyle = b.st('C15', def);
        if (lineFill) nbStyle.fill = lineFill;
        b.put(`C${b.row}`, r.data.nb, nbStyle);
        if (r.externe) {
          b.put(`D${b.row}`, 'service externe', b.st('D15', def));
        } else {
          const tonStyle = b.st('D17', def);
          if (lineFill) tonStyle.fill = lineFill;
          const pesees = (r.data.pesees || []).filter((v) => v != null);
          // Plusieurs bennes : la cellule garde le détail sous forme de formule (=5,54+4,74).
          const value = pesees.length > 1 ? { formula: pesees.map((v) => String(v)).join('+'), result: r.data.tonnage } : r.data.tonnage;
          b.put(`D${b.row}`, value, tonStyle);
        }
      } else {
        for (const c of ['A', 'B', 'C', 'D']) b.put(`${c}${b.row}`, undefined, null);
      }
      const benne = noms.bennes[i];
      if (benne) {
        b.put(`E${b.row}`, benne, b.st('E15', def));
        b.put(`F${b.row}`, s.bennes[benne] == null ? null : s.bennes[benne] / 100, b.st('F15', def));
      }
      const plateau = noms.plateaux[i];
      if (plateau) {
        b.put(`G${b.row}`, plateau, b.st('G15', def));
        b.put(`H${b.row}`, s.plateaux[plateau] == null ? null : s.plateaux[plateau] / 100, b.st('H15', def));
      }
      b.next(H.row);
    }
    const last = b.row - 1;
    const t = M.totals(s);
    b.merge(`A${b.row}`, `B${b.row}`, 'TOTAL', b.st('A23', def));
    b.put(`C${b.row}`, { formula: `SUM(C${first}:C${last})`, result: t.sortiesNb }, b.st('C23', def));
    b.put(`D${b.row}`, { formula: `SUM(D${first}:D${last})`, result: t.tonnage }, b.st('D23', def));
    if (rows.some((r) => r.extra)) b.merge(`E${b.row}`, `H${b.row}`, '* sortie ponctuelle', { font: { italic: true, size: 8, color: { argb: 'FF999999' } }, alignment: { vertical: 'middle' } });
    b.next(H.total);
    // Remplissage : fond du vert au rouge, chiffre en rouge à partir de 80 %.
    for (const ref of [noms.bennes.length && `F${first}:F${first + noms.bennes.length - 1}`, noms.plateaux.length && `H${first}:H${first + noms.plateaux.length - 1}`].filter(Boolean)) {
      ws.addConditionalFormatting({
        ref,
        rules: [
          { type: 'colorScale', priority: 1, cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 0.5 }, { type: 'num', value: 1 }], color: [{ argb: 'FF63BE7B' }, { argb: 'FFFFEB84' }, { argb: 'FFF8696B' }] },
          { type: 'cellIs', priority: 2, operator: 'greaterThanOrEqual', formulae: [String(M.SEUIL_ALERTE / 100)], style: { font: { bold: true, color: { argb: 'FFC00000' } } } },
        ],
      });
    }
    b.gap();

    // Déchets non conformes
    if (s.nonConformes.length) {
      b.section('DÉCHETS NON CONFORMES', def);
      b.next(H.section);
      b.colHeads([['A', 'B', 'Déchet'], ['C', 'C', 'Quantité'], ['D', 'D', 'Unité'], ['E', 'F', 'Provenance'], ['G', 'H', 'Commentaire']], def);
      for (const x of s.nonConformes) {
        b.merge(`A${b.row}`, `B${b.row}`, x.type, b.st('A15', def));
        b.put(`C${b.row}`, x.quantite, { ...b.st('C15', def), numFmt: '0.###' });
        b.put(`D${b.row}`, x.unite, b.st('C7', def));
        b.merge(`E${b.row}`, `F${b.row}`, x.provenance, b.st('A7', def));
        b.merge(`G${b.row}`, `H${b.row}`, `${x.commentaire}${x.photos.length ? `${x.commentaire ? ' ' : ''}(📷 ${x.photos.length})` : ''}`, b.st('B27', def));
        b.next(H.row);
      }
      b.gap();
    }

    // Stockage (bennes stockées sur site)
    const stk = (s.stockage || []).filter((x) => x.type || x.nombre != null);
    if (stk.length) {
      b.section('STOCKAGE', def);
      b.next(H.section);
      b.colHeads([['A', 'D', 'Type'], ['E', 'E', 'Nombre'], ['F', 'H', 'État']], def);
      for (const x of stk) {
        const etat = (M.ETATS_STOCKAGE.find((e) => e.id === x.etat) || {}).label || '';
        const cEtat = b.st('C7', def);
        cEtat.font = { ...cEtat.font, bold: true, color: { argb: x.etat === 'pleine' ? 'FFC00000' : x.etat === 'vide' ? 'FF1F8A4C' : 'FFB7791F' } };
        b.merge(`A${b.row}`, `D${b.row}`, x.type, b.st('A15', def));
        b.put(`E${b.row}`, x.nombre, b.st('C15', def));
        b.merge(`F${b.row}`, `H${b.row}`, etat, cEtat);
        b.next(H.row);
      }
      b.gap();
    }

    // Commandes (saisies par le matin)
    const cmds = (s.commandes || []).filter((x) => x.quoi || x.quantite || x.fournisseur);
    if (cmds.length) {
      b.section('COMMANDES', def);
      b.next(H.section);
      b.colHeads([['A', 'C', 'Quoi'], ['D', 'D', 'Quantité'], ['E', 'F', 'Fournisseur'], ['G', 'G', 'Date prévue'], ['H', 'H', 'Reçue']], def);
      for (const x of cmds) {
        b.merge(`A${b.row}`, `C${b.row}`, x.quoi, b.st('A15', def));
        b.put(`D${b.row}`, x.quantite, b.st('C7', def));
        b.merge(`E${b.row}`, `F${b.row}`, x.fournisseur, b.st('A7', def));
        b.put(`G${b.row}`, x.date ? x.date.split('-').reverse().join('/') : '', b.st('C7', def));
        b.put(`H${b.row}`, x.recue ? '☑' : '☐', b.st('C7', def));
        b.next(H.row);
      }
      b.gap();
    }

    // Tâches de relève (créées dans ce service ou encore en attente à ce moment-là)
    const svcTasks = tasksForService(tasks, day.date, def.id);
    if (svcTasks.length) {
      b.section('TÂCHES POUR LA RELÈVE', def);
      b.next(H.section);
      b.colHeads([['A', 'A', 'État'], ['B', 'E', 'Tâche'], ['F', 'F', 'Créée par'], ['G', 'H', 'Faite par']], def);
      for (const tk of svcTasks) {
        const done = tk.faite;
        const cState = b.st('C7', def);
        cState.font = { ...cState.font, bold: true, color: { argb: done ? 'FF1F8A4C' : 'FFB7791F' } };
        b.put(`A${b.row}`, done ? '☑ Faite' : '☐ À faire', cState);
        b.merge(`B${b.row}`, `E${b.row}`, tk.texte, b.st('B27', def));
        b.put(`F${b.row}`, tk.creePar, b.st('A7', def));
        b.merge(`G${b.row}`, `H${b.row}`, done ? `${done.par || ''} — ${fmtDateTime(done.le)}` : '', b.st('A7', def));
        b.next(H.row);
      }
      b.gap();
    }

    // Observations (au moins 12 lignes, une observation longue continue sur la ligne suivante)
    b.section('N.B.  —  observations', def);
    b.next(H.section);
    b.put(`A${b.row}`, 'Heure', b.st('A26', def));
    b.merge(`B${b.row}`, `H${b.row}`, 'Observation', b.st('B26', def));
    b.next(H.colhead);
    const lines = [];
    for (const o of s.observations) {
      if (!o.heure && !o.texte) continue;
      const txt = `${o.important ? M.IMPORTANT_PREFIX : ''}${o.texte}${o.photos.length ? ` (📷 ${o.photos.length})` : ''}`;
      M.wrapText(txt, 95).forEach((l, i) => lines.push({ heure: i === 0 ? o.heure : '', texte: l, important: o.important }));
    }
    if (s.consignes) M.wrapText(`${M.CONSIGNES_PREFIX} ${s.consignes}`, 95).forEach((l) => lines.push({ heure: '', texte: l }));
    while (lines.length < M.NB_OBSERVATIONS) lines.push({ heure: '', texte: '' });
    for (const l of lines) {
      const t2 = timeToFraction(l.heure);
      b.put(`A${b.row}`, t2 != null ? t2 : l.heure, b.st('A27', def));
      const txtStyle = b.st('B27', def);
      if (l.important) txtStyle.font = { ...txtStyle.font, bold: true, color: { argb: 'FFC00000' } };
      b.merge(`B${b.row}`, `H${b.row}`, l.texte, txtStyle);
      b.next(H.obs);
    }
    b.next(H.end);
  });
  return ws;
}

const SERVICE_ORDER = Object.fromEntries(M.SERVICES.map((d, i) => [d.id, i]));
const serviceKey = (date, service) => `${date}#${SERVICE_ORDER[service]}`;

function tasksForService(tasks, date, service) {
  const k = serviceKey(date, service);
  return tasks.filter((t) => {
    const origin = serviceKey(t.origine.date, t.origine.service);
    if (origin === k) return true;
    if (origin > k) return false;
    return !t.faite || serviceKey(t.faite.date, t.faite.service) >= k;
  });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

module.exports = { buildDaySheet, tasksForService, timeToFraction };
