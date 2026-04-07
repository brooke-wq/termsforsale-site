/* ============================================
   DISPO BUDDY — DEAL DETAIL JS
   ============================================ */

var partner = null;
var deal = null;
var STAGES = [
  'New JV Lead',
  'Missing Information',
  'Under Review',
  'Ready to Market',
  'Actively Marketing',
  'Assignment Sent',
  'Assigned with EMD',
  'Closed'
];
var STAGE_LABELS = {
  'New JV Lead':         'Submitted',
  'Missing Information': 'Need Your Info',
  'Under Review':        'Under Review',
  'Ready to Market':     'Ready to Market',
  'Actively Marketing':  'Marketing',
  'Assignment Sent':     'Assignment Sent',
  'Assigned with EMD':   'EMD Received',
  'Closed':              'Closed',
  'Not Accepted':        'Not Accepted'
};
var STAGE_COLORS = {
  'New JV Lead':         '#718096',
  'Missing Information': '#ef4444',
  'Under Review':        '#8b5cf6',
  'Ready to Market':     '#29ABE2',
  'Actively Marketing':  '#F7941D',
  'Assignment Sent':     '#a855f7',
  'Assigned with EMD':   '#a855f7',
  'Closed':              '#22c55e',
  'Not Accepted':        '#94a3b8'
};

// Init
window.addEventListener('scroll', function() {
  document.querySelector('.nav').classList.toggle('scrolled', window.scrollY > 10);
});
var ham = document.getElementById('hamburger');
if (ham) ham.addEventListener('click', function() {
  this.classList.toggle('on');
  document.getElementById('mobMenu').classList.toggle('on');
});

(function init() {
  var saved = sessionStorage.getItem('db_partner');
  if (!saved) {
    window.location.href = '/dashboard';
    return;
  }
  try {
    partner = JSON.parse(saved);
  } catch(e) {
    window.location.href = '/dashboard';
    return;
  }

  var params = new URLSearchParams(window.location.search);
  var dealId = params.get('id');
  if (!dealId) {
    window.location.href = '/dashboard';
    return;
  }

  loadDeal(dealId);
})();

async function loadDeal(dealId) {
  try {
    var res = await fetch('/.netlify/functions/partner-deal-detail?contactId=' + encodeURIComponent(partner.id) + '&dealId=' + encodeURIComponent(dealId));
    var data = await res.json();

    if (!res.ok) {
      document.getElementById('content').innerHTML =
        '<div class="loading" style="color:var(--red)">Could not load this deal. ' + (data.error || '') + '</div>';
      return;
    }

    deal = data.deal;
    renderDeal();
  } catch(err) {
    document.getElementById('content').innerHTML =
      '<div class="loading" style="color:var(--red)">Connection error. Please refresh.</div>';
  }
}

function renderDeal() {
  if (!deal) return;

  var content = document.getElementById('content');
  var stageColor = STAGE_COLORS[deal.stage] || '#718096';
  var stageLabel = STAGE_LABELS[deal.stage] || deal.stage || 'Processing';
  var stageBg = hexToRgba(stageColor, 0.12);
  var stageStep = STAGES.indexOf(deal.stage) + 1;
  if (deal.status === 'won') stageStep = 8;
  if (deal.status === 'lost' || deal.status === 'abandoned') stageStep = 0;

  var html = '';

  // Back link
  html += '<a href="/dashboard" class="back-link">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>' +
    'Back to dashboard</a>';

  // Header
  html += '<div class="deal-header">';
  html += '<h1>' + escHtml(deal.address || deal.location || 'Deal') + '</h1>';
  html += '<div class="deal-meta">';
  html += '<span class="deal-tag" style="background:' + stageBg + ';color:' + stageColor + '">' +
    '<span class="dot" style="background:' + stageColor + '"></span>' + escHtml(stageLabel) + '</span>';
  if (deal.dealType) html += '<span>' + escHtml(deal.dealType) + '</span>';
  if (deal.daysSinceSubmit !== undefined) html += '<span>· Day ' + deal.daysSinceSubmit + '</span>';
  html += '</div>';
  html += '</div>';

  // Progress dots
  html += '<div class="progress-wrap">';
  html += '<div class="progress-dots">';
  for (var i = 1; i <= 8; i++) {
    var cls = i < stageStep ? 'dot done' : (i === stageStep ? 'dot current' : 'dot');
    html += '<div class="' + cls + '"></div>';
  }
  html += '</div>';
  html += '<div class="progress-labels">';
  html += '<span>Submitted</span><span>Review</span><span>Marketing</span><span>Closed</span>';
  html += '</div>';
  html += '</div>';

  // Action card (only if missing info)
  if (deal.actionNeeded) {
    html += '<div class="action-card">';
    html += '<div class="label">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      'Action Needed</div>';
    html += '<h3>We need a few things from you</h3>';
    html += '<div class="body">' + escHtml(deal.actionNeeded) + '</div>';
    html += '<div class="actions">';
    html += '<a href="sms:+14808425332" class="btn btn-action">Text us</a>';
    html += '<a href="mailto:info@dispobuddy.com?subject=' + encodeURIComponent('RE: ' + (deal.address || 'My deal')) + '" class="btn btn-ghost">Email us</a>';
    html += '</div>';
    html += '</div>';
  }

  // Property snapshot
  html += '<div class="section">';
  html += '<div class="section-head">Property & Numbers</div>';
  html += '<div class="property-grid">';
  if (deal.contractedPrice) html += propItem('Contract', '$' + Number(deal.contractedPrice).toLocaleString());
  if (deal.askingPrice) html += propItem('Asking', '$' + Number(deal.askingPrice).toLocaleString());
  if (deal.arv) html += propItem('ARV (est)', '$' + Number(deal.arv).toLocaleString());
  if (deal.entryFee) html += propItem('Entry Fee', '$' + Number(deal.entryFee).toLocaleString());
  if (deal.dealType) html += propItem('Deal Type', deal.dealType);
  if (deal.occupancy) html += propItem('Occupancy', deal.occupancy);
  html += '</div>';

  // Your projected fee
  if (deal.projectedFee) {
    var splitLabel = (deal.split === 0.7) ? '30/70 split (Power Partner)' : '50/50 split';
    html += '<div class="your-fee-card">';
    html += '<div class="label">Your Projected Fee</div>';
    html += '<div class="num">$' + Number(deal.projectedFee).toLocaleString() + '</div>';
    html += '<div class="sub">' + splitLabel + '</div>';
    html += '</div>';
  }
  html += '</div>';

  // Buyer Interest Metrics (only if deal is actively marketing or later)
  if (deal.metrics) {
    html += '<div class="section">';
    html += '<div class="section-head">Buyer Interest</div>';
    html += '<div class="metrics-grid">';
    html += '<div class="metric-card"><div class="num">' + (deal.metrics.views || 0) + '</div><div class="label">Views</div></div>';
    html += '<div class="metric-card"><div class="num">' + (deal.metrics.inquiries || 0) + '</div><div class="label">Inquiries</div></div>';
    html += '<div class="metric-card"><div class="num">' + (deal.metrics.showings || 0) + '</div><div class="label">Showings</div></div>';
    html += '<div class="metric-card"><div class="num">' + (deal.metrics.offers || 0) + '</div><div class="label">Offers</div></div>';
    html += '</div>';
    html += '<p style="font-size:11px;color:var(--text-light);margin-top:12px;text-align:center">Updated as we hear from buyers</p>';
    html += '</div>';
  }

  // Timeline
  html += '<div class="section">';
  html += '<div class="section-head">Timeline</div>';
  html += '<div class="timeline">';
  for (var j = 0; j < STAGES.length; j++) {
    var s = STAGES[j];
    var stepNum = j + 1;
    var cls = '';
    var when = '';
    if (stepNum < stageStep) { cls = 'done'; when = 'Completed'; }
    else if (stepNum === stageStep) { cls = 'current'; when = 'Current'; }
    else { cls = 'pending'; when = ''; }

    html += '<div class="tl-event ' + cls + '">';
    html += '<div class="stage">' + escHtml(STAGE_LABELS[s] || s) + '</div>';
    if (when) html += '<div class="when">' + when + '</div>';
    html += '</div>';
  }
  html += '</div>';
  html += '</div>';

  // Files
  if (deal.photoLink || deal.docsLink) {
    html += '<div class="section">';
    html += '<div class="section-head">Files & Docs</div>';
    html += '<div class="files-list">';
    if (deal.photoLink) html += fileRow(deal.photoLink, 'Property Photos', 'photo');
    if (deal.docsLink) html += fileRow(deal.docsLink, 'Supporting Documents', 'doc');
    html += '</div>';
    html += '</div>';
  }

  // Contact actions
  html += '<div class="section">';
  html += '<div class="section-head">Need Anything?</div>';
  html += '<div class="contact-row">';
  html += '<a href="sms:+14808425332" class="btn btn-o">Text the team</a>';
  html += '<a href="mailto:info@dispobuddy.com?subject=' + encodeURIComponent('RE: ' + (deal.address || 'My deal')) + '" class="btn btn-ghost">Email us</a>';
  html += '</div>';
  html += '</div>';

  content.innerHTML = html;
}

function propItem(key, val) {
  return '<div class="property-item">' +
    '<div class="key">' + escHtml(key) + '</div>' +
    '<div class="val">' + escHtml(val) + '</div>' +
  '</div>';
}

function fileRow(url, label, type) {
  var icon = type === 'photo'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  return '<a class="file-row" href="' + escAttr(url) + '" target="_blank" rel="noopener">' +
    icon + '<span>' + escHtml(label) + '</span>' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
  '</a>';
}

function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  var r = parseInt(hex.substring(0,2), 16);
  var g = parseInt(hex.substring(2,4), 16);
  var b = parseInt(hex.substring(4,6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function escHtml(s) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(s == null ? '' : String(s)));
  return div.innerHTML;
}

function escAttr(s) {
  return String(s == null ? '' : s).replace(/"/g, '&quot;');
}
