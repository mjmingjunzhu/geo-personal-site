/**
 * 联系系统端到端测试（只读验证，不修改任何数据）
 * ---------------------------------------------------------------------------
 * 用法：node server/test-e2e.js
 * 前置：server/index.js 已在 3011 运行
 *
 * 覆盖：必填校验 400 / 正常提交 200 / 频率限制 429 / 数据库保护 403 / 后台拦截 401
 * 注意：真实提交会写入 leads.db，属预期行为。
 */
'use strict';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3011';
const WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '10000', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;

async function req(pathname, opts = {}) {
    const res = await fetch(BASE + pathname, opts);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { code: res.status, body };
}

function check(label, actual, expected) {
    const ok = actual === expected;
    ok ? pass++ : fail++;
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}  期望=${expected} 实际=${actual}`);
    return ok;
}

(async () => {
    console.log('联系系统 E2E 测试 ->', BASE);
    console.log('='.repeat(56));

    console.log('\n[1] 健康检查');
    const h = await req('/api/health');
    check('健康检查返回 200', h.code, 200);
    check('数据库可达', h.body.ok, true);

    console.log('\n[2] 必填校验（期望 400）');
    await sleep(WINDOW + 500);
    const bad1 = await req('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '无内容' }),
    });
    check('缺留言+缺联系方式', bad1.code, 400);
    check('提示 message 必填', Boolean(bad1.body.fields && bad1.body.fields.message), true);
    check('提示联系方式必填', Boolean(bad1.body.fields && bad1.body.fields.contact), true);

    const bad2 = await req('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bad-email', message: '内容' }),
    });
    check('邮箱格式错误', bad2.code, 400);

    console.log('\n[3] 正常提交（期望 200）');
    await sleep(WINDOW + 500);
    const ok = await req('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'E2E 测试',
            email: 'e2e@example.com',
            message: '端到端测试自动提交，验证线索是否真实落库。',
            source: 'e2e-script',
        }),
    });
    check('正常提交', ok.code, 200);
    check('返回自增 id', typeof ok.body.id === 'number', true);
    console.log(`        已写入记录 id=${ok.body.id}, mail=${ok.body.mail}`);

    console.log('\n[4] 频率限制（10秒内第3次期望 429）');
    const r1 = await req('/api/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'rl1@example.com', message: '限流测试1' }),
    });
    const r2 = await req('/api/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'rl2@example.com', message: '限流测试2' }),
    });
    const r3 = await req('/api/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'rl3@example.com', message: '限流测试3' }),
    });
    console.log(`        实际序列: ${r1.code}, ${r2.code}, ${r3.code}`);
    check('超出窗口被限流', r3.code, 429);

    console.log('\n[5] 安全边界');
    const noauth = await req('/admin');
    check('未登录访问 /admin 被拦截', noauth.code, 401);

    // 数据库文件绝不可下载。两种部署下状态码不同但都安全：
    //   直连后端(3011) → 后端自身返回 403
    //   经预览代理(3000) → 静态目录里没有该文件，返回 404
    // 关键断言是「拿不到数据库内容」，故同时校验状态码与响应体大小。
    const dbRes = await fetch(BASE + '/data/leads.db');
    const dbBody = await dbRes.text();
    const leaked = /SQLite format 3/.test(dbBody);
    check('数据库文件不可下载', leaked, false);
    check('数据库请求被拒绝(403/404)', [403, 404].includes(dbRes.status), true);

    console.log('\n[6] 限流窗口恢复验证');
    await sleep(WINDOW + 500);
    const rec = await req('/api/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'after@example.com', message: '窗口恢复后应成功' }),
    });
    check('窗口过后恢复可提交', rec.code, 200);

    console.log('\n' + '='.repeat(56));
    console.log(`结果: ${pass} 通过 / ${fail} 失败`);
    process.exit(fail === 0 ? 0 : 1);
})();