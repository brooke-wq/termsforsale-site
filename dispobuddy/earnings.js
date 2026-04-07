/* ============================================
   DISPO BUDDY — EARNINGS JS
   ============================================ */

var partner = null;
var allDeals = [];

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
  loadDeals();
})();

async function loadDeals() {
  try {
    var res = await fetch('/.netlify/functions/partner-deals?contactId=' + encodeURIComponent(partner.id));
    var data = await res.json();
    if (!res.ok) {
      document.getElementById('content').innerHTML =
        '<div class="loading" style="color:var(--red)">Failed to load earnings.</div>';
      return;
    }
    allDeals = data.deals || [];
    renderEarnings();
  } catch(err) {
    document.getElementById('content').innerHTML =
      '<div class="loading" style="color:var(--red)">Connection error.</div>';
  }
}

function renderEarnings() {
  var tags = partner.tags || [];
  var isProven = tags.indexOf('db-proven-partner') !== -1;
  var split = isProven ? 0.7 : 0.5;
  var splitLabel = isProven ? '30/70' : '50/50';

  // Calculate stats
  var lifetime = 0;
  var pending = 0;
  var closedDeals = [];
  var pendingDeals = [];
  var totalDays = 0;
  var dealsWithDays = 0;
  var fundedThisQuarter = 0;
  var closedThisQuarter = 0;

  var now = new Date();
  var quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

  allDeals.forEach(function(d) {
    var v = parseFloat(d.monetaryValue) || 0;
    var fee = v * split;

    if (d.status === 'won') {
      lifetime += fee;
      closedDeals.push({ deal: d, fee: fee });

      if (d.createdAt && d.updatedAt) {
        var days = Math.floor((new Date(d.updatedAt) - new Date(d.createdAt)) / 86400000);
        if (days >= 0) {
          totalDays += days;
          dealsWithDays++;
        }
      }
      if (d.updatedAt && new Date(d.updatedAt) >= quarterStart) {
        fundedThisQuarter += v;
        closedThisQuarter++;
      }
    } else if (d.status === 'open') {
      pending += fee;
      pendingDeals.push({ deal: d, fee: fee });
    }
  });

  // Sort closed deals by date desc
  closedDeals.sort(function(a, b) {
    return new Date(b.deal.updatedAt || 0) - new Date(a.deal.updatedAt || 0);
  });

  var avgFee = closedDeals.length > 0 ? lifetime / closedDeals.length : 0;
  var avgDays = dealsWithDays > 0 ? Math.round(totalDays / dealsWithDays) : 0;

  // Build HTML
  var html = '';

  // Page header
  html += '<div class="page-header">';
  html += '<h1>Earnings & Performance</h1>';
  html += '<div class="sub">Your money, your tier, your closed deals.</div>';
  html += '</div>';

  // Big lifetime card
  html += '<div class="big-money">';
  html += '<div class="label">Lifetime Earned</div>';
  html += '<div class="num">' + formatMoney(lifetime) + '</div>';
  html += '<div class="sub">' + closedDeals.length + ' closed deal' + (closedDeals.length === 1 ? '' : 's') + ' · ' + splitLabel + ' split</div>';
  html += '</div>';

  // Hero stats
  html += '<div class="hero-stats">';
  html += statCard('Pending', formatMoney(pending), pendingDeals.length + ' deal' + (pendingDeals.length === 1 ? '' : 's'));
  html += statCard('Closed', closedDeals.length, 'lifetime');
  html += statCard('Avg Fee', formatMoney(avgFee), 'per closed deal');
  html += statCard('Avg Days', avgDays || '—', avgDays ? 'submit to close' : 'no data yet');
  html += '</div>';

  // Tier card
  html += renderTierCard(isProven, lifetime, closedThisQuarter);

  // Pending deals section
  html += '<div class="section">';
  html += '<div class="section-head">';
  html += '<h2>Pending</h2>';
  html += '<div class="count">' + pendingDeals.length + ' active deal' + (pendingDeals.length === 1 ? '' : 's') + '</div>';
  html += '</div>';
  if (pendingDeals.length === 0) {
    html += emptyState('No pending deals', 'Submit a deal to start earning.');
  } else {
    pendingDeals.forEach(function(item) {
      html += renderDealRow(item.deal, item.fee, true);
    });
  }
  html += '</div>';

  // Closed deals section
  html += '<div class="section">';
  html += '<div class="section-head">';
  html += '<h2>Closed Deals</h2>';
  html += '<div class="count">' + closedDeals.length + ' total</div>';
  html += '</div>';
  if (closedDeals.length === 0) {
    html += emptyState('No closed deals yet', 'Your first close pays here.');
  } else {
    closedDeals.forEach(function(item) {
      html += renderDealRow(item.deal, item.fee, false);
    });
  }
  html += '</div>';

  document.getElementById('content').innerHTML = html;
}

function renderTierCard(isProven, lifetime, closedThisQuarter) {
  if (isProven) {
    return '<div class="tier-card power">' +
      '<div class="badge">⭐ Power Partner</div>' +
      '<h2>You\'re on the 30/70 split</h2>' +
      '<div class="current-split">Every deal you close pays out at 70%</div>' +
      '<div class="desc">You\'ve earned the higher tier. Keep stacking deals to maintain status quarter over quarter.</div>' +
    '</div>';
  }

  var fundedPct = Math.min((lifetime / 25000) * 100, 100);
  var dealsPct = Math.min((closedThisQuarter / 3) * 100, 100);
  var pct = Math.max(fundedPct, dealsPct);

  return '<div class="tier-card">' +
    '<div class="badge">Emerging Partner</div>' +
    '<h2>Path to Power Partner (30/70 split)</h2>' +
    '<div class="current-split">Current: 50/50 split</div>' +
    '<div class="tier-bar"><div class="tier-bar-fill" style="width:' + pct.toFixed(0) + '%"></div></div>' +
    '<div class="progress-text">' +
      '$' + Math.round(lifetime).toLocaleString() + ' / $25,000 funded' +
      ' &nbsp;·&nbsp; ' +
      closedThisQuarter + ' / 3 deals this quarter' +
    '</div>' +
    '<div class="desc">Hit either threshold and your split bumps to 30/70 on every future deal. The more you close, the more you keep.</div>' +
  '</div>';
}

function statCard(label, num, sub) {
  return '<div class="hero-stat">' +
    '<div class="label">' + escHtml(label) + '</div>' +
    '<div class="num">' + escHtml(num) + '</div>' +
    '<div class="sub">' + escHtml(sub) + '</div>' +
  '</div>';
}

function renderDealRow(deal, fee, isPending) {
  var addr = deal.location || deal.dealType || 'Deal';
  var date = deal.updatedAt || deal.createdAt;
  var dateStr = date ? formatDate(date) : '';
  var stage = deal.stage || '';
  var feeStr = formatMoney(fee);
  var feeClass = isPending ? 'pending' : '';
  var feeLabel = isPending ? 'Projected' : 'Earned';

  return '<a href="/deal-detail?id=' + encodeURIComponent(deal.id) + '" class="deal-row">' +
    '<div class="deal-row-info">' +
      '<h3>' + escHtml(addr) + '</h3>' +
      '<div class="meta">' +
        (dateStr ? escHtml(dateStr) : '') +
        (dateStr && stage ? '<span class="dot-sep">·</span>' : '') +
        (stage ? escHtml(stage) : '') +
      '</div>' +
    '</div>' +
    '<div class="deal-row-payout">' +
      '<div class="amount ' + feeClass + '">' + feeStr + '</div>' +
      '<div class="label">' + feeLabel + '</div>' +
    '</div>' +
  '</a>';
}

function emptyState(title, sub) {
  return '<div class="empty-state">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 12l-4-4-4 4M12 16V8"/></svg>' +
    '<h3>' + escHtml(title) + '</h3>' +
    '<p>' + escHtml(sub) + '</p>' +
  '</div>';
}

function formatMoney(n) {
  if (!n || n === 0) return '$0';
  return '$' + Math.round(n).toLocaleString();
}

function formatDate(iso) {
  var d = new Date(iso);
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function escHtml(s) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(s == null ? '' : String(s)));
  return div.innerHTML;
}
