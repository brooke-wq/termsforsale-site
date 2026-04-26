require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { generateDealDoc } = require('./generate_pdf');
const { uploadToDrive } = require('./google_drive');
const puppeteer = require('puppeteer-core');
const PptxGenJS = require('pptxgenjs');

const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json({ limit: '4mb' }));

const PORT = Number(process.env.PORT || 3001);
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const REPO_ROOT = process.env.REPO_ROOT || '/root/termsforsale-site';
const TEMPLATE_PATH = path.join(REPO_ROOT, 'tfs-build', 'pitch-deck-template.html');

function requireAuth(req, res, next) {
  if (!AUTH_TOKEN) {
    return res.status(500).json({ error: 'AUTH_TOKEN not configured on server' });
  }
  const token = req.get('X-Auth-Token');
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'invalid or missing X-Auth-Token' });
  }
  next();
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'pdf-render-service',
    uptime: Math.round(process.uptime()),
    driveFolderConfigured: Boolean(process.env.DRIVE_FOLDER_ID),
    decksFolderConfigured: Boolean(process.env.DRIVE_DECKS_FOLDER_ID),
    oauthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN),
    authTokenConfigured: Boolean(AUTH_TOKEN),
    templateExists: fs.existsSync(TEMPLATE_PATH)
  });
});

app.post('/render', requireAuth, async (req, res) => {
  const body = req.body || {};
  const dealId = body.dealId || body.deal_id || `deal-${Date.now()}`;
  const deal = body.deal || body;
  const compute = body.compute || null;
  const enriched = body.enriched || null;

  try {
    const { buffer, filename } = await generateDealDoc({ dealId, deal, compute, enriched });
    const uploaded = await uploadToDrive({
      filename,
      buffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      folderId: process.env.DRIVE_FOLDER_ID,
    });
    res.json({
      ok: true,
      dealId,
      filename,
      driveFileId: uploaded.id,
      driveWebViewLink: uploaded.webViewLink,
      driveWebContentLink: uploaded.webContentLink,
    });
  } catch (err) {
    console.error('[render] failed:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    });
  }
});

app.post('/render-deck', requireAuth, async (req, res) => {
  const body = req.body || {};
  const dealId = body.dealId || `deal-${Date.now()}`;
  const tokens = body.tokens || {};
  const notionPageId = body.notionPageId || null;
  const decksFolderId = process.env.DRIVE_DECKS_FOLDER_ID;

  if (!decksFolderId) {
    return res.status(500).json({ ok: false, error: 'DRIVE_DECKS_FOLDER_ID not configured' });
  }
  if (!fs.existsSync(TEMPLATE_PATH)) {
    return res.status(500).json({ ok: false, error: 'Template not found at ' + TEMPLATE_PATH });
  }

  const ts = Date.now();
  const safeDealId = String(dealId).replace(/[^a-zA-Z0-9-]/g, '-');
  const tempDir = '/tmp';
  const htmlPath = path.join(tempDir, `${safeDealId}-${ts}.html`);
  const pdfPath = path.join(tempDir, `${safeDealId}-${ts}.pdf`);

  try {
    let html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    for (const [token, value] of Object.entries(tokens)) {
      const placeholder = '{{' + token + '}}';
      const replacement = (value != null && value !== '') ? String(value) : '—';
      html = html.split(placeholder).join(replacement);
    }
    const stillThere = (html.match(/\{\{[A-Z_]+\}\}/g) || []);
    const unreplaced = [...new Set(stillThere)];
    if (unreplaced.length) {
      console.warn('[render-deck] Tokens not in substitution map: ' + unreplaced.join(', '));
      unreplaced.forEach(t => { html = html.split(t).join('—'); });
    }

    // Force landscape 1920x1080 page size for Chrome PDF rendering.
    // Inject @page rule into <head> so Chrome respects it.
    const pageCss = '<style>@page{size:20in 11.25in;margin:0}html,body{margin:0!important;padding:0!important;background:white!important}*{box-sizing:border-box}body>deck-stage,deck-stage{display:block!important;position:relative!important;width:1920px!important;height:1080px!important;overflow:hidden!important;page-break-before:always!important;break-before:page!important;page-break-after:always!important;break-after:page!important;page-break-inside:avoid!important;break-inside:avoid!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}body>deck-stage:first-child,deck-stage:first-of-type{page-break-before:avoid!important;break-before:avoid!important}</style>';
    if (html.includes('</head>')) {
      html = html.replace('</head>', pageCss + '</head>');
    } else {
      html = pageCss + html;
    }

    fs.writeFileSync(htmlPath, html, 'utf8');

    let pdfRendered = false;
    let browser = null;
    let slideImages = [];
    try {
      browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        headless: 'new',
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none']
      });
      const pageObj = await browser.newPage();
      await pageObj.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await pageObj.goto('file://' + htmlPath, { waitUntil: 'networkidle0', timeout: 30000 });

      // Hoist all .slide elements out of <deck-stage> wrapper, paginate each as own page.
      // The deck-stage custom element hides inactive slides — we bypass it entirely
      // by moving slides to be direct body children.
      const diag = await pageObj.evaluate(() => {
        document.documentElement.style.cssText = 'margin:0!important;padding:0!important;background:white!important';
        document.body.style.cssText = 'margin:0!important;padding:0!important;background:white!important';

        // Get all .slide divs (43 of them). Filter to keep one theme (default = first occurrence by data-theme or just take all).
        const allSlides = Array.from(document.querySelectorAll('.slide'));
        const fragment = document.createDocumentFragment();
        allSlides.forEach(s => fragment.appendChild(s));

        // Remove the now-empty deck-stage wrapper(s)
        document.querySelectorAll('deck-stage').forEach(s => s.remove());

        // Append slides directly to body
        document.body.appendChild(fragment);

        // Style each slide as a discrete page
        allSlides.forEach((slide, i) => {
          slide.style.cssText = (slide.style.cssText || '') + ';display:block!important;position:relative!important;visibility:visible!important;opacity:1!important;width:1920px!important;height:1080px!important;overflow:hidden!important;page-break-after:' + (i < allSlides.length-1 ? 'always' : 'auto') + '!important;break-after:' + (i < allSlides.length-1 ? 'page' : 'auto') + '!important;page-break-inside:avoid!important;break-inside:avoid!important;margin:0!important';
        });

        return {
          slideCount: allSlides.length,
          bodyScrollHeight: document.body.scrollHeight,
          firstSlideHeight: allSlides[0] ? Math.round(allSlides[0].getBoundingClientRect().height) : 0,
          firstSlideVisible: allSlides[0] ? window.getComputedStyle(allSlides[0]).display : 'none'
        };
      });
      console.log('[render-deck] DIAG: ' + JSON.stringify(diag));

      await pageObj.pdf({
        path: pdfPath,
        width: '1920px',
        height: '1080px',
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        preferCSSPageSize: false,
        timeout: 60000
      });
      pdfRendered = fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0;
      console.log('[render-deck] puppeteer PDF rendered: ' + (pdfRendered ? fs.statSync(pdfPath).size + ' bytes' : 'FAIL'));

      // Capture each slide as a 1920x1080 PNG screenshot for the PPTX build
      try {
        const slideCount = (diag && diag.slideCount) || 22;
        await pageObj.setViewport({ width: 1920, height: slideCount * 1080, deviceScaleFactor: 1 });
        await new Promise(r => setTimeout(r, 500)); // let layout settle
        slideImages = [];
        for (let i = 0; i < slideCount; i++) {
          const buf = await pageObj.screenshot({
            clip: { x: 0, y: i * 1080, width: 1920, height: 1080 },
            type: 'png',
            encoding: 'binary'
          });
          slideImages.push(buf);
        }
        console.log('[render-deck] captured ' + slideImages.length + ' slide screenshots');
      } catch (e) {
        console.error('[render-deck] slide screenshot failed:', e.message);
      }
    } catch (e) {
      console.error('[render-deck] Puppeteer PDF failed:', e.message);
    } finally {
      if (browser) {
        try { await browser.close(); } catch (e) {}
      }
    }

    const filenameBase = `${safeDealId}-pitch-deck-${ts}`;
    const htmlUploaded = await uploadToDrive({
      filename: filenameBase + '.html',
      buffer: fs.readFileSync(htmlPath),
      mimeType: 'text/html',
      folderId: decksFolderId
    });

    // Upload PDF as native Google Slides (Drive auto-converts on upload).
    // Each PDF page becomes a slide image. User can edit slide order, add
    // comments, and share natively in Slides.
    let pdfUploaded = null;
    let slidesUploaded = null;
    if (pdfRendered) {
      try {
        pdfUploaded = await uploadToDrive({
          filename: filenameBase + '.pdf',
          buffer: fs.readFileSync(pdfPath),
          mimeType: 'application/pdf',
          folderId: decksFolderId
        });
      } catch (e) {
        console.error('[render-deck] PDF upload failed:', e.message);
      }

      // Build PPTX from slide screenshots via pptxgenjs, upload as Google Slides
      // (Drive converts .pptx -> native Slides on upload via mimeType swap).
      // Each slide is a full-bleed PNG so visual fidelity matches the PDF.
      try {
        if (slideImages.length === 0) {
          console.warn('[render-deck] no slide screenshots to build PPTX');
        } else {
          const pptx = new PptxGenJS();
          pptx.defineLayout({ name: 'WIDE_16_9', width: 13.333, height: 7.5 });
          pptx.layout = 'WIDE_16_9';
          pptx.title = filenameBase;

          for (const img of slideImages) {
            const slide = pptx.addSlide();
            slide.addImage({
              data: 'data:image/png;base64,' + img.toString('base64'),
              x: 0, y: 0, w: 13.333, h: 7.5
            });
          }

          const pptxPath = pdfPath.replace(/\.pdf$/, '.pptx');
          await pptx.writeFile({ fileName: pptxPath });

          if (fs.existsSync(pptxPath)) {
            const drive = require('./google_drive').getDriveClient();
            const { Readable } = require('stream');
            const slidesRes = await drive.files.create({
              requestBody: {
                name: filenameBase,
                parents: [decksFolderId],
                mimeType: 'application/vnd.google-apps.presentation'
              },
              media: {
                mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                body: Readable.from(fs.readFileSync(pptxPath))
              },
              fields: 'id, name, webViewLink',
              supportsAllDrives: true
            });
            slidesUploaded = slidesRes.data;
            console.log('[render-deck] uploaded as Google Slides: ' + slidesUploaded.id);
            try { fs.unlinkSync(pptxPath); } catch (e) {}
          }
        }
      } catch (e) {
        console.error('[render-deck] PPTX build/upload failed:', e.message, e.stack ? e.stack.slice(0, 300) : '');
      }
    }

    try { fs.unlinkSync(htmlPath); } catch (e) {}
    try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch (e) {}

    // Patch Notion deal page with Slides + PDF URLs (paperclip-side, no Netlify timeout)
    let notionPatched = false;
    if (notionPageId && (slidesUploaded || pdfUploaded) && process.env.NOTION_TOKEN) {
      try {
        const props = {};
        if (slidesUploaded || pdfUploaded) {
          props['Summary URL'] = { url: (slidesUploaded && slidesUploaded.webViewLink) || (pdfUploaded && pdfUploaded.webViewLink) };
        }
        if (pdfUploaded) {
          props['Analysis PDF URL'] = { rich_text: [{ type: 'text', text: { content: pdfUploaded.webViewLink } }] };
        }
        const fetch = (await import('node-fetch')).default || global.fetch || require('https');
        const patchRes = await new Promise((resolve, reject) => {
          const data = JSON.stringify({ properties: props });
          const url = new URL('https://api.notion.com/v1/pages/' + notionPageId);
          const req = require('https').request({
            hostname: url.hostname,
            path: url.pathname,
            method: 'PATCH',
            headers: {
              'Authorization': 'Bearer ' + process.env.NOTION_TOKEN,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data)
            }
          }, (resp) => {
            let body = '';
            resp.on('data', c => body += c);
            resp.on('end', () => resolve({ status: resp.statusCode, body }));
          });
          req.on('error', reject);
          req.write(data);
          req.end();
        });
        if (patchRes.status >= 200 && patchRes.status < 300) {
          notionPatched = true;
          console.log('[render-deck] Notion patched: Summary URL = ' + props['Summary URL'].url);
        } else {
          console.warn('[render-deck] Notion patch failed: ' + patchRes.status + ' ' + (patchRes.body || '').slice(0, 200));
        }
      } catch (e) {
        console.error('[render-deck] Notion patch error:', e.message);
      }
    }

    res.json({
      ok: true,
      dealId,
      htmlFileId: htmlUploaded.id,
      htmlWebViewLink: htmlUploaded.webViewLink,
      pdfFileId: pdfUploaded ? pdfUploaded.id : null,
      pdfWebViewLink: pdfUploaded ? pdfUploaded.webViewLink : null,
      slidesFileId: slidesUploaded ? slidesUploaded.id : null,
      slidesWebViewLink: slidesUploaded ? slidesUploaded.webViewLink : null,
      pdfRendered,
      notionPatched,
      unreplacedTokens: unreplaced
    });
  } catch (err) {
    console.error('[render-deck] failed:', err);
    try { fs.unlinkSync(htmlPath); } catch (e) {}
    try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch (e) {}
    res.status(500).json({
      ok: false,
      error: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
    });
  }
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

app.listen(PORT, () => {
  console.log(`[pdf-render-service] listening on :${PORT}`);
  console.log(`[pdf-render-service] template: ${TEMPLATE_PATH} (exists: ${fs.existsSync(TEMPLATE_PATH)})`);
  console.log(`[pdf-render-service] decks folder: ${process.env.DRIVE_DECKS_FOLDER_ID ? 'configured' : 'NOT SET'}`);
});
