/* ============================================
   DISPO BUDDY — PARTNER DASHBOARD JS
   ============================================ */

// ── State ──
var partner = null;
var allDeals = [];

// ── Stage to display config ──
var STAGE_CONFIG = {
  'New JV Lead':         { label: 'Submitted',         color: '#718096', step: 1 },
  'Missing Information': { label: 'Need Your Info',    color: '#ef4444', step: 2 },
  'Under Review':        { label: 'Under Review',      color: '#8b5cf6', step: 3 },
  'Ready to Market':     { label: 'Ready to Market',   color: '#29ABE2', step: 4 },
  'Actively Marketing':  { label: 'Actively Marketing',color: '#F7941D', step: 5 },
  'Assignment Sent':     { label: 'Assignment Sent',   color: '#a855f7', step: 6 },
  'Assigned with EMD':   { label: 'EMD Received',      color: '#a855f7', step: 7 },
  'Closed':              { label: 'Closed',            color: '#22c55e', step: 8 },
  'Not Accepted':        { label: 'Not Accepted',      color: '#94a3b8', step: 0 }
};
var TOTAL_STAGES = 8;

// ── Init ──
window.addEventListener('scroll', function() {
  document.querySelector('.nav').classList.toggle('scrolled', window.scrollY > 10);
});
document.getElementById('hamburger').addEventListener('click', function() {
  this.classList.toggle('on');
  document.getElementById('mobMenu').classList.toggle('on');
});

(function init() {
  var saved = sessionStorage.getItem('db_partner');
  if (saved) {
    try {
      partner = JSON.parse(saved);
      showDashboard();
    } catch(e) {
      sessionStorage.removeItem('db_partner');
    }
  }
})();

// ── OTP Login Flow ──
var otpState = { phone: '', email: '' };

window.requestCode = async function() {
  var phone = document.getElementById('loginPhone').value.trim();
  var email = document.getElementById('loginEmail').value.trim();
  var errEl = document.getElementById('loginErr');
  var btn   = document.getElementById('loginBtn');

  errEl.classList.remove('show');
  errEl.textContent = '';

  if (!phone && !email) {
    errEl.textContent = 'Enter your phone number or email.';
    errEl.classList.add('show');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending code...';

  try {
    var res = await fetch('/.netlify/functions/partner-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request', phone: phone, email: email }),
    });
    var data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Could not send code. Please try again.';
      errEl.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Send me a code';
      return;
    }

    // Store for the verify step
    otpState.phone = phone;
    otpState.email = email;

    // Show step 2
    document.getElementById('loginStep1').style.display = 'none';
    document.getElementById('loginStep2').style.display = 'block';
    document.getElementById('maskedPhone').textContent = data.maskedPhone || 'your phone';
    document.getElementById('loginCode').focus();

    // Dev mode: show the code so dev can log in without live SMS
    if (data.testMode && data.devCode) {
      console.log('🔑 Test-mode OTP code:', data.devCode);
      var hint = document.createElement('div');
      hint.style.cssText = 'margin-top:12px;padding:10px 14px;background:#FFF3E0;border-radius:8px;font-size:11px;color:#92400e;text-align:center';
      hint.innerHTML = '<strong>Test mode:</strong> Code is <strong style="font-family:monospace;font-size:14px">' + data.devCode + '</strong>';
      document.getElementById('loginStep2').appendChild(hint);
    }
  } catch(err) {
    errEl.textContent = 'Something went wrong. Please try again.';
    errEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Send me a code';
  }
};

window.verifyCode = async function() {
  var code = document.getElementById('loginCode').value.trim();
  var errEl = document.getElementById('verifyErr');
  var btn   = document.getElementById('verifyBtn');

  errEl.classList.remove('show');

  if (!/^\d{6}$/.test(code)) {
    errEl.textContent = 'Enter the 6-digit code.';
    errEl.classList.add('show');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    var res = await fetch('/.netlify/functions/partner-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verify',
        phone: otpState.phone,
        email: otpState.email,
        code: code,
      }),
    });
    var data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Invalid code. Try again.';
      errEl.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Sign In';
      return;
    }

    partner = data.partner;
    sessionStorage.setItem('db_partner', JSON.stringify(partner));
    showDashboard();
  } catch(err) {
    errEl.textContent = 'Something went wrong. Please try again.';
    errEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
};

window.backToStep1 = function(e) {
  if (e) e.preventDefault();
  document.getElementById('loginStep2').style.display = 'none';
  document.getElementById('loginStep1').style.display = 'block';
  document.getElementById('loginBtn').disabled = false;
  document.getElementById('loginBtn').textContent = 'Send me a code';
  document.getElementById('loginCode').value = '';
  // Remove any dev hint
  var hints = document.querySelectorAll('#loginStep2 > div[style*="Test mode"]');
  hints.forEach(function(h) { h.remove(); });
};

window.resendCode = function(e) {
  if (e) e.preventDefault();
  window.requestCode();
};

// Enter key support
document.getElementById('loginPhone').addEventListener('keydown', function(e) { if (e.key === 'Enter') window.requestCode(); });
document.getElementById('loginEmail').addEventListener('keydown', function(e) { if (e.key === 'Enter') window.requestCode(); });
document.getElementById('loginCode').addEventListener('keydown', function(e) { if (e.key === 'Enter') window.verifyCode(); });
// Auto-submit when 6 digits entered
document.getElementById('loginCode').addEventListener('input', function(e) {
  var v = e.target.value.replace(/\D/g, '').slice(0, 6);
  e.target.value = v;
  if (v.length === 6) window.verifyCode();
});

// ── Show Dashboard ──
function showDashboard() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('dashView').classList.add('show');

  var first = partner.firstName || (partner.name || '').split(' ')[0] || 'there';
  document.getElementById('greetName').textContent = first;

  // Update nav
  var navRight = document.getElementById('navRight');
  navRight.innerHTML =
    '<a href="/submit-deal" class="btn btn-o btn-sm">+ New Deal</a>' +
    '<button class="btn btn-ghost btn-sm" onclick="logout()">Sign Out</button>';

  loadDeals();
}

// ── Load Deals ──
async function loadDeals() {
  try {
    var res = await fetch('/.netlify/functions/partner-deals?contactId=' + encodeURIComponent(partner.id));
    var data = await res.json();

    if (!res.ok) {
      document.getElementById('pipeListWrap').innerHTML =
        '<div class="loading" style="color:var(--red)">Failed to load deals. Please refresh.</div>';
      return;
    }

    allDeals = data.deals || [];
    renderAll();

  } catch(err) {
    document.getElementById('pipeListWrap').innerHTML =
      '<div class="loading" style="color:var(--red)">Connection error. Please refresh.</div>';
  }
}

// ── Render Everything ──
function renderAll() {
  renderMoney();
  renderPipelineSnapshot();
  renderActiveDeals();
  renderTier();
  updateLastUpdated();
}

// ── Money Cards ──
function renderMoney() {
  // Default split is 50% (we'll show both tiers later when we add tier check)
  var split = 0.5;

  var lifetime = 0;
  var pending = 0;
  var nextDeal = null;

  allDeals.forEach(function(d) {
    var v = parseFloat(d.monetaryValue) || 0;
    if (d.status === 'won') {
      lifetime += v * split;
    } else if (d.status === 'open') {
      // Count "near close" stages as pending
      var stage = (d.stage || '').toLowerCase();
      if (stage.indexOf('assignment') !== -1 || stage.indexOf('emd') !== -1 || stage.indexOf('marketing') !== -1) {
        pending += v * split;
        if (!nextDeal) nextDeal = d;
      }
    }
  });

  document.getElementById('moneyLifetime').textContent = formatMoney(lifetime);
  document.getElementById('moneyLifetimeSub').textContent = countText(allDeals.filter(function(d){return d.status==='won';}).length, 'closed deal', 'closed deals');

  document.getElementById('moneyPending').textContent = formatMoney(pending);
  document.getElementById('moneyPendingSub').textContent = nextDeal ? 'In active marketing & negotiation' : 'No deals in close cycle yet';

  if (nextDeal) {
    document.getElementById('moneyNext').textContent = '~' + formatMoney(parseFloat(nextDeal.monetaryValue || 0) * split);
    document.getElementById('moneyNextSub').textContent = nextDeal.location || 'Active deal';
  } else {
    document.getElementById('moneyNext').textContent = '—';
    document.getElementById('moneyNextSub').textContent = 'Submit a deal to get started';
  }
}

// ── Pipeline Snapshot (4 cards) ──
function renderPipelineSnapshot() {
  var active = 0, neg = 0, won = 0, dead = 0;
  allDeals.forEach(function(d) {
    var stage = (d.stage || '').toLowerCase();
    if (d.status === 'won') won++;
    else if (d.status === 'lost' || d.status === 'abandoned') dead++;
    else if (stage.indexOf('assignment') !== -1 || stage.indexOf('emd') !== -1 || stage.indexOf('negotiation') !== -1) neg++;
    else active++;
  });
  document.getElementById('pipeActive').textContent = active;
  document.getElementById('pipeNeg').textContent = neg;
  document.getElementById('pipeWon').textContent = won;
  document.getElementById('pipeDead').textContent = dead;
}

// ── Filter state ──
var dealFilter = { search: '', status: 'all', sort: 'recent' };

window.setDealFilter = function(key, val) {
  dealFilter[key] = val;
  // Update active chip
  if (key === 'status') {
    document.querySelectorAll('.filter-chip').forEach(function(c) {
      c.classList.toggle('active', c.dataset.val === val);
    });
  }
  renderActiveDeals();
};

window.setDealSearch = function(val) {
  dealFilter.search = (val || '').toLowerCase();
  renderActiveDeals();
};

window.setDealSort = function(val) {
  dealFilter.sort = val;
  renderActiveDeals();
};

// ── Active Deals List ──
function renderActiveDeals() {
  var wrap = document.getElementById('pipeListWrap');
  var deals = allDeals.slice();

  // Filter by status chip
  if (dealFilter.status === 'all') {
    // Show all non-dead
    deals = deals.filter(function(d) { return d.status === 'open' || d.status === 'won'; });
  } else if (dealFilter.status === 'active') {
    deals = deals.filter(function(d) {
      var stage = (d.stage || '').toLowerCase();
      return d.status === 'open' && stage.indexOf('assignment') === -1 && stage.indexOf('emd') === -1;
    });
  } else if (dealFilter.status === 'negotiating') {
    deals = deals.filter(function(d) {
      var stage = (d.stage || '').toLowerCase();
      return d.status === 'open' && (stage.indexOf('assignment') !== -1 || stage.indexOf('emd') !== -1 || stage.indexOf('negotiation') !== -1);
    });
  } else if (dealFilter.status === 'closed') {
    deals = deals.filter(function(d) { return d.status === 'won'; });
  } else if (dealFilter.status === 'dead') {
    deals = deals.filter(function(d) { return d.status === 'lost' || d.status === 'abandoned'; });
  }

  // Search filter
  if (dealFilter.search) {
    deals = deals.filter(function(d) {
      var hay = ((d.location || '') + ' ' + (d.dealType || '') + ' ' + (d.name || '')).toLowerCase();
      return hay.indexOf(dealFilter.search) !== -1;
    });
  }

  // Sort
  if (dealFilter.sort === 'recent') {
    deals.sort(function(a, b) { return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0); });
  } else if (dealFilter.sort === 'oldest') {
    deals.sort(function(a, b) { return new Date(a.createdAt || 0) - new Date(b.createdAt || 0); });
  } else if (dealFilter.sort === 'value') {
    deals.sort(function(a, b) { return (parseFloat(b.monetaryValue) || 0) - (parseFloat(a.monetaryValue) || 0); });
  }

  if (deals.length === 0) {
    if (dealFilter.search || dealFilter.status !== 'all') {
      wrap.innerHTML =
        '<div class="empty-state">' +
          '<h3>No deals match your filters</h3>' +
          '<p>Try a different filter or clear your search.</p>' +
          '<button class="btn btn-ghost" onclick="clearFilters()">Clear filters</button>' +
        '</div>';
    } else {
      wrap.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>' +
          '<h3>No deals yet</h3>' +
          '<p>Submit a deal and we\'ll review within 24-48 hours.</p>' +
          '<a href="/submit-deal" class="btn btn-o">Submit a Deal</a>' +
        '</div>';
    }
    return;
  }

  wrap.innerHTML = deals.map(renderActiveRow).join('');
}

window.clearFilters = function() {
  dealFilter = { search: '', status: 'all', sort: 'recent' };
  var searchInput = document.getElementById('dealSearch');
  if (searchInput) searchInput.value = '';
  document.querySelectorAll('.filter-chip').forEach(function(c) {
    c.classList.toggle('active', c.dataset.val === 'all');
  });
  renderActiveDeals();
};

function renderActiveRow(deal) {
  var cfg = STAGE_CONFIG[deal.stage] || { label: deal.stage || 'Processing', color: '#718096', step: 1 };
  var bg = hexToRgba(cfg.color, 0.1);
  var dots = '';
  for (var i = 1; i <= TOTAL_STAGES; i++) {
    var cls = i < cfg.step ? 'dot done' : (i === cfg.step ? 'dot current' : 'dot');
    dots += '<div class="' + cls + '"></div>';
  }
  var nextStep = deal.partnerNote || 'We\'ll update you shortly.';
  var lastUpdate = deal.updatedAt ? timeAgo(deal.updatedAt) : '';

  return '<a href="/deal-detail?id=' + encodeURIComponent(deal.id) + '" class="pipe-row">' +
    '<div class="pipe-row-top">' +
      '<div class="pipe-row-addr">' + escHtml(deal.location || deal.dealType || 'Deal') + '</div>' +
      '<div class="pipe-row-badge" style="background:' + bg + ';color:' + cfg.color + '">' +
        '<span class="dot" style="background:' + cfg.color + '"></span>' +
        escHtml(cfg.label) +
      '</div>' +
    '</div>' +
    '<div class="progress-dots">' + dots + '</div>' +
    '<div class="pipe-row-status">' +
      '<strong>Next:</strong> ' + escHtml(nextStep) +
    '</div>' +
    '<div class="pipe-row-meta">' +
      '<span>' + (lastUpdate ? 'Updated ' + lastUpdate : 'Just submitted') + '</span>' +
      '<span class="right">View deal →</span>' +
    '</div>' +
  '</a>';
}

// ── Tier Progress ──
function renderTier() {
  var card = document.getElementById('tierCard');
  if (!card) return;

  var lifetimeFunded = 0;
  var closedThisQuarter = 0;
  var now = new Date();
  var quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

  allDeals.forEach(function(d) {
    if (d.status === 'won') {
      var v = parseFloat(d.monetaryValue) || 0;
      lifetimeFunded += v;
      if (d.updatedAt && new Date(d.updatedAt) >= quarterStart) {
        closedThisQuarter++;
      }
    }
  });

  var tags = partner.tags || [];
  var isProven = tags.indexOf('db-proven-partner') !== -1;

  if (isProven) {
    card.className = 'tier-card power';
    card.innerHTML =
      '<div class="label">⭐ Power Partner Status</div>' +
      '<h3>You\'re on the 30/70 split</h3>' +
      '<p class="desc">You\'ve earned the higher tier. Every deal you submit pays out at 70%. Keep stacking deals.</p>';
    return;
  }

  // Show progress toward proven
  var fundedPct = Math.min((lifetimeFunded / 25000) * 100, 100);
  var dealsPct = Math.min((closedThisQuarter / 3) * 100, 100);
  var pct = Math.max(fundedPct, dealsPct);

  card.innerHTML =
    '<div class="label">Tier Progress</div>' +
    '<h3>Path to Power Partner (30/70 split)</h3>' +
    '<div class="tier-bar"><div class="tier-bar-fill" style="width:' + pct.toFixed(0) + '%"></div></div>' +
    '<div class="progress-text">' +
      '$' + Math.round(lifetimeFunded).toLocaleString() + ' / $25,000 funded' +
      ' &nbsp;·&nbsp; ' +
      closedThisQuarter + ' / 3 deals this quarter' +
    '</div>' +
    '<div class="desc">Hit either threshold and your split bumps to 30/70 on every future deal. Keep submitting.</div>';
}

// ── Update last updated text ──
function updateLastUpdated() {
  var el = document.getElementById('lastUpdate');
  if (el) el.textContent = 'Synced just now';
}

// ── Logout ──
function logout() {
  partner = null;
  allDeals = [];
  sessionStorage.removeItem('db_partner');
  document.getElementById('dashView').classList.remove('show');
  document.getElementById('loginView').style.display = '';
  document.getElementById('loginPhone').value = '';
  document.getElementById('loginEmail').value = '';
  var navRight = document.getElementById('navRight');
  navRight.innerHTML = '<a href="/submit-deal" class="btn btn-o btn-sm">Submit a Deal</a>';
}

// ── Helpers ──
function formatMoney(n) {
  if (!n || n === 0) return '$0';
  if (n >= 1000) return '$' + Math.round(n).toLocaleString();
  return '$' + Math.round(n);
}

function countText(n, singular, plural) {
  if (n === 0) return 'No deals yet';
  return n + ' ' + (n === 1 ? singular : plural);
}

function timeAgo(iso) {
  var d = new Date(iso);
  var diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
  if (diff < 604800) return Math.floor(diff / 86400) + ' days ago';
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
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
  div.appendChild(document.createTextNode(s || ''));
  return div.innerHTML;
}
