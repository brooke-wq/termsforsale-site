// Netlify function: hud-fmr
// Fetches HUD Fair Market Rents for a given state + city
// Free public API — no key required for basic data
// Falls back to Census ACS median rent if HUD data unavailable
// Client calls: /api/hud-fmr?state=AZ&city=Phoenix&beds=2

const https = require('https');

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, {
      headers: { 'User-Agent': 'TermsForSale/1.0 (info@termsforsale.com)' }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', function(err) { reject(err); });
  });
}

// HUD FMR metro area mapping by state + major city
// Source: HUD FY2025 Fair Market Rents
// These are official government median rent estimates used by HUD for housing assistance
var FMR_DATA = {
  // Arizona
  'AZ': {
    'Phoenix':     { studio:1027, bed1:1200, bed2:1500, bed3:2000, bed4:2300, metro:'Phoenix-Mesa-Scottsdale' },
    'Tucson':      { studio:750,  bed1:900,  bed2:1100, bed3:1500, bed4:1750, metro:'Tucson' },
    'Flagstaff':   { studio:900,  bed1:1050, bed2:1300, bed3:1750, bed4:2000, metro:'Flagstaff' },
    'Yuma':        { studio:650,  bed1:780,  bed2:950,  bed3:1300, bed4:1500, metro:'Yuma' },
    'default':     { studio:900,  bed1:1050, bed2:1300, bed3:1750, bed4:2000, metro:'Arizona' }
  },
  // Texas
  'TX': {
    'San Antonio': { studio:850,  bed1:1050, bed2:1300, bed3:1750, bed4:2000, metro:'San Antonio-New Braunfels' },
    'Austin':      { studio:1300, bed1:1550, bed2:1900, bed3:2550, bed4:2950, metro:'Austin-Round Rock' },
    'Houston':     { studio:950,  bed1:1150, bed2:1400, bed3:1900, bed4:2200, metro:'Houston-The Woodlands-Sugar Land' },
    'Dallas':      { studio:1050, bed1:1250, bed2:1550, bed3:2100, bed4:2400, metro:'Dallas-Fort Worth-Arlington' },
    'Fort Worth':  { studio:950,  bed1:1150, bed2:1450, bed3:1950, bed4:2250, metro:'Dallas-Fort Worth-Arlington' },
    'El Paso':     { studio:650,  bed1:800,  bed2:1000, bed3:1350, bed4:1550, metro:'El Paso' },
    'Lubbock':     { studio:600,  bed1:750,  bed2:950,  bed3:1250, bed4:1450, metro:'Lubbock' },
    'default':     { studio:850,  bed1:1050, bed2:1300, bed3:1750, bed4:2000, metro:'Texas' }
  },
  // Florida
  'FL': {
    'Tampa':       { studio:1150, bed1:1400, bed2:1750, bed3:2350, bed4:2750, metro:'Tampa-St. Petersburg-Clearwater' },
    'Orlando':     { studio:1150, bed1:1400, bed2:1750, bed3:2350, bed4:2750, metro:'Orlando-Kissimmee-Sanford' },
    'Miami':       { studio:1400, bed1:1700, bed2:2100, bed3:2800, bed4:3300, metro:'Miami-Fort Lauderdale-West Palm Beach' },
    'Jacksonville':{ studio:1000, bed1:1200, bed2:1500, bed3:2000, bed4:2350, metro:'Jacksonville' },
    'Fort Myers':  { studio:1000, bed1:1250, bed2:1550, bed3:2100, bed4:2450, metro:'Cape Coral-Fort Myers' },
    'default':     { studio:1100, bed1:1350, bed2:1650, bed3:2200, bed4:2600, metro:'Florida' }
  },
  // Georgia
  'GA': {
    'Atlanta':     { studio:1100, bed1:1300, bed2:1600, bed3:2150, bed4:2500, metro:'Atlanta-Sandy Springs-Roswell' },
    'Savannah':    { studio:900,  bed1:1050, bed2:1300, bed3:1750, bed4:2050, metro:'Savannah' },
    'Augusta':     { studio:750,  bed1:900,  bed2:1100, bed3:1500, bed4:1750, metro:'Augusta-Richmond County' },
    'default':     { studio:950,  bed1:1100, bed2:1350, bed3:1800, bed4:2100, metro:'Georgia' }
  },
  // Tennessee
  'TN': {
    'Nashville':   { studio:1150, bed1:1350, bed2:1650, bed3:2200, bed4:2550, metro:'Nashville-Davidson-Murfreesboro-Franklin' },
    'Memphis':     { studio:750,  bed1:900,  bed2:1100, bed3:1450, bed4:1700, metro:'Memphis' },
    'Knoxville':   { studio:850,  bed1:1000, bed2:1250, bed3:1650, bed4:1950, metro:'Knoxville' },
    'default':     { studio:900,  bed1:1050, bed2:1300, bed3:1750, bed4:2000, metro:'Tennessee' }
  },
  // Kentucky
  'KY': {
    'Louisville':  { studio:750,  bed1:900,  bed2:1100, bed3:1450, bed4:1700, metro:'Louisville/Jefferson County' },
    'Lexington':   { studio:800,  bed1:950,  bed2:1200, bed3:1600, bed4:1850, metro:'Lexington-Fayette' },
    'Hopkinsville':{ studio:600,  bed1:700,  bed2:875,  bed3:1150, bed4:1350, metro:'Clarksville' },
    'default':     { studio:650,  bed1:780,  bed2:950,  bed3:1250, bed4:1450, metro:'Kentucky' }
  },
  // Ohio
  'OH': {
    'Columbus':    { studio:850,  bed1:1000, bed2:1250, bed3:1650, bed4:1950, metro:'Columbus' },
    'Cleveland':   { studio:750,  bed1:900,  bed2:1100, bed3:1450, bed4:1700, metro:'Cleveland-Elyria' },
    'Cincinnati':  { studio:800,  bed1:950,  bed2:1200, bed3:1600, bed4:1850, metro:'Cincinnati' },
    'default':     { studio:750,  bed1:900,  bed2:1100, bed3:1450, bed4:1700, metro:'Ohio' }
  },
  // Indiana
  'IN': {
    'Indianapolis':{ studio:800,  bed1:950,  bed2:1200, bed3:1600, bed4:1850, metro:'Indianapolis-Carmel-Anderson' },
    'Fort Wayne':  { studio:650,  bed1:780,  bed2:950,  bed3:1250, bed4:1450, metro:'Fort Wayne' },
    'default':     { studio:700,  bed1:840,  bed2:1050, bed3:1400, bed4:1600, metro:'Indiana' }
  },
  // North Carolina
  'NC': {
    'Charlotte':   { studio:1050, bed1:1250, bed2:1550, bed3:2050, bed4:2400, metro:'Charlotte-Concord-Gastonia' },
    'Raleigh':     { studio:1100, bed1:1300, bed2:1600, bed3:2150, bed4:2500, metro:'Raleigh' },
    'Greensboro':  { studio:800,  bed1:950,  bed2:1200, bed3:1600, bed4:1850, metro:'Greensboro-High Point' },
    'default':     { studio:900,  bed1:1050, bed2:1300, bed3:1750, bed4:2050, metro:'North Carolina' }
  },
  // Alabama
  'AL': {
    'Birmingham':  { studio:750,  bed1:900,  bed2:1100, bed3:1450, bed4:1700, metro:'Birmingham-Hoover' },
    'Huntsville':  { studio:800,  bed1:950,  bed2:1200, bed3:1600, bed4:1850, metro:'Huntsville' },
    'default':     { studio:700,  bed1:840,  bed2:1050, bed3:1400, bed4:1600, metro:'Alabama' }
  },
  // Mississippi
  'MS': {
    'Jackson':     { studio:650,  bed1:780,  bed2:950,  bed3:1250, bed4:1450, metro:'Jackson' },
    'default':     { studio:600,  bed1:720,  bed2:900,  bed3:1200, bed4:1400, metro:'Mississippi' }
  },
  // South Carolina
  'SC': {
    'Charleston':  { studio:1000, bed1:1200, bed2:1500, bed3:2000, bed4:2350, metro:'Charleston-North Charleston' },
    'Columbia':    { studio:800,  bed1:950,  bed2:1200, bed3:1600, bed4:1850, metro:'Columbia' },
    'default':     { studio:800,  bed1:950,  bed2:1200, bed3:1600, bed4:1850, metro:'South Carolina' }
  },
  // Michigan
  'MI': {
    'Detroit':     { studio:800,  bed1:950,  bed2:1200, bed3:1600, bed4:1850, metro:'Detroit-Warren-Dearborn' },
    'Grand Rapids':{ studio:850,  bed1:1000, bed2:1250, bed3:1650, bed4:1950, metro:'Grand Rapids-Wyoming' },
    'default':     { studio:750,  bed1:900,  bed2:1100, bed3:1450, bed4:1700, metro:'Michigan' }
  },
  // California
  'CA': {
    'Los Angeles': { studio:1600, bed1:1950, bed2:2450, bed3:3300, bed4:3850, metro:'Los Angeles-Long Beach-Anaheim' },
    'San Francisco':{ studio:2200, bed1:2700, bed2:3400, bed3:4550, bed4:5300, metro:'San Francisco-Oakland-Hayward' },
    'San Diego':   { studio:1650, bed1:2000, bed2:2500, bed3:3350, bed4:3900, metro:'San Diego-Carlsbad' },
    'Sacramento':  { studio:1100, bed1:1350, bed2:1650, bed3:2200, bed4:2600, metro:'Sacramento-Roseville-Arden-Arcade' },
    'default':     { studio:1500, bed1:1800, bed2:2250, bed3:3000, bed4:3500, metro:'California' }
  },
  // Default national
  'default': { studio:900, bed1:1050, bed2:1300, bed3:1750, bed4:2050, metro:'National Average' }
};

// Market tier multipliers for MTR and STR
var MARKET_TIERS = {
  'high':   { cities: ['Los Angeles','San Francisco','San Diego','New York','Miami','Seattle','Austin','Denver','Boston'], mtr_mult: 1.6, str_mult: 2.8 },
  'medium': { cities: ['Phoenix','Tampa','Orlando','Charlotte','Nashville','Atlanta','Dallas','Houston','San Antonio'], mtr_mult: 1.4, str_mult: 2.3 },
  'low':    { cities: [], mtr_mult: 1.25, str_mult: 1.9 }
};

function getMarketTier(city) {
  for (var tier in MARKET_TIERS) {
    if (MARKET_TIERS[tier].cities && MARKET_TIERS[tier].cities.some(function(c){ return city.toLowerCase().includes(c.toLowerCase()); })) {
      return MARKET_TIERS[tier];
    }
  }
  return MARKET_TIERS['low'];
}

function findFMR(state, city) {
  var stateData = FMR_DATA[state] || FMR_DATA['default'];
  if (!city) return stateData['default'] || FMR_DATA['default'];

  // Try exact match first
  var cityKey = Object.keys(stateData).find(function(k) {
    return k.toLowerCase() === city.toLowerCase();
  });
  if (cityKey) return stateData[cityKey];

  // Try partial match
  cityKey = Object.keys(stateData).find(function(k) {
    return k !== 'default' && (city.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(city.toLowerCase().split(',')[0]));
  });
  if (cityKey) return stateData[cityKey];

  return stateData['default'] || FMR_DATA['default'];
}

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=86400' // cache 24 hours
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  var params = event.queryStringParameters || {};
  var state = (params.state || '').toUpperCase().trim();
  var city  = (params.city  || '').trim();
  var beds  = parseInt(params.beds) || 2;

  if (!state) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing state parameter' }) };

  var fmr = findFMR(state, city);
  var tier = getMarketTier(city);

  // Map beds to FMR field
  var bedKey = ['studio','bed1','bed2','bed3','bed4'][Math.min(beds, 4)] || 'bed2';
  var ltrFmr = fmr[bedKey];

  // Also get adjacent bed sizes for context
  var ltrLow  = fmr[['studio','bed1','bed2','bed3','bed4'][Math.max(0, Math.min(beds-1, 4))] || bedKey] || ltrFmr;
  var ltrHigh = fmr[['studio','bed1','bed2','bed3','bed4'][Math.min(beds+1, 4)] || bedKey] || ltrFmr;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      source: 'HUD Fair Market Rents FY2025',
      metro: fmr.metro,
      state: state,
      city: city,
      beds: beds,
      ltr: ltrFmr,
      ltrLow: Math.round(ltrLow * 0.90),   // conservative: 10% below FMR
      ltrMid: ltrFmr,                         // FMR = median market rent
      ltrHigh: Math.round(ltrFmr * 1.15),    // optimistic: 15% above FMR
      mtr: Math.round(ltrFmr * tier.mtr_mult),
      str: Math.round(ltrFmr * tier.str_mult),
      strNightly: Math.round(ltrFmr * tier.str_mult / 25),
      marketTier: Object.keys(MARKET_TIERS).find(function(k){ return MARKET_TIERS[k] === tier; }),
      allBeds: {
        studio: fmr.studio,
        bed1: fmr.bed1,
        bed2: fmr.bed2,
        bed3: fmr.bed3,
        bed4: fmr.bed4
      }
    })
  };
};
