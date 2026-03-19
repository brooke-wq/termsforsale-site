// Netlify Function: sitemap
// Generates sitemap.xml from Google Sheet + posts-index.json
// Accessible at /sitemap.xml via redirect in netlify.toml

exports.handler = async function(event) {
  var SHEET_ID = '1WOB61XBRGlypbtYZYogSRo1sVS3XUagppsTitTwyJsg';
  var BASE_URL = 'https://deals.termsforsale.com';
  var today = new Date().toISOString().split('T')[0];

  var urls = [
    { loc: BASE_URL + '/', priority: '1.0', freq: 'daily' },
    { loc: BASE_URL + '/blog/', priority: '0.9', freq: 'daily' },
    { loc: BASE_URL + '/map.html', priority: '0.8', freq: 'weekly' }
  ];

  // Fetch deal IDs from Google Sheet
  try {
    var sheetUrl = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:json&gid=0&headers=1';
    var res = await fetch(sheetUrl);
    var text = await res.text();
    var m = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/);
    if (m) {
      var json = JSON.parse(m[1]);
      var cols = json.table.cols.map(function(c){return c.label.trim();});
      var rows = json.table.rows || [];
      var ACTIVE = ['actively marketing','active marketing','active'];
      rows.forEach(function(row) {
        var o = {};
        var seen = {};
        cols.forEach(function(c,i){
          var cell=row.c[i]; var val=cell?(cell.v!==null?String(cell.v).trim():''):'';
          if(seen[c]===undefined){seen[c]=0;o[c]=val;o[c+'__0']=val;}
          else{seen[c]++;o[c+'__'+seen[c]]=val;o[c]=val;}
        });
        var status = (o['Deal Status'] || '').trim().toLowerCase();
        var id = o['Deal ID'] || o['Deal Status__0'];
        if (ACTIVE.indexOf(status) > -1 && id) {
          urls.push({
            loc: BASE_URL + '/deal.html?id=' + encodeURIComponent(id),
            priority: '0.8',
            freq: 'weekly'
          });
        }
      });
    }
  } catch(e) {}

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
