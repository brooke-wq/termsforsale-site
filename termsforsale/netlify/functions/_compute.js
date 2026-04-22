// Underwriting compute layer for auto-enrich. Pure math, no API calls.
// Consumes enriched deal data + rehab totals (produced by Claude in auto-enrich.js)
// and produces: tax-reset projection, 4-scenario returns, PASS/PROCEED verdict.

const DEFAULT_MORTGAGE_RATE = 0.0725;
const DEFAULT_LOAN_TERM_YEARS = 30;
const DEFAULT_DOWN_PAYMENT_PCT = 0.20;
const DEFAULT_CLOSING_COSTS_PCT = 0.03;
const DEFAULT_VACANCY_PCT = 0.08;
const DEFAULT_MGMT_PCT = 0.10;
const DEFAULT_MAINTENANCE_PCT = 0.08;
const DEFAULT_INSURANCE_ANNUAL = 1800;

// Monthly mortgage payment (principal + interest only)
function pmt(principal, annualRate, years) {
  if (!principal || principal <= 0) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// Tax-reset math. Buyers typically lose the seller's homestead exemption on
// resale and get reassessed to purchase price → tax hike next assessment cycle.
// For Texas: millage ~2.4% of value; homestead caps appraisal growth at 10%/yr
// plus $100k school-tax exemption.
function computeTaxReset({ marketValue, millageRate, currentTaxAmount, hasHomestead, purchasePrice, state }) {
  const px = Number(purchasePrice) || Number(marketValue) || 0;
  let mill = Number(millageRate);
  if (!mill || mill <= 0) {
    // Fall back: derive implied rate from currentTaxAmount / marketValue
    if (currentTaxAmount && marketValue) mill = Number(currentTaxAmount) / Number(marketValue);
    else mill = state === 'TX' ? 0.024 : 0.012;
  }
  // Millage rates are sometimes stored as the dollars-per-$1000 rate or as a decimal.
  // Normalize: anything > 1 we treat as per-$1000 and divide.
  if (mill > 1) mill = mill / 1000;

  const currentTax = Number(currentTaxAmount) || Math.round((Number(marketValue) || px) * mill);
  // Post-purchase reassessed tax, assuming new owner loses homestead
  const reassessedTax = Math.round(px * mill);
  const taxShock = Math.max(0, reassessedTax - currentTax);
  const pctIncrease = currentTax > 0 ? (taxShock / currentTax) : 0;

  return {
    assumedMillageRate: Number(mill.toFixed(5)),
    currentAnnualTax: Math.round(currentTax),
    projectedAnnualTax: reassessedTax,
    annualTaxShock: taxShock,
    monthlyTaxShock: Math.round(taxShock / 12),
    pctIncrease: Number((pctIncrease * 100).toFixed(1)),
    sellerHadHomestead: !!hasHomestead,
    note: hasHomestead
      ? 'Seller held homestead exemption — buyer loses it on resale. Tax will step up at next assessment.'
      : 'No homestead exemption on record — smaller post-purchase jump expected.'
  };
}

// One scenario row for the returns table. All money in dollars.
function computeOneScenario({ label, purchasePrice, rehabCost, arv, monthlyRent, annualTax, annualInsurance, isAllCash, rate, years, downPct, closingPct, vacancyPct, mgmtPct, maintPct }) {
  const pp = Number(purchasePrice) || 0;
  const rehab = Number(rehabCost) || 0;
  const arvN = Number(arv) || pp;
  const rent = Number(monthlyRent) || 0;
  const tax = Number(annualTax) || 0;
  const ins = Number(annualInsurance) || DEFAULT_INSURANCE_ANNUAL;

  const totalCostIn = pp + rehab;
  const spreadDollars = arvN - totalCostIn;
  const spreadPct = totalCostIn > 0 ? (spreadDollars / totalCostIn) * 100 : 0;

  let monthlyPI = 0;
  let cashRequired = 0;
  if (isAllCash) {
    cashRequired = pp + rehab + (pp * closingPct);
  } else {
    const downPayment = pp * downPct;
    const closing = pp * closingPct;
    const loanAmount = pp - downPayment;
    monthlyPI = pmt(loanAmount, rate, years);
    cashRequired = downPayment + rehab + closing;
  }

  const monthlyTax = tax / 12;
  const monthlyIns = ins / 12;
  const monthlyVacancy = rent * vacancyPct;
  const monthlyMgmt = rent * mgmtPct;
  const monthlyMaint = rent * maintPct;
  const monthlyOpex = monthlyTax + monthlyIns + monthlyVacancy + monthlyMgmt + monthlyMaint;

  const monthlyNoi = rent - monthlyOpex;
  const annualNoi = monthlyNoi * 12;
  const capRate = arvN > 0 ? (annualNoi / arvN) * 100 : 0;

  const monthlyCashFlow = monthlyNoi - monthlyPI;
  const annualCashFlow = monthlyCashFlow * 12;
  const cashOnCash = cashRequired > 0 ? (annualCashFlow / cashRequired) * 100 : 0;

  return {
    label,
    purchasePrice: Math.round(pp),
    rehabCost: Math.round(rehab),
    totalCostIn: Math.round(totalCostIn),
    arv: Math.round(arvN),
    spreadDollars: Math.round(spreadDollars),
    spreadPct: Number(spreadPct.toFixed(1)),
    monthlyRent: Math.round(rent),
    monthlyPI: Math.round(monthlyPI),
    monthlyTax: Math.round(monthlyTax),
    monthlyInsurance: Math.round(monthlyIns),
    monthlyOpex: Math.round(monthlyOpex),
    monthlyCashFlow: Math.round(monthlyCashFlow),
    annualCashFlow: Math.round(annualCashFlow),
    capRate: Number(capRate.toFixed(2)),
    cashRequired: Math.round(cashRequired),
    cashOnCash: Number(cashOnCash.toFixed(2))
  };
}

function computeReturns({ purchasePrice, rehab, arv, monthlyRent, annualTax, annualInsurance, overrides }) {
  const opts = overrides || {};
  const rate = opts.rate || DEFAULT_MORTGAGE_RATE;
  const years = opts.years || DEFAULT_LOAN_TERM_YEARS;
  const downPct = opts.downPct || DEFAULT_DOWN_PAYMENT_PCT;
  const closingPct = opts.closingPct || DEFAULT_CLOSING_COSTS_PCT;
  const vacancyPct = opts.vacancyPct || DEFAULT_VACANCY_PCT;
  const mgmtPct = opts.mgmtPct || DEFAULT_MGMT_PCT;
  const maintPct = opts.maintPct || DEFAULT_MAINTENANCE_PCT;

  const rehabLight = (rehab && rehab.light && rehab.light.total) || 0;
  const rehabModerate = (rehab && rehab.moderate && rehab.moderate.total) || 0;
  const negotiatedPx = Math.round(Number(purchasePrice) * 0.90); // 10% off asking

  const common = { arv, monthlyRent, annualTax, annualInsurance, rate, years, downPct, closingPct, vacancyPct, mgmtPct, maintPct };

  return [
    computeOneScenario({ label: 'Light Rehab (Financed)', purchasePrice, rehabCost: rehabLight, isAllCash: false, ...common }),
    computeOneScenario({ label: 'Moderate Rehab (Financed)', purchasePrice, rehabCost: rehabModerate, isAllCash: false, ...common }),
    computeOneScenario({ label: 'Negotiated (-10%, Moderate)', purchasePrice: negotiatedPx, rehabCost: rehabModerate, isAllCash: false, ...common }),
    computeOneScenario({ label: 'All-Cash (Moderate)', purchasePrice, rehabCost: rehabModerate, isAllCash: true, ...common })
  ];
}

// Normalize deal type strings to one of: 'subto', 'sf', 'hybrid', 'cash', 'other'.
// Matches the loose strings seen in Notion: "Subject To", "SubTo", "Seller Finance",
// "SF", "Hybrid", "Morby Method", "Cash", "Wrap", "Lease Option", etc.
function normalizeDealType(raw) {
  if (!raw) return 'other';
  const s = String(raw).toLowerCase().replace(/[^a-z ]/g, '').trim();
  if (/(subject to|sub to|subto)/.test(s)) return 'subto';
  if (/(seller finance|seller financed|sf|owner finance|owner financed)/.test(s)) return 'sf';
  if (/(hybrid|morby|stack|wrap)/.test(s)) return 'hybrid';
  if (/cash/.test(s)) return 'cash';
  return 'other';
}

// Scenario helper for SubTo (buyer takes over existing loan, pays entry fee).
// Uses deal.piti if provided (total monthly housing payment). Otherwise computes
// P+I from loanBalance and interestRate, then adds tax + insurance separately.
function computeSubToScenario({ label, entryFee, rehabCost, loanBalance, interestRate, dealPiti, arv, monthlyRent, annualTax, annualInsurance, closingPct, vacancyPct, mgmtPct, maintPct, purchasePrice }) {
  const entry = Number(entryFee) || 0;
  const rehab = Number(rehabCost) || 0;
  const arvN = Number(arv) || Number(purchasePrice) || 0;
  const rent = Number(monthlyRent) || 0;
  const ins = Number(annualInsurance) || DEFAULT_INSURANCE_ANNUAL;
  const totalCostIn = entry + rehab;
  const spreadDollars = arvN - (Number(purchasePrice) || arvN) - rehab;
  const spreadPct = (Number(purchasePrice) || arvN) > 0 ? (spreadDollars / (Number(purchasePrice) + rehab)) * 100 : 0;

  // Monthly PITI resolution: prefer deal.piti (includes tax+ins), else compute PI from loan balance
  let monthlyPI = 0;
  let monthlyTax = (Number(annualTax) || 0) / 12;
  let monthlyIns = ins / 12;
  let pitiNote;
  if (dealPiti && Number(dealPiti) > 0) {
    // deal.piti is total monthly housing (PI+T+I). Zero out separate tax/ins to avoid double-counting.
    monthlyPI = Number(dealPiti);
    monthlyTax = 0;
    monthlyIns = 0;
    pitiNote = 'PITI (inherited, from Notion)';
  } else if (loanBalance && interestRate) {
    const rate = Number(interestRate) > 1 ? Number(interestRate) / 100 : Number(interestRate); // accept 7.25 or 0.0725
    monthlyPI = pmt(Number(loanBalance), rate, DEFAULT_LOAN_TERM_YEARS);
    pitiNote = 'P+I from assumed loan balance × rate';
  } else {
    // Fallback: estimate with market SubTo rate on 80% of asking
    const assumedLoan = Math.round((Number(purchasePrice) || arvN) * 0.80);
    monthlyPI = pmt(assumedLoan, 0.055, DEFAULT_LOAN_TERM_YEARS);
    pitiNote = 'PITI estimated (loan terms not provided — verify before close)';
  }

  const monthlyVacancy = rent * vacancyPct;
  const monthlyMgmt = rent * mgmtPct;
  const monthlyMaint = rent * maintPct;
  const monthlyOpex = monthlyTax + monthlyIns + monthlyVacancy + monthlyMgmt + monthlyMaint;
  const monthlyNoi = rent - monthlyOpex;
  const annualNoi = monthlyNoi * 12;
  const capRate = arvN > 0 ? (annualNoi / arvN) * 100 : 0;
  const monthlyCashFlow = monthlyNoi - monthlyPI;
  const annualCashFlow = monthlyCashFlow * 12;
  const closing = (Number(purchasePrice) || 0) * (closingPct || DEFAULT_CLOSING_COSTS_PCT) * 0.30; // SubTo closing costs are much lower (~30% of conventional)
  const cashRequired = entry + rehab + closing;
  const cashOnCash = cashRequired > 0 ? (annualCashFlow / cashRequired) * 100 : 0;

  return {
    label,
    purchasePrice: Math.round(Number(purchasePrice) || 0),
    entryFee: Math.round(entry),
    rehabCost: Math.round(rehab),
    totalCostIn: Math.round(totalCostIn),
    arv: Math.round(arvN),
    spreadDollars: Math.round(spreadDollars),
    spreadPct: Number(spreadPct.toFixed(1)),
    monthlyRent: Math.round(rent),
    monthlyPI: Math.round(monthlyPI),
    monthlyTax: Math.round(monthlyTax),
    monthlyInsurance: Math.round(monthlyIns),
    monthlyOpex: Math.round(monthlyOpex),
    monthlyCashFlow: Math.round(monthlyCashFlow),
    annualCashFlow: Math.round(annualCashFlow),
    capRate: Number(capRate.toFixed(2)),
    cashRequired: Math.round(cashRequired),
    cashOnCash: Number(cashOnCash.toFixed(2)),
    pitiNote
  };
}

// Scenario helper for Seller Finance (seller carries the note).
function computeSfScenario({ label, purchasePrice, entryFee, rehabCost, interestRate, arv, monthlyRent, annualTax, annualInsurance, closingPct, vacancyPct, mgmtPct, maintPct, sfYears }) {
  const pp = Number(purchasePrice) || 0;
  const down = Number(entryFee) || Math.round(pp * 0.10); // default 10% down if no entry fee given
  const rehab = Number(rehabCost) || 0;
  const arvN = Number(arv) || pp;
  const rent = Number(monthlyRent) || 0;
  const tax = Number(annualTax) || 0;
  const ins = Number(annualInsurance) || DEFAULT_INSURANCE_ANNUAL;
  const loanAmount = pp - down;
  const rate = interestRate ? (Number(interestRate) > 1 ? Number(interestRate) / 100 : Number(interestRate)) : 0.065;
  const years = sfYears || DEFAULT_LOAN_TERM_YEARS;
  const monthlyPI = pmt(loanAmount, rate, years);
  const monthlyTax = tax / 12;
  const monthlyIns = ins / 12;
  const monthlyVacancy = rent * vacancyPct;
  const monthlyMgmt = rent * mgmtPct;
  const monthlyMaint = rent * maintPct;
  const monthlyOpex = monthlyTax + monthlyIns + monthlyVacancy + monthlyMgmt + monthlyMaint;
  const monthlyNoi = rent - monthlyOpex;
  const annualNoi = monthlyNoi * 12;
  const capRate = arvN > 0 ? (annualNoi / arvN) * 100 : 0;
  const monthlyCashFlow = monthlyNoi - monthlyPI;
  const annualCashFlow = monthlyCashFlow * 12;
  const closing = pp * (closingPct || DEFAULT_CLOSING_COSTS_PCT) * 0.50; // SF closing typically 50% of conventional
  const cashRequired = down + rehab + closing;
  const cashOnCash = cashRequired > 0 ? (annualCashFlow / cashRequired) * 100 : 0;
  const totalCostIn = pp + rehab;
  const spreadDollars = arvN - totalCostIn;
  const spreadPct = totalCostIn > 0 ? (spreadDollars / totalCostIn) * 100 : 0;

  return {
    label,
    purchasePrice: Math.round(pp),
    entryFee: Math.round(down),
    rehabCost: Math.round(rehab),
    totalCostIn: Math.round(totalCostIn),
    arv: Math.round(arvN),
    spreadDollars: Math.round(spreadDollars),
    spreadPct: Number(spreadPct.toFixed(1)),
    monthlyRent: Math.round(rent),
    monthlyPI: Math.round(monthlyPI),
    monthlyTax: Math.round(monthlyTax),
    monthlyInsurance: Math.round(monthlyIns),
    monthlyOpex: Math.round(monthlyOpex),
    monthlyCashFlow: Math.round(monthlyCashFlow),
    annualCashFlow: Math.round(annualCashFlow),
    capRate: Number(capRate.toFixed(2)),
    cashRequired: Math.round(cashRequired),
    cashOnCash: Number(cashOnCash.toFixed(2))
  };
}

// Build scenarios appropriate to the deal type.
function buildScenariosByDealType({ dealType, purchasePrice, entryFee, loanBalance, interestRate, dealPiti, rehab, arv, monthlyRent, annualTax, annualInsurance }) {
  const type = normalizeDealType(dealType);
  const common = { arv, monthlyRent, annualTax, annualInsurance,
    closingPct: DEFAULT_CLOSING_COSTS_PCT, vacancyPct: DEFAULT_VACANCY_PCT,
    mgmtPct: DEFAULT_MGMT_PCT, maintPct: DEFAULT_MAINTENANCE_PCT };
  const rehabLight = (rehab && rehab.light && rehab.light.total) || 0;
  const rehabMod = (rehab && rehab.moderate && rehab.moderate.total) || 0;
  const rehabSub = (rehab && rehab.substantial && rehab.substantial.total) || 0;

  if (type === 'subto') {
    const base = { entryFee, loanBalance, interestRate, dealPiti, purchasePrice, ...common };
    const entryN = Number(entryFee) || 0;
    const negEntry = Math.round(entryN * 0.5);
    return [
      computeSubToScenario({ label: 'SubTo + Light Rehab', rehabCost: rehabLight, ...base }),
      computeSubToScenario({ label: 'SubTo + Moderate Rehab', rehabCost: rehabMod, ...base }),
      computeSubToScenario({ label: 'SubTo + Substantial Rehab', rehabCost: rehabSub, ...base }),
      computeSubToScenario({ label: 'Negotiated Entry (-50%, Moderate)', rehabCost: rehabMod, ...base, entryFee: negEntry })
    ];
  }

  if (type === 'sf') {
    const base = { purchasePrice, entryFee, interestRate, ...common };
    return [
      computeSfScenario({ label: 'Seller Finance + Light Rehab', rehabCost: rehabLight, ...base }),
      computeSfScenario({ label: 'Seller Finance + Moderate Rehab', rehabCost: rehabMod, ...base }),
      computeSfScenario({ label: 'Seller Finance + Substantial Rehab', rehabCost: rehabSub, ...base }),
      computeSfScenario({ label: 'Negotiated Rate (-1%, Moderate)', rehabCost: rehabMod, ...base, interestRate: (Number(interestRate) > 1 ? Number(interestRate) - 1 : Number(interestRate) - 0.01) })
    ];
  }

  if (type === 'cash') {
    const base = { purchasePrice, ...common, rate: DEFAULT_MORTGAGE_RATE, years: DEFAULT_LOAN_TERM_YEARS, downPct: DEFAULT_DOWN_PAYMENT_PCT };
    return [
      computeOneScenario({ label: 'All-Cash + Light Rehab', rehabCost: rehabLight, isAllCash: true, ...base }),
      computeOneScenario({ label: 'All-Cash + Moderate Rehab', rehabCost: rehabMod, isAllCash: true, ...base }),
      computeOneScenario({ label: 'All-Cash + Substantial Rehab', rehabCost: rehabSub, isAllCash: true, ...base }),
      computeOneScenario({ label: 'Conventional Financed (Moderate)', rehabCost: rehabMod, isAllCash: false, ...base })
    ];
  }

  // Fallback — hybrid/morby/wrap/unknown: use conventional financing assumption
  return computeReturns({ purchasePrice, rehab, arv, monthlyRent, annualTax, annualInsurance });
}

// Flood-zone severity classifier. FEMA zones that start with A* or V* are Special Flood Hazard Areas.
function classifyFloodRisk(zone) {
  if (!zone) return { tier: 'unknown', sfha: false };
  const z = String(zone).toUpperCase();
  if (/^VE?\b/.test(z)) return { tier: 'high', sfha: true, note: 'Coastal V-zone — velocity hazard' };
  if (/^AE?\b/.test(z) || /^AH\b/.test(z) || /^AO\b/.test(z) || /^AR\b/.test(z) || /^A99\b/.test(z)) {
    return { tier: 'elevated', sfha: true, note: 'SFHA — flood insurance typically required for mortgage' };
  }
  if (z === 'X' || z.startsWith('X')) return { tier: 'low', sfha: false, note: 'Outside 100-year floodplain' };
  if (z === 'D') return { tier: 'unknown', sfha: false, note: 'Flood hazard undetermined' };
  return { tier: 'unknown', sfha: false };
}

// Deterministic verdict from computed metrics.
// PASS+ : strong deal, move fast
// PROCEED: workable, negotiate to improve
// PASS  : skip
function computeVerdict({ scenarios, taxReset, floodRisk, disasters }) {
  const reasons = [];
  const redFlags = [];

  const best = scenarios.reduce((a, b) => (b.cashOnCash > a.cashOnCash ? b : a), scenarios[0] || {});
  const spread = Math.max(...scenarios.map(s => s.spreadPct || 0));
  const bestCoc = best.cashOnCash || 0;

  if (bestCoc >= 12) reasons.push(`Best-case CoC ${bestCoc.toFixed(1)}% (${best.label})`);
  else if (bestCoc >= 8) reasons.push(`Adequate CoC ${bestCoc.toFixed(1)}% (${best.label})`);
  else redFlags.push(`Weak CoC — best scenario only ${bestCoc.toFixed(1)}%`);

  if (spread >= 25) reasons.push(`Strong spread ${spread.toFixed(1)}% over total cost-in`);
  else if (spread >= 15) reasons.push(`Moderate spread ${spread.toFixed(1)}%`);
  else redFlags.push(`Thin spread — only ${spread.toFixed(1)}% over cost-in`);

  const tax = taxReset || {};
  if (tax.monthlyTaxShock > 300) redFlags.push(`Tax shock $${tax.monthlyTaxShock}/mo at reassessment`);
  else if (tax.monthlyTaxShock > 0) reasons.push(`Modest tax step-up $${tax.monthlyTaxShock}/mo`);

  const flood = floodRisk || {};
  if (flood.tier === 'high') redFlags.push(`High flood risk (${flood.note || 'V-zone'})`);
  else if (flood.tier === 'elevated') redFlags.push(`Elevated flood risk (${flood.note || 'SFHA'}) — insurance required`);
  else if (flood.tier === 'low') reasons.push('Outside 100-year floodplain');

  const disasterCount = Array.isArray(disasters) ? disasters.length : 0;
  if (disasterCount >= 3) redFlags.push(`${disasterCount} federal disaster declarations in county (last 5 yrs)`);
  else if (disasterCount > 0) reasons.push(`${disasterCount} disaster declaration${disasterCount > 1 ? 's' : ''} in county — review cause`);

  let verdict;
  const strong = bestCoc >= 12 && spread >= 25 && flood.tier !== 'high' && (tax.monthlyTaxShock || 0) < 300;
  const workable = bestCoc >= 8 && spread >= 15 && flood.tier !== 'high';
  if (strong) verdict = 'PASS+';
  else if (workable) verdict = 'PROCEED';
  else verdict = 'PASS';

  return {
    verdict,
    bestScenario: best.label,
    bestCashOnCash: bestCoc,
    maxSpreadPct: Number(spread.toFixed(1)),
    reasons,
    redFlags
  };
}

// Top-level orchestrator. Takes the raw enrichment output + already-generated rehab
// budget (from Claude in auto-enrich.js) and produces the full compute block.
function runCompute({ deal, enriched, rehab }) {
  const attom = enriched && enriched.attom;
  const rcAvm = enriched && enriched.rcAvm;
  const rcRent = enriched && enriched.rcRent;
  const hud = enriched && enriched.hud;
  const femaFlood = enriched && enriched.femaFlood;
  const femaDisasters = (enriched && enriched.femaDisasters) || [];

  const purchasePrice = Number(deal.askingPrice) || 0;
  const arv = (rcAvm && rcAvm.value) || (attom && attom.marketValue) || purchasePrice;
  const monthlyRent = (rcRent && rcRent.rent) || (hud && hud.ltr) || 0;

  const taxReset = computeTaxReset({
    marketValue: attom && attom.marketValue,
    millageRate: attom && attom.millageRate,
    currentTaxAmount: attom && attom.taxAmount,
    hasHomestead: attom && attom.hasHomestead,
    purchasePrice,
    state: deal.state
  });

  const scenarios = buildScenariosByDealType({
    dealType: deal.dealType,
    purchasePrice,
    entryFee: deal.entryFee,
    loanBalance: deal.loanBalance,
    interestRate: deal.interestRate,
    dealPiti: deal.piti,
    rehab,
    arv,
    monthlyRent,
    annualTax: taxReset.projectedAnnualTax,
    annualInsurance: DEFAULT_INSURANCE_ANNUAL
  });

  const floodRisk = classifyFloodRisk(femaFlood && femaFlood.zone);

  const verdict = computeVerdict({ scenarios, taxReset, floodRisk, disasters: femaDisasters });

  return {
    purchasePriceUsed: purchasePrice,
    arvUsed: arv,
    monthlyRentUsed: monthlyRent,
    taxReset,
    rehab: rehab || null,
    scenarios,
    floodRisk,
    verdict,
    assumptions: {
      mortgageRate: DEFAULT_MORTGAGE_RATE,
      loanTermYears: DEFAULT_LOAN_TERM_YEARS,
      downPaymentPct: DEFAULT_DOWN_PAYMENT_PCT,
      closingCostsPct: DEFAULT_CLOSING_COSTS_PCT,
      vacancyPct: DEFAULT_VACANCY_PCT,
      mgmtPct: DEFAULT_MGMT_PCT,
      maintenancePct: DEFAULT_MAINTENANCE_PCT,
      annualInsurance: DEFAULT_INSURANCE_ANNUAL
    }
  };
}

module.exports = {
  pmt,
  computeTaxReset,
  computeOneScenario,
  computeReturns,
  classifyFloodRisk,
  computeVerdict,
  runCompute,
  normalizeDealType,
  computeSubToScenario,
  computeSfScenario,
  buildScenariosByDealType
};
