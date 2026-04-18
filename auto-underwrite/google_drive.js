const { google } = require('googleapis');
const { Readable } = require('stream');

const OAUTH_REDIRECT = 'https://developers.google.com/oauthplayground';

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN in env');
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, OAUTH_REDIRECT);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function getDriveClient() {
  return google.drive({ version: 'v3', auth: getOAuthClient() });
}

async function uploadToDrive({ filename, buffer, mimeType, folderId }) {
  if (!filename) throw new Error('filename required');
  if (!buffer) throw new Error('buffer required');
  if (!folderId) throw new Error('DRIVE_FOLDER_ID not set');

  const drive = getDriveClient();
  const body = Readable.from(buffer);

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
      mimeType,
    },
    media: {
      mimeType,
      body,
    },
    fields: 'id, name, webViewLink, webContentLink',
    supportsAllDrives: true,
  });

  return res.data;
}

async function ensureFolderExists(folderId) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId: folderId,
    fields: 'id, name, mimeType',
    supportsAllDrives: true,
  });
  return res.data;
}

module.exports = { uploadToDrive, ensureFolderExists, getOAuthClient, getDriveClient };
