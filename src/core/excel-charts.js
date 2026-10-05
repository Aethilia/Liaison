'use strict';

// Graphiques Excel natifs (camemberts, histogrammes) ajoutés après coup au
// classeur : ExcelJS ne sait pas en créer, on écrit donc directement les
// parties DrawingML du fichier .xlsx. Chaque graphique pointe sur les cellules
// de l'onglet (il reste modifiable dans Excel) et embarque ses valeurs en cache
// pour s'afficher même sans recalcul.

const JSZip = require('jszip');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c) => String(c).replace('#', '').toUpperCase();
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function title(text) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"><a:solidFill><a:srgbClr val="1F2F4F"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr lang="fr-FR" sz="1200" b="1"><a:solidFill><a:srgbClr val="1F2F4F"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`;
}

function catData(ref, labels) {
  return `<c:cat><c:strRef><c:f>${esc(ref)}</c:f><c:strCache><c:ptCount val="${labels.length}"/>${labels.map((l, i) => `<c:pt idx="${i}"><c:v>${esc(l)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>`;
}

function valData(ref, values, fmt = 'General') {
  return `<c:val><c:numRef><c:f>${esc(ref)}</c:f><c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${Number(v) || 0}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val>`;
}

const textProps = (sz = 900, color = '52514E') => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="fr-FR"/></a:p></c:txPr>`;

function pieXml(ch) {
  const points = ch.colors.map((c, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join('');
  return `<c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(ch.title)}</c:v></c:tx>${points}`
    + `<c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${textProps(900, '0B0B0B')}<c:dLblPos val="bestFit"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>`
    + `${catData(ch.catRef, ch.labels)}${valData(ch.valRef, ch.values, ch.format)}</c:ser><c:firstSliceAng val="0"/></c:pieChart>`;
}

function barXml(ch) {
  return `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(ch.title)}</c:v></c:tx>`
    + `<c:spPr><a:solidFill><a:srgbClr val="${hex(ch.colors[0])}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`
    + `${catData(ch.catRef, ch.labels)}${valData(ch.valRef, ch.values, ch.format)}</c:ser><c:gapWidth val="50"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>`
    + `<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>${textProps(800)}<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
    + `<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="EDEDED"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${esc(ch.format || 'General')}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${textProps(800)}<c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
}

function chartXml(ch) {
  const plot = ch.type === 'pie' ? pieXml(ch) : barXml(ch);
  const legend = ch.type === 'pie' ? `<c:legend><c:legendPos val="r"/><c:overlay val="0"/>${textProps(900, '0B0B0B')}</c:legend>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/><c:chart>${title(ch.title)}<c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="DDE2EA"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
}

function anchorXml(ch, i) {
  const { from, to } = ch.anchor;
  const pos = (p) => `<xdr:col>${p.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>0</xdr:rowOff>`;
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${pos(from)}</xdr:from><xdr:to>${pos(to)}</xdr:to>`
    + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="${esc(ch.title)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
    + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
    + `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rIdChart${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

// Chemin (dans le zip) de la feuille portant ce nom.
async function sheetPath(zip, name) {
  const wb = await zip.file('xl/workbook.xml').async('string');
  const m = new RegExp(`<sheet [^>]*name="${esc(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*r:id="([^"]+)"`).exec(wb);
  if (!m) throw new Error(`Onglet introuvable : ${name}`);
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const r = new RegExp(`<Relationship [^>]*Id="${m[1]}"[^>]*Target="([^"]+)"`).exec(rels) || new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${m[1]}"`).exec(rels);
  return `xl/${r[1].replace(/^\/?xl\//, '')}`;
}

// charts : [{ type: 'pie'|'bar', title, labels, values, catRef, valRef, colors, format, anchor: { from: {col,row}, to: {col,row} } }]
async function addCharts(file, sheetName, charts, fs = require('fs')) {
  if (!charts.length) return;
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const sheet = await sheetPath(zip, sheetName);
  const sheetFile = sheet.split('/').pop();
  const existing = Object.keys(zip.files);
  let d = 1;
  while (existing.includes(`xl/drawings/drawing${d}.xml`)) d++;
  let c = 1;
  const chartNames = [];
  for (const ch of charts) {
    while (existing.includes(`xl/charts/chart${c}.xml`) || chartNames.includes(`chart${c}.xml`)) c++;
    chartNames.push(`chart${c}.xml`);
    zip.file(`xl/charts/chart${c}.xml`, chartXml(ch));
  }
  zip.file(`xl/drawings/drawing${d}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}">${charts.map(anchorXml).join('')}</xdr:wsDr>`);
  zip.file(`xl/drawings/_rels/drawing${d}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${chartNames.map((n, i) => `<Relationship Id="rIdChart${i + 1}" Type="${NS_R}/chart" Target="../charts/${n}"/>`).join('')}</Relationships>`);

  // Lien feuille → dessin
  const relsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const drawRel = `<Relationship Id="rIdDrawing${d}" Type="${NS_R}/drawing" Target="../drawings/drawing${d}.xml"/>`;
  const relsXml = zip.file(relsPath)
    ? (await zip.file(relsPath).async('string')).replace('</Relationships>', `${drawRel}</Relationships>`)
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawRel}</Relationships>`;
  zip.file(relsPath, relsXml);
  let sx = await zip.file(sheet).async('string');
  if (/<drawing /.test(sx)) throw new Error('La feuille a déjà un dessin.');
  if (!/xmlns:r=/.test(sx.slice(0, 600))) sx = sx.replace('<worksheet ', `<worksheet xmlns:r="${NS_R}" `);
  const tag = `<drawing r:id="rIdDrawing${d}"/>`;
  const before = ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>'];
  const at = before.map((t) => sx.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  sx = sx.slice(0, at) + tag + sx.slice(at);
  zip.file(sheet, sx);

  // Types de contenu
  let ct = await zip.file('[Content_Types].xml').async('string');
  const overrides = [
    `<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    ...chartNames.map((n) => `<Override PartName="/xl/charts/${n}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`),
  ];
  ct = ct.replace('</Types>', `${overrides.join('')}</Types>`);
  zip.file('[Content_Types].xml', ct);

  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

module.exports = { addCharts };
