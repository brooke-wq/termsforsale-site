/**
 * Auto Blog Post — generates a deal spotlight post when a new deal goes active.
 * Called internally by notify-buyers.js (not exposed as public API).
 *
 * Creates an HTML file in GitHub via API + updates posts-index.json.
 * Template-based, no Claude needed, $0 cost.
 */

const https = require('https');
const { buildDealUrl } = require('./_deal-url');

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function fc(n) { if (!n) return ''; var v = +n; return isNaN(v) || v === 0 ? '' : '$' + v.toLocaleString(); }

async function githubApi(method, path, body, token) {
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'TermsForSale/1.0',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function createDealPost(deal) {
  var token = process.env.GITHUB_TOKEN;
  var owner = process.env.GITHUB_REPO_OWNER || 'brooke-wq';
  var repo = process.env.GITHUB_REPO_NAME || 'termsforsale-site';

  if (!token) { console.log('[auto-blog] No GITHUB_TOKEN — skipping'); return; }

  var slug = slugify(deal.dealType + '-deal-' + deal.city + '-' + deal.state);
  var filePath = 'termsforsale/blog/posts/' + slug + '.html';
  var dealUrl = buildDealUrl(deal);
  var price = fc(deal.askingPrice);
  var entry = fc(deal.entryFee);
  var rent = fc(deal.rentFinal);
  var specs = [deal.beds ? deal.beds + ' Beds' : '', deal.baths ? deal.baths + ' Baths' : '', deal.sqft ? Number(deal.sqft).toLocaleString() + ' Sqft' : '', deal.yearBuilt ? 'Built ' + deal.yearBuilt : ''].filter(Boolean).join(' · ');
  var highlights = [deal.highlight1, deal.highlight2, deal.highlight3].filter(Boolean);
  var title = deal.dealType + ' Deal in ' + deal.city + ', ' + deal.state + (entry ? ' — ' + entry + ' Entry' : price ? ' — ' + price : '');
  var hook = 'Off-market ' + (deal.dealType || '').toLowerCase() + ' deal in ' + deal.city + ', ' + deal.state + '. ' + (specs || '') + '. ' + (entry ? entry + ' entry fee + CC/TC.' : price ? price + ' asking.' : '');
  var now = new Date().toISOString().split('T')[0];

  // Check if post already exists
  var checkRes = await githubApi('GET', '/repos/' + owner + '/' + repo + '/contents/' + filePath, null, token);
  if (checkRes.status === 200) {
    console.log('[auto-blog] Post already exists: ' + slug);
    return;
  }

  // Build minimal SEO blog post HTML
  var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + '<title>' + escHtml(title) + ' | Terms For Sale</title>'
    + '<meta name="description" content="' + escHtml(hook) + '">'
    + '<link rel="canonical" href="https://termsforsale.com/blog/posts/' + slug + '/">'
    + '<meta property="og:title" content="' + escHtml(title) + '">'
    + '<meta property="og:description" content="' + escHtml(hook) + '">'
    + '<meta property="og:type" content="article">'
    + '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;color:#0D1F3C;background:#F4F6F9;line-height:1.6}.page{max-width:700px;margin:0 auto;padding:40px 24px 80px}'
    + 'h1{font-size:32px;font-weight:900;margin-bottom:8px}p{margin-bottom:12px;color:#4A5568;font-size:15px}'
    + '.badge{display:inline-block;padding:4px 12px;border-radius:20px;background:#EBF8FF;color:#1a8bbf;font-size:12px;font-weight:700;margin-bottom:12px}'
    + '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:24px 0}'
    + '.stat{background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:16px;text-align:center}'
    + '.stat-label{font-size:10px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:.5px}'
    + '.stat-value{font-size:22px;font-weight:800;color:#0D1F3C;margin-top:4px}'
    + '.btn{display:inline-block;padding:14px 32px;background:#29ABE2;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;margin-top:20px}'
    + '.highlights{margin:24px 0}.hl{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;font-size:14px;color:#4A5568}'
    + '.hl-check{color:#10B981;font-weight:700}'
    + 'nav{background:#0D1F3C;padding:16px 24px;text-align:center}nav a{color:#fff;text-decoration:none;font-weight:700;font-size:14px}'
    + '</style></head><body>'
    + '<nav><a href="/deals.html">Terms For Sale — Browse All Deals</a></nav>'
    + '<div class="page">'
    + '<div class="badge">' + escHtml(deal.dealType || 'Deal') + '</div>'
    + '<h1>' + escHtml(title) + '</h1>'
    + '<p style="color:#718096;font-size:13px;margin-bottom:24px">' + escHtml(deal.city + ', ' + deal.state) + (specs ? ' · ' + escHtml(specs) : '') + ' · Listed ' + now + '</p>'
    + '<div class="stats">'
    + (price ? '<div class="stat"><div class="stat-label">Asking Price</div><div class="stat-value">' + price + '</div></div>' : '')
    + (entry ? '<div class="stat"><div class="stat-label">Entry Fee</div><div class="stat-value">' + entry + '</div></div>' : '')
    + (rent ? '<div class="stat"><div class="stat-label">Est. Rent</div><div class="stat-value" style="color:#10B981">' + rent + '/mo</div></div>' : '')
    + '<div class="stat"><div class="stat-label">Deal Type</div><div class="stat-value" style="font-size:16px">' + escHtml(deal.dealType) + '</div></div>'
    + '</div>'
    + (highlights.length ? '<div class="highlights"><h2 style="font-size:18px;font-weight:800;margin-bottom:12px">Deal Highlights</h2>' + highlights.map(function(h) { return '<div class="hl"><span class="hl-check">✓</span>' + escHtml(h) + '</div>'; }).join('') + '</div>' : '')
    + '<p>This is an active off-market deal available through Terms For Sale. View full terms, photos, and financials on the deal page.</p>'
    + '<a href="' + dealUrl + '" class="btn">View Full Deal Details →</a>'
    // tfs-blog-cta-bottom — VIP buyer + JV submission two-column footer
    + '<div class="tfs-cta-bot" style="display:flex;flex-wrap:wrap;gap:16px;margin:48px 0 28px">'
      + '<div style="flex:1 1 280px;background:#0D1F3C;border-radius:14px;padding:26px 24px;color:#fff">'
        + '<h3 style="font-size:18px;font-weight:800;color:#fff;margin:0 0 8px;line-height:1.3">Get First-Access to Off-Market Deals</h3>'
        + '<p style="font-size:13px;color:rgba(255,255,255,.7);line-height:1.55;margin:0 0 16px">Tell us your buy box once. We&rsquo;ll send only matching SubTo, seller finance, and cash deals — before they hit any group.</p>'
        + '<a href="/buying-criteria.html" style="display:inline-block;padding:11px 22px;background:#29ABE2;color:#fff;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">Share My Buy Box →</a>'
      + '</div>'
      + '<div style="flex:1 1 280px;background:linear-gradient(135deg,#FFF8EF,#FFEFD9);border:1.5px solid #F7C77A;border-radius:14px;padding:26px 24px">'
        + '<h3 style="font-size:18px;font-weight:800;color:#0D1F3C;margin:0 0 8px;line-height:1.3">Have a Deal That Needs Dispo Help?</h3>'
        + '<p style="font-size:13px;color:#5a3c0b;line-height:1.55;margin:0 0 16px">Wholesalers: upload the basic numbers, we&rsquo;ll tell you if it&rsquo;s a fit and handle dispo. <strong>No upfront fees, 50/50 at close.</strong></p>'
        + '<a href="https://dispobuddy.com/submit-deal.html" target="_blank" rel="noopener" style="display:inline-block;padding:11px 22px;background:#F7941D;color:#fff;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">Submit a Deal for Review →</a>'
      + '</div>'
    + '</div>'
    + '<p style="margin-top:40px;font-size:12px;color:#A0AEC0">Terms For Sale · Deal Pros LLC · All figures are estimates. Verify with your own due diligence.</p>'
    + '</div></body></html>';

  // Commit the HTML file
  var createRes = await githubApi('PUT', '/repos/' + owner + '/' + repo + '/contents/' + filePath, {
    message: 'Auto blog: ' + title,
    content: Buffer.from(html).toString('base64'),
    branch: 'main'
  }, token);

  if (createRes.status !== 201) {
    console.error('[auto-blog] Failed to create post:', createRes.status, JSON.stringify(createRes.body).slice(0, 200));
    return;
  }

  console.log('[auto-blog] Created post: ' + slug);

  // Update posts-index.json
  try {
    var indexPath = 'termsforsale/blog/posts-index.json';
    var indexRes = await githubApi('GET', '/repos/' + owner + '/' + repo + '/contents/' + indexPath, null, token);
    if (indexRes.status === 200) {
      var indexContent = Buffer.from(indexRes.body.content, 'base64').toString('utf8');
      var index = JSON.parse(indexContent);
      // Add new post at the beginning
      index.unshift({
        slug: slug,
        type: 'deal-spotlight',
        category: 'Deal Spotlight',
        title: title,
        hook: hook,
        description: hook,
        dealType: deal.dealType,
        city: deal.city,
        state: deal.state,
        askingPrice: deal.askingPrice || null,
        entryFee: deal.entryFee || null,
        estRent: deal.rentFinal || null,
        status: 'Active',
        date: new Date().toISOString(),
        url: 'https://termsforsale.com/blog/posts/' + slug + '.html'
      });
      await githubApi('PUT', '/repos/' + owner + '/' + repo + '/contents/' + indexPath, {
        message: 'Auto blog index: add ' + slug,
        content: Buffer.from(JSON.stringify(index, null, 2)).toString('base64'),
        sha: indexRes.body.sha,
        branch: 'main'
      }, token);
      console.log('[auto-blog] Updated posts-index.json');
    }
  } catch (e) {
    console.warn('[auto-blog] Index update failed:', e.message);
  }
}

module.exports = { createDealPost };
