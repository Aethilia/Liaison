'use strict';

// Onglet « Synthèse » : bandeau, tuiles des chiffres clés, « en bref », puis
// des blocs tableau + graphique natif (voir excel-charts.js), chacun avec sa
// couleur. Les poids des services externes (onglet Externes) y sont repris.

const M = require('./model');

const SHEET = 'Synthèse';

// Palette douce et contrastée (lisible aussi pour les daltoniens).
const C = {
  nuit: '1E2A4A', // bandeau, titres
  encre: '2B3550', // texte principal
  gris: '7A8699',
  fond: 'F6F8FC',
  ligne: 'E4E9F2',
  indigo: '4F6BED',
  orange: 'F28C38',
  vert: '2BB673',
  jaune: 'F2B544',
  rose: 'E05A8B',
  violet: '8E6CEF',
  turquoise: '3FB8C9',
  corail: 'E8615A',
  ardoise: '94A3B8',
};
const PALETTE = ['indigo', 'orange', 'vert', 'jaune', 'rose', 'violet', 'turquoise', 'corail'].map((n) => `#${C[n]}`);
const AUTRES = `#${C.ardoise}`;
const EXTERNE = `#${C.vert}`; // service externe (Bois, Matelas…)
const SERVICE_COLORS = { matin: `#${C.orange}`, apresmidi: `#${C.indigo}`, nuit: `#${C.violet}` };

// Mélange d'une couleur avec le blanc (t = part de blanc) : teintes claires.
function teinte(hex, t) {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * t));
  return ch.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}
const argb = (hex) => `FF${hex.replace('#', '').toUpperCase()}`;

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtJour = (iso) => `${JOURS[M.parseISODate(iso).getDay()]} ${fmtDate(iso)}`;
const fmtLong = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmtT = (v) => `${(Math.round(v * 1000) / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} T`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const weekEnd = (iso) => [0, 6].includes(M.parseISODate(iso).getDay());
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const fill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const font = (o = {}) => ({ name: 'Arial', size: 10, color: { argb: argb(C.encre) }, ...o });
const trait = (hex, style = 'thin') => ({ style, color: { argb: argb(hex) } });

// Grille : A | B C D | E (marge) | F … N. Les tuiles occupent toute la largeur.
const COLS = [26, 13, 13, 13, 2, 11, 11, 11, 11, 11, 11, 11, 11, 11];
const TUILES = [['A', 'A'], ['B', 'C'], ['D', 'F'], ['G', 'H'], ['I', 'J'], ['K', 'L'], ['M', 'N']];
const LETTRES = 'ABCDEFGHIJKLMN';
const colonnes = (a, b) => LETTRES.slice(LETTRES.indexOf(a), LETTRES.indexOf(b) + 1).split('');

// Écrit l'onglet et renvoie la description des graphiques à ajouter.
// externes : pesées des services externes [{ date, matiere, nb, tonnage }].
function buildSynthese(ws, days, { siteName = '', services = M.SERVICES, externes = [] } = {}) {
  const st = M.stats(days, services);
  const charts = [];
  ws.columns = [...COLS.map((width) => ({ width })), { width: 6, hidden: true }];
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.3, footer: 0.3 } };

  const put = (addr, value, style) => {
    const c = ws.getCell(addr);
    c.value = value;
    if (style) c.style = JSON.parse(JSON.stringify(style));
    return c;
  };
  // Zone fusionnée avec un style posé sur toutes ses cellules (bordures et fond continus).
  const zone = (a, b, r, value, style) => {
    for (const col of colonnes(a, b)) put(`${col}${r}`, col === a ? value : null, style);
    if (a !== b) ws.mergeCells(`${a}${r}:${b}${r}`);
    return ws.getCell(`${a}${r}`);
  };

  const debut = days.length ? days[0].date : '';
  const fin = days.length ? days[days.length - 1].date : '';
  // Pesées des services externes sur la période.
  const ext = externes.filter((e) => e.date >= debut && e.date <= fin && e.tonnage != null);
  const tonExt = ext.reduce((a, e) => a + e.tonnage, 0);
  const extParMatiere = new Map();
  for (const e of ext) extParMatiere.set(e.matiere, (extParMatiere.get(e.matiere) || 0) + e.tonnage);

  // ---- Bandeau ----
  const bandeau = { font: font({ bold: true, size: 18, color: { argb: 'FFFFFFFF' } }), fill: { type: 'gradient', gradient: 'angle', degree: 0, stops: [{ position: 0, color: { argb: argb(C.nuit) } }, { position: 1, color: { argb: argb('34467A') } }] }, alignment: { vertical: 'middle', indent: 1 } };
  zone('A', 'N', 1, `Synthèse  ·  ${siteName || 'Tronc principal'}`, bandeau);
  ws.getRow(1).height = 36;
  const moisEntier = days.length > 27 && debut.slice(8) === '01' && debut.slice(0, 7) === fin.slice(0, 7);
  const periode = !days.length ? '' : days.length === 1 ? `Journée du ${fmtLong(debut)}`
    : `${moisEntier ? `${MOIS[Number(debut.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase())} ${debut.slice(0, 4)}   ·   ` : ''}du ${fmtLong(debut)} au ${fmtLong(fin)}  (${days.length} jours)`;
  zone('A', 'N', 2, periode, { font: font({ size: 10, color: { argb: 'FFDCE3F5' } }), fill: fill('34467A'), alignment: { vertical: 'middle', indent: 1 } });
  ws.getRow(2).height = 20;
  ws.getRow(3).height = 10;

  // ---- Tuiles des chiffres clés ----
  const k = st.kpis;
  const nbExt = st.matieres.filter((m) => m.externe).reduce((a, m) => a + m.nb, 0);
  const topMotifs = st.motifs.slice(0, 2).map((m) => `${m.motif} ${m.nb}`).join(' · ');
  const topNc = st.nonConformes.slice().sort((a, b) => b.lignes - a.lignes).slice(0, 2).map((x) => x.type).join(', ');
  const tuiles = [
    ['ENTRÉES', k.entrees, '#,##0', days.length > 1 ? `${Math.round(k.entrees / days.length)} / jour en moyenne` : 'passages de véhicules', C.indigo],
    ['SORTIES', k.sorties, '#,##0', nbExt ? `dont ${nbExt} service externe` : 'bennes et sorties', C.orange],
    ['TONNAGE SORTI', Math.round((k.tonnage + tonExt) * 1000) / 1000, '#,##0.0" T"', tonExt ? `dont ${fmtT(tonExt)} externe` : nbExt ? 'externes : poids à saisir' : '', C.vert],
    ['OBSERVATIONS', k.observations, '#,##0', k.importantes ? `dont ${k.importantes} importante${k.importantes > 1 ? 's' : ''}` : '', C.turquoise],
    ['CLÔTURÉS', `${pct(k.clos, k.services)} %`, null, `${k.clos} services sur ${k.services}`, C.violet],
    ['NON CONFORMES', k.nonConformes, '#,##0', topNc, C.jaune],
    ['ABSENCES', k.absents, '#,##0', topMotifs, C.rose],
  ];
  const separation = trait('FFFFFF', 'medium');
  tuiles.forEach(([label, value, fmt, detail, couleur], i) => {
    const [a, b] = TUILES[i];
    const fond = teinte(couleur, 0.9);
    const bords = { left: separation, right: separation };
    zone(a, b, 4, label, { font: font({ bold: true, size: 8, color: { argb: argb(couleur) } }), fill: fill(fond), alignment: { vertical: 'bottom', indent: 1 }, border: { ...bords, top: trait(couleur, 'thick') } });
    const v = zone(a, b, 5, value, { font: font({ bold: true, size: 20, color: { argb: argb(C.nuit) } }), fill: fill(fond), alignment: { horizontal: 'left', vertical: 'middle', indent: 1 }, border: bords });
    if (fmt) v.numFmt = fmt;
    zone(a, b, 6, detail, { font: font({ size: 8, color: { argb: argb(C.gris) } }), fill: fill(fond), alignment: { vertical: 'top', indent: 1, wrapText: true }, border: bords });
  });
  ws.getRow(4).height = 18;
  ws.getRow(5).height = 30;
  ws.getRow(6).height = 24;
  ws.getRow(7).height = 10;

  // ---- En bref : faits marquants, sur une ligne ----
  const parJour = st.parJour.map((j) => ({ ...j, ext: ext.filter((e) => e.date === j.date).reduce((a, e) => a + e.tonnage, 0) }));
  const totJour = (j) => j.tonnage + j.ext;
  const pic = parJour.slice().sort((a, b) => totJour(b) - totJour(a))[0];
  const tonnesMat = st.matieres.filter((m) => !m.externe && m.tonnage > 0).map((m) => ({ ...m }));
  for (const [nom, t] of extParMatiere) tonnesMat.push({ nom, tonnage: t, nb: (st.matieres.find((m) => m.nom === nom) || {}).nb || 0, externe: true });
  const totalMat = tonnesMat.reduce((a, m) => a + m.tonnage, 0);
  const principale = tonnesMat.slice().sort((a, b) => b.tonnage - a.tonnage)[0];
  const ent = st.entrees.map((e) => ({ ...e, total: e.plateaux + e.pl }));
  const entMax = ent.slice().sort((a, b) => b.total - a.total)[0];
  const bref = [
    ['EN BREF', null],
    ['Jour le plus chargé', pic && totJour(pic) > 0 ? `${fmtJour(pic.date)} · ${fmtT(totJour(pic))}` : '—'],
    ['Moyenne par jour', days.length ? fmtT((k.tonnage + tonExt) / days.length) : '—'],
    ['Matière principale', principale ? `${principale.nom} · ${pct(principale.tonnage, totalMat)} %` : '—'],
    ['Service le plus chargé', entMax && entMax.total ? `${services.find((d) => d.id === entMax.service).label} · ${pct(entMax.total, k.entrees)} %` : '—'],
    ['Services externes', ext.length ? [...extParMatiere].map(([n, t]) => `${n} ${fmtT(t)}`).join(' · ') : nbExt ? 'poids à saisir' : 'aucun'],
  ];
  const brefSpans = [['A', 'A'], ['B', 'C'], ['D', 'F'], ['G', 'H'], ['I', 'J'], ['K', 'N']];
  bref.forEach(([label, value], i) => {
    const [a, b] = brefSpans[i];
    const bords = { top: trait(C.ligne), bottom: trait(C.ligne) };
    if (i === 0) {
      put('A8', label, { font: font({ bold: true, size: 10, color: { argb: 'FFFFFFFF' } }), fill: fill(C.nuit), alignment: { vertical: 'middle', horizontal: 'center' } });
      put('A9', null, { fill: fill(C.nuit) });
      ws.mergeCells('A8:A9');
      return;
    }
    zone(a, b, 8, label, { font: font({ size: 8, color: { argb: argb(C.gris) } }), fill: fill(C.fond), alignment: { vertical: 'bottom', indent: 1 }, border: { top: bords.top } });
    zone(a, b, 9, value, { font: font({ bold: true, size: 10, color: { argb: argb(C.nuit) } }), fill: fill(C.fond), alignment: { vertical: 'top', indent: 1 }, border: { bottom: bords.bottom } });
  });
  ws.getRow(8).height = 16;
  ws.getRow(9).height = 20;

  let row = 12;
  const ref = (col, from, to) => `'${SHEET}'!$${col}$${from}:$${col}$${to}`;
  let numero = 0;

  // Bloc = titre coloré + en-têtes + lignes (zébrées) + total ; graphique à droite.
  let blocks = 0;
  const block = (titre, couleur, heads, rows, { chart = null, total = null, barres = null, echelle = null, gris = null, etiquettes = null } = {}) => {
    // Deux blocs par page (la première page porte aussi les tuiles),
    // pour qu'un graphique ne soit jamais coupé à l'impression.
    if (blocks > 0 && blocks % 2 === 0) ws.getRow(row - 1).addPageBreak();
    blocks += 1;
    numero += 1;
    const start = row;
    const clair = teinte(couleur, 0.88);
    const tresClair = teinte(couleur, 0.95);
    // Titre : pastille numérotée + texte, souligné de la couleur du bloc.
    put(`A${row}`, `${numero}   ${titre}`, { font: font({ bold: true, size: 11, color: { argb: argb(couleur) } }), alignment: { vertical: 'middle' }, border: { bottom: trait(couleur, 'medium') } });
    for (const col of 'BCD') put(`${col}${row}`, null, { border: { bottom: trait(couleur, 'medium') } });
    ws.getRow(row).height = 24;
    row += 1;
    heads.forEach((hd, i) => put(`${'ABCD'[i]}${row}`, hd, { font: font({ bold: true, size: 8.5, color: { argb: argb(couleur) } }), fill: fill(clair), alignment: { horizontal: i ? 'right' : 'left', vertical: 'middle', indent: i ? 0 : 1 } }));
    ws.getRow(row).height = 18;
    row += 1;
    const first = row;
    rows.forEach((r, n) => {
      const style = { font: font(), fill: n % 2 ? fill(tresClair) : fill('FFFFFF'), alignment: { vertical: 'middle' }, border: { bottom: trait(C.ligne, 'hair') } };
      r.forEach((v, i) => {
        const c = put(`${'ABCD'[i]}${row}`, v && v.value !== undefined ? v.value : v, style);
        if (v && v.fmt) c.numFmt = v.fmt;
        c.alignment = { ...c.alignment, ...(i ? { horizontal: 'right' } : { indent: 1 }) };
        if (v && v.color) c.font = { ...c.font, bold: true, color: { argb: argb(v.color) } };
        if (gris && gris(n)) c.font = { ...c.font, color: { argb: argb(C.ardoise) } };
      });
      for (let i = r.length; i < 4; i++) put(`${'ABCD'[i]}${row}`, null, style);
      row += 1;
    });
    if (!rows.length) {
      put(`A${row}`, 'Aucune donnée sur la période.', { font: font({ italic: true, size: 9, color: { argb: argb(C.gris) } }), alignment: { indent: 1 } });
      row += 1;
    }
    const last = first + rows.length - 1;
    // Étiquettes courtes du graphique dans une colonne masquée (O).
    if (etiquettes) etiquettes.forEach((t, n) => { ws.getCell(`O${first + n}`).value = t; });
    if (rows.length && total) {
      for (let i = 0; i < 4; i++) {
        const v = total[i];
        const c = put(`${'ABCD'[i]}${row}`, v && v.value !== undefined ? v.value : v ?? null, { font: font({ bold: true, color: { argb: argb(C.nuit) } }), fill: fill(clair), border: { top: trait(couleur) }, alignment: { vertical: 'middle', ...(i ? { horizontal: 'right' } : { indent: 1 }) } });
        if (v && v.fmt) c.numFmt = v.fmt;
      }
      ws.getRow(row).height = 18;
      row += 1;
    }
    // Barres de données dans la cellule et dégradé de couleur (lecture rapide).
    if (rows.length && barres) {
      ws.addConditionalFormatting({ ref: `${barres}${first}:${barres}${last}`, rules: [{ type: 'dataBar', priority: 1, gradient: false, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: argb(teinte(couleur, 0.55)) } }] });
    }
    if (rows.length && echelle) {
      ws.addConditionalFormatting({ ref: `${echelle}${first}:${echelle}${last}`, rules: [{ type: 'colorScale', priority: 2, cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFFFFFFF' }, { argb: argb(teinte(couleur, 0.5)) }] }] });
    }
    if (chart && rows.length) {
      const height = 17;
      charts.push({
        bordure: teinte(couleur, 0.7),
        ...chart,
        catRef: ref(etiquettes ? 'O' : 'A', first, last),
        valRef: ref(chart.col, first, last),
        ...(chart.series ? { series: chart.series.map((s) => ({ ...s, valRef: ref(s.col, first, last) })) } : {}),
        anchor: { from: { col: 5, row: start - 1 }, to: { col: 14, row: start - 1 + height } },
      });
      row = Math.max(row, start + height);
    }
    row += 2;
  };

  // 1. Tonnage par matière (anneau) : main courante + pesées externes.
  const tonnes = tonnesMat.sort((a, b) => b.tonnage - a.tonnage);
  const top = tonnes.slice(0, 7);
  const reste = tonnes.slice(7);
  if (reste.length) top.push({ nom: 'Autres', tonnage: reste.reduce((a, m) => a + m.tonnage, 0), nb: reste.reduce((a, m) => a + m.nb, 0), autres: true });
  const totalTon = top.reduce((a, m) => a + m.tonnage, 0) || 1;
  const nomMat = (m) => `${m.nom}${m.extra ? ' *' : ''}${m.externe ? ' (externe)' : ''}`;
  let ci = 0;
  let ce = 0;
  const verts = [EXTERNE, `#${teinte(C.vert, 0.45)}`, `#${teinte(C.vert, 0.7)}`];
  const couleursMat = top.map((m) => (m.autres ? AUTRES : m.externe ? verts[ce++ % verts.length] : PALETTE.filter((p) => p !== EXTERNE)[ci++ % (PALETTE.length - 1)]));
  block('TONNAGE PAR MATIÈRE', `#${C.indigo}`, ['Matière', 'Tonnage', 'Nb sorties', 'Part'],
    top.map((m) => [nomMat(m), { value: m.tonnage, fmt: '#,##0.000" T"' }, m.nb, { value: m.tonnage / totalTon, fmt: '0%' }]),
    {
      total: ['Total', { value: Math.round(top.reduce((a, m) => a + m.tonnage, 0) * 1000) / 1000, fmt: '#,##0.000" T"' }, top.reduce((a, m) => a + m.nb, 0), { value: 1, fmt: '0%' }],
      barres: 'D',
      chart: top.length >= 2 ? { type: 'doughnut', title: 'Tonnage par matière', col: 'B', labels: top.map(nomMat), values: top.map((m) => m.tonnage), colors: couleursMat } : null,
    });

  // 2. Entrées de véhicules par service (anneau aux couleurs des services).
  block('ENTRÉES DE VÉHICULES PAR SERVICE', `#${C.turquoise}`, ['Service', 'Plateaux', 'Poids lourds', 'Total'],
    ent.map((e) => [{ value: services.find((d) => d.id === e.service).label, color: SERVICE_COLORS[e.service] }, e.plateaux, e.pl, e.total]),
    {
      total: ['Total', ent.reduce((a, e) => a + e.plateaux, 0), ent.reduce((a, e) => a + e.pl, 0), k.entrees],
      barres: 'D',
      chart: ent.filter((e) => e.total > 0).length >= 2 ? { type: 'doughnut', title: 'Entrées par service', col: 'D', labels: ent.map((e) => services.find((d) => d.id === e.service).label), values: ent.map((e) => e.total), colors: ent.map((e) => SERVICE_COLORS[e.service]) } : null,
    });

  // 3. Tonnage par jour (histogramme ; empilé avec les pesées externes s'il y en a).
  if (parJour.length >= 2) {
    const moy = (k.tonnage + tonExt) / parJour.length;
    const titre = `Tonnage sorti par jour · moyenne ${moy.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} T`;
    const avecExt = tonExt > 0;
    block('TONNAGE PAR JOUR', `#${C.indigo}`, avecExt ? ['Jour', 'Main courante', 'Externes', 'Total'] : ['Jour', 'Tonnage'],
      parJour.map((j) => (avecExt
        ? [fmtJour(j.date), { value: j.tonnage, fmt: '#,##0.000' }, { value: j.ext, fmt: '#,##0.000;;""' }, { value: Math.round(totJour(j) * 1000) / 1000, fmt: '#,##0.000" T"' }]
        : [fmtJour(j.date), { value: j.tonnage, fmt: '#,##0.000" T"' }])),
      {
        total: avecExt ? ['Total', { value: k.tonnage, fmt: '#,##0.000' }, { value: tonExt, fmt: '#,##0.000' }, { value: k.tonnage + tonExt, fmt: '#,##0.000" T"' }] : ['Total', { value: k.tonnage, fmt: '#,##0.000" T"' }],
        echelle: avecExt ? 'D' : 'B',
        gris: (n) => weekEnd(parJour[n].date),
        etiquettes: parJour.map((j) => j.date.slice(8)),
        chart: avecExt
          ? { type: 'bar', title: titre, col: 'B', labels: parJour.map((j) => j.date.slice(8)), values: [], colors: [PALETTE[0]], format: '0', series: [{ name: 'Main courante', col: 'B', values: parJour.map((j) => j.tonnage), color: `#${C.indigo}` }, { name: 'Services externes', col: 'C', values: parJour.map((j) => j.ext), color: EXTERNE }] }
          : { type: 'bar', title: titre, col: 'B', labels: parJour.map((j) => j.date.slice(8)), values: parJour.map((j) => j.tonnage), colors: [`#${C.indigo}`], pointColors: parJour.map((j) => (weekEnd(j.date) ? `#${teinte(C.indigo, 0.5)}` : null)), format: '0' },
      });
  }

  // 4. Nombre de sorties par matière (histogramme, externes en vert).
  const sorties = st.matieres.filter((m) => m.nb > 0).sort((a, b) => b.nb - a.nb);
  block('SORTIES PAR MATIÈRE', `#${C.orange}`, ['Matière', 'Nb sorties', 'Type', 'Poids'],
    sorties.map((m) => [`${m.nom}${m.extra ? ' *' : ''}`, m.nb, m.externe ? 'service externe' : m.extra ? 'ponctuelle' : '',
      m.externe ? (extParMatiere.has(m.nom) ? { value: extParMatiere.get(m.nom), fmt: '#,##0.000" T"' } : 'à saisir') : { value: m.tonnage, fmt: '#,##0.000" T"' }]),
    {
      total: ['Total', k.sorties, '', { value: k.tonnage + tonExt, fmt: '#,##0.000" T"' }],
      barres: 'B',
      chart: sorties.length >= 2 ? { type: 'bar', title: 'Nombre de sorties par matière', col: 'B', labels: sorties.map((m) => m.nom), values: sorties.map((m) => m.nb), colors: [`#${C.orange}`], pointColors: sorties.map((m) => (m.externe ? EXTERNE : null)), dataLabels: true, format: '0' } : null,
    });

  // 5. Absences par motif (anneau si au moins 2 motifs).
  const motifs = st.motifs.slice(0, 7);
  if (st.motifs.length > 7) motifs.push({ motif: 'Autres', nb: st.motifs.slice(7).reduce((a, m) => a + m.nb, 0), autres: true });
  const totalAbs = motifs.reduce((a, m) => a + m.nb, 0) || 1;
  const couleursAbs = ['rose', 'violet', 'turquoise', 'jaune', 'indigo', 'orange', 'corail'].map((n) => `#${C[n]}`);
  block('ABSENCES PAR MOTIF', `#${C.rose}`, ['Motif', 'Nombre', 'Part'], motifs.map((m) => [m.motif, m.nb, { value: m.nb / totalAbs, fmt: '0%' }]),
    {
      total: ['Total', k.absents, { value: 1, fmt: '0%' }],
      barres: 'B',
      chart: motifs.length >= 2 ? { type: 'doughnut', title: 'Absences par motif', col: 'B', labels: motifs.map((m) => m.motif), values: motifs.map((m) => m.nb), colors: motifs.map((m, i) => (m.autres ? AUTRES : couleursAbs[i % couleursAbs.length])) } : null,
    });

  // 6. Déchets non conformes (tableau : unités différentes, pas de total commun).
  block('DÉCHETS NON CONFORMES', `#${C.jaune}`, ['Déchet', 'Quantité', 'Unité', 'Signalements'],
    st.nonConformes.map((x) => [x.type, { value: x.quantite, fmt: '0.###' }, x.unite, x.lignes]),
    { total: ['Total', '', '', st.nonConformes.reduce((a, x) => a + x.lignes, 0)], barres: 'D' });

  const now = new Date();
  put(`A${row}`, `Édité le ${fmtLong(now.toISOString().slice(0, 10))} à ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} avec Liaison${ext.length ? '  ·  poids des services externes repris de l\'onglet Externes' : ''}`,
    { font: font({ italic: true, size: 8, color: { argb: argb(C.ardoise) } }) });
  return charts;
}

module.exports = { buildSynthese, SYNTHESE_SHEET: SHEET };
