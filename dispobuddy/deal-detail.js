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

  // Live listing CTA (only if deal is marketing+ and has a URL)
  var marketingStages = ['Actively Marketing', 'Assignment Sent', 'Assigned with EMD', 'Closed'];
  if (deal.liveListingUrl && marketingStages.indexOf(deal.stage) !== -1) {
    html += '<a href="' + escAttr(deal.liveListingUrl) + '" target="_blank" rel="noopener" ' +
      'style="display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,#EBF8FF,#d0eef9);' +
      'border:1px solid #29ABE2;border-radius:12px;padding:16px 20px;margin-bottom:20px;' +
      'color:#0D1F3C;transition:transform .15s" onmouseover="this.style.transform=\'translateY(-1px)\'" ' +
      'onmouseout="this.style.transform=\'translateY(0)\'">' +
      '<div style="width:40px;height:40px;border-radius:10px;background:#29ABE2;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M15 3h6v6M14 10l7-7M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>' +
      '</div>' +
      '<div style="flex:1">' +
        '<div style="font-size:14px;font-weight:700;color:#0D1F3C">View Live Listing</div>' +
        '<div style="font-size:12px;color:#4A6070;margin-top:2px">See what buyers see on Terms For Sale</div>' +
      '</div>' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#29ABE2" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>' +
    '</a>';
  }

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
  html += '<div class="section">';
  html += '<div class="section-head">Files & Docs</div>';
  html += '<div class="files-list">';
  if (deal.photoLink) html += fileRow(deal.photoLink, 'Property Photos', 'photo');
  if (deal.docsLink) html += fileRow(deal.docsLink, 'Supporting Documents', 'doc');
  if (!deal.photoLink && !deal.docsLink) {
    html += '<div style="font-size:13px;color:var(--text-light);padding:8px 0">No files attached yet.</div>';
  }
  html += '</div>';

  // Add-link form
  html += '<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border-light)">';
  html += '<div style="font-size:12px;font-weight:600;color:var(--text-mid);margin-bottom:10px">Add a new link (Google Drive, Dropbox, etc.)</div>';
  html += '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">';
  html += '<select id="linkType" class="fi" style="flex:0 0 140px;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font);font-size:13px;background:var(--white);outline:none">';
  html += '<option value="photos">Photos</option>';
  html += '<option value="documents">Documents</option>';
  html += '<option value="other">Other</option>';
  html += '</select>';
  html += '<input type="url" id="linkUrl" class="fi" placeholder="https://drive.google.com/..." style="flex:1;min-width:200px;padding:10px 14px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font);font-size:13px;outline:none">';
  html += '</div>';
  html += '<button class="btn btn-o" onclick="addLink()" id="addLinkBtn" style="width:100%">Add Link</button>';
  html += '<div id="addLinkMsg" style="font-size:12px;margin-top:8px;display:none"></div>';
  html += '</div>';

  html += '</div>';

  // Messages (per-deal thread)
  html += '<div class="section">';
  html += '<div class="section-head">Messages</div>';
  html += '<div id="dealMsgList" style="display:flex;flex-direction:column;gap:10px;max-height:300px;overflow-y:auto;margin-bottom:14px;padding-right:4px">';
  html += '<div style="font-size:12px;color:var(--text-light);text-align:center;padding:20px">Loading...</div>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;border-top:1px solid var(--border-light);padding-top:14px">';
  html += '<textarea id="dealMsgInput" placeholder="Message the team about this deal..." rows="1" ' +
    'style="flex:1;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font);font-size:13px;color:var(--navy);outline:none;resize:none;min-height:40px;max-height:120px"></textarea>';
  html += '<button class="btn btn-o" onclick="sendDealMessage()" id="dealMsgBtn" style="padding:10px 18px">Send</button>';
  html += '</div>';
  html += '<div id="dealMsgStatus" style="font-size:12px;margin-top:8px;display:none"></div>';
  html += '</div>';

  // Contact actions
  html += '<div class="section">';
  html += '<div class="section-head">Need Anything?</div>';
  html += '<div class="contact-row">';
  html += '<a href="sms:+14808425332" class="btn btn-o">Text the team</a>';
  html += '<a href="mailto:info@dispobuddy.com?subject=' + encodeURIComponent('RE: ' + (deal.address || 'My deal')) + '" class="btn btn-ghost">Email us</a>';
  html += '</div>';
  html += '</div>';

  content.innerHTML = html;

  // Load deal-scoped messages
  loadDealMessages();
}

async function loadDealMessages() {
  var list = document.getElementById('dealMsgList');
  if (!list) return;
  try {
    var res = await fetch('/.netlify/functions/partner-messages?contactId=' + encodeURIComponent(partner.id));
    var data = await res.json();
    if (!res.ok) {
      list.innerHTML = '<div style="font-size:12px;color:var(--red);text-align:center;padding:20px">Could not load messages</div>';
      return;
    }
    var messages = data.messages || [];
    // Filter to messages that reference this deal's address (best-effort scoping)
    var addrKey = (deal.address || '').split(',')[0].toLowerCase().trim();
    if (addrKey) {
      var filtered = messages.filter(function(m) {
        var body = ((m.body || '') + ' ' + (m.subject || '')).toLowerCase();
        return body.indexOf(addrKey) !== -1;
      });
      if (filtered.length > 0) messages = filtered;
      else messages = messages.slice(-5); // fallback: show last 5 of all messages
    }

    if (messages.length === 0) {
      list.innerHTML = '<div style="font-size:12px;color:var(--text-light);text-align:center;padding:20px">No messages yet. Send one to start the conversation.</div>';
      return;
    }

    var html = '';
    messages.forEach(function(m) {
      var dir = m.direction === 'outbound' ? 'outbound' : 'inbound';
      var bg = dir === 'outbound' ? 'background:#29ABE2;color:#fff' : 'background:#F4F6F9;color:#0D1F3C';
      var align = dir === 'outbound' ? 'align-self:flex-end' : 'align-self:flex-start';
      var time = m.createdAt ? timeOnly(m.createdAt) : '';
      html += '<div style="' + align + ';max-width:85%;padding:10px 14px;border-radius:14px;' + bg + ';font-size:13px;line-height:1.5">' +
        escHtml(m.body || m.subject || '') +
        '<div style="font-size:10px;opacity:.7;margin-top:3px">' + escHtml(time) + '</div>' +
      '</div>';
    });
    list.innerHTML = html;
    list.scrollTop = list.scrollHeight;
  } catch(err) {
    list.innerHTML = '<div style="font-size:12px;color:var(--red);text-align:center;padding:20px">Connection error</div>';
  }
}

window.sendDealMessage = async function() {
  var ta = document.getElementById('dealMsgInput');
  var btn = document.getElementById('dealMsgBtn');
  var status = document.getElementById('dealMsgStatus');
  var msg = (ta.value || '').trim();
  if (!msg) return;

  // Prefix with deal address so team and threading know context
  var addrPrefix = deal.address ? '[RE: ' + deal.address + '] ' : '';
  var fullMsg = addrPrefix + msg;

  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    var res = await fetch('/.netlify/functions/partner-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: partner.id, message: fullMsg }),
    });
    var data = await res.json();
    if (!res.ok) {
      status.textContent = data.error || 'Failed to send';
      status.style.cssText = 'font-size:12px;margin-top:8px;color:#ef4444';
      status.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Send';
      return;
    }
    ta.value = '';
    status.textContent = data.testMode ? 'Saved (test mode)' : 'Sent';
    status.style.cssText = 'font-size:12px;margin-top:8px;color:#16a34a';
    status.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Send';
    setTimeout(loadDealMessages, 800);
    setTimeout(function() { status.style.display = 'none'; }, 3000);
  } catch(err) {
    status.textContent = 'Connection error';
    status.style.cssText = 'font-size:12px;margin-top:8px;color:#ef4444';
    status.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Send';
  }
};

function timeOnly(iso) {
  var d = new Date(iso);
  var h = d.getHours();
  var m = d.getMinutes();
  var ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return h + ':' + (m < 10 ? '0' : '') + m + ampm;
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

window.addLink = async function() {
  var linkType = document.getElementById('linkType').value;
  var url = document.getElementById('linkUrl').value.trim();
  var msgEl = document.getElementById('addLinkMsg');
  var btn = document.getElementById('addLinkBtn');

  msgEl.style.display = 'none';
  msgEl.className = '';

  if (!url) {
    msgEl.textContent = 'Paste a link first.';
    msgEl.style.cssText = 'font-size:12px;margin-top:8px;color:#ef4444';
    msgEl.style.display = 'block';
    return;
  }
  if (!/^https?:\/\/.+\..+/.test(url)) {
    msgEl.textContent = 'Please enter a valid URL.';
    msgEl.style.cssText = 'font-size:12px;margin-top:8px;color:#ef4444';
    msgEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Adding...';

  try {
    var res = await fetch('/.netlify/functions/partner-add-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactId: partner.id,
        opportunityId: deal.id,
        linkType: linkType,
        url: url,
      }),
    });
    var data = await res.json();
    if (!res.ok) {
      msgEl.textContent = data.error || 'Failed to add link.';
      msgEl.style.cssText = 'font-size:12px;margin-top:8px;color:#ef4444';
      msgEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Add Link';
      return;
    }
    msgEl.textContent = '✓ Link added — our team will review it.';
    msgEl.style.cssText = 'font-size:12px;margin-top:8px;color:#16a34a';
    msgEl.style.display = 'block';
    document.getElementById('linkUrl').value = '';
    btn.disabled = false;
    btn.textContent = 'Add Link';
    // Refresh the deal after short delay
    setTimeout(function() { loadDeal(deal.id); }, 1200);
  } catch(err) {
    msgEl.textContent = 'Connection error. Please try again.';
    msgEl.style.cssText = 'font-size:12px;margin-top:8px;color:#ef4444';
    msgEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Add Link';
  }
};

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
