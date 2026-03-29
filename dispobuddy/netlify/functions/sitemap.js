// Dispo Buddy — Dynamic Sitemap
// GET /sitemap.xml

exports.handler = async () => {
  const base = 'https://dispobuddy.com';
  const now = new Date().toISOString().split('T')[0];

  const pages = [
    { url: '/',                 priority: '1.0', freq: 'weekly' },
    { url: '/submit-deal',      priority: '0.9', freq: 'monthly' },
    { url: '/process',          priority: '0.8', freq: 'monthly' },
    { url: '/what-we-look-for', priority: '0.8', freq: 'monthly' },
    { url: '/buyers-map',       priority: '0.8', freq: 'weekly' },
    { url: '/join',             priority: '0.7', freq: 'monthly' },
    { url: '/proof',            priority: '0.7', freq: 'monthly' },
    { url: '/faq',              priority: '0.6', freq: 'monthly' },
    { url: '/contact',          priority: '0.5', freq: 'yearly' },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${base}${p.url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' },
    body: xml,
  };
};
