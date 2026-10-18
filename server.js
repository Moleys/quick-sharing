'use strict';

/**
 * Quick Share — server chia sẻ file siêu nhẹ (không cần cài dependency nào).
 *
 * - Hiển thị nội dung thư mục data/ trên giao diện web
 *   (có thể đổi bằng biến môi trường SHARE_ROOT)
 * - Tải file:  GET /download?path=<đường-dẫn-tương-đối>  (&inline=1 để xem trước)
 * - Danh sách: GET /api/list?path=<thư-mục>
 * - Upload:    POST /api/upload?path=<thư-mục>&name=<tên-file>  (body = nội dung file)
 * - Xóa:       POST|DELETE /api/delete?path=<đường-dẫn>
 * - Chế độ chỉ đọc: biến môi trường SHARE_READONLY=1
 *
 * Chạy: node server.js [port]     (mặc định port 3000)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');

const PORT = Number(process.env.PORT || process.argv[2] || 3000);
const ROOT = path.resolve(process.env.SHARE_ROOT || path.join(__dirname, 'data'));
const READONLY = /^(1|true|yes)$/i.test(process.env.SHARE_READONLY || '');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.iso': 'application/x-iso9660-image',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.apk': 'application/vnd.android.package-archive',
  '.exe': 'application/vnd.microsoft.portable-executable',
};

// Tên file bị Windows cấm (CON, NUL, COM1...)
const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/* ---------- Tiện ích ---------- */

function sendJson(res, code, obj) {
  if (res.headersSent) { res.end(); return; }
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** Chặn path traversal: chỉ cho phép đường dẫn nằm trong ROOT */
function safePath(rel) {
  rel = String(rel || '').replace(/\\/g, '/');
  if (rel.includes('\0')) return null;
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

/** Làm sạch tên file khi upload */
function sanitizeName(name) {
  let n = path.basename(String(name || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (!n || n === '.' || n === '..') return null;
  if (RESERVED_NAME.test(n)) n = '_' + n;
  return n;
}

/** Nếu file đã tồn tại thì tự động đổi thành "tên (1).ext", "(2)"... */
async function uniquePath(abs) {
  if (!fs.existsSync(abs)) return abs;
  const dir = path.dirname(abs);
  const ext = path.extname(abs);
  const base = path.basename(abs, ext);
  for (let i = 1; i < 1000; i++) {
    const cand = path.join(dir, base + ' (' + i + ')' + ext);
    if (!fs.existsSync(cand)) return cand;
  }
  return path.join(dir, base + '-' + Date.now() + ext);
}

function encodeRFC5987(s) {
  return encodeURIComponent(s)
    .replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

/* ---------- Handlers ---------- */

async function serveUi(res) {
  const html = await fsp.readFile(path.join(PUBLIC_DIR, 'index.html'));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

async function handleList(q, res) {
  const dir = safePath(q.get('path'));
  if (!dir) return sendJson(res, 400, { error: 'Đường dẫn không hợp lệ' });

  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    return sendJson(res, err.code === 'ENOENT' ? 404 : 500, { error: 'Không đọc được thư mục' });
  }

  const out = [];
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue; // ẩn file hệ thống/thuộc git
    let st;
    try { st = await fsp.stat(path.join(dir, ent.name)); } catch { continue; }
    out.push({ name: ent.name, dir: ent.isDirectory(), size: st.size, mtime: st.mtimeMs });
  }

  out.sort((a, b) =>
    a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, 'vi', { numeric: true })
  );

  sendJson(res, 200, {
    cwd: path.relative(ROOT, dir).split(path.sep).join('/'),
    readonly: READONLY,
    entries: out,
  });
}

async function handleDownload(q, req, res) {
  const abs = safePath(q.get('path'));
  if (!abs) return sendJson(res, 400, { error: 'Đường dẫn không hợp lệ' });

  let st;
  try { st = await fsp.stat(abs); } catch {
    return sendJson(res, 404, { error: 'File không tồn tại' });
  }
  if (st.isDirectory()) return sendJson(res, 400, { error: 'Đây là thư mục' });

  const inline = q.get('inline') === '1';
  const headers = {
    'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition':
      (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeRFC5987(path.basename(abs)),
  };

  // Hỗ trợ Range để xem trước video/audio mượt hơn
  let start = 0;
  let end = st.size - 1;
  let status = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  if (m && (m[1] !== '' || m[2] !== '')) {
    if (m[1] === '') {
      start = Math.max(0, st.size - Number(m[2]));
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(Number(m[2]), st.size - 1);
    }
    if (Number.isNaN(start) || start > end || start >= st.size) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
  }

  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();

  const stream = fs.createReadStream(abs, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

async function handleUpload(q, req, res) {
  if (READONLY) return sendJson(res, 403, { error: 'Server đang ở chế độ chỉ đọc' });

  const dir = safePath(q.get('path'));
  if (!dir) return sendJson(res, 400, { error: 'Đường dẫn không hợp lệ' });

  const name = sanitizeName(q.get('name'));
  if (!name) return sendJson(res, 400, { error: 'Tên file không hợp lệ' });

  await fsp.mkdir(dir, { recursive: true });
  const target = await uniquePath(path.join(dir, name));

  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(target);
    req.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    req.on('error', reject);
  });

  sendJson(res, 200, { ok: true, name: path.basename(target) });
}

async function handleDelete(q, res) {
  if (READONLY) return sendJson(res, 403, { error: 'Server đang ở chế độ chỉ đọc' });

  const abs = safePath(q.get('path'));
  if (!abs || abs === ROOT) return sendJson(res, 400, { error: 'Không thể xóa mục này' });

  await fsp.rm(abs, { recursive: true, force: true });
  sendJson(res, 200, { ok: true });
}

/* ---------- Server ---------- */

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    const q = u.searchParams;

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (p === '/' || p === '/index.html') return await serveUi(res);
      if (p === '/api/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('ok');
      }
      if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (p === '/api/list') return await handleList(q, res);
      if (p === '/download') return await handleDownload(q, req, res);
    } else if (req.method === 'POST') {
      if (p === '/api/upload') return await handleUpload(q, req, res);
      if (p === '/api/delete') return await handleDelete(q, res);
    } else if (req.method === 'DELETE') {
      if (p === '/api/delete') return await handleDelete(q, res);
    }

    sendJson(res, 404, { error: 'Không tìm thấy' });
  } catch (err) {
    sendJson(res, err && err.code === 'ENOENT' ? 404 : 500, { error: String((err && err.message) || err) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const line = '─'.repeat(60);
  console.log('');
  console.log(line);
  console.log('  ⚡ Quick Share đang chạy');
  console.log('  Thư mục chia sẻ : ' + ROOT);
  console.log('  Chế độ          : ' + (READONLY ? 'chỉ đọc (SHARE_READONLY)' : 'đọc + ghi'));
  console.log('  Local           : http://localhost:' + PORT);
  for (const ip of lanIps()) console.log('  Mạng LAN        : http://' + ip + ':' + PORT);
  console.log('');
  console.log('  Mẹo: chạy start.ps1 (hoặc start.bat) để tự tạo link online');
  console.log('       qua Cloudflare Tunnel → dùng được từ mọi nơi.');
  console.log(line);
  console.log('');
});
