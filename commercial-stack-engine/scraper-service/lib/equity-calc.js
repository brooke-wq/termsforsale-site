'use strict';

// Equity estimation helpers.
//
// Used by the enrichment pipeline to convert (last_sale_price, last_sale_date,
// mortgage_origination_date, mortgage_amount) into a current equity %.

const HISTORICAL_RATES = require('./historical-rates');

// Standard 30-yr amortization remaining balance.
//   P = principal at origination
//   r = monthly interest rate (annual_rate / 12)
//   n = total number of payments
//   k = number of payments already made
function remainingBalance(P, annualRate, termYears, monthsPaid) {
  if (!P || P <= 0) return 0;
  const r = annualRate / 12;
  const n = termYears * 12;
  const k = Math.max(0, Math.min(monthsPaid, n));
  if (r === 0) return P * (1 - k / n);
  // Remaining = P*(1+r)^k - M*((1+r)^k - 1)/r
  // Where M = P*r*(1+r)^n / ((1+r)^n - 1)
  const onePlusRtoN = Math.pow(1 + r, n);
  const M = P * r * onePlusRtoN / (onePlusRtoN - 1);
  const onePlusRtoK = Math.pow(1 + r, k);
  return P * onePlusRtoK - M * (onePlusRtoK - 1) / r;
}

function monthsBetween(d1, d2) {
  if (!d1 || !d2) return 0;
  const a = new Date(d1), b = new Date(d2);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function rateAtOrigination(origDate, fallback = 0.065) {
  if (!origDate) return fallback;
  const d = new Date(origDate);
  if (Number.isNaN(d.getTime())) return fallback;
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return HISTORICAL_RATES[ym] || fallback;
}

// National appreciation index — coarse annual %s. We use these to project
// the current market value from the last recorded sale price.
//
// These are a reasonable approximation of Case-Shiller national index.
// Per-MSA detail is a v2 enhancement.
const ANNUAL_APPRECIATION = {
  default: 0.04,         // baseline 4%/yr long-run national average
  '2020': 0.10, '2021': 0.18, '2022': 0.07,
  '2023': 0.04, '2024': 0.05, '2025': 0.04, '2026': 0.04
};

function appreciate(saleDate, salePrice) {
  if (!saleDate || !salePrice) return null;
  const start = new Date(saleDate);
  const today = new Date();
  if (Number.isNaN(start.getTime())) return null;
  let v = salePrice;
  let y = start.getFullYear();
  // Year fraction in start year
  const daysInStartYear = Math.ceil((new Date(y + 1, 0, 1) - start) / (1000 * 60 * 60 * 24));
  v *= 1 + (ANNUAL_APPRECIATION[String(y)] || ANNUAL_APPRECIATION.default) * (daysInStartYear / 365);
  y++;
  while (y < today.getFullYear()) {
    v *= 1 + (ANNUAL_APPRECIATION[String(y)] || ANNUAL_APPRECIATION.default);
    y++;
  }
  // Year fraction in current year
  const daysInCurYear = Math.ceil((today - new Date(y, 0, 1)) / (1000 * 60 * 60 * 24));
  v *= 1 + (ANNUAL_APPRECIATION[String(y)] || ANNUAL_APPRECIATION.default) * (daysInCurYear / 365);
  return Math.round(v);
}

// Compute equity given the enrichment row. Returns
//   { estimated_market_value, mortgage_estimated_balance,
//     equity_estimate_dollars, equity_estimate_percent }
function computeEquity(enr) {
  const mv = enr.estimated_market_value
          || appreciate(enr.last_sale_date, enr.last_sale_price)
          || enr.current_assessed_value
          || null;
  if (!mv) return { estimated_market_value: null, mortgage_estimated_balance: null,
                    equity_estimate_dollars: null, equity_estimate_percent: null };

  let mortBal = 0;
  if (enr.has_active_mortgage && enr.mortgage_origination_date && enr.last_sale_price) {
    const months = Math.max(0, monthsBetween(enr.mortgage_origination_date, new Date()));
    // If we don't know the original loan amount, estimate it as 75% LTV at origination
    const principal = enr.mortgage_original_amount || (enr.last_sale_price * 0.75);
    const rate = rateAtOrigination(enr.mortgage_origination_date);
    mortBal = Math.max(0, remainingBalance(principal, rate, 30, months));
  }
  const equityDollars = mv - mortBal;
  const equityPct = mv > 0 ? Math.max(0, Math.min(100, (equityDollars / mv) * 100)) : null;

  return {
    estimated_market_value: Math.round(mv),
    mortgage_estimated_balance: Math.round(mortBal),
    equity_estimate_dollars: Math.round(equityDollars),
    equity_estimate_percent: equityPct == null ? null : Number(equityPct.toFixed(2))
  };
}

// Detect motivation signals on an enrichment row. Returns string[].
function detectMotivation(enr, listing) {
  const signals = [];
  if (enr.owner_state && listing.state && enr.owner_state !== listing.state) {
    signals.push('out_of_state_owner');
  }
  if (enr.is_llc && /dissolved|delinquent|inactive/i.test(enr.llc_status || '')) {
    signals.push('llc_inactive');
  }
  if (enr.last_sale_date) {
    const yrs = (Date.now() - new Date(enr.last_sale_date).getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (yrs >= 10) signals.push('long_hold_period');
  }
  if (enr.tax_delinquent) signals.push('tax_delinquent');
  if ((enr.code_violations_count || 0) > 0) signals.push('code_violations');
  return signals;
}

module.exports = {
  remainingBalance, rateAtOrigination, appreciate,
  monthsBetween, computeEquity, detectMotivation
};
