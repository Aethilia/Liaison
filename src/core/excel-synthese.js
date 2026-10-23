'use strict';

// Onglet « Synthèse » : chiffres clés de la période exportée, « en bref », puis
// des blocs tableau + graphique natif (voir excel-charts.js). Les poids des
// services externes (onglet Externes de l'appli) y sont repris.

const M = require('./model');

const SHEET = 'Synthèse';
// Ordre fixe des couleurs de catégories (palette validée pour les daltoniens).
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const AUTRES = '#8591a3';
const EXTERNE = '#1baf7a'; // service externe (Bois, Matelas…)
// Couleurs des services pour les graphiques : proches de celles de l'appli, mais
// assez saturées et distinctes pour rester lisibles (validées, y compris daltonisme).
const SERVICE_COLORS = { matin: '#eb6834', apresmidi: '#2a78d6', nuit: '#4a3aa7' };

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtJour = (iso) => `${JOURS[M.parseISODate(iso).getDay()]} ${fmtDate(iso)}`;
const fmtLong = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmtT = (v) => `${(Math.round(v * 1000) / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} T`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const weekEnd = (iso) => [0, 6].includes(M.parseISODate(iso).getDay());
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const NAVY = 'FF1F2F4F';
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const font = (o = {}) => ({ name: 'Arial', size: 10, color: { argb: 'FF333333' }, ...o });
const styles = {
  bandeau: { font: font({ bold: true, size: 16, color: { argb: 'FFFFFFFF' } }), fill: fill(NAVY), alignment: { vertical: 'middle', indent: 1 } },
  periode: { font: font({ size: 10, color: { argb: NAVY } }), fill: fill('FFE8ECF3'), alignment: { vertical: 'middle', indent: 1 } },
  section: { font: font({ bold: true, size: 10, color: { argb: 'FFFFFFFF' } }), fill: fill('FF34466B'), alignment: { vertical: 'middle', indent: 1 } },
  head: {
    font: font({ bold: true, size: 9, color: { argb: NAVY } }), fill: fill('FFEEF2F7'),
    alignment: { horizontal: 'center', vertical: 'middle' }, border: { bottom: { style: 'thin', color: { argb: 'FFC9D2DF' } } },
  },
  cell: { font: font(), border: { bottom: { style: 'thin', color: { argb: 'FFECEFF3' } } }, alignment: { vertical: 'middle' } },
  zebre: { font: font(), fill: fill('FFF8FAFC'), border: { bottom: { style: 'thin', color: { argb: 'FFECEFF3' } } }, alignment: { vertical: 'middle' } },
  total: { font: font({ bold: true, color: { argb: NAVY } }), fill: fill('FFEEF2F7'), border: { top: { style: 'thin', color: { argb: NAVY } } }, alignment: { vertical: 'middle' } },
  kpiLabel: { font: font({ color: { argb: 'FF555555' } }), alignment: { vertical: 'middle', indent: 1 }, border: { left: { style: 'thick', color: { argb: 'FF2A78D6' } }, bottom: { style: 'thin', color: { argb: 'FFECEFF3' } } } },
  kpiValue: { font: font({ bold: true, size: 13, color: { argb: NAVY } }), alignment: { horizontal: 'right', vertical: 'middle' }, border: { bottom: { style: 'thin', color: { argb: 'FFECEFF3' } } } },
  kpiDetail: { font: font({ italic: true, size: 9, color: { argb: 'FF7A8699' } }), alignment: { vertical: 'middle', indent: 1 }, border: { bottom: { style: 'thin', color: { argb: 'FFECEFF3' } } } },
  brefLabel: { font: font({ size: 9, color: { argb: 'FF7A8699' } }), fill: fill('FFF8FAFC'), alignment: { vertical: 'middle', indent: 1 } },
  brefValue: { font: font({ bold: true, color: { argb: NAVY } }), fill: fill('FFF8FAFC'), alignment: { vertical: 'middle' } },
  vide: { font: font({ italic: true, size: 9, color: { argb: 'FF999999' } }) },
  pied: { font: font({ italic: true, size: 8, color: { argb: 'FF999999' } }) },
};

// Écrit l'onglet et renvoie la description des graphiques à ajouter.
// externes : pesées des services externes [{ date, matiere, nb, tonnage }].
function buildSynthese(ws, days, { siteName = '', services = M.SERVICES, externes = [] } = {}) {
  const st = M.stats(days, services);
  const charts = [];
  ws.columns = [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 3 }, ...Array.from({ length: 9 }, () => ({ width: 11 }))];
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.3, footer: 0.3 } };

  const put = (addr, value, style) => {
    const c = ws.getCell(addr);
    c.value = value;
    if (style) c.style = JSON.parse(JSON.stringify(style));
    return c;
  };
  const debut = days.length ? days[0].date : '';
  const fin = days.length ? days[days.length - 1].date : '';
  // Pesées des services externes sur la période.
  const ext = externes.filter((e) => e.date >= debut && e.date <= fin && e.tonnage != null);
  const tonExt = ext.reduce((a, e) => a + e.tonnage, 0);
  const extParMatiere = new Map();
  for (const e of ext) extParMatiere.set(e.matiere, (extParMatiere.get(e.matiere) || 0) + e.tonnage);

  // En-tête
  ws.mergeCells('A1:N1');
  put('A1', `SYNTHÈSE  ·  ${(siteName || 'Tronc principal').toUpperCase()}`, styles.bandeau);
  ws.getRow(1).height = 32;
  ws.mergeCells('A2:N2');
  const moisEntier = days.length > 27 && debut.slice(8) === '01' && debut.slice(0, 7) === fin.slice(0, 7);
  put('A2', !days.length ? '' : days.length === 1 ? `Journée du ${fmtLong(debut)}`
    : `${moisEntier ? `${MOIS[Number(debut.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase())} ${debut.slice(0, 4)}  ·  ` : ''}du ${fmtLong(debut)} au ${fmtLong(fin)} (${days.length} jours)`, styles.periode);
  ws.getRow(2).height = 20;

  // Chiffres clés (A-D) : valeur + précision.
  const k = st.kpis;
  const nbExt = st.matieres.filter((m) => m.externe).reduce((a, m) => a + m.nb, 0);
  const topMotifs = st.motifs.slice(0, 3).map((m) => `${m.motif} ${m.nb}`).join(', ');
  const topNc = st.nonConformes.slice().sort((a, b) => b.lignes - a.lignes).slice(0, 3).map((x) => x.type).join(', ');
  const kpis = [
    ['Entrées (passages de véhicules)', k.entrees, '0', days.length > 1 ? `${Math.round(k.entrees / days.length)} par jour en moyenne` : ''],
    ['Sorties', k.sorties, '0', nbExt ? `dont ${nbExt} service externe` : ''],
    ['Tonnage sorti', Math.round((k.tonnage + tonExt) * 1000) / 1000, '#,##0.000" T"', tonExt ? `dont ${fmtT(tonExt)} service externe` : nbExt ? 'service externe : poids non saisis' : ''],
    ['Observations', k.observations, '0', k.importantes ? `dont ${k.importantes} importante${k.importantes > 1 ? 's' : ''}` : ''],
    ['Services clôturés', `${k.clos} / ${k.services}`, null, `${pct(k.clos, k.services)} %`],
    ['Déchets non conformes (lignes)', k.nonConformes, '0', topNc],
    ['Absences', k.absents, '0', topMotifs],
  ];
  ws.mergeCells('A4:D4');
  put('A4', 'CHIFFRES CLÉS', styles.section);
  ws.getRow(4).height = 20;
  kpis.forEach(([label, value, fmt, detail], i) => {
    const r = 5 + i;
    put(`A${r}`, label, styles.kpiLabel);
    const c = put(`B${r}`, value, styles.kpiValue);
    if (fmt) c.numFmt = fmt;
    ws.mergeCells(`C${r}:D${r}`);
    put(`C${r}`, detail, styles.kpiDetail);
    ws.getRow(r).height = 20;
  });

  // En bref (F-N) : les faits marquants de la période.
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
    ['Jour le plus chargé', pic && totJour(pic) > 0 ? `${fmtJour(pic.date)}  ·  ${fmtT(totJour(pic))}` : '—'],
    ['Tonnage moyen par jour', days.length ? fmtT((k.tonnage + tonExt) / days.length) : '—'],
    ['Matière principale', principale ? `${principale.nom}  ·  ${pct(principale.tonnage, totalMat)} % du tonnage` : '—'],
    ['Service le plus chargé (entrées)', entMax && entMax.total ? `${services.find((d) => d.id === entMax.service).label}  ·  ${pct(entMax.total, k.entrees)} % des passages` : '—'],
    ['Pesées des services externes', ext.length ? [...extParMatiere].map(([n, t]) => `${n} ${fmtT(t)}`).join('  ·  ') : nbExt ? 'en attente de saisie' : 'aucune'],
  ];
  ws.mergeCells('F4:N4');
  put('F4', 'EN BREF', styles.section);
  bref.forEach(([label, value], i) => {
    const r = 5 + i;
    ws.mergeCells(`F${r}:H${r}`);
    put(`F${r}`, label, styles.brefLabel);
    ws.mergeCells(`I${r}:N${r}`);
    put(`I${r}`, value, styles.brefValue);
  });

  let row = 5 + kpis.length + 2;
  const ref = (col, from, to) => `'${SHEET}'!$${col}$${from}:$${col}$${to}`;
  let numero = 0;

  // Bloc = bandeau numéroté + en-têtes + lignes (zébrées) + total ; graphique à droite.
  let blocks = 0;
  const block = (titre, heads, rows, { chart = null, total = null, barres = null, echelle = null, gris = null } = {}) => {
    // Deux blocs par page (la première page porte aussi les chiffres clés),
    // pour qu'un graphique ne soit jamais coupé à l'impression.
    if (blocks > 0 && blocks % 2 === 0) ws.getRow(row - 1).addPageBreak();
    blocks += 1;
    numero += 1;
    const start = row;
    ws.mergeCells(`A${row}:D${row}`);
    put(`A${row}`, `${numero}   ${titre}`, styles.section);
    ws.getRow(row).height = 20;
    row += 1;
    heads.forEach((hd, i) => put(`${'ABCD'[i]}${row}`, hd, styles.head));
    row += 1;
    const first = row;
    rows.forEach((r, n) => {
      const base = n % 2 ? styles.zebre : styles.cell;
      r.forEach((v, i) => {
        const c = put(`${'ABCD'[i]}${row}`, v && v.value !== undefined ? v.value : v, base);
        if (v && v.fmt) c.numFmt = v.fmt;
        if (i > 0) c.alignment = { ...c.alignment, horizontal: 'right' };
        if (v && v.color) c.font = { ...c.font, bold: true, color: { argb: `FF${v.color.replace('#', '').toUpperCase()}` } };
        if (gris && gris(n)) c.font = { ...c.font, color: { argb: 'FF9AA3B2' } };
      });
      row += 1;
    });
    if (!rows.length) {
      put(`A${row}`, 'Aucune donnée sur la période.', styles.vide);
      row += 1;
    }
    const last = first + rows.length - 1;
    if (rows.length && total) {
      total.forEach((v, i) => {
        const c = put(`${'ABCD'[i]}${row}`, v && v.value !== undefined ? v.value : v, styles.total);
        if (v && v.fmt) c.numFmt = v.fmt;
        if (i > 0) c.alignment = { ...c.alignment, horizontal: 'right' };
      });
      row += 1;
    }
    // Barres de données dans la cellule et dégradé de couleur (lecture rapide).
    if (rows.length && barres) {
      ws.addConditionalFormatting({ ref: `${barres.col}${first}:${barres.col}${last}`, rules: [{ type: 'dataBar', priority: 1, gradient: false, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: `FF${barres.color.replace('#', '').toUpperCase()}` } }] });
    }
    if (rows.length && echelle) {
      ws.addConditionalFormatting({ ref: `${echelle}${first}:${echelle}${last}`, rules: [{ type: 'colorScale', priority: 2, cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFFFFFFF' }, { argb: 'FF9CC3F0' }] }] });
    }
    if (chart && rows.length) {
      const height = 17;
      charts.push({
        ...chart,
        catRef: ref('A', first, last),
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
  let couleur = 0;
  const couleursMat = top.map((m) => (m.autres ? AUTRES : PALETTE[couleur++ % PALETTE.length]));
  block('TONNAGE PAR MATIÈRE', ['Matière', 'Tonnage', 'Nb sorties', 'Part'],
    top.map((m) => [nomMat(m), { value: m.tonnage, fmt: '#,##0.000" T"' }, m.nb, { value: m.tonnage / totalTon, fmt: '0%' }]),
    {
      total: ['Total', { value: Math.round(top.reduce((a, m) => a + m.tonnage, 0) * 1000) / 1000, fmt: '#,##0.000" T"' }, top.reduce((a, m) => a + m.nb, 0), { value: 1, fmt: '0%' }],
      barres: { col: 'D', color: '#9CC3F0' },
      chart: top.length >= 2 ? { type: 'doughnut', title: 'Tonnage par matière', col: 'B', labels: top.map(nomMat), values: top.map((m) => m.tonnage), colors: couleursMat } : null,
    });

  // 2. Entrées de véhicules par service (anneau aux couleurs des services).
  block('ENTRÉES DE VÉHICULES PAR SERVICE', ['Service', 'Plateaux', 'Poids lourds', 'Total'],
    ent.map((e) => [{ value: services.find((d) => d.id === e.service).label, color: SERVICE_COLORS[e.service] }, e.plateaux, e.pl, e.total]),
    {
      total: ['Total', ent.reduce((a, e) => a + e.plateaux, 0), ent.reduce((a, e) => a + e.pl, 0), k.entrees],
      barres: { col: 'D', color: '#C9D2DF' },
      chart: ent.filter((e) => e.total > 0).length >= 2 ? { type: 'doughnut', title: 'Entrées par service', col: 'D', labels: ent.map((e) => services.find((d) => d.id === e.service).label), values: ent.map((e) => e.total), colors: ent.map((e) => SERVICE_COLORS[e.service]) } : null,
    });

  // 3. Tonnage par jour (histogramme ; empilé avec les pesées externes s'il y en a).
  if (parJour.length >= 2) {
    const moy = (k.tonnage + tonExt) / parJour.length;
    const titre = `Tonnage sorti par jour (T) · moyenne ${moy.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} T`;
    const avecExt = tonExt > 0;
    block('TONNAGE PAR JOUR', avecExt ? ['Jour', 'Main courante', 'Externes', 'Total'] : ['Jour', 'Tonnage'],
      parJour.map((j) => (avecExt
        ? [fmtJour(j.date), { value: j.tonnage, fmt: '#,##0.000' }, { value: j.ext, fmt: '#,##0.000;;""' }, { value: Math.round(totJour(j) * 1000) / 1000, fmt: '#,##0.000" T"' }]
        : [fmtJour(j.date), { value: j.tonnage, fmt: '#,##0.000" T"' }])),
      {
        total: avecExt ? ['Total', { value: k.tonnage, fmt: '#,##0.000' }, { value: tonExt, fmt: '#,##0.000' }, { value: k.tonnage + tonExt, fmt: '#,##0.000" T"' }] : ['Total', { value: k.tonnage, fmt: '#,##0.000" T"' }],
        echelle: avecExt ? 'D' : 'B',
        gris: (n) => weekEnd(parJour[n].date),
        chart: avecExt
          ? { type: 'bar', title: titre, col: 'B', labels: parJour.map((j) => fmtDate(j.date)), values: [], colors: [PALETTE[0]], format: '0', series: [{ name: 'Main courante', col: 'B', values: parJour.map((j) => j.tonnage), color: PALETTE[0] }, { name: 'Services externes', col: 'C', values: parJour.map((j) => j.ext), color: EXTERNE }] }
          : { type: 'bar', title: titre, col: 'B', labels: parJour.map((j) => fmtDate(j.date)), values: parJour.map((j) => j.tonnage), colors: [PALETTE[0]], pointColors: parJour.map((j) => (weekEnd(j.date) ? '#9CC3F0' : null)), format: '0' },
      });
  }

  // 4. Nombre de sorties par matière (histogramme, externes en vert).
  const sorties = st.matieres.filter((m) => m.nb > 0).sort((a, b) => b.nb - a.nb);
  block('NOMBRE DE SORTIES PAR MATIÈRE', ['Matière', 'Nb sorties', 'Type', 'Poids'],
    sorties.map((m) => [`${m.nom}${m.extra ? ' *' : ''}`, m.nb, m.externe ? 'service externe' : m.extra ? 'ponctuelle' : '',
      m.externe ? (extParMatiere.has(m.nom) ? { value: extParMatiere.get(m.nom), fmt: '#,##0.000" T"' } : 'à saisir') : { value: m.tonnage, fmt: '#,##0.000" T"' }]),
    {
      total: ['Total', k.sorties, '', { value: k.tonnage + tonExt, fmt: '#,##0.000" T"' }],
      chart: sorties.length >= 2 ? { type: 'bar', title: 'Nombre de sorties par matière', col: 'B', labels: sorties.map((m) => m.nom), values: sorties.map((m) => m.nb), colors: [PALETTE[1]], pointColors: sorties.map((m) => (m.externe ? EXTERNE : null)), dataLabels: true, format: '0' } : null,
    });

  // 5. Absences par motif (anneau si au moins 2 motifs).
  const motifs = st.motifs.slice(0, 7);
  if (st.motifs.length > 7) motifs.push({ motif: 'Autres', nb: st.motifs.slice(7).reduce((a, m) => a + m.nb, 0), autres: true });
  const totalAbs = motifs.reduce((a, m) => a + m.nb, 0) || 1;
  block('ABSENCES PAR MOTIF', ['Motif', 'Nombre', 'Part'], motifs.map((m) => [m.motif, m.nb, { value: m.nb / totalAbs, fmt: '0%' }]),
    {
      total: ['Total', k.absents, { value: 1, fmt: '0%' }],
      barres: { col: 'B', color: '#F3B8A0' },
      chart: motifs.length >= 2 ? { type: 'doughnut', title: 'Absences par motif', col: 'B', labels: motifs.map((m) => m.motif), values: motifs.map((m) => m.nb), colors: motifs.map((m, i) => (m.autres ? AUTRES : PALETTE[i])) } : null,
    });

  // 6. Déchets non conformes (tableau : unités différentes, pas de total commun).
  block('DÉCHETS NON CONFORMES', ['Déchet', 'Quantité', 'Unité', 'Signalements'],
    st.nonConformes.map((x) => [x.type, { value: x.quantite, fmt: '0.###' }, x.unite, x.lignes]),
    { total: ['Total', '', '', st.nonConformes.reduce((a, x) => a + x.lignes, 0)], barres: { col: 'D', color: '#F3B8A0' } });

  const now = new Date();
  put(`A${row}`, `Édité le ${fmtLong(now.toISOString().slice(0, 10))} à ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} · Liaison${ext.length ? ' · poids des services externes repris de l\'onglet Externes' : ''}`, styles.pied);
  return charts;
}

module.exports = { buildSynthese, SYNTHESE_SHEET: SHEET };
