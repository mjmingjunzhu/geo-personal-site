/**
 * 本地静态预览服务器（预览 public/ 目录）
 *
 * 设计要点：
 * 1. 仅使用 Node.js 内置模块，零第三方依赖，无需联网下载。
 * 2. 自动扫描 3000-3010 端口：若端口已被本项目占用则直接复用浏览器打开，
 *    若被其他程序占用则自动顺延，避免端口冲突报错。
 * 3. 服务器在终端中前台运行 —— 关闭该黑框（终端）窗口，进程即终止，服务随之停止。
 *
 * 启动方式：node serve.js  或  双击 一键启动.bat（Windows）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = path.join(__dirname, 'public');
const PORT_START = 3000;
const PORT_END = 3010;

/**
 * 本地开发用的后端 API 地址。
 * 页面里用的是相对路径 fetch('/api/leads')，这样线上交给 Nginx 反代即可同源工作；
 * 本地预览时由本服务器转发到 3011，避免跨域。
 * 可用环境变量 API_ORIGIN 覆盖。
 */
const API_ORIGIN = process.env.API_ORIGIN || 'http://127.0.0.1:3011';
const API_PREFIX = '/api/';
const ADMIN_PREFIX = '/admin';

const API_TARGET = (() => {
  try {
    return new URL(API_ORIGIN);
  } catch {
    console.warn(`[警告] API_ORIGIN 解析失败: ${API_ORIGIN}，/api 反代将不可用`);
    return null;
  }
})();

/** 把 /api/* 与 /admin 转发给后端服务，其余仍走静态文件 */
function proxyToApi(req, res, urlPath) {
  if (!API_TARGET) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: 'API_ORIGIN 无效，无法代理' }));
  }

  const isApi = urlPath.startsWith(API_PREFIX);
  const isAdmin = urlPath === ADMIN_PREFIX || urlPath.startsWith(ADMIN_PREFIX + '/');
  if (!isApi && !isAdmin) return false;

  const targetPath = urlPath + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');

  const opts = {
    protocol: API_TARGET.protocol,
    hostname: API_TARGET.hostname,
    port: API_TARGET.port || (API_TARGET.protocol === 'https:' ? 443 : 80),
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: API_TARGET.host },
  };

  const upstream = http.request(opts, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });

  upstream.on('error', (err) => {
    // 后端没起时给出明确提示，而不是让页面报"发送失败"却不知原因
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({
      ok: false,
      error: `无法连接本地后端 ${API_ORIGIN}，请先运行 node server/index.js`,
      detail: String(err.message || err),
    }));
  });

  req.pipe(upstream);
  return true;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** 判断某端口是否已被本项目占用（首页特征检测） */
function probeExisting(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/index.html', timeout: 1200 },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
          if (body.length > 4000) req.destroy();
        });
        // 首页里有结构化数据，就认为是本项目生成的网站
        res.on('end', () => resolve(body.includes('application/ld+json')));
        res.on('error', () => resolve(false));
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'start ""' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
  exec(`${cmd} "${url}"`, () => {});
}

function createServer() {
  return http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      urlPath = req.url.split('?')[0];
    }

    // 路径安全：禁止跳出 public 目录
    const target = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('403 Forbidden');
    }

    // API 与后台请求 → 转发给后端（相对路径 fetch 的本地等价方案）
    if (proxyToApi(req, res, urlPath)) return;

    fs.stat(target, (err, stat) => {
      let file = target;
      if (err) {
        // 目录或不存在 → 回退到 404
        file = path.join(target, 'index.html');
        fs.stat(file, (err2, stat2) => {
          if (err2 || !stat2.isFile()) return send404(res);
          return sendFile(res, file);
        });
        return;
      }
      if (stat.isDirectory()) {
        file = path.join(target, 'index.html');
        fs.stat(file, (err2, stat2) => {
          if (err2 || !stat2.isFile()) return send404(res);
          return sendFile(res, file);
        });
        return;
      }
      sendFile(res, file);
    });
  });
}

function sendFile(res, file) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  fs.readFile(file, (err, buf) => {
    if (err) return send404(res);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

function send404(res) {
  const p = path.join(ROOT, '404.html');
  fs.readFile(p, (err, buf) => {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(err ? '<h1>404</h1>' : buf);
  });
}

async function boot() {
  if (!fs.existsSync(ROOT)) {
    console.error('[错误] 未找到 public 目录，请先执行：npm run build');
    process.exit(1);
  }

  // 1) 先检查常用端口是否已被本项目占用 → 复用
  for (let p = PORT_START; p <= PORT_END; p++) {
    if (await probeExisting(p)) {
      console.log(`[提示] 检测到服务已在 http://localhost:${p} 运行，直接打开。`);
      openBrowser(`http://localhost:${p}`);
      return;
    }
  }

  // 2) 否则寻找可用端口启动
  const server = createServer();
  let port = null;
  for (let p = PORT_START; p <= PORT_END; p++) {
    const ok = await new Promise((resolve) => {
      const onErr = (e) => {
        if (e.code === 'EADDRINUSE' || e.code === 'EACCES') {
          server.removeListener('error', onErr);
          resolve(false);
        } else {
          resolve(false);
        }
      };
      server.once('error', onErr);
      server.listen(p, '127.0.0.1', () => {
        server.removeListener('error', onErr);
        resolve(true);
      });
    });
    if (ok) {
      port = p;
      break;
    }
  }

  if (!port) {
    console.error('[错误] 3000-3010 端口均被占用，请关闭占用程序后重试。');
    process.exit(1);
  }

  const url = `http://localhost:${port}`;
  console.log('');
  console.log('  个人网站 —— 本地预览已启动');
  console.log('  ----------------------------------------');
  console.log(`  地址：${url}`);
  if (API_TARGET) {
    console.log(`  API ：/api/*  →  ${API_ORIGIN}（已启用反向代理）`);
    console.log(`  后台：/admin   →  ${API_ORIGIN}`);
  }
  console.log('  浏览器即将自动打开…');
  console.log('');
  console.log('  【关闭方法】直接关闭本窗口，服务即停止。');
  console.log('');

  openBrowser(url);
}

boot();