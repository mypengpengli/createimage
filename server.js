const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 80);
const ROOT = __dirname;
const UPLOAD_DIR = process.env.TEMP_UPLOAD_DIR || path.join('/tmp', 'imageforge-uploads');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024);
const UPLOAD_TTL_MS = Number(process.env.UPLOAD_TTL_MS || 2 * 60 * 60 * 1000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime'
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
}

function safeExt(name, type) {
  const byName = path.extname(String(name || '')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(byName)) return byName;
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  if (type === 'image/gif') return '.gif';
  return '.jpg';
}

function cleanupUploads() {
  const cutoff = Date.now() - UPLOAD_TTL_MS;
  fs.readdir(UPLOAD_DIR, { withFileTypes: true }, (err, entries) => {
    if (err) return;
    entries.forEach(entry => {
      if (!entry.isFile()) return;
      const filePath = path.join(UPLOAD_DIR, entry.name);
      fs.stat(filePath, (statErr, stat) => {
        if (!statErr && stat.mtimeMs < cutoff) fs.unlink(filePath, () => {});
      });
    });
  });
}

function handleUpload(req, res) {
  const type = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
  if (!type.startsWith('image/')) return sendJson(res, 415, { error: 'Only image uploads are supported' });

  const size = Number(req.headers['content-length'] || 0);
  if (size > MAX_UPLOAD_BYTES) return sendJson(res, 413, { error: 'Upload is too large' });

  const chunks = [];
  let received = 0;
  req.on('data', chunk => {
    received += chunk.length;
    if (received > MAX_UPLOAD_BYTES) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (received <= 0) return sendJson(res, 400, { error: 'Empty upload' });
    const original = decodeURIComponent(String(req.headers['x-file-name'] || 'reference.jpg'));
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt(original, type)}`;
    const filePath = path.join(UPLOAD_DIR, name);
    fs.writeFile(filePath, Buffer.concat(chunks), err => {
      if (err) return sendJson(res, 500, { error: 'Could not store upload' });
      sendJson(res, 200, {
        url: `/tmp-uploads/${name}`,
        expires_in: Math.round(UPLOAD_TTL_MS / 1000)
      });
    });
  });
  req.on('error', () => sendJson(res, 400, { error: 'Upload failed' }));
}

function serveFile(res, filePath, cache) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cache
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/tmp-uploads/')) {
    const name = path.basename(url.pathname);
    return serveFile(res, path.join(UPLOAD_DIR, name), 'public, max-age=7200');
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const requested = path.normalize(path.join(ROOT, pathname));
  if (!requested.startsWith(ROOT)) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });

  fs.stat(requested, (err, stat) => {
    if (!err && stat.isFile()) {
      const ext = path.extname(requested).toLowerCase();
      const cache = ext === '.html' ? 'no-cache' : 'public, max-age=604800';
      return serveFile(res, requested, cache);
    }
    serveFile(res, path.join(ROOT, 'index.html'), 'no-cache');
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/temp-upload') return handleUpload(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return handleStatic(req, res);
  send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
});

cleanupUploads();
setInterval(cleanupUploads, Math.min(UPLOAD_TTL_MS, 10 * 60 * 1000)).unref();

server.listen(PORT, () => {
  console.log(`ImageForge Studio listening on ${PORT}`);
});
