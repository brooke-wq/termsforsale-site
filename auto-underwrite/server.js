require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { generateDealDoc } = require('./generate_pdf');
const { uploadToDrive } = require('./google_drive');
const puppeteer = require('puppeteer-core');

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

      // Convert PDF -> PPTX via libreoffice, then upload PPTX as native Google Slides.
      // Drive converts .pptx -> Google Slides reliably. Each slide will be an image of
      // the corresponding PDF page (visual fidelity preserved, text not editable per-element).
      try {
        const pptxPath = pdfPath.replace(/\.pdf$/, '.pptx');
        await execFileAsync('libreoffice', [
          '--headless',
          '--convert-to', 'pptx',
          '--outdir', tempDir,
          pdfPath
        ], { timeout: 60000 });

        if (fs.existsSync(pptxPath)) {
          const drive = require('./google_drive').getDriveClient();
          const { Readable } = require('stream');
          const slidesRes = await drive.files.create({
            requestBody: {
              name: filenameBase,
              parents: [decksFolderId],
              mimeType: 'application/vnd.google-apps.presentation'  // converts .pptx -> Slides on upload
            },
            media: {
              mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              body: Readable.from(fs.readFileSync(pptxPath))
            },
            fields: 'id, name, webViewLink',
            supportsAllDrives: true
          });
          slidesUploaded = slidesRes.data;
          console.log('[render-deck] uploaded as Google Slides via PPTX: ' + slidesUploaded.id);
          try { fs.unlinkSync(pptxPath); } catch (e) {}
        } else {
          console.warn('[render-deck] libreoffice did not produce pptx file at ' + pptxPath);
        }
      } catch (e) {
        console.error('[render-deck] PDF->PPTX->Slides failed:', e.message);
      }
    }

    try { fs.unlinkSync(htmlPath); } catch (e) {}
    try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch (e) {}

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
