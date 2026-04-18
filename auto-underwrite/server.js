require('dotenv').config();
const express = require('express');
const { generateDealDoc } = require('./generate_pdf');
const { uploadToDrive } = require('./google_drive');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 3001);
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

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
    oauthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN),
    authTokenConfigured: Boolean(AUTH_TOKEN),
  });
});

app.post('/render', requireAuth, async (req, res) => {
  const body = req.body || {};
  const dealId = body.dealId || body.deal_id || `deal-${Date.now()}`;
  const deal = body.deal || body;

  try {
    const { buffer, filename } = await generateDealDoc({ dealId, deal });
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

app.use((req, res) => res.status(404).json({ error: 'not found' }));

app.listen(PORT, () => {
  console.log(`[pdf-render-service] listening on :${PORT}`);
});
