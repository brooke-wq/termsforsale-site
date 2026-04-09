// Netlify Function: sitemap
// Generates sitemap.xml from Google Sheet + posts-index.json
// Accessible at /sitemap.xml via redirect in netlify.toml

var { buildDealPath } = require('./_deal-url');

exports.handler = async function(event) {
  var SHEET_ID = '1WOB61XBRGlypbtYZYogSRo1sVS3XUagppsTitTwyJsg';
  var BASE_URL = 'https://deals.termsforsale.com';
  var today = new Date().toISOString().split('T')[0];

  var urls = [
    { loc: BASE_URL + '/', priority: '1.0', freq: 'daily' },
    { loc: BASE_URL + '/deals.html', priority: '0.95', freq: 'daily' },
    { loc: BASE_URL + '/blog/', priority: '0.8', freq: 'daily' },
    { loc: BASE_URL + '/buying-criteria.html', priority: '0.7', freq: 'monthly' },
    { loc: BASE_URL + '/vip-buyers.html', priority: '0.6', freq: 'monthly' },
    { loc: BASE_URL + '/privacy.html', priority: '0.3', freq: 'yearly' },
    { loc: BASE_URL + '/terms.html', priority: '0.3', freq: 'yearly' }
  ];

  // Fetch active deals from Notion via internal API
  try {
    var dealsRes = await fetch(BASE_URL + '/api/deals');
    if (dealsRes.ok) {
      var dealsData = await dealsRes.json();
      (dealsData.deals || []).forEach(function(d) {
        urls.push({
          loc: BASE_URL + buildDealPath(d),
          priority: '0.8',
          freq: 'weekly'
        });
      });
    }
  } catch(e) { console.warn('sitemap: deals fetch failed:', e.message); }

  // Fetch blog posts from posts-index.json
  try {
    var indexUrl = BASE_URL + '/blog/posts-index.json';
    var indexRes = await fetch(indexUrl);
    if (indexRes.ok) {
      var posts = await indexRes.json();
      posts.forEach(function(p) {
        urls.push({
          loc: p.url || (BASE_URL + '/blog/posts/' + p.slug + '.html'),
          priority: '0.7',
          freq: 'monthly'
        });
      });
    }
  } catch(e) {}

  // Build XML
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(function(u) {
        return '  <url>\n'
          + '    <loc>' + u.loc + '</loc>\n'
          + '    <lastmod>' + today + '</lastmod>\n'
          + '    <changefreq>' + u.freq + '</changefreq>\n'
          + '    <priority>' + u.priority + '</priority>\n'
          + '  </url>';
      }).join('\n')
    + '\n</urlset>';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600'
    },
    body: xml
  };
};
