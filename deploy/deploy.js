/**
 * 一键部署上线：把网站放到你自己的云服务器上，自动配置 Nginx 和 HTTPS
 * ---------------------------------------------------------------------------
 * 用法：
 *   1. 复制 deploy.env.example，改名为 deploy.env，填好服务器信息
 *   2. 运行 npm run deploy（Windows 也可以双击「一键上线.bat」）
 *   想退回上一个版本：npm run deploy -- --rollback
 *
 * 流程：生成网站 → 检查域名解析 → SSH 连上服务器 → 上传网页并执行 deploy/server.sh → 从外网检查能否打开
 * 服务器端具体做了什么见 deploy/server.sh，完整说明见 DEPLOY.md
 */
'use strict';

const fs = require('fs');
const path = require('path');
const dns = require('dns');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const ENV_FILE = path.join(ROOT, 'deploy.env');
const KNOWN_HOSTS = path.join(ROOT, 'deploy.known_hosts.json');  // 记住服务器的身份指纹，防止连到冒充的服务器
const KEEP = 3;                     // 服务器上保留几个历史版本，用于回滚
const FALLBACK_NODE = 'v22.22.2';   // 本机 Node 版本不适合装到服务器时，联系表单用这个版本

const argv = process.argv.slice(2);
const ROLLBACK = argv.includes('--rollback');
const FORCE = argv.includes('--force');

const log = (s = '') => console.log(s);
// 出错就抛出 Stop，由最外层统一显示；中途抛出也能让 finally 里的清理照常执行
class Stop extends Error {}
function fail(msg) {
    throw new Stop(msg);
}
// 给 shell 用的单引号转义
const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

// ---------------------------------------------------------------------------
// 读取配置
// ---------------------------------------------------------------------------
function loadConfig() {
    if (!fs.existsSync(ENV_FILE)) {
        fail('没有找到 deploy.env。\n       复制 deploy.env.example，改名为 deploy.env，填好服务器信息后再运行。详见 DEPLOY.md。');
    }
    const env = require('dotenv').parse(fs.readFileSync(ENV_FILE));
    const cfg = {
        host: (env.DEPLOY_HOST || '').trim(),
        port: parseInt(env.DEPLOY_PORT || '22', 10),
        user: (env.DEPLOY_USER || 'root').trim(),
        password: env.DEPLOY_PASSWORD || '',
        key: (env.DEPLOY_KEY || '').trim(),
        keyPassphrase: env.DEPLOY_KEY_PASSPHRASE || '',
        email: (env.DEPLOY_EMAIL || '').trim(),
        form: /^(yes|true|1|是)$/i.test((env.DEPLOY_FORM || '').trim()),
    };
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(cfg.host)) fail('deploy.env 里的 DEPLOY_HOST 要填服务器的公网 IP，比如 47.100.12.34（在云服务器控制台能看到）。');
    if (!(cfg.port > 0 && cfg.port < 65536)) fail('deploy.env 里的 DEPLOY_PORT 不对，一般填 22。');
    if (!/^[a-z_][a-z0-9_.-]*$/i.test(cfg.user)) fail('deploy.env 里的 DEPLOY_USER 不对，一般填 root。');
    if (!cfg.password && !cfg.key) fail('deploy.env 里的 DEPLOY_PASSWORD（登录密码）和 DEPLOY_KEY（私钥文件路径）至少要填一个。');
    if (cfg.key && !fs.existsSync(cfg.key)) fail(`找不到私钥文件：${cfg.key}`);
    if (cfg.email && !/^[^\s@'"]+@[^\s@'"]+\.[a-z]{2,}$/i.test(cfg.email)) fail('deploy.env 里的 DEPLOY_EMAIL 格式不对。');
    if (cfg.form) {
        if (!fs.existsSync(path.join(ROOT, '.env'))) fail('DEPLOY_FORM=yes 需要先配置好联系表单的 .env（复制 .env.example 改名为 .env 并填写），见 README「联系表单」。');
        cfg.formPort = parseInt(require('dotenv').parse(fs.readFileSync(path.join(ROOT, '.env'))).PORT || '3011', 10);
    }
    return cfg;
}

/** 从 src/data.js 读域名；还是 example.com 时用 IP 上线 */
function readSite() {
    let DOMAIN;
    try {
        ({ DOMAIN } = require(path.join(ROOT, 'src', 'data.js')));
    } catch (e) {
        fail(`读取 src/data.js 出错：${e.message}`);
    }
    let host;
    try {
        host = new URL(DOMAIN).hostname.toLowerCase();
    } catch {
        fail(`src/data.js 里的 DOMAIN 格式不对：${DOMAIN}（应该像 https://yourname.com）`);
    }
    if (host === 'example.com' || host.endsWith('.example.com') || /^\d+(\.\d+){3}$/.test(host)) {
        return { domain: '', alt: '', site: 'ip-preview' };
    }
    if (!/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z0-9-]{2,}$/.test(host)) fail(`src/data.js 里的域名不对：${host}`);
    const alt = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
    return { domain: host, alt, site: host };
}

function serverNodeVersion() {
    const [a, b] = process.versions.node.split('.').map(Number);
    return a % 2 === 0 && (a > 22 || (a === 22 && b >= 13)) ? process.version : FALLBACK_NODE;
}

// ---------------------------------------------------------------------------
// 生成网站、检查解析
// ---------------------------------------------------------------------------
function build() {
    const r = spawnSync('npm run build', { cwd: ROOT, shell: true, encoding: 'utf8' });
    if (r.status !== 0) {
        console.error(r.stdout || '', r.stderr || '');
        fail('网站生成失败，请看上面的报错（多半是 src/data.js 里少了逗号或引号）。');
    }
}

/** 查域名解析到哪些 IP。优先问阿里、腾讯的公共 DNS，拿到的是最新结果 */
async function lookup(name) {
    const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 2 });
    resolver.setServers(['223.5.5.5', '119.29.29.29', '8.8.8.8']);
    try {
        return await resolver.resolve4(name);
    } catch (e) {
        if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return [];
        try { return await dns.promises.resolve4(name); } catch { return []; }
    }
}

// ---------------------------------------------------------------------------
// Nginx 配置（服务器端脚本会把 __HTTPS_NAMES__ 换成证书实际覆盖的域名）
// ---------------------------------------------------------------------------
function nginxConfs({ site, domain, alt, ip, form, formPort }) {
    const root = `/var/www/${site}/current`;
    const head = '# 由 geo-personal-site 的部署脚本生成，每次部署都会覆盖，不要手动修改\n';
    const acme = `
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/${site}/acme;
        default_type text/plain;
    }
`;
    const body = `
    root ${root};
    index index.html;
    charset utf-8;
    error_page 404 /404.html;

    location / {
        try_files $uri $uri/ =404;
    }
    location ~* \\.(?:jpg|jpeg|png|webp|gif|svg|ico)$ {
        expires 7d;
    }
${form ? `    location /api/ {
        proxy_pass http://127.0.0.1:${formPort};
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        client_max_body_size 64k;
    }
` : ''}`;
    const httpNames = [domain, alt, ip].filter(Boolean).join(' ');

    const httpConf = `${head}server {
    listen 80;
    server_name ${httpNames};
${acme}${body}}
`;
    const httpsConf = `${head}server {
    listen 80;
    server_name ${httpNames};
${acme}
    location / {
        return 301 https://${domain}$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name __HTTPS_NAMES__;
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    if ($host = ${alt}) {
        return 301 https://${domain}$request_uri;
    }
${body}}
`;
    return { httpConf, httpsConf };
}

// ---------------------------------------------------------------------------
// SSH
// ---------------------------------------------------------------------------
let hostKeyChanged = false;
function hostVerifier(cfg) {
    const id = `${cfg.host}:${cfg.port}`;
    return (key) => {
        const fp = 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
        let known = {};
        try { known = JSON.parse(fs.readFileSync(KNOWN_HOSTS, 'utf8')); } catch { /* 第一次连接 */ }
        if (!known[id]) {
            known[id] = fp;
            fs.writeFileSync(KNOWN_HOSTS, JSON.stringify(known, null, 2) + '\n');
            log(`      第一次连接这台服务器，已记下它的身份指纹（${fp.slice(0, 20)}...）`);
            return true;
        }
        if (known[id] === fp) return true;
        hostKeyChanged = true;
        return false;
    };
}

function connect(cfg) {
    let Client;
    try {
        ({ Client } = require('ssh2'));
    } catch {
        fail('缺少部署用的组件 ssh2，请先在项目文件夹运行 npm install。');
    }
    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('ready', () => resolve(conn));
        conn.on('error', reject);
        // 有的服务器用「键盘交互」方式问密码
        conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => finish(prompts.map(() => cfg.password)));
        conn.connect({
            host: cfg.host,
            port: cfg.port,
            username: cfg.user,
            password: cfg.password || undefined,
            privateKey: cfg.key ? fs.readFileSync(cfg.key) : undefined,
            passphrase: cfg.keyPassphrase || undefined,
            tryKeyboard: !!cfg.password,
            readyTimeout: 20000,
            keepaliveInterval: 15000,
            hostVerifier: hostVerifier(cfg),
        });
    });
}

function explainSshError(err) {
    const m = String((err && err.message) || err);
    if (hostKeyChanged) {
        return '这台服务器的身份指纹和上次不一样。\n       如果你刚重装过系统或换了服务器，删除项目里的 deploy.known_hosts.json 后再运行；\n       否则可能有人在冒充你的服务器，先不要继续。';
    }
    if (/authentication methods failed/i.test(m)) return '登录失败：用户名或密码（私钥）不对。检查 deploy.env 里的 DEPLOY_USER 和 DEPLOY_PASSWORD；忘了密码可以在云服务器控制台重置。';
    if (/ECONNREFUSED/.test(m)) return `服务器拒绝连接：确认 IP 没填错、服务器已经开机，SSH 端口是 ${err.port || '22'}。`;
    if (/ETIMEDOUT|Timed out/i.test(m)) return '连接服务器超时：确认 IP 没填错，并在云服务器控制台的「防火墙 / 安全组」里放行 22 端口。';
    if (/EHOSTUNREACH|ENETUNREACH|ENOTFOUND/.test(m)) return '网络不通：检查本机网络和服务器 IP。';
    if (/Cannot parse privateKey|passphrase/i.test(m)) return `私钥文件读不了：${m}。如果私钥有密码，填到 deploy.env 的 DEPLOY_KEY_PASSPHRASE。`;
    return `连接服务器出错：${m}`;
}

/** 在服务器上执行命令。onLine 逐行收到输出（标准输出和错误输出都算） */
function exec(conn, cmd, { stdin = null, onLine = null } = {}) {
    return new Promise((resolve, reject) => {
        conn.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let out = '';
            const feed = () => {
                const decoder = new StringDecoder('utf8');
                let rest = '';
                return {
                    data(chunk) {
                        const s = decoder.write(chunk);
                        out += s;
                        if (!onLine) return;
                        const lines = (rest + s).split('\n');
                        rest = lines.pop();
                        lines.forEach((l) => onLine(l.replace(/\r$/, '')));
                    },
                    end() {
                        const s = decoder.end();
                        out += s;
                        if (onLine && (rest + s)) onLine(rest + s);
                    },
                };
            };
            const o = feed();
            const e = feed();
            stream.on('data', o.data);
            stream.stderr.on('data', e.data);
            stream.on('close', (code) => {
                o.end();
                e.end();
                resolve({ code, out });
            });
            if (stdin != null) stream.end(stdin);
        });
    });
}

const call = (obj, fn, ...args) => new Promise((resolve, reject) => obj[fn](...args, (e, v) => (e ? reject(e) : resolve(v))));

function listTree(dir, base = dir, out = { dirs: [], files: [] }) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        const rel = path.relative(base, full).split(path.sep).join('/');
        if (ent.isDirectory()) {
            out.dirs.push(rel);
            listTree(full, base, out);
        } else if (ent.isFile()) {
            out.files.push(rel);
        }
    }
    return out;
}

/** 把本机目录上传到服务器（服务器上的目标目录必须还不存在） */
async function uploadTree(sftp, localDir, remoteDir) {
    const { dirs, files } = listTree(localDir);
    await call(sftp, 'mkdir', remoteDir);
    for (const d of dirs) await call(sftp, 'mkdir', `${remoteDir}/${d}`);
    let next = 0;
    const worker = async () => {
        while (next < files.length) {
            const f = files[next++];
            await call(sftp, 'fastPut', path.join(localDir, f), `${remoteDir}/${f}`);
        }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return files.length;
}

// ---------------------------------------------------------------------------
// 从外网访问一次
// ---------------------------------------------------------------------------
function get(url, hostHeader) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        const req = mod.get({
            hostname: u.hostname,
            port: u.port || undefined,
            path: u.pathname,
            headers: hostHeader ? { Host: hostHeader } : {},
            timeout: 10000,
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { if (body.length < 5e6) body += c; });
            res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body }));
        });
        req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: '超时' })));
        req.on('error', (e) => resolve({ error: e.code || e.message }));
    });
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
    const cfg = loadConfig();
    const { domain, alt, site } = readSite();
    const isRoot = cfg.user === 'root';

    log('');
    log('  一键部署上线');
    log('  ----------------------------------------');
    log(`  服务器：${cfg.user}@${cfg.host}`);
    log(`  域名  ：${domain || '还没有设置（src/data.js 的 DOMAIN 还是 example.com），先用 IP 上线'}`);
    log('');

    let dnsOk = false;
    let altOk = false;
    let addrs = [];
    if (!ROLLBACK) {
        log('[1/5] 生成网站...');
        build();
        if (fs.existsSync(path.join(PUBLIC_DIR, 'start.html')) && !FORCE) {
            fail('网站还是示例内容（名字还是「你的名字」），先把内容换成你自己的再上线。\n       只是想先试试上线流程的话，运行：npm run deploy -- --force');
        }

        log('[2/5] 检查域名解析...');
        if (domain) {
            addrs = await lookup(domain);
            dnsOk = addrs.includes(cfg.host);
            altOk = (await lookup(alt)).includes(cfg.host);
            log(`      ${domain} → ${addrs.length ? addrs.join(', ') : '没有解析记录'}${dnsOk ? '（正确）' : ''}`);
        } else {
            log('      没有域名，跳过');
        }
    }

    log(`[${ROLLBACK ? '1/2' : '3/5'}] 连接服务器...`);
    let conn;
    try {
        conn = await connect(cfg);
    } catch (e) {
        if (e instanceof Stop) throw e;
        fail(explainSshError(Object.assign(e, { port: cfg.port })));
    }
    log('      已连接');

    let stage = '';
    const state = {};
    const notes = [];
    try {
        // 服务器上建一个只有自己能读的临时目录（可能要放 .env），脚本结束时会删掉
        const mk = await exec(conn, 'mktemp -d /tmp/geo-deploy.XXXXXX');
        stage = mk.out.trim();
        if (!/^\/tmp\/geo-deploy\.[A-Za-z0-9]+$/.test(stage)) fail(`在服务器上建临时目录失败：${mk.out.trim()}`);

        const sftp = await call(conn, 'sftp');
        const script = fs.readFileSync(path.join(__dirname, 'server.sh'), 'utf8').replace(/\r\n/g, '\n');
        await call(sftp, 'writeFile', `${stage}/server.sh`, script);

        if (!ROLLBACK) {
            log('[4/5] 上传网页并配置服务器（第一次要装软件，需要几分钟）...');
            const { httpConf, httpsConf } = nginxConfs({ site, domain, alt, ip: cfg.host, form: cfg.form, formPort: cfg.formPort });
            await call(sftp, 'writeFile', `${stage}/nginx-http.conf`, httpConf);
            await call(sftp, 'writeFile', `${stage}/nginx-https.conf`, httpsConf);
            const n = await uploadTree(sftp, PUBLIC_DIR, `${stage}/public`);
            log(`      已上传 ${n} 个文件`);
            if (cfg.form) {
                await call(sftp, 'mkdir', `${stage}/app`);
                await call(sftp, 'mkdir', `${stage}/app/server`);
                for (const f of ['package.json', 'package-lock.json', '.npmrc', '.env', 'server/index.js']) {
                    if (fs.existsSync(path.join(ROOT, f))) await call(sftp, 'fastPut', path.join(ROOT, f), `${stage}/app/${f}`);
                }
            }
        }
        sftp.end();

        const vars = {
            ACTION: ROLLBACK ? 'rollback' : 'deploy',
            SITE: site,
            DOMAIN: domain,
            ALT: alt,
            DNS_OK: dnsOk ? 1 : 0,
            ALT_OK: altOk ? 1 : 0,
            EMAIL: cfg.email,
            IP: cfg.host,
            FORM: cfg.form ? 1 : 0,
            FORM_PORT: cfg.formPort || 3011,
            NODE_VERSION: serverNodeVersion(),
            KEEP,
        };
        const assign = Object.entries(vars).map(([k, v]) => `${k}=${shq(v)}`).join(' ');
        const run = `env ${assign} bash ${stage}/server.sh`;
        const cmd = isRoot ? run : cfg.password ? `sudo -S -p '' ${run}` : `sudo -n ${run}`;

        const res = await exec(conn, cmd, {
            stdin: !isRoot && cfg.password ? `${cfg.password}\n` : null,
            onLine(line) {
                const m = line.match(/^::([a-z-]+)::(.*)$/);
                if (m) {
                    if (m[1] === 'warn') {
                        notes.push(m[2]);
                        log(`      [注意] ${m[2]}`);
                    } else {
                        state[m[1]] = m[2] || true;
                    }
                    return;
                }
                if (line.trim()) log(line.startsWith('      ') ? line : `      ${line}`);
            },
        });

        if (state.fail) fail(state.fail);
        if (res.code !== 0) {
            if (/incorrect password|a password is required|not in the sudoers/i.test(res.out)) {
                fail(`用户 ${cfg.user} 没有 sudo 权限，或者密码不对。最简单的办法：deploy.env 里用 root 登录。`);
            }
            fail(`服务器上的部署脚本出错了（退出码 ${res.code}），请看上面的输出。`);
        }
    } finally {
        if (stage) await exec(conn, `rm -rf ${stage}`).catch(() => {});
        conn.end();
    }

    if (ROLLBACK) {
        const [from, to] = String(state.rolledback || '').split('::');
        log('');
        log(`  已退回上一个版本：${from} → ${to}`);
        log('  刷新网页就能看到（浏览器有缓存的话，按 Ctrl+F5）。');
        log('');
        return;
    }

    // ---------- 从外网检查 ----------
    log('[5/5] 从外网检查网站能不能打开...');
    const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    const same = (r) => r.status === 200 && r.body === indexHtml;
    const httpsOn = state.https === 'on';
    const todo = [];
    let url = `http://${cfg.host}`;
    let ok;

    if (httpsOn) {
        const r = await get(`https://${domain}/`);
        ok = same(r);
        url = `https://${domain}`;
        // 域名没解析到这台服务器时，打不开是解析的问题，下面会单独提示
        if (!ok && dnsOk) {
            todo.push(r.error
                ? `从外网打不开 https://${domain}（${r.error}）。去云服务器控制台的「防火墙 / 安全组」放行 443 端口，再运行一次。`
                : `https://${domain} 返回的不是刚上传的网页（状态码 ${r.status}）。`);
        }
    } else {
        const r = await get(`http://${cfg.host}/`, domain || undefined);
        ok = same(r);
        if (!ok) {
            todo.push(r.error
                ? `从外网访问 http://${cfg.host} 失败（${r.error}），服务器本机访问是正常的（状态码 ${state.local}）。去云服务器控制台的「防火墙 / 安全组」放行 80 和 443 端口，再运行一次。`
                : `http://${cfg.host} 返回的不是刚上传的网页（状态码 ${r.status}）。`);
        }
        if (domain && dnsOk) {
            const rd = await get(`http://${domain}/`);
            if (same(rd)) {
                url = `http://${domain}`;
            } else {
                todo.push(`用域名 http://${domain} 打不开（${rd.error || `状态码 ${rd.status}`}），用 IP 可以。如果服务器在中国大陆，多半是域名还没有备案，被服务商拦截了；备案通过后再运行一次。`);
            }
        }
    }

    // ---------- 还要做的事 ----------
    if (!domain) {
        todo.push('现在是用 IP 访问。想被搜索引擎和 AI 收录，需要一个域名：买好域名后，把 src/data.js 的 DOMAIN 改成 https://你的域名，添加解析（主机记录 @ 和 www，记录类型 A，记录值 ' + cfg.host + '），再运行一次。');
    } else if (!dnsOk) {
        todo.push(`域名 ${domain} 还没有解析到这台服务器（${addrs.length ? `现在解析到 ${addrs.join(', ')}` : '还没有解析记录'}）。去域名服务商的控制台添加两条解析：记录类型 A，主机记录 @ 和 www，记录值都填 ${cfg.host}。一般几分钟生效${httpsOn ? '' : '，之后再运行一次，会自动开启 HTTPS'}。`);
    } else {
        if (!altOk) todo.push(`${alt} 还没有解析到这台服务器，现在只有 ${domain} 能打开。加一条 A 记录（记录值 ${cfg.host}）后再运行一次，${alt} 会自动跳转到 ${domain}。`);
        if (!httpsOn) todo.push(`HTTPS 证书没申请下来${state['https-fail'] ? '（上面有 certbot 的报错）' : ''}。常见原因：解析刚加还没生效，等十分钟再运行一次；服务器在中国大陆而域名还没有备案；云控制台没放行 80 端口。`);
    }
    if (cfg.form && state.form !== 'on') todo.push('联系表单后端没有正常运行，见上面的 [注意]。');
    todo.push(...notes.filter((n) => !/联系表单后端/.test(n)));

    log('');
    log('  ==========================================');
    log(ok ? `   网站已上线：${url}` : `   部署完成，但从外网还打不开：${url}`);
    log('  ==========================================');
    if (todo.length) {
        log('   还要做的事：');
        todo.forEach((t, i) => log(`   ${i + 1}. ${t}`));
        log('');
    }
    if (ok && domain && httpsOn) {
        log(`   让搜索引擎和 AI 找到你：把 ${url}/sitemap.xml 提交到必应、百度、Google 的站长平台（见 DEPLOY.md）。`);
    }
    log('   以后改完内容，再运行一次 npm run deploy（Windows 双击「一键上线.bat」）就会更新。');
    log('   改坏了想退回上一个版本：npm run deploy -- --rollback');
    log('');
}

main().catch((e) => {
    if (e instanceof Stop) {
        console.error(`\n[失败] ${e.message}\n`);
    } else {
        console.error(`\n[失败] 部署过程中出错：${(e && e.message) || e}`);
        console.error('       把这段报错发给 AI 助手；想看详细信息，设置环境变量 DEBUG=1 再运行一次。\n');
        if (process.env.DEBUG) console.error(e);
    }
    process.exit(1);
});
