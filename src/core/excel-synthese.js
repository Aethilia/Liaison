'use strict';

// Onglet « Synthèse » : chiffres clés de la période exportée et tableaux qui
// alimentent les graphiques natifs (voir excel-charts.js).

const M = require('./model');

const SHEET = 'Synthèse';
// Ordre fixe des couleurs de catégories (palette validée pour les daltoniens).
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const AUTRES = '#8591a3';
// Couleurs des services pour les graphiques : proches de celles de l'appli, mais
// assez saturées et distinctes pour rester lisibles (validées, y compris daltonisme).
const SERVICE_COLORS = { matin: '#eb6834', apresmidi: '#2a78d6', nuit: '#4a3aa7' };

const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtLong = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const NAVY = 'FF1F2F4F';
const styles = {
  title: { font: { name: 'Arial', bold: true, size: 15, color: { argb: NAVY } } },
  sub: { font: { name: 'Arial', size: 10, color: { argb: 'FF888888' } } },
  section: {
    font: { name: 'Arial', bold: true, size: 10, color: { argb: 'FFC55A11' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE9DD' } },
    alignment: { vertical: 'middle' },
  },
  head: {
    font: { name: 'Arial', bold: true, size: 9, color: { argb: 'FF555555' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F7F9' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: { bottom: { style: 'thin', color: { argb: 'FFD0D5DD' } } },
  },
  cell: { font: { name: 'Arial', size: 10, color: { argb: 'FF333333' } }, border: { bottom: { style: 'thin', color: { argb: 'FFECEFF3' } } } },
  kpiLabel: { font: { name: 'Arial', size: 10, color: { argb: 'FF555555' } } },
  kpiValue: { font: { name: 'Arial', bold: true, size: 12, color: { argb: NAVY } }, alignment: { horizontal: 'right' } },
};

// Écrit l'onglet et renvoie la description des graphiques à ajouter.
function buildSynthese(ws, days, { siteName = '' } = {}) {
  const st = M.stats(days);
  const charts = [];
  ws.columns = [{ width: 28 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 3 }, ...Array.from({ length: 9 }, () => ({ width: 11 }))];
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.3, footer: 0.3 } };

  const put = (addr, value, style) => {
    const c = ws.getCell(addr);
    c.value = value;
    if (style) c.style = JSON.parse(JSON.stringify(style));
    return c;
  };
  put('A1', `SYNTHÈSE  ·  ${(siteName || 'Tronc principal').toUpperCase()}`, styles.title);
  ws.getRow(1).height = 26;
  if (days.length) put('A2', days.length > 1 ? `Du ${fmtLong(days[0].date)} au ${fmtLong(days[days.length - 1].date)} (${days.length} jours)` : `Journée du ${fmtLong(days[0].date)}`, styles.sub);

  // Chiffres clés
  const k = st.kpis;
  const kpis = [
    ['Entrées (passages de véhicules)', k.entrees, '0'],
    ['Sorties', k.sorties, '0'],
    ['Tonnage sorti', k.tonnage, '0.000" T"'],
    ['Observations', k.observations, '0'],
    ['dont importantes', k.importantes, '0'],
    ['Services clôturés', `${k.clos} / ${k.services}`, null],
    ['Déchets non conformes (lignes)', k.nonConformes, '0'],
    ['Absences', k.absents, '0'],
  ];
  put('A4', 'CHIFFRES CLÉS', styles.section);
  ws.mergeCells('A4:D4');
  kpis.forEach(([label, value, fmt], i) => {
    put(`A${5 + i}`, label, styles.kpiLabel);
    const c = put(`B${5 + i}`, value, styles.kpiValue);
    if (fmt) c.numFmt = fmt;
  });

  let row = 5 + kpis.length + 2;
  const ref = (col, from, to) => `'${SHEET}'!$${col}$${from}:$${col}$${to}`;

  // Bloc = titre + en-têtes + lignes ; le graphique éventuel se place à droite.
  let blocks = 0;
  const block = (titre, heads, rows, chart) => {
    // Deux blocs par page (la première page porte aussi les chiffres clés),
    // pour qu'un graphique ne soit jamais coupé à l'impression.
    if (blocks > 0 && blocks % 2 === 0) ws.getRow(row - 1).addPageBreak();
    blocks += 1;
    const start = row;
    put(`A${row}`, titre, styles.section);
    ws.mergeCells(`A${row}:D${row}`);
    ws.getRow(row).height = 18;
    row += 1;
    heads.forEach((hd, i) => put(`${'ABCD'[i]}${row}`, hd, styles.head));
    row += 1;
    const first = row;
    for (const r of rows) {
      r.forEach((v, i) => {
        const c = put(`${'ABCD'[i]}${row}`, v.value !== undefined ? v.value : v, styles.cell);
        if (v.fmt) c.numFmt = v.fmt;
        if (v.color) c.font = { ...c.font, bold: true, color: { argb: `FF${v.color.replace('#', '').toUpperCase()}` } };
      });
      row += 1;
    }
    if (!rows.length) {
      put(`A${row}`, 'Aucune donnée sur la période.', { font: { name: 'Arial', italic: true, size: 9, color: { argb: 'FF999999' } } });
      row += 1;
    }
    const last = first + rows.length - 1;
    if (chart && rows.length) {
      const height = 17;
      charts.push({
        ...chart,
        catRef: ref('A', first, last),
        valRef: ref(chart.col, first, last),
        anchor: { from: { col: 5, row: start - 1 }, to: { col: 13, row: start - 1 + height } },
      });
      row = Math.max(row, start + height);
    }
    row += 2;
  };

  // 1. Tonnage par matière (camembert) : 7 premières matières + « Autres ».
  const tonnes = st.matieres.filter((m) => !m.externe && m.tonnage > 0).sort((a, b) => b.tonnage - a.tonnage);
  const top = tonnes.slice(0, 7);
  const reste = tonnes.slice(7);
  if (reste.length) top.push({ nom: 'Autres', tonnage: reste.reduce((a, m) => a + m.tonnage, 0), nb: reste.reduce((a, m) => a + m.nb, 0), autres: true });
  const totalTon = top.reduce((a, m) => a + m.tonnage, 0) || 1;
  block('TONNAGE PAR MATIÈRE', ['Matière', 'Tonnage', 'Nb sorties', 'Part'],
    top.map((m) => [`${m.nom}${m.extra ? ' *' : ''}`, { value: m.tonnage, fmt: '0.000" T"' }, m.nb, { value: m.tonnage / totalTon, fmt: '0%' }]),
    top.length >= 2 ? { type: 'pie', title: 'Tonnage par matière', col: 'B', labels: top.map((m) => m.nom), values: top.map((m) => m.tonnage), colors: top.map((m, i) => (m.autres ? AUTRES : PALETTE[i])) } : null);

  // 2. Entrées de véhicules par service (camembert aux couleurs des services).
  const ent = st.entrees.map((e) => ({ ...e, total: e.plateaux + e.pl }));
  block('ENTRÉES DE VÉHICULES PAR SERVICE', ['Service', 'Plateaux', 'Poids lourds', 'Total'],
    ent.map((e) => [{ value: M.SERVICES.find((d) => d.id === e.service).label, color: SERVICE_COLORS[e.service] }, e.plateaux, e.pl, e.total]),
    ent.filter((e) => e.total > 0).length >= 2 ? { type: 'pie', title: 'Entrées par service', col: 'D', labels: ent.map((e) => M.SERVICES.find((d) => d.id === e.service).label), values: ent.map((e) => e.total), colors: ent.map((e) => SERVICE_COLORS[e.service]) } : null);

  // 3. Tonnage par jour (histogramme), à partir de 2 jours.
  if (st.parJour.length >= 2) {
    block('TONNAGE PAR JOUR', ['Jour', 'Tonnage'], st.parJour.map((j) => [fmtDate(j.date), { value: j.tonnage, fmt: '0.000" T"' }]),
      { type: 'bar', title: 'Tonnage sorti par jour (T)', col: 'B', labels: st.parJour.map((j) => fmtDate(j.date)), values: st.parJour.map((j) => j.tonnage), colors: [PALETTE[0]], format: '0.0' });
  }

  // 4. Nombre de sorties par matière (histogramme, externes comprises).
  const sorties = st.matieres.filter((m) => m.nb > 0).sort((a, b) => b.nb - a.nb);
  block('NOMBRE DE SORTIES PAR MATIÈRE', ['Matière', 'Nb sorties', 'Type'],
    sorties.map((m) => [`${m.nom}${m.extra ? ' *' : ''}`, m.nb, m.externe ? 'service externe' : m.extra ? 'ponctuelle' : '']),
    sorties.length >= 2 ? { type: 'bar', title: 'Nombre de sorties par matière', col: 'B', labels: sorties.map((m) => m.nom), values: sorties.map((m) => m.nb), colors: [PALETTE[1]], format: '0' } : null);

  // 5. Absences par motif (camembert si au moins 2 motifs).
  const motifs = st.motifs.slice(0, 7);
  if (st.motifs.length > 7) motifs.push({ motif: 'Autres', nb: st.motifs.slice(7).reduce((a, m) => a + m.nb, 0), autres: true });
  block('ABSENCES PAR MOTIF', ['Motif', 'Nombre'], motifs.map((m) => [m.motif, m.nb]),
    motifs.length >= 2 ? { type: 'pie', title: 'Absences par motif', col: 'B', labels: motifs.map((m) => m.motif), values: motifs.map((m) => m.nb), colors: motifs.map((m, i) => (m.autres ? AUTRES : PALETTE[i])) } : null);

  // 6. Déchets non conformes (tableau : unités différentes, pas de total commun).
  block('DÉCHETS NON CONFORMES', ['Déchet', 'Quantité', 'Unité', 'Signalements'],
    st.nonConformes.map((x) => [x.type, { value: x.quantite, fmt: '0.###' }, x.unite, x.lignes]), null);

  return charts;
}

module.exports = { buildSynthese, SYNTHESE_SHEET: SHEET };
