// Netlify Function: create-post
// Called by the VA Post Builder form
// Creates a new HTML file in GitHub via API — VA never touches GitHub
// Requires env vars: GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Verify the VA password
  var data;
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (data.password !== process.env.VA_PASSWORD) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Incorrect password' })
    };
  }

  // Auth check only — just verify password, don't create anything
  if (data.authCheck) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, authOnly: true })
    };
  }

  var token     = process.env.GITHUB_TOKEN;
  var owner     = process.env.GITHUB_REPO_OWNER;  // e.g. brooke-wq
  var repo      = process.env.GITHUB_REPO_NAME;   // e.g. termsforsale-site
  var branch    = 'main';

  if (!token || !owner || !repo) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server not configured. Contact your admin.' })
    };
  }

  // Build slug from city + state + deal type
  function slugify(str) {
    return str.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  var slug = slugify(data.dealType + '-deal-' + data.city + '-' + data.state);
  var filePath = 'termsforsale/blog/posts/' + slug + '.html';

  // Build the HTML page from form data
  var statusClass = data.status === 'Active' ? 'status-active'
    : data.status === 'Under Contract' ? 'status-contract' : 'status-sold';

  var equityAtEntry = '';
  if (data.arv && data.askingPrice) {
    var eq = parseFloat(data.arv.replace(/[$,]/g,'')) - parseFloat(data.askingPrice.replace(/[$,]/g,''));
    if (eq > 0) equityAtEntry = '$' + eq.toLocaleString();
  }

  var html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(data.headline)} | Terms For Sale</title>
<meta name="description" content="${escHtml(data.metaDesc)}">
<link rel="canonical" href="https://deals.termsforsale.com/blog/posts/${slug}/">
<meta property="og:title" content="${escHtml(data.headline)}">
<meta property="og:description" content="${escHtml(data.hook)}">
<meta property="og:type" content="article">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--navy:#0D1F3C;--blue:#29ABE2;--blue-dark:#1a8bbf;--blue-light:#EBF8FF;--orange:#F7941D;--orange-dark:#d97c0e;--green:#10B981;--white:#fff;--bg:#F4F6F9;--text:#0D1F3C;--text-mid:#4A5568;--text-light:#718096;--border:#E2E8F0;--font:'Poppins',sans-serif;--r:10px}
body{font-family:var(--font);color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased;line-height:1.6}
nav{background:var(--navy);height:70px;display:flex;align-items:center;justify-content:space-between;padding:0 48px;position:sticky;top:0;z-index:100}
.nav-logo img{height:40px}
.nav-links{display:flex;gap:24px}.nav-links a{color:rgba(255,255,255,.75);text-decoration:none;font-size:14px;font-weight:500}
.btn-nav{padding:8px 18px;border-radius:8px;background:var(--blue);color:#fff;font-size:13px;font-weight:600;text-decoration:none}
.post-hero{background:var(--navy);padding:52px 48px 44px}
.post-hero-inner{max-width:1100px;margin:0 auto}
.post-breadcrumb{font-size:12px;color:rgba(255,255,255,.4);margin-bottom:16px}
.post-breadcrumb a{color:rgba(255,255,255,.5);text-decoration:none}
.post-type-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:6px;background:rgba(247,148,29,.2);border:1px solid rgba(247,148,29,.4);color:var(--orange);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px}
.post-hero h1{font-size:44px;font-weight:900;color:#fff;line-height:1.1;letter-spacing:-.5px;margin-bottom:16px;max-width:800px}
.post-hook{font-size:18px;color:rgba(255,255,255,.7);max-width:680px;line-height:1.65;margin-bottom:24px}
.post-meta{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.post-meta-item{display:flex;align-items:center;gap:5px;font-size:12px;color:rgba(255,255,255,.45);font-weight:500}
.status-badge{padding:4px 10px;border-radius:50px;font-size:11px;font-weight:700;text-transform:uppercase}
.status-active{background:rgba(16,185,129,.2);color:#6ee7b7;border:1px solid rgba(16,185,129,.3)}
.status-contract{background:rgba(247,148,29,.2);color:#fcd34d;border:1px solid rgba(247,148,29,.3)}
.status-sold{background:rgba(107,114,128,.2);color:#9ca3af;border:1px solid rgba(107,114,128,.3)}
.snapshot-bar{background:#fff;border-bottom:1px solid var(--border);padding:0 48px}
.snapshot-inner{max-width:1100px;margin:0 auto;display:flex;overflow-x:auto;scrollbar-width:none}
.snap-item{padding:18px 24px;border-right:1px solid var(--border);flex-shrink:0;text-align:center;min-width:140px}
.snap-item:last-child{border-right:none}
.snap-label{font-size:10px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px}
.snap-value{font-size:20px;font-weight:800;color:var(--navy);display:block;line-height:1}
.snap-value.highlight{color:var(--blue)}.snap-value.green{color:var(--green)}
.post-layout{max-width:1100px;margin:0 auto;padding:44px 48px 80px;display:grid;grid-template-columns:1fr 340px;gap:40px;align-items:start}
.article-body h2{font-size:26px;font-weight:800;color:var(--navy);margin:36px 0 14px;letter-spacing:-.3px}
.article-body h2:first-child{margin-top:0}
.article-body p{font-size:15px;color:var(--text-mid);line-height:1.75;margin-bottom:16px}
.article-body ul{padding-left:20px;margin-bottom:16px}
.article-body li{font-size:15px;color:var(--text-mid);line-height:1.7;margin-bottom:6px}
.article-body strong{color:var(--text);font-weight:700}
.deal-table{width:100%;border-collapse:collapse;margin:20px 0;border-radius:var(--r);overflow:hidden;border:1px solid var(--border)}
.deal-table th{background:var(--navy);color:#fff;padding:11px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.deal-table td{padding:11px 16px;border-bottom:1px solid var(--border);font-size:14px;color:var(--text-mid)}
.deal-table tr:last-child td{border-bottom:none}
.deal-table tr:nth-child(even) td{background:#f8fafc}
.deal-table td:last-child{font-weight:700;color:var(--navy)}
.callout{border-radius:var(--r);padding:18px 20px;margin:24px 0}
.callout-blue{background:var(--blue-light);border-left:4px solid var(--blue)}
.callout-orange{background:#FFF3E0;border-left:4px solid var(--orange)}
.callout-red{background:#fff5f5;border-left:4px solid #e53e3e}
.callout-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.callout-blue .callout-title{color:var(--blue-dark)}.callout-orange .callout-title{color:#c05621}.callout-red .callout-title{color:#c53030}
.callout p{font-size:14px;margin:0;line-height:1.65}
.buyer-fit{background:var(--navy);border-radius:14px;padding:24px;margin:32px 0}
.buyer-fit h3{font-size:16px;font-weight:800;color:#fff;margin-bottom:16px}
.buyer-fit-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.buyer-fit-yes,.buyer-fit-no{padding:12px 14px;border-radius:8px}
.buyer-fit-yes{background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.25)}
.buyer-fit-no{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2)}
.buyer-fit-yes p{font-size:13px;margin:0;color:#6ee7b7}
.buyer-fit-no p{font-size:13px;margin:0;color:#fca5a5}
.bfy-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;display:block}
.buyer-fit-yes .bfy-label{color:rgba(110,231,183,.7)}.buyer-fit-no .bfy-label{color:rgba(252,165,165,.7)}
.sidebar{position:sticky;top:88px;display:flex;flex-direction:column;gap:16px}
.cta-card{background:var(--navy);border-radius:14px;overflow:hidden}
.cta-card-head{padding:20px 20px 16px;border-bottom:1px solid rgba(255,255,255,.1)}
.cta-card-head h3{font-size:15px;font-weight:800;color:#fff;margin-bottom:4px}
.cta-card-head p{font-size:12px;color:rgba(255,255,255,.55)}
.cta-card-perks{padding:14px 20px;border-bottom:1px solid rgba(255,255,255,.08)}
.cta-perk{display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.65);padding:5px 0}
.cta-card-form{padding:16px 20px 20px;display:flex;flex-direction:column;gap:10px}
.cta-input{padding:10px 14px;border:1.5px solid rgba(255,255,255,.15);border-radius:8px;background:rgba(255,255,255,.08);color:#fff;font-family:var(--font);font-size:13px;outline:none;width:100%;transition:border .2s}
.cta-input:focus{border-color:var(--blue);background:rgba(255,255,255,.12)}
.cta-input::placeholder{color:rgba(255,255,255,.3)}
.cta-select{width:100%;padding:10px 28px 10px 14px;border:1.5px solid rgba(255,255,255,.15);border-radius:8px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.8);font-family:var(--font);font-size:13px;outline:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='9' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;cursor:pointer}
.cta-select option{background:#1a2e47}
.cta-note{font-size:10px;color:rgba(255,255,255,.3);text-align:center}
.btn-orange-full{display:block;width:100%;padding:12px;background:var(--orange);color:#fff;border:none;border-radius:8px;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer;text-align:center}
.btn-blue-full{display:block;width:100%;padding:12px;background:var(--blue);color:#fff;border:none;border-radius:8px;font-family:var(--font);font-size:13px;font-weight:700;text-align:center;text-decoration:none}
.info-card{background:#fff;border-radius:14px;border:1px solid var(--border);overflow:hidden}
.info-card-head{padding:14px 16px;background:var(--bg);border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px}
.info-row{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);font-size:13px}
.info-row:last-child{border-bottom:none}
.info-label{color:var(--text-light);font-weight:500}.info-value{font-weight:700;color:var(--navy)}
.urgency-bar{background:#FFF3E0;border:1px solid #fcd34d;border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:8px;font-size:12px;color:#92400e;font-weight:600}
.disclaimer{background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:16px;font-size:11px;color:var(--text-light);line-height:1.8;margin-top:32px}
footer{background:var(--navy);padding:32px 48px;text-align:center;font-size:12px;color:rgba(255,255,255,.3)}
footer a{color:rgba(255,255,255,.5);text-decoration:none;margin:0 8px}
@media(max-width:1024px){.post-layout{grid-template-columns:1fr;padding:32px 24px 60px}.sidebar{position:static}.post-hero,.snapshot-bar{padding-left:24px;padding-right:24px}}
@media(max-width:768px){nav{padding:0 20px}.post-hero h1{font-size:30px}}
</style>
</head>
<body>

<nav>
  <a href="/"><img src="https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg" alt="Terms For Sale" style="height:40px"></a>
  <div class="nav-links"><a href="/">Active Deals</a><a href="/map.html">Deal Map</a><a href="/blog/">Blog</a></div>
  <a href="/" class="btn-nav">View All Deals</a>
</nav>

<div class="post-hero">
  <div class="post-hero-inner">
    <div class="post-breadcrumb"><a href="/blog/">Blog</a> › <a href="/blog/">Deal Spotlights</a> › ${escHtml(data.city)}, ${escHtml(data.state)}</div>
    <div class="post-type-badge">🏠 Deal Spotlight — ${escHtml(data.dealType)}</div>
    <h1>${escHtml(data.headline)}</h1>
    <p class="post-hook">${escHtml(data.hook)}</p>
    <div class="post-meta">
      <span class="status-badge ${statusClass}">● ${escHtml(data.status)}</span>
      <span class="post-meta-item">📍 ${escHtml(data.city)}, ${escHtml(data.state)}</span>
      <span class="post-meta-item">📅 Posted ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</span>
      ${data.dealId ? `<span class="post-meta-item">🏷 Deal ID: ${escHtml(data.dealId)}</span>` : ''}
    </div>
  </div>
</div>

<div class="snapshot-bar">
  <div class="snapshot-inner">
    ${data.askingPrice ? `<div class="snap-item"><span class="snap-label">Asking Price</span><span class="snap-value">${escHtml(data.askingPrice)}</span></div>` : ''}
    ${data.entryFee ? `<div class="snap-item"><span class="snap-label">Entry Fee</span><span class="snap-value highlight">${escHtml(data.entryFee)}</span></div>` : ''}
    ${data.interestRate ? `<div class="snap-item"><span class="snap-label">Rate Locked</span><span class="snap-value green">${escHtml(data.interestRate)}</span></div>` : ''}
    ${data.estRent ? `<div class="snap-item"><span class="snap-label">Est. Rent</span><span class="snap-value">${escHtml(data.estRent)}</span></div>` : ''}
    ${equityAtEntry ? `<div class="snap-item"><span class="snap-label">Equity at Entry</span><span class="snap-value green">${equityAtEntry}</span></div>` : ''}
    ${data.bedsBaths ? `<div class="snap-item"><span class="snap-label">Beds / Baths</span><span class="snap-value">${escHtml(data.bedsBaths)}</span></div>` : ''}
    ${data.sqft ? `<div class="snap-item"><span class="snap-label">Sqft</span><span class="snap-value">${escHtml(data.sqft)}</span></div>` : ''}
    ${data.coe ? `<div class="snap-item"><span class="snap-label">COE</span><span class="snap-value" style="font-size:15px">${escHtml(data.coe)}</span></div>` : ''}
  </div>
</div>

<div class="post-layout">
  <div>
    <div class="article-body">

      <h2>Why This Deal Exists Right Now</h2>
      ${data.whyExists.split('\n').filter(p=>p.trim()).map(p=>`<p>${escHtml(p)}</p>`).join('\n      ')}

      <h2>The Full Numbers Breakdown</h2>
      <table class="deal-table">
        <tr><th>Field</th><th>Details</th></tr>
        ${data.askingPrice ? `<tr><td>Asking Price</td><td>${escHtml(data.askingPrice)}</td></tr>` : ''}
        ${data.entryFee ? `<tr><td>Entry Fee (Out of Pocket)</td><td>${escHtml(data.entryFee)}</td></tr>` : ''}
        ${data.loanBalance ? `<tr><td>Existing Loan Balance</td><td>${escHtml(data.loanBalance)}</td></tr>` : ''}
        ${data.interestRate ? `<tr><td>Interest Rate (LOCKED)</td><td>${escHtml(data.interestRate)}</td></tr>` : ''}
        ${data.piti ? `<tr><td>PITI Payment</td><td>${escHtml(data.piti)}/mo</td></tr>` : ''}
        ${data.sfTerms ? `<tr><td>Seller Finance Terms</td><td>${escHtml(data.sfTerms)}</td></tr>` : ''}
        ${data.estRent ? `<tr><td>Est. Market Rent</td><td>${escHtml(data.estRent)}</td></tr>` : ''}
        ${data.arv ? `<tr><td>Comps ARV</td><td>${escHtml(data.arv)}</td></tr>` : ''}
        ${equityAtEntry ? `<tr><td>Equity at Entry</td><td>${equityAtEntry}</td></tr>` : ''}
        ${data.bedsBaths ? `<tr><td>Beds / Baths</td><td>${escHtml(data.bedsBaths)}</td></tr>` : ''}
        ${data.sqft ? `<tr><td>Square Footage</td><td>${escHtml(data.sqft)}</td></tr>` : ''}
        ${data.yearBuilt ? `<tr><td>Year Built</td><td>${escHtml(data.yearBuilt)}</td></tr>` : ''}
        ${data.coe ? `<tr><td>Close of Escrow</td><td>${escHtml(data.coe)}</td></tr>` : ''}
      </table>

      <h2>Investment Strategies That Work Here</h2>
      ${data.strategies.split('\n').filter(p=>p.trim()).map(p=>`<p>${escHtml(p)}</p>`).join('\n      ')}

      <h2>Who This Deal Is For</h2>
      <div class="buyer-fit">
        <h3>Buyer Fit</h3>
        <div class="buyer-fit-grid">
          ${data.buyerFitYes.split('\n').filter(r=>r.trim()).map(r=>`
          <div class="buyer-fit-yes"><span class="bfy-label">✓ Great fit if you…</span><p>${escHtml(r)}</p></div>`).join('')}
        </div>
      </div>

      <div class="callout callout-orange" style="margin-top:32px">
        <div class="callout-title">🚀 Ready to Move on This Deal?</div>
        <p>Active deals like this go fast. Fill out the form to get full address, lockbox access, and a call with our deal coordinator within 24 hours.</p>
      </div>

    </div>

    <div class="disclaimer"><strong>Disclaimer:</strong> All figures including asking price, entry fee, ARV, rent estimates, cash flow projections, and investment returns are estimates only and are provided for informational purposes. They do not constitute a guarantee of value, return, or outcome. Deal Pros LLC facilitates the wholesale assignment of purchase contracts. We are not a licensed real estate broker, financial advisor, or attorney. Nothing on this page constitutes legal, financial, or investment advice. Buyers should conduct their own due diligence and consult a licensed attorney and CPA before transacting.</div>
  </div>

  <div class="sidebar">
    ${data.coe ? `<div class="urgency-bar">⚡ COE ${escHtml(data.coe)} — move fast</div>` : ''}
    <div class="cta-card">
      <div class="cta-card-head"><h3>Request Access to This Deal</h3><p>Get the full address, lockbox code, and deal package within 24 hours.</p></div>
      <div class="cta-card-perks">
        <div class="cta-perk">✓ No agent needed</div>
        <div class="cta-perk">✓ Full deal package sent instantly</div>
        <div class="cta-perk">✓ Coordinator assigned to your inquiry</div>
      </div>
      <div class="cta-card-form">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <input class="cta-input" id="b-fn" placeholder="First Name">
          <input class="cta-input" id="b-ln" placeholder="Last Name">
        </div>
        <input class="cta-input" id="b-phone" type="tel" placeholder="Phone Number">
        <input class="cta-input" id="b-email" type="email" placeholder="Email Address">
        <select class="cta-select" id="b-buy">
          <option value="">How do you buy?</option>
          <option>Cash</option><option>Subject To</option><option>Seller Finance</option>
          <option>Lease Option</option><option>Novation</option><option>Morby Method</option>
          <option>Assumable Loans</option><option>Partnerships/JV</option>
          <option>Traditional Financing</option><option>DSCR</option>
        </select>
        <div id="blog-err" style="font-size:12px;color:#e53e3e;display:none"></div>
        <div id="blog-ok" style="font-size:12px;color:#276749;background:#E6F9F0;border:1px solid #b2dfce;border-radius:6px;padding:8px 12px;display:none"></div>
        <button class="btn-orange-full" onclick="blogSubmit()">📋 Request Access Now</button>
        <div class="cta-note">By submitting you agree to receive SMS &amp; email. Reply STOP to opt out.</div>
      </div>
    </div>
    <div class="info-card">
      <div class="info-card-head">Deal Quick Info</div>
      <div class="info-row"><span class="info-label">Deal Type</span><span class="info-value">${escHtml(data.dealType)}</span></div>
      ${data.dealId ? `<div class="info-row"><span class="info-label">Deal ID</span><span class="info-value">${escHtml(data.dealId)}</span></div>` : ''}
      <div class="info-row"><span class="info-label">Status</span><span class="info-value" style="color:var(--green)">${escHtml(data.status)}</span></div>
      ${data.access ? `<div class="info-row"><span class="info-label">Access</span><span class="info-value">${escHtml(data.access)}</span></div>` : ''}
      ${data.occupancy ? `<div class="info-row"><span class="info-label">Occupancy</span><span class="info-value">${escHtml(data.occupancy)}</span></div>` : ''}
      ${data.coe ? `<div class="info-row"><span class="info-label">COE</span><span class="info-value">${escHtml(data.coe)}</span></div>` : ''}
    </div>
    <a href="https://calendar.app.google/DXJoTQwDpGhCjicu6" target="_blank" class="btn-blue-full">📅 Book a Call With Our Team</a>
    <a href="/" class="btn-blue-full" style="background:var(--bg);color:var(--navy);border:1.5px solid var(--border)">← Back to All Active Deals</a>
  </div>
</div>

<footer>
  <a href="/">Home</a><a href="/blog/">Blog</a><a href="/map.html">Deal Map</a><a href="mailto:info@termsforsale.com">Contact</a>
  <br><br>&copy; 2025 Deal Pros LLC. All Rights Reserved.
</footer>

<script>
var GHL_INQUIRY='https://services.leadconnectorhq.com/hooks/7IyUgu1zpi38MDYpSDTs/webhook-trigger/1fd6be66-9022-4375-b17a-d7ec2cabe593';
var POST_DEAL_ID='${escHtml(data.dealId||'')}';
var POST_DEAL_ADDR='${escHtml(data.city)} ${escHtml(data.state)} — ${escHtml(data.dealType)}';
function blogSubmit(){
  var fn=document.getElementById('b-fn').value.trim();
  var phone=document.getElementById('b-phone').value.trim();
  var err=document.getElementById('blog-err');
  var ok=document.getElementById('blog-ok');
  err.style.display='none';ok.style.display='none';
  if(!fn||!phone){err.textContent='Please enter your name and phone.';err.style.display='block';return;}
  var btn=event.target;btn.disabled=true;btn.textContent='Sending…';
  fetch(GHL_INQUIRY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    firstName:fn,lastName:document.getElementById('b-ln').value.trim(),
    phone:phone,email:document.getElementById('b-email').value.trim(),
    deal_id:POST_DEAL_ID,deal_structure:document.getElementById('b-buy').value,
    request_type:'Blog - Access Request',source:'TFS Blog - Deal Spotlight',
    pipeline_name:'Buyer Inquiries',pipeline_stage:'New Lead',tags:['TFS Buyer','Blog Lead'],
    utm_source:new URLSearchParams(window.location.search).get('utm_source')||'',
    utm_medium:new URLSearchParams(window.location.search).get('utm_medium')||''
  })}).catch(function(){});
  ok.textContent='✓ Request sent! We\\'ll be in touch within 24 hours.';ok.style.display='block';
  btn.textContent='✓ Sent!';btn.style.background='#276749';
}
</script>
</body>
</html>`;

  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // Base64 encode for GitHub API
  var encoded = Buffer.from(html, 'utf8').toString('base64');

  // Check if file already exists (to get SHA for update)
  var existingFile = null;
  try {
    var checkRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
      { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (checkRes.ok) {
      existingFile = await checkRes.json();
    }
  } catch(e) {}

  // Create or update file via GitHub API
  var body = {
    message: `Add blog post: ${data.headline}`,
    content: encoded,
    branch: branch
  };
  if (existingFile && existingFile.sha) {
    body.sha = existingFile.sha;
    body.message = `Update blog post: ${data.headline}`;
  }

  var res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    var errData = await res.json();
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'GitHub API error: ' + (errData.message || res.status) })
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      url: `https://deals.termsforsale.com/blog/posts/${slug}.html`,
      slug: slug
    })
  };
};
