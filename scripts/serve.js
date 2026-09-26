'use strict';

/**
 * Zero-dependency static file server with live reload.
 * Usage: npm start            -> http://localhost:8080
 *        PORT=3000 npm start  -> custom port
 *        LIVE_RELOAD=0 npm start -> disable live reload
 * Env:   PORT (default 8080), HOST (default 127.0.0.1), LIVE_RELOAD (default on)
 *
 * How live reload works (no dependencies):
 *   - fs.watch recursively watches public/
 *   - browsers get a tiny injected script that subscribes to the
 *     Server-Sent Events endpoint /__livereload
 *   - on any change, the server broadcasts "reload" and pages reload
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const LIVE_RELOAD = process.env.LIVE_RELOAD !== '0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

/** Client script served at /__livereload.js (injected into HTML pages). */
const LIVERELOAD_CLIENT = `/* injected by dev server */
(function () {
  var es = new EventSource('/__livereload');
  es.onmessage = function () { location.reload(); };
  es.onopen = function () { console.log('[livereload] connected'); };
  /* EventSource reconnects automatically after a server restart */
})();
`;

/** Connected SSE responses waiting for reload events. */
const sseClients = new Set();

function broadcastReload() {
  for (const res of sseClients) {
    res.write('data: reload\n\n');
  }
  if (sseClients.size > 0) {
    console.log(`[livereload] change detected -> reloading ${sseClients.size} client(s)`);
  }
}

/** Debounced watcher: editors fire several events per save. */
let debounceTimer = null;
function startWatcher() {
  try {
    fs.watch(ROOT, { recursive: true }, () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(broadcastReload, 120);
    });
    console.log(`[livereload] watching ${ROOT} for changes`);
  } catch (err) {
    console.warn('[livereload] disabled (could not watch directory):', err.message);
  }
}

/** Inject the livereload client into an HTML string before </body>. */
function injectLivereload(html) {
  const tag = '<script src="/__livereload.js"></script>';
  if (html.includes(tag)) return html;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${tag}\n</body>`);
  }
  return html + tag;
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }

  // --- live reload endpoints -------------------------------------------------
  if (LIVE_RELOAD && urlPath === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (LIVE_RELOAD && urlPath === '/__livereload.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    res.end(LIVERELOAD_CLIENT);
    return;
  }

  // --- static files ----------------------------------------------------------
  let filePath = path.normalize(path.join(ROOT, urlPath));

  // Prevent path traversal outside public/
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  // Serve index.html for directory requests (e.g. "/")
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    if (LIVE_RELOAD && ext === '.html') {
      res.end(injectLivereload(data.toString('utf8')));
    } else {
      res.end(data);
    }
  });
});

// Keep idle SSE connections alive through proxies.
setInterval(() => {
  for (const res of sseClients) res.write(': ping\n\n');
}, 25000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
  if (LIVE_RELOAD) startWatcher();
  else console.log('[livereload] disabled via LIVE_RELOAD=0');
});
