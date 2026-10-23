/**
 * 联系表单后端（可选）—— 收留言、存进 SQLite、发邮件通知
 * ---------------------------------------------------------------------------
 *  - Node 原生 http，不引入 Web 框架
 *  - better-sqlite3 单文件数据库（server/data/leads.db）
 *  - helmet 提供基础安全响应头
 *  - 配置全部来自 .env（复制 .env.example 后填写）
 *
 * 端口：3011（API）。静态网站由 serve.js 在 3000 提供，并把 /api/* 转发到这里。
 * 上线时：用 Nginx 托管 public/，并把 /api/ 反向代理到本服务。
 */
'use strict';

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const helmet = require('helmet');

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3011', 10);
const HOST = '127.0.0.1';// 仅本机监听，绝不监听 0.0.0.0
const DB_PATH = process.env.DB_PATH
    ? path.resolve(__dirname, '..', process.env.DB_PATH)
    : path.join(__dirname, 'data', 'leads.db');

const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '2', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '10000', 10);

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'true') === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
const NOTIFY_TO = process.env.NOTIFY_TO || SMTP_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';

// ---------------------------------------------------------------------------
// 数据库
// ---------------------------------------------------------------------------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT,
        email        TEXT,
        phone        TEXT,
        message      TEXT NOT NULL,
        source       TEXT,
        ip           TEXT,
        user_agent   TEXT,
        mail_status  TEXT,
        mail_error   TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at)');

const insertLead = db.prepare(`
    INSERT INTO leads (name, email, phone, message, source, ip, user_agent)
    VALUES (@name, @email, @phone, @message, @source, @ip, @user_agent)
`);
const listLeads = db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT ?');
const countLeads = db.prepare('SELECT COUNT(*) AS n FROM leads');
const updateMail = db.prepare('UPDATE leads SET mail_status = ?, mail_error = ? WHERE id = ?');

console.log('[db] 数据库就绪:', DB_PATH);
console.log('[db] 当前线索数:', countLeads.get().n);

// ---------------------------------------------------------------------------
// 频率限制（内存内，按 IP）
// ---------------------------------------------------------------------------
const hits = new Map(); // ip -> number[]

function rateLimited(ip) {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (list.length >= RATE_LIMIT_MAX) {
        hits.set(ip, list);
        return true;
    }
    list.push(now);
    hits.set(ip, list);
    return false;
}
setInterval(() => {
    const now = Date.now();
    for (const [ip, list] of hits) {
        const kept = list.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
        if (kept.length === 0) hits.delete(ip); else hits.set(ip, kept);
    }
}, 60000).unref();

// ---------------------------------------------------------------------------
// 邮件（凭证未就绪时降级，不阻断主流程）
// ---------------------------------------------------------------------------
const mailReady = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);

/** 返回缺失的 SMTP 键名列表（只报键名，绝不涉及值） */
function mailMissingKeys() {
    const missing = [];
    if (!SMTP_HOST) missing.push('SMTP_HOST');
    if (!SMTP_USER) missing.push('SMTP_USER');
    if (!SMTP_PASSWORD) missing.push('SMTP_PASSWORD');
    return missing;
}

/** 启动时明确指出到底缺哪一项，避免只说"未配置凭证"而难以定位 */
function mailMissingHint() {
    const missing = [];
    if (!SMTP_HOST) missing.push('SMTP_HOST');
    if (!SMTP_USER) missing.push('SMTP_USER');
    if (!SMTP_PASSWORD) missing.push('SMTP_PASSWORD（空值）');
    return missing.length ? `未配置凭证 —— 缺少/为空: ${missing.join(', ')}` : '未配置凭证';
}

const transporter = mailReady
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    })
    : null;

async function notifyMail(lead) {
    if (!mailReady) {
        return { status: 'skipped_no_credentials', error: 'SMTP_PASSWORD 未配置，本次未发信' };
    }
    try {
        await transporter.sendMail({
            from: `"网站表单" <${SMTP_USER}>`,
            to: NOTIFY_TO,
            subject: `【新线索】${lead.name || '未留名'} - ${lead.email || '未留邮箱'}`,
            text: [
                `收到一条来自 ${process.env.SITE_NAME || '网站'} 联系页的访客留言：`,
                '',
                `姓名：${lead.name || '（未填）'}`,
                `邮箱：${lead.email || '（未填）'}`,
                `电话：${lead.phone || '（未填）'}`,
                `来源：${lead.source || '（未填）'}`,
                `时间：${lead.created_at}`,
                '',
                '留言正文：',
                lead.message,
            ].join('\n'),
        });
        return { status: 'sent', error: null };
    } catch (err) {
        return { status: 'failed', error: String(err.message || err).slice(0, 300) };
    }
}

// ---------------------------------------------------------------------------
// Turnstile（未配置则跳过，便于本地跑通）
// ---------------------------------------------------------------------------
async function verifyTurnstile(token, ip) {
    if (!TURNSTILE_SECRET) return { ok: true, skipped: true };
    if (!token) return { ok: false, reason: 'missing_token' };
    try {
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: TURNSTILE_SECRET, response: token, remoteip: ip }),
        });
        const data = await res.json();
        return { ok: Boolean(data.success), skipped: false };
    } catch (err) {
        // 验证服务不可达时不阻断提交（本地/国内网络常态），但要留痕
        return { ok: true, skipped: true, warn: String(err.message || err) };
    }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function clientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
}

function readBody(req, limit = 64 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(new Error('payload_too_large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function adminAuthorized(req) {
    if (!ADMIN_PASSWORD) return false;
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Basic ')) {
        const [u, p] = Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':');
        if (u === 'admin' && p && crypto.timingSafeEqual(
            crypto.createHash('sha256').update(p).digest(),
            crypto.createHash('sha256').update(ADMIN_PASSWORD).digest())) return true;
    }
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)wb_admin=([a-f0-9]+)/);
    if (m) {
        const expect = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex').slice(0, 32);
        if (m[1] === expect) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// 后台页面
// ---------------------------------------------------------------------------
function adminHtml(rows, total) {
    const trs = rows.map(r => `
            <tr>
                <td>${r.id}</td>
                <td>${escapeHtml(r.created_at)}</td>
                <td>${escapeHtml(r.name || '—')}</td>
                <td>${escapeHtml(r.email || '—')}</td>
                <td>${escapeHtml(r.phone || '—')}</td>
                <td class="msg">${escapeHtml(r.message)}</td>
                <td>${escapeHtml(r.mail_status || '—')}</td>
            </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>留言后台</title>
<style>
 body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:32px;background:#fafafa;color:#171717}
 h1{font-size:20px;font-weight:500;margin:0 0 4px}
 .sub{color:#888;font-size:13px;margin:0 0 24px}
 table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e5e5e5;font-size:13px}
 th,td{border-bottom:1px solid #eee;padding:8px 10px;text-align:left;vertical-align:top}
 th{background:#f5f5f5;font-weight:500;font-size:12px;color:#555}
 td.msg{max-width:320px;word-break:break-word}
 .empty{padding:32px;text-align:center;color:#999}
 code{background:#f0f0f0;padding:1px 4px;border-radius:3px}
</style></head><body>
<h1>线索后台</h1>
<p class="sub">共${total} 条·本地开发环境</p>
${rows.length ? `<table><thead><tr>
 <th>ID</th><th>时间</th><th>姓名</th><th>邮箱</th><th>电话</th><th>留言</th><th>邮件</th>
</tr></thead><tbody>${trs}</tbody></table>` : '<div class="empty">暂无数据</div>'}
</body></html>`;
}

function loginHtml(msg) {
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="robots" content="noindex,nofollow">
<title>后台登录</title><style>
body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa}
form{background:#fff;padding:32px;border:1px solid #e5e5e5;width:320px}
h1{font-size:16px;font-weight:500;margin:0 0 20px}
input{width:100%;box-sizing:border-box;padding:8px;margin-bottom:12px;border:1px solid #ddd;font-size:14px}
button{width:100%;padding:9px;background:#171717;color:#fff;border:0;cursor:pointer;font-size:14px}
.err{color:#c00;font-size:13px;margin-bottom:12px}
</style></head><body>
<form method="POST" action="/admin/login">
 <h1>线索后台登录</h1>
 ${msg ? `<div class="err">${escapeHtml(msg)}</div>` : ''}
 <input type="password" name="password" placeholder="管理口令" autofocus>
 <button type="submit">进入</button>
</form></body></html>`;
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
    // 仅本机使用时关闭 helmet 的跨源策略，避免影响本地预览联调
    const h = helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
    h(req, res, async () => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const p = url.pathname;
        const ip = clientIp(req);

        try {
            // ---- 健康检查 ----
            if (p === '/api/health') {
                return sendJson(res, 200, {
                    ok: true,
                    db: DB_PATH,
                    leads: countLeads.get().n,
                    mail: mailReady ? 'ready' : 'skipped_no_credentials',
                    mail_missing: mailReady ? null : mailMissingKeys(),
                    turnstile: TURNSTILE_SECRET ? 'on' : 'off(local)',
                });
            }

            // ---- 线索提交 ----
            if (p === '/api/leads' && req.method === 'POST') {
                if (rateLimited(ip)) {
                    return sendJson(res, 429, {
                        ok: false, error: '提交过于频繁，请稍后再试',
                        hint: `每 ${RATE_LIMIT_WINDOW_MS / 1000} 秒最多 ${RATE_LIMIT_MAX} 次`,
                    });
                }

                const raw = await readBody(req);
                let data;
                const ct = req.headers['content-type'] || '';
                if (ct.includes('application/json')) {
                    try { data = JSON.parse(raw || '{}'); } catch { data = {}; }
                } else {
                    data = Object.fromEntries(new URLSearchParams(raw));
                }

                const name = String(data.name || '').trim();
                const email = String(data.email || '').trim();
                const phone = String(data.phone || '').trim();
                const message = String(data.message || '').trim();

                // 必填校验：留言 + 邮箱或电话，至少一项联系方式
                const errors = {};
                if (!message) errors.message = '留言内容不能为空';
                if (!email && !phone) errors.contact = '邮箱与电话至少填写一项';
                if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = '邮箱格式不正确';
                if (message.length > 5000) errors.message = '留言过长（上限 5000 字）';
                if (Object.keys(errors).length) {
                    return sendJson(res, 400, { ok: false, error: '参数校验失败', fields: errors });
                }

                const ts = await verifyTurnstile(data.turnstile_token, ip);
                if (!ts.ok) {
                    return sendJson(res, 400, { ok: false, error: '人机验证未通过', turnstile: ts.reason });
                }

                const info = insertLead.run({
                    name, email, phone, message,
                    source: String(data.source || 'contact-page').slice(0, 100),
                    ip, user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
                });

                const lead = { ...data, created_at: new Date().toLocaleString('zh-CN') };
                const mail = await notifyMail(lead);
                updateMail.run(mail.status, mail.error, info.lastInsertRowid);

                return sendJson(res, 200, {
                    ok: true,
                    id: Number(info.lastInsertRowid),
                    mail: mail.status,
                    ...(mail.warn ? { warn: 'Turnstile 校验服务不可达，已放行' } : {}),
                });
            }

            // ---- 后台登录 ----
            if (p === '/admin/login' && req.method === 'POST') {
                const raw = await readBody(req);
                const { password } = Object.fromEntries(new URLSearchParams(raw));
                if (!ADMIN_PASSWORD) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    return res.end(loginHtml('ADMIN_PASSWORD 未配置，无法登录'));
                }
                const ok = String(password || '') === ADMIN_PASSWORD;
                if (!ok) {
                    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
                    return res.end(loginHtml('口令不正确'));
                }
                const token = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex').slice(0, 32);
                res.writeHead(302, {
                    Location: '/admin',
                    'Set-Cookie': `wb_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,
                });
                return res.end();
            }

            // ---- 后台列表 ----
            if (p === '/admin') {
                if (!adminAuthorized(req)) {
                    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
                    return res.end(loginHtml('请输入管理口令'));
                }
                const rows = listLeads.all(200);
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                return res.end(adminHtml(rows, countLeads.get().n));
            }

            // ---- 明确拒绝数据库文件被下载 ----
            if (/\.db(-journal|-wal|-shm)?$/i.test(p)) {
                return sendJson(res, 403, { ok: false, error: '禁止访问' });
            }

            return sendJson(res, 404, { ok: false, error: 'Not Found' });
        } catch (err) {
            console.error('[error]', err);
            return sendJson(res, 500, { ok: false, error: String(err.message || err) });
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  联系系统后端已启动');
    console.log('  ─────────────────────────────────');
    console.log(`  地址     http://${HOST}:${PORT}`);
    console.log(`  数据库   ${DB_PATH}`);
    console.log(`  邮件     ${mailReady ? `已配置 (${SMTP_HOST})` : mailMissingHint()}`);
    console.log(`  Turnstile ${TURNSTILE_SECRET ? '已启用' : '未配置 —— 本地自动跳过'}`);
    console.log(`  管理口令 ${ADMIN_PASSWORD ? '已配置' : '未配置 —— /admin 将无法登录'}`);
    console.log(`  限流     ${RATE_LIMIT_WINDOW_MS / 1000}秒内最多 ${RATE_LIMIT_MAX} 次`);
    console.log('');
});

module.exports = server;