const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  Footer, PageNumber
} = require('docx');

// Brand colors (hex, no #)
const NAVY   = '0D1F3C';
const ORANGE = 'F7941D';
const BLUE   = '29ABE2';
const WHITE  = 'FFFFFF';
const LGRAY  = 'F5F5F5';
const PAGE_WIDTH = 9360; // letter, 1-in margins each side (twips)
const MGRAY  = 'CCCCCC';
const DGRAY  = '555555';
const GREEN  = '16A34A';
const RED    = 'DC2626';
const LBLUE  = 'E8EEF5';
const SOFT_Y = 'FEF3C7';
const SOFT_Y2 = 'FFFBEB';

// ---------- Formatters ----------
function safe(v, fallback = '—') {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
}
function money(v, fallback = '—') {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  if (!isFinite(n)) return fallback;
  if (n === 0) return '$0';
  const neg = n < 0;
  return (neg ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function pct(v, digits = 1) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toFixed(digits) + '%';
}
function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return safe(d);
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return safe(d); }
}
function slug(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function nowMonthYear() {
  return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ---------- Border / shading helpers ----------
function noBorder() { return { style: BorderStyle.NONE, size: 0, color: 'auto' }; }
function thinBorder(color = MGRAY) { return { style: BorderStyle.SINGLE, size: 4, color }; }
function noTableBorders() { return { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideH: noBorder(), insideV: noBorder() }; }
function stdBorders() { return { top: thinBorder(), bottom: thinBorder(), left: thinBorder(), right: thinBorder(), insideH: thinBorder(), insideV: thinBorder() }; }
function shade(fill) { return { fill, type: ShadingType.CLEAR, color: 'auto' }; }

// ---------- Low-level builders ----------
function spacer(after = 160) {
  return new Paragraph({ children: [], spacing: { after } });
}
function breakPage() {
  return new Paragraph({ pageBreakBefore: true, children: [], spacing: { after: 0 } });
}
function centered(runs, spacing = {}) {
  const r = Array.isArray(runs) ? runs : [new TextRun({ text: safe(runs) })];
  return new Paragraph({ alignment: AlignmentType.CENTER, children: r, spacing: { after: 80, ...spacing } });
}

function textCell(text, opts = {}) {
  const {
    bold = false, color = '000000', size = 20, fill = null,
    align = AlignmentType.LEFT, width = null, italics = false
  } = opts;
  const cellOpts = {
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text: safe(text), bold, color, size, italics })],
      spacing: { after: 0 }
    })],
    margins: { top: 80, bottom: 80, left: 120, right: 120 }
  };
  if (fill) cellOpts.shading = shade(fill);
  if (width != null) cellOpts.width = { size: Math.round(PAGE_WIDTH * width / 100), type: WidthType.DXA };
  return new TableCell(cellOpts);
}

// Section heading bar (full-width navy)
function sectionHeading(label, pageBreakBef = true) {
  const elements = [];
  if (pageBreakBef) elements.push(breakPage());
  elements.push(
    new Table({
      width: { size: PAGE_WIDTH, type: WidthType.DXA },
      columnWidths: [PAGE_WIDTH],
      borders: noTableBorders(),
      rows: [new TableRow({
        children: [new TableCell({
          shading: shade(NAVY),
          children: [new Paragraph({
            children: [new TextRun({ text: label, bold: true, color: WHITE, size: 24, allCaps: true })],
            spacing: { before: 100, after: 100 }
          })],
          margins: { top: 80, bottom: 80, left: 180, right: 180 }
        })]
      })]
    })
  );
  elements.push(spacer(120));
  return elements;
}

// Sub-heading (navy text with blue underline)
function subHeading(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: NAVY, size: 22 })],
    spacing: { before: 160, after: 80 },
    border: { bottom: thinBorder(BLUE) }
  });
}

// 2-col KV table with alternating row shading
function kvTable(pairs) {
  const rows = pairs.filter(Boolean).map(([label, value], i) => {
    const fill = i % 2 === 1 ? LGRAY : WHITE;
    return new TableRow({
      children: [
        textCell(label, { bold: true, color: NAVY, fill, width: 38 }),
        textCell(safe(value), { fill, width: 62 })
      ]
    });
  });
  return new Table({ width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: [3557, 5803], borders: stdBorders(), rows });
}

// Full-width colored callout
function calloutBox(text, fill, textColor = WHITE, size = 40) {
  return new Table({
    width: { size: PAGE_WIDTH, type: WidthType.DXA },
    columnWidths: [PAGE_WIDTH],
    borders: noTableBorders(),
    rows: [new TableRow({
      children: [new TableCell({
        shading: shade(fill),
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: safe(text), bold: true, color: textColor, size })],
          spacing: { before: 120, after: 120 }
        })],
        margins: { top: 120, bottom: 120, left: 240, right: 240 }
      })]
    })]
  });
}

// Stubs — implementations appended below
function buildCover(deal, compute) {
  const d = deal || {};
  const v = (compute && compute.verdict) || {};
  const verdict = v.verdict || '—';
  const askingStr = money(d.askingPrice);
  const arvStr = money(compute ? compute.arvUsed : d.arv);
  const rentStr = compute && compute.monthlyRentUsed ? money(compute.monthlyRentUsed) + '/mo' : (d.estRent ? money(d.estRent) + '/mo' : '—');
  const bedsStr = [safe(d.beds, ''), safe(d.baths, '')].filter(Boolean).join(' / ') || '—';
  const floodTier = compute && compute.floodRisk ? (compute.floodRisk.tier || 'unknown') : 'verify';
  const verdictColor = verdict === 'PASS+' ? GREEN : verdict === 'PROCEED' ? ORANGE : RED;
  const did = d.dealId || d.dealCode || '';
  const cityLine = [d.city, d.state, d.zip].filter(Boolean).join(', ');

  const elements = [];
  elements.push(spacer(400));
  elements.push(centered([new TextRun({ text: did, bold: true, color: NAVY, size: 36 })], { after: 80 }));
  if (d.streetAddress) {
    elements.push(centered([new TextRun({ text: d.streetAddress, bold: true, color: NAVY, size: 28 })], { after: 40 }));
  }
  if (cityLine) {
    elements.push(centered([new TextRun({ text: cityLine, color: DGRAY, size: 24 })], { after: 80 }));
  }
  elements.push(spacer(200));
  elements.push(centered([new TextRun({ text: 'INVESTMENT ANALYSIS REPORT', color: MGRAY, size: 18, allCaps: true })], { after: 40 }));
  elements.push(centered([new TextRun({ text: 'Prepared for Terms for Sale  |  termsforsale.com', color: MGRAY, size: 18 })], { after: 40 }));
  elements.push(centered([new TextRun({ text: nowMonthYear(), color: MGRAY, size: 18 })], { after: 240 }));

  // 5-col stat table
  const labels = ['Asking Price', 'ARV', 'Est. Rent', 'Bed/Bath', 'Flood Zone'];
  const vals = [askingStr, arvStr, rentStr, bedsStr, String(floodTier).toUpperCase()];
  elements.push(new Table({
    width: { size: PAGE_WIDTH, type: WidthType.DXA },
    columnWidths: [1872, 1872, 1872, 1872, 1872],
    borders: stdBorders(),
    rows: [
      new TableRow({
        children: labels.map(l => new TableCell({
          shading: shade(NAVY),
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: l, bold: true, color: WHITE, size: 18 })], spacing: { after: 0 } })],
          margins: { top: 80, bottom: 60, left: 80, right: 80 }
        }))
      }),
      new TableRow({
        children: vals.map((val, i) => new TableCell({
          shading: shade(i % 2 === 0 ? LGRAY : WHITE),
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: val, bold: true, size: 22, color: NAVY })], spacing: { after: 0 } })],
          margins: { top: 80, bottom: 80, left: 80, right: 80 }
        }))
      })
    ]
  }));
  elements.push(spacer(240));
  elements.push(calloutBox(
    verdict + '  —  ' + (v.bestScenario || '—') + '  |  CoC: ' + (v.bestCashOnCash != null ? pct(v.bestCashOnCash, 2) : '—'),
    verdictColor, WHITE, 40
  ));
  return elements;
}

function buildPropertyOverview(deal, enriched) {
  const d = deal || {};
  const attom = (enriched && enriched.attom) || {};
  const rcListing = (enriched && enriched.rcListing) || {};
  const rcProp = (enriched && enriched.rcProperty) || {};
  const county = (enriched && enriched.county) || d.county;

  const elements = [...sectionHeading('Property Overview')];
  const propRows = [
    ['Deal Type', safe(d.dealType)],
    ['Street Address', safe(d.streetAddress)],
    ['City / State / ZIP', [safe(d.city, ''), safe(d.state, ''), safe(d.zip, '')].filter(Boolean).join(', ') || '—'],
    ['County', safe(county)],
    ['Property Type', safe(rcProp.propertyType)],
    ['Bedrooms / Bathrooms', [safe(d.beds, ''), safe(d.baths, '')].filter(Boolean).join(' / ') || '—'],
    ['Living Area', (d.sqft || rcProp.sqft) ? Number(d.sqft || rcProp.sqft).toLocaleString() + ' sqft' : '—'],
    ['Year Built', safe(d.yearBuilt || attom.yearBuilt)],
    ['Lot Size', attom.lotSizeSqft ? Number(attom.lotSizeSqft).toLocaleString() + ' sqft' : (attom.lotSizeAcres ? attom.lotSizeAcres + ' acres' : (rcProp.lotSize ? Number(rcProp.lotSize).toLocaleString() + ' sqft' : '—'))],
    ['APN / Parcel', safe(attom.apn)]
  ];
  elements.push(kvTable(propRows));
  elements.push(spacer());

  if (rcListing && (rcListing.listPrice || rcListing.daysOnMarket || rcListing.status)) {
    elements.push(subHeading('Listing Information'));
    const listRows = [
      ['MLS Status', safe(rcListing.status)],
      ['List Price', money(rcListing.listPrice)],
      ['Listed Date', fmtDate(rcListing.listedDate)],
      ['Days on Market', safe(rcListing.daysOnMarket)],
      ['MLS #', safe(rcListing.mlsNumber)]
    ].filter(r => r[1] !== '—');
    if (listRows.length) {
      elements.push(kvTable(listRows));
      elements.push(spacer());
    }
  }

  elements.push(subHeading('Deal Terms'));
  const termsRows = [
    ['Asking Price', money(d.askingPrice)],
    ['Entry Fee', money(d.entryFee)],
    ['ARV (Estimated)', money(d.arv)],
    ['Est. Monthly Rent', d.estRent ? money(d.estRent) + '/mo' : '—'],
    d.loanBalance ? ['Existing Loan Balance', money(d.loanBalance)] : null,
    d.interestRate ? ['Interest Rate', pct(d.interestRate, 3)] : null,
    d.piti ? ['PITI (est.)', money(d.piti) + '/mo'] : null
  ].filter(Boolean);
  elements.push(kvTable(termsRows));
  return elements;
}

function buildTaxHistory(deal, compute, enriched) {
  const attom = (enriched && enriched.attom) || {};
  const tax = (compute && compute.taxReset) || {};
  const elements = [...sectionHeading('Price & Tax History')];

  const historyRows = [
    ['Last Sale Date', fmtDate(attom.lastSaleDate)],
    ['Last Sale Price', money(attom.lastSalePrice)],
    ['Assessed Value', money(attom.assessedValue)],
    ['Market Value (ATTOM)', money(attom.marketValue)],
    ['Tax Year', safe(attom.taxYear)],
    ['Current Annual Tax (Public Record)', money(attom.taxAmount)]
  ].filter(r => r[1] !== '—');
  if (historyRows.length) {
    elements.push(kvTable(historyRows));
    elements.push(spacer());
  }

  if (tax.currentAnnualTax != null || tax.projectedAnnualTax != null) {
    elements.push(subHeading('Tax Reset Analysis'));
    const taxRows = [
      ['Current Annual Tax', money(tax.currentAnnualTax)],
      ['Projected Annual Tax (Post-Purchase)', money(tax.projectedAnnualTax)],
      ['Annual Tax Increase', money(tax.annualTaxShock)],
      ['Monthly Tax Increase', money(tax.monthlyTaxShock) + '/mo'],
      ['% Increase', pct(tax.pctIncrease, 1)],
      ['Assumed Millage Rate', tax.assumedMillageRate != null ? (Number(tax.assumedMillageRate) * 100).toFixed(3) + '%' : '—'],
      ['Seller Held Homestead?', tax.sellerHadHomestead ? 'Yes — buyer loses exemption on resale' : 'No homestead exemption on record']
    ];
    elements.push(kvTable(taxRows));
    elements.push(spacer(80));
    if (tax.note) {
      elements.push(new Paragraph({
        children: [new TextRun({ text: '⚠ ' + tax.note, italics: true, size: 18, color: DGRAY })],
        spacing: { after: 80 }
      }));
    }
  }
  return elements;
}

function buildComparables(enriched) {
  const rcAvm = (enriched && enriched.rcAvm) || null;
  const rcRent = (enriched && enriched.rcRent) || null;
  const elements = [...sectionHeading('Comparable Sales & Rental Analysis')];

  if (!rcAvm && !rcRent) {
    elements.push(new Paragraph({ children: [new TextRun({ text: 'No comparable data available.', italics: true, color: MGRAY })], spacing: { after: 80 } }));
    return elements;
  }

  if (rcAvm) {
    const rangeStr = (rcAvm.valueRangeLow && rcAvm.valueRangeHigh)
      ? money(rcAvm.valueRangeLow) + ' – ' + money(rcAvm.valueRangeHigh) : '—';
    elements.push(subHeading('AVM Value Estimate'));
    elements.push(kvTable([
      ['AVM Estimated Value', money(rcAvm.value)],
      ['Value Range', rangeStr],
      ['Comparable Count', String((rcAvm.comps || []).length)]
    ]));
    elements.push(spacer(120));

    if (rcAvm.comps && rcAvm.comps.length) {
      elements.push(subHeading('Sale Comparable Properties'));
      const headerRow = new TableRow({
        children: ['Address', 'Sale Price', 'Sq Ft', '$/Sq Ft', 'Distance'].map(h =>
          textCell(h, { bold: true, color: WHITE, fill: NAVY, size: 18, align: AlignmentType.CENTER })
        )
      });
      const compRows = rcAvm.comps.map((c, i) => {
        const fill = i % 2 === 0 ? LGRAY : WHITE;
        const ppsf = c.sqft && c.price ? money(Math.round(Number(c.price) / Number(c.sqft))) : '—';
        return new TableRow({
          children: [
            textCell(c.address || '—', { fill, size: 18, width: 40 }),
            textCell(money(c.price), { fill, size: 18, align: AlignmentType.RIGHT }),
            textCell(c.sqft ? Number(c.sqft).toLocaleString() : '—', { fill, size: 18, align: AlignmentType.RIGHT }),
            textCell(ppsf, { fill, size: 18, align: AlignmentType.RIGHT }),
            textCell(c.distance != null ? Number(c.distance).toFixed(2) + ' mi' : '—', { fill, size: 18, align: AlignmentType.RIGHT })
          ]
        });
      });
      elements.push(new Table({ width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: [3744, 1404, 1404, 1404, 1404], borders: stdBorders(), rows: [headerRow, ...compRows] }));
      elements.push(spacer());
    }
  }

  if (rcRent) {
    const rr = (rcRent.rentRangeLow && rcRent.rentRangeHigh)
      ? money(rcRent.rentRangeLow) + ' – ' + money(rcRent.rentRangeHigh) + '/mo' : '—';
    elements.push(subHeading('Rental Market Analysis'));
    elements.push(kvTable([
      ['AVM Estimated Rent', rcRent.rent ? money(rcRent.rent) + '/mo' : '—'],
      ['Rent Range', rr],
      ['Comparable Count', String((rcRent.comps || []).length)]
    ]));
    elements.push(spacer(120));

    if (rcRent.comps && rcRent.comps.length) {
      elements.push(subHeading('Rental Comparable Properties'));
      const headerRow = new TableRow({
        children: ['Address', 'Monthly Rent', 'Distance'].map(h =>
          textCell(h, { bold: true, color: WHITE, fill: NAVY, size: 18, align: AlignmentType.CENTER })
        )
      });
      const rentCompRows = rcRent.comps.map((c, i) => {
        const fill = i % 2 === 0 ? LGRAY : WHITE;
        return new TableRow({
          children: [
            textCell(c.address || '—', { fill, size: 18, width: 55 }),
            textCell(c.rent ? money(c.rent) + '/mo' : '—', { fill, size: 18, align: AlignmentType.RIGHT }),
            textCell(c.distance != null ? Number(c.distance).toFixed(2) + ' mi' : '—', { fill, size: 18, align: AlignmentType.RIGHT })
          ]
        });
      });
      elements.push(new Table({ width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: [5148, 2106, 2106], borders: stdBorders(), rows: [headerRow, ...rentCompRows] }));
      elements.push(spacer());
    }
  }
  return elements;
}
function buildFloodRisk(compute, enriched) {
  const flood = (compute && compute.floodRisk) || {};
  const femaFlood = (enriched && enriched.femaFlood) || {};
  const disasters = (enriched && enriched.femaDisasters) || [];
  const hud = (enriched && enriched.hud) || {};

  const elements = [...sectionHeading('Flood & Risk Assessment')];
  const tierLabels = {
    high: 'HIGH — V-Zone (Coastal Velocity)',
    elevated: 'ELEVATED — Special Flood Hazard Area (SFHA)',
    low: 'LOW — Outside 100-Year Floodplain',
    unknown: 'UNKNOWN — Verify via FEMA MSC'
  };
  const tierColors = { high: RED, elevated: ORANGE, low: GREEN, unknown: MGRAY };

  elements.push(subHeading('Flood Zone'));
  const floodRows = [
    ['FEMA Flood Zone', safe(femaFlood.zone)],
    ['Risk Tier', String(flood.tier || 'unknown').toUpperCase()],
    ['Special Flood Hazard Area?', flood.sfha ? 'YES — Flood insurance typically required' : 'No'],
    ['Source', safe(femaFlood.source)]
  ];
  elements.push(kvTable(floodRows));
  elements.push(spacer(80));

  const tier = flood.tier || 'unknown';
  const color = tierColors[tier] || MGRAY;
  elements.push(calloutBox(tierLabels[tier] || String(tier).toUpperCase(), color, WHITE, 22));
  elements.push(spacer());

  if (hud && (hud.ltr || hud.metro)) {
    elements.push(subHeading('HUD Fair Market Rents — ' + safe(hud.metro, 'Metro Area')));
    const hudRows = [
      ['HUD FMR (Market)', hud.ltr ? money(hud.ltr) + '/mo' : '—'],
      ['HUD Range', (hud.ltrLow && hud.ltrHigh) ? money(hud.ltrLow) + ' – ' + money(hud.ltrHigh) + '/mo' : '—'],
      ['Market Tier', safe(hud.marketTier)]
    ].filter(r => r[1] !== '—');
    if (hudRows.length) {
      elements.push(kvTable(hudRows));
      elements.push(spacer());
    }
  }

  elements.push(subHeading('Federal Disaster Declarations (Past 5 Years — County)'));
  if (!disasters.length) {
    elements.push(new Paragraph({
      children: [new TextRun({ text: 'No qualifying FEMA disaster declarations found for this county in the past 5 years.', color: DGRAY, size: 18, italics: true })],
      spacing: { after: 80 }
    }));
  } else {
    const headerRow = new TableRow({
      children: ['#', 'Title', 'Type', 'Date', 'Area'].map(h =>
        textCell(h, { bold: true, color: WHITE, fill: NAVY, size: 18 })
      )
    });
    const disRows = disasters.map((dis, i) => {
      const fill = i % 2 === 0 ? LGRAY : WHITE;
      return new TableRow({
        children: [
          textCell(safe(dis.disasterNumber), { fill, size: 18 }),
          textCell(safe(dis.title), { fill, size: 18 }),
          textCell(safe(dis.incidentType), { fill, size: 18 }),
          textCell(fmtDate(dis.declarationDate), { fill, size: 18 }),
          textCell(safe(dis.area), { fill, size: 18 })
        ]
      });
    });
    elements.push(new Table({ width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: [936, 2808, 1404, 1872, 2340], borders: stdBorders(), rows: [headerRow, ...disRows] }));
  }
  return elements;
}

function buildRehabBudget(compute) {
  const rehab = (compute && compute.rehab) || {};
  const elements = [...sectionHeading('Rehab Budget Estimates')];

  if (!rehab.light && !rehab.moderate && !rehab.substantial) {
    elements.push(new Paragraph({ children: [new TextRun({ text: 'No rehab budget data available.', italics: true, color: MGRAY })], spacing: { after: 80 } }));
    return elements;
  }

  const tiers = [
    { key: 'light', label: 'Light Rehab — Cosmetic / Move-In Ready', color: GREEN },
    { key: 'moderate', label: 'Moderate Rehab — Light + Kitchen / Bath Refresh', color: ORANGE },
    { key: 'substantial', label: 'Substantial Rehab — Full Renovation', color: RED }
  ];

  for (const { key, label, color } of tiers) {
    const tier = rehab[key];
    if (!tier) continue;
    elements.push(subHeading(label));

    const items = Array.isArray(tier.items) ? tier.items : [];
    const rows = [
      new TableRow({
        children: [
          textCell('Line Item', { bold: true, color: WHITE, fill: color, size: 18, width: 70 }),
          textCell('Cost', { bold: true, color: WHITE, fill: color, size: 18, align: AlignmentType.RIGHT, width: 30 })
        ]
      }),
      ...items.map((item, i) => {
        const fill = i % 2 === 0 ? LGRAY : WHITE;
        return new TableRow({
          children: [
            textCell(safe(item.name), { fill, size: 18, width: 70 }),
            textCell(money(item.cost), { fill, size: 18, align: AlignmentType.RIGHT, width: 30 })
          ]
        });
      }),
      new TableRow({
        children: [
          textCell('TOTAL', { bold: true, color: NAVY, fill: LBLUE, size: 20, width: 70 }),
          textCell(money(tier.total), { bold: true, color: NAVY, fill: LBLUE, size: 20, align: AlignmentType.RIGHT, width: 30 })
        ]
      })
    ];
    elements.push(new Table({ width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: [6552, 2808], borders: stdBorders(), rows }));

    if (tier.description) {
      elements.push(new Paragraph({
        children: [new TextRun({ text: tier.description, italics: true, size: 18, color: DGRAY })],
        spacing: { before: 80, after: 120 }
      }));
    }
    elements.push(spacer(80));
  }
  return elements;
}
function buildReturns(compute) {
  const scenarios = (compute && compute.scenarios) || [];
  const assumptions = (compute && compute.assumptions) || {};
  const elements = [...sectionHeading('4-Scenario Investment Analysis')];

  if (!scenarios.length) {
    elements.push(new Paragraph({ children: [new TextRun({ text: 'No scenario data available.', italics: true, color: MGRAY })], spacing: { after: 80 } }));
    return elements;
  }

  elements.push(subHeading('Underwriting Assumptions'));
  const assumptionPairs = [
    ['Mortgage Rate', assumptions.mortgageRate != null ? (Number(assumptions.mortgageRate) * 100).toFixed(2) + '%' : '—'],
    ['Loan Term', assumptions.loanTermYears ? assumptions.loanTermYears + ' years' : '—'],
    ['Down Payment', assumptions.downPaymentPct != null ? (Number(assumptions.downPaymentPct) * 100).toFixed(0) + '%' : '—'],
    ['Closing Costs', assumptions.closingCostsPct != null ? (Number(assumptions.closingCostsPct) * 100).toFixed(1) + '%' : '—'],
    ['Vacancy Rate', assumptions.vacancyPct != null ? (Number(assumptions.vacancyPct) * 100).toFixed(0) + '%' : '—'],
    ['Management Fee', assumptions.mgmtPct != null ? (Number(assumptions.mgmtPct) * 100).toFixed(0) + '%' : '—'],
    ['Maintenance Reserve', assumptions.maintenancePct != null ? (Number(assumptions.maintenancePct) * 100).toFixed(0) + '%' : '—'],
    ['Annual Insurance', money(assumptions.annualInsurance)]
  ];
  elements.push(kvTable(assumptionPairs));
  elements.push(spacer());

  elements.push(subHeading('Scenario Comparison'));

  const metrics = [
    ['Purchase Price',       s => money(s.purchasePrice)],
    ['Rehab Budget',         s => money(s.rehabCost)],
    ['Total Cost-In',        s => money(s.totalCostIn)],
    ['ARV',                  s => money(s.arv)],
    ['Spread ($)',           s => money(s.spreadDollars)],
    ['Spread (%)',           s => pct(s.spreadPct, 1)],
    ['__DIVIDER__',          null],
    ['Monthly Rent',         s => money(s.monthlyRent) + '/mo'],
    ['P & I (financed)',     s => money(s.monthlyPI) + '/mo'],
    ['Monthly Tax',          s => money(s.monthlyTax) + '/mo'],
    ['Monthly Insurance',    s => money(s.monthlyInsurance) + '/mo'],
    ['Total Monthly Opex',   s => money(s.monthlyOpex) + '/mo'],
    ['Monthly Cash Flow',    s => money(s.monthlyCashFlow) + '/mo'],
    ['Annual Cash Flow',     s => money(s.annualCashFlow)],
    ['__DIVIDER__',          null],
    ['Cap Rate',             s => pct(s.capRate, 2)],
    ['Cash Required',        s => money(s.cashRequired)],
    ['Cash-on-Cash Return',  s => pct(s.cashOnCash, 2)]
  ];

  const colCount = scenarios.length + 1;

  const headerRow = new TableRow({
    children: [
      textCell('Metric', { bold: true, color: WHITE, fill: NAVY, size: 18 }),
      ...scenarios.map(s => textCell(s.label, { bold: true, color: WHITE, fill: NAVY, size: 16, align: AlignmentType.CENTER }))
    ]
  });

  const bodyRows = metrics.map(([metric, getter], rowIdx) => {
    if (metric === '__DIVIDER__') {
      return new TableRow({
        children: Array.from({ length: colCount }, () => new TableCell({
          shading: shade(MGRAY),
          children: [new Paragraph({ children: [], spacing: { after: 0 } })],
          margins: { top: 20, bottom: 20 }
        }))
      });
    }
    const isHL = metric === 'Cash-on-Cash Return' || metric === 'Monthly Cash Flow';
    const fill = rowIdx % 2 === 0 ? LGRAY : WHITE;
    const labelCell = textCell(metric, { fill, bold: isHL, color: NAVY, size: 18 });
    const valueCells = scenarios.map(s => {
      const val = getter(s);
      let color = '000000';
      if (isHL) {
        const n = parseFloat(String(val).replace(/[^\-\d.]/g, ''));
        color = n > 0 ? GREEN : (n < 0 ? RED : '000000');
      }
      return textCell(val, { fill, bold: isHL, size: 18, align: AlignmentType.RIGHT, color });
    });
    return new TableRow({ children: [labelCell, ...valueCells] });
  });

  const metricColW = Math.round(PAGE_WIDTH * 0.32);
  const scenColW = Math.round((PAGE_WIDTH - metricColW) / (scenarios.length || 1));
  elements.push(new Table({ width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: [metricColW, ...Array(scenarios.length).fill(scenColW)], borders: stdBorders(), rows: [headerRow, ...bodyRows] }));
  return elements;
}

function buildVerdict(compute, deal) {
  const v = (compute && compute.verdict) || {};
  const verdict = v.verdict || 'PASS';
  const elements = [...sectionHeading('Investment Verdict')];

  const verdictColor = verdict === 'PASS+' ? GREEN : verdict === 'PROCEED' ? ORANGE : RED;
  const verdictDesc = {
    'PASS+': 'Strong Deal — Move Fast',
    'PROCEED': 'Workable — Negotiate to Improve',
    'PASS': "Skip — Numbers Don't Work at This Price"
  };

  elements.push(calloutBox(verdict + '  —  ' + (verdictDesc[verdict] || ''), verdictColor, WHITE, 40));
  elements.push(spacer(120));

  if (v.bestScenario) {
    elements.push(kvTable([
      ['Best Scenario', safe(v.bestScenario)],
      ['Best Cash-on-Cash', pct(v.bestCashOnCash, 2)],
      ['Max Spread over Cost-In', pct(v.maxSpreadPct, 1)]
    ]));
    elements.push(spacer());
  }

  if (v.reasons && v.reasons.length) {
    elements.push(subHeading('Why This Works'));
    const reasonRows = v.reasons.map((r, i) => {
      const fill = i % 2 === 0 ? LGRAY : WHITE;
      return new TableRow({
        children: [
          textCell('✓', { fill, bold: true, color: GREEN, size: 20, width: 5, align: AlignmentType.CENTER }),
          textCell(r, { fill, size: 18, width: 95 })
        ]
      });
    });
    elements.push(new Table({ width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: [468, 8892], borders: stdBorders(), rows: reasonRows }));
    elements.push(spacer());
  }

  if (v.redFlags && v.redFlags.length) {
    elements.push(subHeading('Red Flags / Concerns'));
    const flagRows = v.redFlags.map((f, i) => {
      const fill = i % 2 === 0 ? SOFT_Y : SOFT_Y2;
      return new TableRow({
        children: [
          textCell('⚠', { fill, bold: true, color: ORANGE, size: 20, width: 5, align: AlignmentType.CENTER }),
          textCell(f, { fill, size: 18, width: 95 })
        ]
      });
    });
    elements.push(new Table({ width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: [468, 8892], borders: stdBorders(), rows: flagRows }));
    elements.push(spacer());
  }

  const d = deal || {};
  if (d.hook || d.whyExists || d.strategies || d.buyerFitYes) {
    elements.push(subHeading('Deal Narrative'));
    if (d.hook) {
      elements.push(new Paragraph({ children: [new TextRun({ text: safe(d.hook), italics: true, size: 20 })], spacing: { after: 120 } }));
    }
    if (d.whyExists) {
      elements.push(new Paragraph({
        children: [new TextRun({ text: 'Why It Exists: ', bold: true, size: 18 }), new TextRun({ text: safe(d.whyExists), size: 18 })],
        spacing: { after: 80 }
      }));
    }
    if (d.strategies) {
      elements.push(new Paragraph({ children: [new TextRun({ text: 'Strategies:', bold: true, size: 18 })], spacing: { after: 40 } }));
      for (const line of String(d.strategies).split('\n').map(s => s.trim()).filter(Boolean)) {
        elements.push(new Paragraph({
          children: [new TextRun({ text: '• ' + line.replace(/^[•\-]\s*/, ''), size: 18 })],
          indent: { left: 240 },
          spacing: { after: 40 }
        }));
      }
    }
    if (d.buyerFitYes) {
      elements.push(new Paragraph({
        children: [new TextRun({ text: 'Ideal Buyer: ', bold: true, size: 18 }), new TextRun({ text: safe(d.buyerFitYes), size: 18 })],
        spacing: { before: 80, after: 80 }
      }));
    }
  }

  elements.push(spacer(200));
  elements.push(new Paragraph({
    children: [new TextRun({
      text: 'DISCLAIMER: This report is prepared for informational purposes only. All projections are estimates based on third-party data and are not guarantees of future performance. Verify all data independently before making investment decisions. Terms for Sale makes no representations or warranties of any kind.',
      size: 16, color: MGRAY, italics: true
    })],
    spacing: { after: 80 }
  }));

  return elements;
}

// ---------- Main export ----------
async function generateDealDoc({ dealId, deal, compute, enriched }) {
  const d = deal || {};
  const displayId = dealId || d.dealId || d.dealCode || `deal-${Date.now()}`;
  const title = `${displayId} — Investment Analysis Report — Terms for Sale`;

  const footer = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `Prepared for Terms for Sale  |  termsforsale.com  |  ${nowMonthYear()}  |  Page `, size: 16, color: MGRAY }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MGRAY }),
        new TextRun({ text: ' of ', size: 16, color: MGRAY }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MGRAY })
      ],
      spacing: { after: 0 }
    })]
  });

  const children = [
    ...buildCover(d, compute),
    ...buildPropertyOverview(d, enriched),
    ...buildTaxHistory(d, compute, enriched),
    ...buildComparables(enriched),
    ...buildFloodRisk(compute, enriched),
    ...buildRehabBudget(compute),
    ...buildReturns(compute),
    ...buildVerdict(compute, d)
  ];

  const doc = new Document({
    creator: 'Terms for Sale',
    title,
    description: `Investment analysis report for ${displayId}`,
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      footers: { default: footer },
      children
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `${slug(displayId) || 'deal'}-${Date.now()}.docx`;
  return { buffer, filename };
}

module.exports = { generateDealDoc };
