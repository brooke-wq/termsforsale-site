const {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} = require('docx');

function safe(v, fallback = '—') {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
}

function money(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (!isFinite(n) || n === 0) return safe(v);
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function slug(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function kvRow(label, value) {
  const cell = (text, bold) => new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text: safe(text), bold: Boolean(bold) })] })],
  });
  return new TableRow({ children: [cell(label, true), cell(value, false)] });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true })],
    spacing: { before: 240, after: 120 },
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true })],
    spacing: { before: 200, after: 100 },
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text: safe(text), ...opts })],
    spacing: { after: 80 },
  });
}

function buildPropertyTable(d) {
  const rows = [
    kvRow('Deal ID', d.dealId || d.dealCode),
    kvRow('Address', d.streetAddress || d.address),
    kvRow('City / State / ZIP', [safe(d.city, ''), safe(d.state, ''), safe(d.zip, '')].filter(Boolean).join(', ')),
    kvRow('Property Type', d.propertyType),
    kvRow('Beds / Baths', [safe(d.beds, ''), safe(d.baths, '')].filter(Boolean).join(' / ')),
    kvRow('Sq Ft', d.sqft || d.livingArea),
    kvRow('Year Built', d.yearBuilt),
    kvRow('Lot Size', d.lotSize),
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function buildEconomicsTable(d) {
  const rows = [
    kvRow('Deal Type', d.dealType),
    kvRow('Asking Price', money(d.askingPrice || d.price)),
    kvRow('Entry Fee', money(d.entryFee)),
    kvRow('ARV', money(d.arv)),
    kvRow('Estimated Rent', money(d.estRent)),
    kvRow('PITI (est)', money(d.piti)),
    kvRow('Loan Balance', money(d.loanBalance)),
    kvRow('Interest Rate', d.interestRate ? `${d.interestRate}%` : '—'),
    kvRow('Seller Finance Terms', d.sfTerms),
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

async function generateDealDoc({ dealId, deal }) {
  const d = deal || {};
  const displayId = dealId || d.dealId || d.dealCode || `deal-${Date.now()}`;
  const title = d.headline || d.title || `Deal Analysis — ${displayId}`;
  const addrLine = [d.city, d.state].filter(Boolean).join(', ');

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, bold: true, size: 36 })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${safe(displayId)}${addrLine ? '  •  ' + addrLine : ''}`, italics: true })],
      spacing: { after: 240 },
    }),

    h2('Property'),
    buildPropertyTable(d),

    h2('Economics'),
    buildEconomicsTable(d),
  ];

  if (d.hook || d.summary || d.dealStory) {
    children.push(h2('Summary'));
    children.push(p(d.hook || d.summary || d.dealStory));
  }

  if (d.whyExists) {
    children.push(h2('Why This Exists'));
    children.push(p(d.whyExists));
  }

  if (d.strategies) {
    children.push(h2('Strategies'));
    children.push(p(d.strategies));
  }

  if (d.buyerFitYes) {
    children.push(h2('Ideal Buyer'));
    children.push(p(d.buyerFitYes));
  }

  if (d.analysis) {
    children.push(h2('Underwriting Notes'));
    const blocks = String(d.analysis).split(/\n\n+/);
    for (const block of blocks) children.push(p(block));
  }

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Generated ${new Date().toISOString()}`, italics: true, size: 18, color: '888888' })],
    spacing: { before: 240 },
  }));

  const doc = new Document({
    creator: 'Deal Pros LLC',
    title,
    description: `Deal analysis for ${displayId}`,
    sections: [{ properties: {}, children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `${slug(displayId) || 'deal'}-${Date.now()}.docx`;
  return { buffer, filename };
}

module.exports = { generateDealDoc };
