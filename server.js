/* PSE · 本地静态服务器 (server.js)
 * 用法： node server.js [端口]     默认 8787
 * 只读托管当前目录（index.html + src/ + tests/），无依赖。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2] || '8787', 10);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!abs.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 ' + rel); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('PSE 原型已启动: http://127.0.0.1:' + PORT + '/');
  console.log('（Ctrl+C 停止）');
});
