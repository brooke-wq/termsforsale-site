#!/usr/bin/env node
/**
 * GitHub Webhook Listener — Auto-deploy on push to main
 * Runs on port 9000 on the Droplet.
 * When GitHub sends a push event for the main branch,
 * this pulls the latest code automatically.
 *
 * PM2 keeps this running permanently.
 */

const http = require('http');
const { execSync } = require('child_process');
const crypto = require('crypto');

const PORT = 9000;
const REPO_DIR = '/root/termsforsale-site';
const BRANCH = 'main';
const SECRET = process.env.WEBHOOK_SECRET || '';

const server = http.createServer(function(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/deploy') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  var body = '';
  req.on('data', function(chunk) { body += chunk; });
  req.on('end', function() {
    // Verify signature if secret is set
    if (SECRET) {
      var sig = req.headers['x-hub-signature-256'] || '';
      var expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
      if (sig !== expected) {
        console.log('[deploy-hook] Invalid signature — rejected');
        res.writeHead(403);
        res.end('Invalid signature');
        return;
      }
    }

    var payload;
    try { payload = JSON.parse(body); } catch(e) {
      res.writeHead(400);
      res.end('Invalid JSON');
      return;
    }

    // Only deploy on pushes to main
    var ref = payload.ref || '';
    if (ref !== 'refs/heads/' + BRANCH) {
      console.log('[deploy-hook] Ignoring push to ' + ref);
      res.writeHead(200);
      res.end('Ignored — not main branch');
      return;
    }

    console.log('[deploy-hook] Push to main detected — pulling...');

    try {
      var output = execSync('cd ' + REPO_DIR + ' && git pull origin ' + BRANCH + ' 2>&1', {
        timeout: 30000,
        encoding: 'utf8'
      });
      console.log('[deploy-hook] Pull complete:\n' + output);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deployed: true, output: output.trim() }));
    } catch(err) {
      console.error('[deploy-hook] Pull failed:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deployed: false, error: err.message }));
    }
  });
});

server.listen(PORT, function() {
  console.log('[deploy-hook] Listening on port ' + PORT);
  console.log('[deploy-hook] POST /deploy — triggers git pull');
  console.log('[deploy-hook] GET /health — health check');
});
