// ============================================================
// 页面生成脚本：读取 src/data.js，生成 public/ 下的整站静态网页
// 一般不需要改这个文件；改内容去 src/data.js，改样式去 src/style.css
// ============================================================
const fs = require('fs');
const path = require('path');
const { DOMAIN, site, author, home, work, alsoDoing, cases, pages, contact, projects, articles } = require('./data');

const PUBLIC_DIR = path.join(__dirname, '../public');

// 清掉上一次生成的页面，避免改名后的旧页面残留在 public/ 里被一起部署
// （style.css 由 build:css 先生成，static/ 下面会重新复制，都不在清理范围内）
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.readdirSync(PUBLIC_DIR).forEach(name => {
    const full = path.join(PUBLIC_DIR, name);
    if (name.endsWith('.html')) fs.rmSync(full);
    if (['articles', 'practices', 'work'].includes(name)) fs.rmSync(full, { recursive: true, force: true });
});
['', '/practices', '/articles', '/work'].forEach(dir => {
    fs.mkdirSync(path.join(PUBLIC_DIR, dir), { recursive: true });
});

// HTML 转义：用于标题、描述等写进属性或纯文本的位置（文章正文 content 本身是 HTML，不转义）
const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const NAME = author.name;
const YEAR = new Date().getFullYear();

// 还是示例内容时（名字没改），自动生成「上手指南」页，并在每页顶部加一条提示；换成自己的内容后两者都会消失
const SHOW_GUIDE = NAME === '你的名字';
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#b0341c"/><text x="32" y="44" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="36" font-weight="500" text-anchor="middle" fill="#fff7ef">${esc(site.faviconText || NAME.slice(0, 1))}</text></svg>`;

const sortedArticles = [...articles].sort((a, b) => b.date.localeCompare(a.date));
const articlesOf = (p) => sortedArticles.filter(a => a.projectId === p.id);
const latestOf = (p) => { const arts = articlesOf(p); return arts.length ? arts[0].date : ''; };
const workOf = (p) => (p && p.workId ? work.find(w => w.id === p.workId) : null);
const workUrl = (w) => `/work/${w.slug}.html`;

// 状态标签：「进行中」用绿色，其余用中性色
const statusTag = (status) => (status === '进行中' ? '<span class="tag ok">' : '<span class="tag">') + esc(status) + '</span>';

// 分区标题
const secHead = (id, kicker, title, text) => `
                <div class="sec-head">
                    <p class="kicker">${esc(kicker)}</p>
                    <h2 id="${id}">${esc(title)}</h2>${text ? `
                    <p>${esc(text)}</p>` : ''}
                </div>`;

// ---------- 结构化数据（JSON-LD）----------
const PERSON_ID = `${DOMAIN}/#person`;
const WEBSITE_ID = `${DOMAIN}/#website`;

const getPersonNode = () => ({
    "@type": "Person",
    "@id": PERSON_ID,
    "name": NAME,
    ...(author.jobTitle ? { "jobTitle": author.jobTitle } : {}),
    "description": author.description,
    "email": author.email,
    ...(author.telephone ? { "telephone": author.telephone } : {}),
    "url": author.url,
    ...(author.photo ? { "image": `${DOMAIN}${author.photo}` } : {}),
    "knowsAbout": work.map(w => w.name),
    ...(author.socials.length ? { "sameAs": author.socials.map(s => s.url) } : {}),
    "inLanguage": "zh-CN"
});

const getWebsiteNode = () => ({
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    "name": site.name,
    "url": `${DOMAIN}/`,
    "publisher": { "@id": PERSON_ID },
    "inLanguage": "zh-CN"
});

const getBreadcrumbNode = (canonical, items) => ({
    "@type": "BreadcrumbList",
    "@id": `${canonical}#breadcrumb`,
    "itemListElement": items.map((item, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "name": item.name,
        "item": item.url
    }))
});

const getItemListNode = (itemListId, name, items) => {
    if (!items || !items.length) return null;
    return {
        "@type": "ItemList",
        "@id": itemListId,
        "name": name,
        "itemListOrder": "https://schema.org/ItemListOrderDescending",
        "numberOfItems": items.length,
        "itemListElement": items.map((item, index) => ({
            "@type": "ListItem",
            "position": index + 1,
            "url": item.url,
            "name": item.name
        }))
    };
};

const getFaqNode = (id, pageId, faq) => (faq && faq.length ? {
    "@type": "FAQPage",
    "@id": id,
    "mainEntityOfPage": { "@id": pageId },
    "isPartOf": { "@id": WEBSITE_ID },
    "mainEntity": faq.map(q => ({
        "@type": "Question",
        "name": q.q,
        "acceptedAnswer": { "@type": "Answer", "text": q.a }
    }))
} : null);

// ---------- 页面框架 ----------
const NAV_ITEMS = [
    { key: 'work', name: pages.work.nav, url: '/work.html' },
    { key: 'practices', name: pages.practices.nav, url: '/practices.html' },
    { key: 'articles', name: pages.articles.nav, url: '/articles.html' },
    { key: 'about', name: pages.about.nav, url: '/about.html' }
];

// 左上角头像：data.js 里填了 avatar 就显示图片，否则显示占位圆圈
const avatarHtml = author.avatar
    ? `<img class="avatar" src="${author.avatar}" width="36" height="36" alt="">`
    : '<span class="avatar avatar-slot" aria-hidden="true">头像</span>';

// 通用布局：全站默认浅色；访客切换过深浅色的话，会在页面绘制前恢复上次的选择
function layout({ title, desc, canonical, jsonLdGraph, content, robots, breadcrumb, ogType = "website", nav = '' }) {
    let jsonLdScript = '';
    const validGraph = (jsonLdGraph || []).filter(Boolean);
    if (validGraph.length > 0) {
        jsonLdScript = `<script type="application/ld+json">\n${JSON.stringify({ "@context": "https://schema.org", "@graph": validGraph }, null, 2)}\n    </script>`;
    }

    const crumbs = breadcrumb && breadcrumb.length ? `
        <div class="wrap">
            <nav aria-label="面包屑导航" class="crumbs">
                <ol>
                    ${breadcrumb.map((item, i) => {
                        const isLast = i === breadcrumb.length - 1;
                        return isLast
                            ? '<li><span aria-current="page">' + esc(item.name) + '</span></li>'
                            : '<li><a href="' + item.url + '">' + esc(item.name) + '</a><span aria-hidden="true">/</span></li>';
                    }).join('')}
                </ol>
            </nav>
        </div>` : '';

    return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="${ogType}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(desc)}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:site_name" content="${esc(site.name)}">
    <meta property="og:locale" content="zh_CN">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(desc)}">
    <meta name="theme-color" content="#f5f4f0">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <script>try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
    ${robots ? `<meta name="robots" content="${robots}">\n    ` : ''}<link rel="stylesheet" href="/style.css">
    ${jsonLdScript}
</head>
<body${nav === 'home' ? ' class="home"' : ''}>
    <a class="skip" href="#main">跳到正文</a>${SHOW_GUIDE && nav !== 'start' ? `
    <div class="guide-bar"><div class="wrap">这是示例网站，内容还没换成你的。<a href="/start.html">看看怎么用 AI 几分钟把它变成你自己的网站 →</a></div></div>` : ''}
    <header class="site-head">
        <div class="head-inner">
            <a class="brand" href="/" aria-label="${esc(NAME)}｜回到首页">
                ${avatarHtml}
                <span><b>${esc(NAME)}</b><small>${esc(author.jobTitle || DOMAIN.replace(/^https?:\/\//, ''))}</small></span>
            </a>
            <nav class="site-nav" aria-label="主导航">
                ${NAV_ITEMS.map(item => `<a href="${item.url}"${item.key === nav ? ' aria-current="page"' : ''}>${esc(item.name)}</a>`).join('\n                ')}
            </nav>
            <a class="btn head-cta" href="/contact.html">${esc(pages.contact.title)}</a>
        </div>
    </header>
    <main id="main">${crumbs}${content}
    </main>
    <footer class="site-foot">
        <div class="wrap">
            <div class="foot-grid">
                <div class="foot-brand">
                    <b>${esc(NAME)}</b>
                    <p>${esc(author.description)}</p>
                </div>
                <div>
                    <h2>${esc(pages.work.nav)}</h2>
                    <ul>
                        ${work.map(w => `<li><a href="${workUrl(w)}">${esc(w.name)}</a></li>`).join('\n                        ')}
                    </ul>
                </div>
                <div>
                    <h2>网站</h2>
                    <nav aria-label="页脚导航">
                        <a href="/">首页</a>
                        <a href="/work.html">${esc(pages.work.nav)}</a>
                        <a href="/practices.html">${esc(pages.practices.nav)}</a>
                        <a href="/articles.html">${esc(pages.articles.nav)}</a>
                        <a href="/about.html">${esc(pages.about.nav)}</a>
                        <a href="/contact.html">${esc(pages.contact.nav)}</a>
                        <a href="/rss.xml">RSS</a>
                    </nav>
                </div>
            </div>
            <div class="foot-bottom">
                <address>&copy; ${YEAR} ${esc(NAME)}${site.icp ? ` · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">${esc(site.icp)}</a>` : ''}</address>
                <button type="button" class="theme-toggle" data-theme-toggle hidden>深色</button>
            </div>
        </div>
    </footer>
    <script>
    (function () {
        // 深浅色切换：默认浅色，访客的选择会记住
        var btn = document.querySelector('[data-theme-toggle]');
        if (!btn) return;
        var root = document.documentElement;
        var meta = document.querySelector('meta[name="theme-color"]');
        function sync() {
            var dark = root.getAttribute('data-theme') === 'dark';
            btn.textContent = dark ? '浅色' : '深色';
            btn.setAttribute('aria-label', dark ? '切换到浅色' : '切换到深色');
            if (meta) meta.setAttribute('content', dark ? '#0d0e0e' : '#f5f4f0');
        }
        sync();
        btn.hidden = false;
        btn.addEventListener('click', function () {
            var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            root.setAttribute('data-theme', next);
            try { localStorage.setItem('theme', next); } catch (e) {}
            sync();
        });
    })();
    </script>
</body>
</html>`;
}

// ---------- 可复用的区块 ----------

// 文章条目
function postItem(art, { showProject = true, showSummary = false } = {}) {
    const proj = projects.find(p => p.id === art.projectId);
    return `
                    <li><a href="/articles/${art.slug}.html"><time datetime="${art.date}">${art.date}</time><span class="body"><span class="t">${esc(art.title)}</span>${showSummary ? `<span class="sum">${esc(art.conclusion)}</span>` : ''}</span>${showProject && proj ? `<span class="p">${esc(proj.short || proj.title)}</span>` : ''}</a></li>`;
}

// 项目卡片
function projectCard(p, heading) {
    const n = articlesOf(p).length;
    const latest = latestOf(p);
    const w = workOf(p);
    return `
                    <li>
                        <a class="card" href="/practices/${p.slug}.html">
                            <div class="top"><${heading}>${esc(p.title)}</${heading}>${statusTag(p.status)}</div>
                            <p>${esc(p.desc)}</p>
                            <span class="meta">${w ? `方向：${esc(w.name)} · ` : ''}${n} 篇记录${latest ? ` · 最近更新 <time datetime="${latest}">${latest}</time>` : ''}</span>
                        </a>
                    </li>`;
}

// 「在做的事」卡片
function workCard(w, i) {
    return `
                    <article class="svc">
                        <p class="num">0${i + 1} · ${esc(w.short)}</p>
                        <h3><a href="${workUrl(w)}">${esc(w.name)}</a></h3>
                        <p class="tagline">${esc(w.tagline)}</p>
                        <ul class="checks">
                            ${w.deliverables.map(d => `<li>${esc(d.title)}</li>`).join('\n                            ')}
                        </ul>
                        <a class="more" href="${workUrl(w)}">看看怎么做 →</a>
                    </article>`;
}

// 我的做法
const stepsHtml = () => `
                <ol class="steps">
                    ${home.process.map(st => `<li><b>${esc(st.title)}</b><p>${esc(st.text)}</p></li>`).join('\n                    ')}
                </ol>`;

// 常见问题（折叠，内容仍在源码里）
const faqList = (faq) => `
                <div class="faq-list">
                    ${faq.map(q => `<details><summary>${esc(q.q)}</summary><p>${esc(q.a)}</p></details>`).join('\n                    ')}
                </div>`;

// 也在做
const alsoHtml = () => `
                <ul class="others">
                    ${alsoDoing.map(o => `<li><b>${esc(o.name)}</b><p>${esc(o.text)}</p></li>`).join('\n                    ')}
                </ul>`;

// 底部引导区：统一引导到联系页
const ctaBand = (title = '想聊聊？', text = '你在做类似的事，或者卡在某一步，欢迎联系我。留言、邮件、微信都可以，我看到会回复。') => `

        <section class="cta-band" aria-labelledby="cta-h">
            <div class="wrap">
                <h2 id="cta-h">${esc(title)}</h2>
                <p>${esc(text)}</p>
                <div class="cta-row">
                    <a class="btn" href="/contact.html">${esc(pages.contact.title)} →</a>
                    <a class="btn ghost" href="mailto:${author.email}">直接发邮件</a>
                </div>
            </div>
        </section>`;

// 例子 / 案例（data.js 里 cases 留空则不显示）
const casesBand = () => cases.length ? `

        <section class="band" aria-labelledby="case-h">
            <div class="wrap">${secHead('case-h', '例子', '做过的例子', '按对方意愿匿名。')}
                <ul class="cards cols-3">
                    ${cases.map(c => {
                        const w = work.find(x => x.id === c.workId);
                        return `<li><div class="card case"><div class="top"><h3>${esc(c.industry)}</h3>${w ? `<span class="tag">${esc(w.short)}</span>` : ''}</div><dl><dt>问题</dt><dd>${esc(c.problem)}</dd><dt>做法</dt><dd>${esc(c.did)}</dd><dt>结果</dt><dd>${esc(c.result)}</dd></dl></div></li>`;
                    }).join('\n                    ')}
                </ul>
            </div>
        </section>` : '';

// 文末 / 项目页里的「你也在做这件事？」
const relatedCta = (w, kicker) => `
            <aside class="article-cta" aria-label="交流">
                <p class="k">${kicker}</p>
                <h2>${w ? esc(w.name) : '想聊聊？'}</h2>
                <p>${w ? `${esc(w.tagline)}。欢迎交流你的做法，或者聊聊卡在哪一步。` : '你在做类似的事，或者卡在某一步，欢迎联系我。'}</p>
                <div class="cta-row">
                    <a class="btn" href="/contact.html">${esc(pages.contact.title)}</a>${w ? `
                    <a class="btn ghost" href="${workUrl(w)}">看看 ${esc(w.short)} 怎么做</a>` : ''}
                </div>
            </aside>`;

// ---------- 1. 首页 ----------
const homeCanonical = `${DOMAIN}/`;
const homeDesc = author.description;
const S = home.sections;

const indexArticles = sortedArticles.slice(0, 4);
// 首页展示有对应方向、最近有更新的 3 个项目
const indexProjects = [...projects]
    .sort((a, b) => (b.workId ? 1 : 0) - (a.workId ? 1 : 0) || latestOf(b).localeCompare(latestOf(a)))
    .slice(0, 3);

fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), layout({
    title: site.homeTitle,
    desc: homeDesc,
    canonical: homeCanonical,
    nav: 'home',
    jsonLdGraph: [
        getWebsiteNode(),
        getPersonNode(),
        {
            "@type": "WebPage",
            "@id": `${homeCanonical}#webpage`,
            "url": homeCanonical,
            "name": site.homeTitle,
            "description": homeDesc,
            "isPartOf": { "@id": WEBSITE_ID },
            "about": { "@id": PERSON_ID },
            "hasPart": [
                { "@id": `${homeCanonical}#practice-itemlist` },
                { "@id": `${homeCanonical}#article-itemlist` }
            ],
            "inLanguage": "zh-CN"
        },
        getItemListNode(`${homeCanonical}#practice-itemlist`, S.projects.title, indexProjects.map(p => ({ url: `${DOMAIN}/practices/${p.slug}.html`, name: p.title }))),
        getItemListNode(`${homeCanonical}#article-itemlist`, S.articles.title, indexArticles.map(a => ({ url: `${DOMAIN}/articles/${a.slug}.html`, name: a.title }))),
        getFaqNode(`${homeCanonical}#faq`, `${homeCanonical}#webpage`, home.faq)
    ],
    content: `
        <div class="wrap">
            ${author.photo ? '<section class="hero has-photo">' : '<section class="hero">'}
                <div>
                    <p class="kicker"><b>~/</b> ${esc(home.eyebrow)}</p>
                    <h1>${esc(home.headline[0])}<br><span class="accent">${esc(home.headline[1] || '')}</span></h1>
                    <p class="lead">${esc(home.sub)}</p>
                    <div class="cta-row">
                        <a class="btn" href="/contact.html">${esc(pages.contact.title)} →</a>
                        <a class="btn ghost" href="/work.html">看我${esc(pages.work.nav)}</a>
                    </div>
                    <ul class="promises">
                        ${home.notes.map(t => `<li>${esc(t)}</li>`).join('\n                        ')}
                    </ul>
                </div>${author.photo ? `
                <figure class="hero-photo"><img src="${author.photo}"${author.photoSmall ? ` srcset="${author.photoSmall} 480w, ${author.photo} 800w" sizes="320px"` : ''} width="800" height="1000" decoding="async" alt="${esc(author.photoAlt || NAME)}"><figcaption>${esc(NAME)} · ${esc(author.location)}</figcaption></figure>` : ''}
            </section>
        </div>

        <section class="band alt" id="work" aria-labelledby="work-h">
            <div class="wrap">${secHead('work-h', S.work.kicker, S.work.title, S.work.text)}
                <div class="svc-grid">${work.map(workCard).join('')}
                </div>
            </div>
        </section>

        <section class="band" aria-labelledby="flow-h">
            <div class="wrap">${secHead('flow-h', S.process.kicker, S.process.title, S.process.text)}${stepsHtml()}
            </div>
        </section>${casesBand()}

        <section class="band alt" aria-labelledby="proof-h">
            <div class="wrap">${secHead('proof-h', S.projects.kicker, S.projects.title, S.projects.text)}
                <ul class="cards cols-3">${indexProjects.map(p => projectCard(p, 'h3')).join('')}
                </ul>
                <a class="more" href="/practices.html">全部 ${projects.length} 个项目 →</a>
            </div>
        </section>

        <section class="band" aria-labelledby="post-h">
            <div class="wrap">${secHead('post-h', S.articles.kicker, S.articles.title, S.articles.text)}
                <ul class="posts">${indexArticles.map(art => postItem(art)).join('')}
                </ul>
                <a class="more" href="/articles.html">全部${esc(pages.articles.nav)} →</a>
            </div>
        </section>${alsoDoing.length ? `

        <section class="band alt" aria-labelledby="other-h">
            <div class="wrap">${secHead('other-h', S.also.kicker, S.also.title, S.also.text)}${alsoHtml()}
            </div>
        </section>` : ''}${home.faq.length ? `

        <section class="band" aria-labelledby="faq-h">
            <div class="wrap">${secHead('faq-h', S.faq.kicker, S.faq.title, S.faq.text)}${faqList(home.faq)}
            </div>
        </section>` : ''}${ctaBand()}`
}));

// ---------- 2. 「在做的事」总览页 ----------
const workCanonical = `${DOMAIN}/work.html`;
const workTitle = `${pages.work.title} - ${NAME}`;
fs.writeFileSync(path.join(PUBLIC_DIR, 'work.html'), layout({
    title: workTitle,
    desc: pages.work.description,
    canonical: workCanonical,
    nav: 'work',
    breadcrumb: [
        { name: "首页", url: "/" },
        { name: pages.work.nav, url: "/work.html" }
    ],
    jsonLdGraph: [
        getWebsiteNode(),
        getPersonNode(),
        {
            "@type": "WebPage",
            "@id": `${workCanonical}#webpage`,
            "url": workCanonical,
            "name": workTitle,
            "description": pages.work.description,
            "isPartOf": { "@id": WEBSITE_ID },
            "about": { "@id": PERSON_ID },
            "hasPart": work.map(w => ({ "@id": `${DOMAIN}${workUrl(w)}#service` })),
            "inLanguage": "zh-CN"
        },
        getBreadcrumbNode(workCanonical, [
            { name: "首页", url: `${DOMAIN}/` },
            { name: pages.work.nav, url: workCanonical }
        ])
    ],
    content: `
        <div class="wrap">
            <header class="page-head">
                <h1>${esc(pages.work.title)}</h1>
                <p class="lead">${esc(pages.work.lead)}</p>
            </header>
        </div>

        <section class="band alt tight" aria-label="${esc(pages.work.title)}">
            <div class="wrap">
                <div class="svc-grid">${work.map(workCard).join('')}
                </div>
            </div>
        </section>

        <section class="band" aria-labelledby="flow-h">
            <div class="wrap">${secHead('flow-h', '我的做法', S.process.title)}${stepsHtml()}
            </div>
        </section>${alsoDoing.length ? `

        <section class="band alt" aria-labelledby="other-h">
            <div class="wrap">${secHead('other-h', '也在做', S.also.title)}${alsoHtml()}
            </div>
        </section>` : ''}${ctaBand()}`
}));

// ---------- 3. 「在做的事」详情页 ----------
work.forEach((w, i) => {
    const url = `${DOMAIN}${workUrl(w)}`;
    const title = `${w.name}：${w.tagline} - ${NAME}`;
    const proj = projects.find(p => p.workId === w.id);
    const related = proj ? articlesOf(proj) : [];

    fs.writeFileSync(path.join(PUBLIC_DIR, 'work', `${w.slug}.html`), layout({
        title,
        desc: w.summary,
        canonical: url,
        nav: 'work',
        breadcrumb: [
            { name: "首页", url: "/" },
            { name: pages.work.nav, url: "/work.html" },
            { name: w.name, url: workUrl(w) }
        ],
        jsonLdGraph: [
            getWebsiteNode(),
            getPersonNode(),
            {
                "@type": "WebPage",
                "@id": `${url}#webpage`,
                "url": url,
                "name": title,
                "description": w.summary,
                "isPartOf": { "@id": WEBSITE_ID },
                "mainEntity": { "@id": `${url}#service` },
                "inLanguage": "zh-CN"
            },
            {
                "@type": "Service",
                "@id": `${url}#service`,
                "name": w.name,
                "serviceType": w.short,
                "description": w.summary,
                "provider": { "@id": PERSON_ID },
                "url": url,
                "inLanguage": "zh-CN"
            },
            getBreadcrumbNode(url, [
                { name: "首页", url: `${DOMAIN}/` },
                { name: pages.work.nav, url: workCanonical },
                { name: w.name, url }
            ]),
            getFaqNode(`${url}#faq`, `${url}#webpage`, w.faq)
        ],
        content: `
        <div class="wrap">
            <header class="page-head">
                <p class="kicker"><b>0${i + 1}</b> / ${esc(w.short)}</p>
                <h1>${esc(w.name)}</h1>
                <p class="lead">${esc(w.tagline)}。${esc(w.summary)}</p>
                <div class="cta-row">
                    <a class="btn" href="/contact.html">${esc(pages.contact.title)} →</a>
                    <a class="btn ghost" href="mailto:${author.email}">直接发邮件</a>
                </div>
            </header>
        </div>

        <section class="band alt" aria-labelledby="get-h">
            <div class="wrap">${secHead('get-h', '我在做的', '具体做什么')}
                <ol class="deliver">
                    ${w.deliverables.map(d => `<li><b>${esc(d.title)}</b><p>${esc(d.text)}</p></li>`).join('\n                    ')}
                </ol>
            </div>
        </section>

        <section class="band" aria-label="和谁有关">
            <div class="wrap">
                <div class="split">
                    <div class="box">
                        <h2>可能和你有关，如果你是</h2>
                        <ul>
                            ${w.forWho.map(t => `<li>${esc(t)}</li>`).join('\n                            ')}
                        </ul>
                    </div>${proj ? `
                    <div class="box">
                        <h2>我在哪里实践</h2>
                        <p><a href="/practices/${proj.slug}.html">${esc(proj.title)} →</a></p>
                        <p class="note">${esc(proj.desc)}</p>
                    </div>` : ''}
                </div>
            </div>
        </section>${(w.faq && w.faq.length) || related.length ? `

        <section class="band alt" aria-labelledby="faq-h">
            <div class="wrap">${secHead('faq-h', '常见问题', `关于 ${w.short}`)}${w.faq && w.faq.length ? faqList(w.faq) : ''}${related.length ? `
                <div class="related">
                    <h2>// 相关${esc(pages.articles.nav)}</h2>
                    <ul class="posts">${related.map(a => postItem(a, { showProject: false })).join('')}
                    </ul>
                </div>` : ''}
            </div>
        </section>` : ''}${ctaBand(`想聊聊 ${w.short}？`)}`
    }));
});

// ---------- 4. 关于页 ----------
const aboutCanonical = `${DOMAIN}/about.html`;
const aboutTitle = `${pages.about.title} - ${NAME}`;
fs.writeFileSync(path.join(PUBLIC_DIR, 'about.html'), layout({
    title: aboutTitle,
    desc: pages.about.description,
    canonical: aboutCanonical,
    nav: 'about',
    breadcrumb: [
        { name: "首页", url: "/" },
        { name: pages.about.nav, url: "/about.html" }
    ],
    jsonLdGraph: [
        getWebsiteNode(),
        getPersonNode(),
        {
            "@type": "ProfilePage",
            "@id": `${aboutCanonical}#webpage`,
            "url": aboutCanonical,
            "name": aboutTitle,
            "description": pages.about.description,
            "isPartOf": { "@id": WEBSITE_ID },
            "mainEntity": { "@id": PERSON_ID },
            "inLanguage": "zh-CN"
        },
        getBreadcrumbNode(aboutCanonical, [
            { name: "首页", url: `${DOMAIN}/` },
            { name: pages.about.nav, url: aboutCanonical }
        ])
    ],
    content: `
        <div class="wrap">
            <header class="page-head">
                <h1>${esc(pages.about.heading)}</h1>
                <p class="lead">${esc(pages.about.lead)}</p>
            </header>
            <div class="about-grid">${author.photo ? `
                <figure class="about-photo"><img src="${author.photoSmall || author.photo}" width="220" height="275" loading="lazy" alt="${esc(author.photoAlt || NAME)}"></figure>` : '<div></div>'}
                <div>
                    <div class="prose">
                        ${pages.about.paragraphs.map(t => `<p>${esc(t)}</p>`).join('\n                        ')}
                    </div>${pages.about.principles.length ? `
                    <ul class="principles">
                        ${pages.about.principles.map(t => `<li>${esc(t)}</li>`).join('\n                        ')}
                    </ul>` : ''}
                </div>
            </div>
        </div>${ctaBand()}`
}));

// ---------- 5. 联系页 ----------
const contactCanonical = `${DOMAIN}/contact.html`;
const contactTitle = `${pages.contact.title} - ${NAME}`;
const wechatBox = (contact.wechatQr || author.wechat) ? `
                    <div class="side-box">
                        <h2>// 微信</h2>${contact.wechatQr ? `
                        <div class="wx-desk">
                            <img src="${contact.wechatQr}" width="140" height="178" loading="lazy" alt="${esc(NAME)}的微信二维码">
                            <p>用手机微信扫一扫，备注一下来意。</p>
                        </div>` : ''}${author.wechat ? `
                        <div class="wx-mobile">
                            <button class="btn" type="button" data-copy="${esc(author.wechat)}">复制微信号</button>
                            <p>复制后到微信里粘贴搜索，备注一下来意。</p>
                        </div>` : ''}
                    </div>` : '';
const elsewhereBox = (contact.wechatAccount || author.socials.length) ? `
                    <div class="side-box">
                        <h2>// 其他地方</h2>
                        <ul class="kv">${contact.wechatAccount ? `
                            <li><span class="k">公众号</span><span>${esc(contact.wechatAccount)}</span></li>` : ''}
                            ${author.socials.map(s => `<li><span class="k">${esc(s.name)}</span><a href="${s.url}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ↗</a></li>`).join('\n                            ')}
                        </ul>
                    </div>` : '';

fs.writeFileSync(path.join(PUBLIC_DIR, 'contact.html'), layout({
    title: contactTitle,
    desc: pages.contact.description,
    canonical: contactCanonical,
    nav: 'contact',
    breadcrumb: [
        { name: "首页", url: "/" },
        { name: pages.contact.nav, url: "/contact.html" }
    ],
    jsonLdGraph: [
        getWebsiteNode(),
        getPersonNode(),
        {
            "@type": "WebPage",
            "@id": `${contactCanonical}#webpage`,
            "url": contactCanonical,
            "name": contactTitle,
            "description": pages.contact.description,
            "isPartOf": { "@id": WEBSITE_ID },
            "about": { "@id": PERSON_ID },
            "inLanguage": "zh-CN"
        },
        getBreadcrumbNode(contactCanonical, [
            { name: "首页", url: `${DOMAIN}/` },
            { name: pages.contact.nav, url: contactCanonical }
        ])
    ],
    content: `
        <div class="wrap">
            <header class="page-head">
                <h1>${esc(pages.contact.title)}</h1>
                <p class="lead">${esc(pages.contact.lead)}</p>
            </header>

            <div class="contact-grid">
                <section id="contact-form" aria-label="留言">
                    <form class="form" id="cf-form" novalidate>
                        <label class="field">
                            <span>怎么称呼你 <small>（选填）</small></span>
                            <input type="text" name="name" maxlength="60" autocomplete="name">
                        </label>
                        <label class="field">
                            <span>公司名或网站 <small>（选填）</small></span>
                            <input type="text" name="company" maxlength="120" autocomplete="organization">
                        </label>
                        <label class="field">
                            <span>主营产品 / 行业 <small>（选填）</small></span>
                            <input type="text" name="product" maxlength="120">
                        </label>${contact.topics.length ? `
                        <fieldset class="field">
                            <legend>想聊什么 <small>（可多选）</small></legend>
                            <div class="checkset">
                                ${contact.topics.map(n => `<label><input type="checkbox" name="topics" value="${esc(n)}">${esc(n)}</label>`).join('\n                                ')}
                            </div>
                        </fieldset>` : ''}
                        <label class="field">
                            <span>怎么联系你 <small>（邮箱或手机 / 微信号）</small></span>
                            <input type="text" name="contact" maxlength="120" autocomplete="email" required>
                        </label>
                        <label class="field">
                            <span>想说的话 <small>（选填）</small></span>
                            <textarea name="message" rows="4" maxlength="4000"></textarea>
                        </label>

                        <!-- Honeypot：真人看不到，机器人通常会填 -->
                        <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">

                        <div class="form-foot">
                            <button class="btn" type="submit" id="cf-submit">发送</button>
                            <p class="form-status" id="cf-status" role="status" aria-live="polite"></p>
                        </div>
                        <p class="privacy">你留下的信息只用来回复你，不公开，不给第三方。表单提交频次有限制。</p>
                    </form>
                </section>

                <aside aria-label="其他联系方式">
                    <div class="side-box">
                        <h2>// 也可以直接发邮件</h2>
                        <a class="email" href="mailto:${author.email}">${author.email.replace('@', '<wbr>@')}</a>
                        <div class="actions">
                            <button class="btn ghost" type="button" data-copy="${author.email}">复制邮箱</button>
                        </div>${author.replyTime ? `
                        <p class="reply">一般 ${esc(author.replyTime)}内回复</p>` : ''}
                    </div>${wechatBox}${elsewhereBox}
                </aside>
            </div>
        </div>

            <script>
            (function () {
                // 复制按钮：剪贴板不可用时，直接把内容显示在按钮上，方便手动复制
                document.querySelectorAll('[data-copy]').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        var value = btn.getAttribute('data-copy');
                        var label = btn.textContent;
                        function done(text) {
                            btn.textContent = text;
                            setTimeout(function () { btn.textContent = label; }, 1800);
                        }
                        if (navigator.clipboard && window.isSecureContext) {
                            navigator.clipboard.writeText(value).then(function () { done('已复制'); }, function () { done(value); });
                        } else {
                            done(value);
                        }
                    });
                });

                var form = document.getElementById('cf-form');
                if (!form) return;
                var statusEl = document.getElementById('cf-status');
                var btn = document.getElementById('cf-submit');

                function say(msg, kind) {
                    statusEl.textContent = msg;
                    statusEl.className = 'form-status' + (kind ? ' ' + kind : '');
                }

                // 防垃圾：隐藏陷阱字段（website）+ 后端按 IP 限流

                form.addEventListener('submit', function (e) {
                    e.preventDefault();

                    // Honeypot 命中：静默丢弃，伪装成成功
                    if (form.website && form.website.value) {
                        say('已收到。', 'ok');
                        form.reset();
                        return;
                    }

                    var raw = form.contact.value.trim();
                    var company = form.company.value.trim();
                    var product = form.product.value.trim();
                    var note = form.message.value.trim();
                    var topics = Array.prototype.filter.call(form.querySelectorAll('input[name="topics"]'), function (c) { return c.checked; })
                        .map(function (c) { return c.value; });

                    if (!topics.length && !note && !product) { say('选一下想聊什么，或者写一句想说的话吧。', 'err'); return; }
                    if (!raw) { say('留一个能联系到你的方式吧。', 'err'); form.contact.focus(); return; }

                    // 一个输入框：含 @ 视为邮箱，否则视为手机 / 微信号（后端约定 email 与 phone 二选一）
                    var isEmail = raw.indexOf('@') > -1;
                    if (isEmail && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(raw)) {
                        say('这个邮箱格式好像不对。', 'err');
                        form.contact.focus();
                        return;
                    }

                    // 后端只存一段留言，把表单各项拼成一段，方便在邮件里直接看
                    var lines = [];
                    if (topics.length) lines.push('【想聊】' + topics.join('、'));
                    if (company) lines.push('【公司/网站】' + company);
                    if (product) lines.push('【产品/行业】' + product);
                    if (note) lines.push('【留言】' + note);

                    var payload = {
                        name: form.name.value.trim(),
                        contact_type: isEmail ? 'email' : 'phone',
                        email: isEmail ? raw : '',
                        phone: isEmail ? '' : raw,
                        message: lines.join('\\n'),
                        source: 'contact-page'
                    };

                    btn.disabled = true;
                    say('发送中…');

                    // 相对路径：线上由 Nginx 反代，本地由 serve.js 反代
                    fetch('/api/leads', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    }).then(function (r) {
                        return r.json().then(function (j) { return { code: r.status, body: j }; });
                    }).then(function (res) {
                        if (res.code === 200) {
                            form.reset();
                            say('收到了，我看到会回复你。', 'ok');
                        } else if (res.code === 429) {
                            say(res.body.error || '提交过于频繁，请稍后再试。', 'err');
                        } else if (res.code === 400 && res.body.fields) {
                            var f = res.body.fields, msg = [];
                            if (f.message) msg.push(f.message);
                            if (f.contact) msg.push(f.contact);
                            if (f.email) msg.push(f.email);
                            say(msg.join('；') || (res.body.error || '请检查填写内容'), 'err');
                        } else {
                            // 把后端给的具体原因显示出来（比如后端没启动、服务器出错），邮件作为后备
                            var reason = res.body && res.body.error ? res.body.error : '服务器返回 ' + res.code;
                            say('发送失败（' + reason + '）。可以改用邮件联系：' + ${JSON.stringify(author.email)}, 'err');
                        }
                    }).catch(function () {
                        say('发送失败（网络没连上，或服务器没有响应）。可以改用邮件联系：' + ${JSON.stringify(author.email)}, 'err');
                    }).then(function () { btn.disabled = false; });
                });
            })();
            </script>`
}));

// ---------- 6. 项目列表页 ----------
const practicesCanonical = `${DOMAIN}/practices.html`;
const practicesTitle = `${pages.practices.title} - ${NAME}`;
fs.writeFileSync(path.join(PUBLIC_DIR, 'practices.html'), layout({
    title: practicesTitle,
    desc: pages.practices.description,
    canonical: practicesCanonical,
    nav: 'practices',
    breadcrumb: [
        { name: "首页", url: "/" },
        { name: pages.practices.nav, url: "/practices.html" }
    ],
    jsonLdGraph: [
        getWebsiteNode(),
        getPersonNode(),
        {
            "@type": "CollectionPage",
            "@id": `${practicesCanonical}#webpage`,
            "url": practicesCanonical,
            "name": practicesTitle,
            "description": pages.practices.description,
            "isPartOf": { "@id": WEBSITE_ID },
            "mainEntity": { "@id": `${practicesCanonical}#itemlist` },
            "inLanguage": "zh-CN"
        },
        getItemListNode(`${practicesCanonical}#itemlist`, pages.practices.title, projects.map(p => ({ url: `${DOMAIN}/practices/${p.slug}.html`, name: p.title }))),
        getBreadcrumbNode(practicesCanonical, [
            { name: "首页", url: `${DOMAIN}/` },
            { name: pages.practices.nav, url: practicesCanonical }
        ])
    ],
    content: `
        <div class="wrap">
            <header class="page-head">
                <h1>${esc(pages.practices.title)}</h1>
                <p class="lead">${esc(pages.practices.lead)}</p>
            </header>
            <ul class="cards cols-2">${projects.map(p => projectCard(p, 'h2')).join('')}
            </ul>
        </div>${ctaBand()}`
}));

// ---------- 7. 项目详情页 ----------
projects.forEach((p, idx) => {
    const prevProj = idx > 0 ? projects[idx - 1] : null;
    const nextProj = idx < projects.length - 1 ? projects[idx + 1] : null;

    const pCanonical = `${DOMAIN}/practices/${p.slug}.html`;
    const relatedArts = articlesOf(p);
    const latest = latestOf(p);
    const w = workOf(p);
    const pTitle = `${p.title} - ${pages.practices.nav} - ${NAME}`;

    const relatedItemList = getItemListNode(`${pCanonical}#related-articles`, `相关${pages.articles.nav}`, relatedArts.map(a => ({ url: `${DOMAIN}/articles/${a.slug}.html`, name: a.title })));

    const webPageNode = {
        "@type": "WebPage",
        "@id": `${pCanonical}#webpage`,
        "url": pCanonical,
        "name": pTitle,
        "description": p.desc,
        "isPartOf": { "@id": WEBSITE_ID },
        "inLanguage": "zh-CN"
    };

    const creativeWorkNode = {
        "@type": "CreativeWork",
        "@id": `${pCanonical}#practice`,
        "name": p.title,
        "description": p.desc,
        "mainEntityOfPage": { "@id": `${pCanonical}#webpage` },
        "isPartOf": { "@id": WEBSITE_ID },
        "author": { "@id": PERSON_ID },
        "url": pCanonical,
        "inLanguage": "zh-CN"
    };

    if (relatedArts.length > 0) {
        creativeWorkNode.hasPart = relatedArts.map(ra => ({ "@id": `${DOMAIN}/articles/${ra.slug}.html#article` }));
    }

    const graph = [
        getWebsiteNode(),
        getPersonNode(),
        webPageNode,
        creativeWorkNode,
        getBreadcrumbNode(pCanonical, [
            { name: "首页", url: `${DOMAIN}/` },
            { name: pages.practices.nav, url: practicesCanonical },
            { name: p.title, url: pCanonical }
        ])
    ];

    if (relatedItemList) {
        webPageNode.hasPart = { "@id": `${pCanonical}#related-articles` };
        graph.push(relatedItemList);
    }

    fs.writeFileSync(path.join(PUBLIC_DIR, 'practices', `${p.slug}.html`), layout({
        title: pTitle,
        desc: p.desc,
        canonical: pCanonical,
        ogType: "article",
        nav: 'practices',
        breadcrumb: [
            { name: "首页", url: "/" },
            { name: pages.practices.nav, url: "/practices.html" },
            { name: p.title, url: `/practices/${p.slug}.html` }
        ],
        jsonLdGraph: graph,
        content: `
        <div class="wrap">
            <header class="page-head">
                <h1>${esc(p.title)}</h1>
                <p class="page-meta">${statusTag(p.status)}<span>${relatedArts.length} 篇记录</span>${latest ? `<span>最近更新 <time datetime="${latest}">${latest}</time></span>` : ''}</p>
                <p class="lead">${esc(p.desc)}</p>
            </header>${w ? `
${relatedCta(w, '// 这个项目对应的方向')}` : ''}

            <section class="related" aria-labelledby="rec-h">
                <h2 id="rec-h">// 相关${esc(pages.articles.nav)}</h2>
                ${relatedArts.length > 0 ? `<ul class="posts">${relatedArts.map(art => postItem(art, { showProject: false, showSummary: true })).join('')}
                </ul>` : '<p class="empty">暂无记录。</p>'}
            </section>

            <nav aria-label="实践导航" class="pager">
                ${prevProj ? '<a href="/practices/' + prevProj.slug + '.html" rel="prev">← 上一个项目<span class="pt">' + esc(prevProj.title) + '</span></a>' : ''}
                ${nextProj ? '<a href="/practices/' + nextProj.slug + '.html" rel="next" class="next">下一个项目 →<span class="pt">' + esc(nextProj.title) + '</span></a>' : ''}
            </nav>
        </div>
        <div class="spacer"></div>`
    }));
});

// ---------- 8. 文章列表 ----------
const articlesCanonical = `${DOMAIN}/articles.html`;
const articlesTitle = `${pages.articles.title} - ${NAME}`;
fs.writeFileSync(path.join(PUBLIC_DIR, 'articles.html'), layout({
    title: articlesTitle,
    desc: pages.articles.description,
    canonical: articlesCanonical,
    nav: 'articles',
    breadcrumb: [
        { name: "首页", url: "/" },
        { name: pages.articles.nav, url: "/articles.html" }
    ],
    jsonLdGraph: [
        getWebsiteNode(),
        getPersonNode(),
        {
            "@type": "CollectionPage",
            "@id": `${articlesCanonical}#webpage`,
            "url": articlesCanonical,
            "name": articlesTitle,
            "description": pages.articles.description,
            "isPartOf": { "@id": WEBSITE_ID },
            "mainEntity": { "@id": `${articlesCanonical}#itemlist` },
            "inLanguage": "zh-CN"
        },
        getItemListNode(`${articlesCanonical}#itemlist`, pages.articles.title, sortedArticles.map(a => ({ url: `${DOMAIN}/articles/${a.slug}.html`, name: a.title }))),
        getBreadcrumbNode(articlesCanonical, [
            { name: "首页", url: `${DOMAIN}/` },
            { name: pages.articles.nav, url: articlesCanonical }
        ])
    ],
    content: `
        <div class="wrap">
            <header class="page-head">
                <h1>${esc(pages.articles.title)}</h1>
                <p class="lead">${esc(pages.articles.lead)}</p>
            </header>
            <ul class="posts">${sortedArticles.map(art => postItem(art, { showSummary: true })).join('')}
            </ul>
        </div>${ctaBand()}`
}));

// ---------- 9. 文章详情页 ----------
articles.forEach(art => {
    const idx = sortedArticles.findIndex(a => a.id === art.id);
    const prevArt = idx > 0 ? sortedArticles[idx - 1] : null;
    const nextArt = idx < sortedArticles.length - 1 ? sortedArticles[idx + 1] : null;

    const artCanonical = `${DOMAIN}/articles/${art.slug}.html`;
    const parentProject = projects.find(p => p.id === art.projectId);
    const w = workOf(parentProject);
    const relatedArts = articles.filter(a => (art.relatedSlugs || []).includes(a.slug));

    const blogPostingNode = {
        "@type": "BlogPosting",
        "@id": `${artCanonical}#article`,
        "headline": art.title,
        "datePublished": art.date,
        "dateModified": art.date,
        "author": { "@id": PERSON_ID },
        "description": art.conclusion,
        "mainEntityOfPage": { "@id": `${artCanonical}#webpage` },
        "isPartOf": { "@id": WEBSITE_ID },
        "url": artCanonical,
        "inLanguage": "zh-CN"
    };

    if (parentProject) {
        blogPostingNode.about = { "@id": `${DOMAIN}/practices/${parentProject.slug}.html#practice` };
    }

    const graph = [
        getWebsiteNode(),
        getPersonNode(),
        {
            "@type": "WebPage",
            "@id": `${artCanonical}#webpage`,
            "url": artCanonical,
            "name": `${art.title} - ${NAME}`,
            "description": art.conclusion,
            "isPartOf": { "@id": WEBSITE_ID },
            "inLanguage": "zh-CN"
        },
        blogPostingNode,
        getBreadcrumbNode(artCanonical, [
            { name: "首页", url: `${DOMAIN}/` },
            { name: pages.articles.nav, url: articlesCanonical },
            { name: art.title, url: artCanonical }
        ]),
        getFaqNode(`${artCanonical}#faq`, `${artCanonical}#webpage`, art.qa)
    ];

    const qaHtml = art.qa && art.qa.length > 0 ? `

                <section id="qa" class="faq" aria-labelledby="qa-h">
                    <h2 id="qa-h">// 常见问题</h2>
                    <dl>
                        ${art.qa.map(q => `<dt>${esc(q.q)}</dt>
                        <dd>${esc(q.a)}</dd>`).join('\n                        ')}
                    </dl>
                </section>` : '';

    const relatedHtml = relatedArts.length > 0 ? `

            <section class="related" aria-labelledby="rel-h">
                <h2 id="rel-h">// 相关${esc(pages.articles.nav)}</h2>
                <ul class="posts">${relatedArts.map(ra => postItem(ra, { showProject: false })).join('')}
                </ul>
            </section>` : '';

    fs.writeFileSync(path.join(PUBLIC_DIR, 'articles', `${art.slug}.html`), layout({
        title: `${art.title} - ${NAME}`,
        desc: art.conclusion,
        canonical: artCanonical,
        ogType: "article",
        nav: 'articles',
        breadcrumb: [
            { name: "首页", url: "/" },
            { name: pages.articles.nav, url: "/articles.html" },
            { name: art.title, url: `/articles/${art.slug}.html` }
        ],
        jsonLdGraph: graph,
        content: `
        <div class="wrap">
            <article>
                <header class="article-head">
                    <h1>${esc(art.title)}</h1>
                    <p class="page-meta"><time datetime="${art.date}">${art.date}</time><span>作者：${esc(NAME)}</span>${parentProject ? `<span>收录于 <a href="/practices/${parentProject.slug}.html">${esc(parentProject.title)}</a></span>` : ''}</p>
                </header>

                <div class="conclusion"><b>先说结论</b>${esc(art.conclusion)}</div>

                <div class="prose">
                    ${art.content}
                </div>${qaHtml}
            </article>
${relatedCta(w, '// 你也在做这件事？')}${relatedHtml}

            <nav aria-label="文章导航" class="pager">
                ${prevArt ? '<a href="/articles/' + prevArt.slug + '.html" rel="prev">← 上一篇<span class="pt">' + esc(prevArt.title) + '</span></a>' : ''}
                ${nextArt ? '<a href="/articles/' + nextArt.slug + '.html" rel="next" class="next">下一篇 →<span class="pt">' + esc(nextArt.title) + '</span></a>' : ''}
            </nav>
        </div>
        <div class="spacer"></div>`
    }));
});

// ---------- 上手指南（只在还是示例内容时生成，不进 sitemap，不让搜索引擎收录）----------
if (SHOW_GUIDE) {
    // 提示语从项目根目录的「交给AI的提示语.txt」里读取（每段在两行 ===== 之间），保证网页和文件里的一致
    const prompts = {
        content: '请先完整阅读项目根目录的 AGENTS.md，按里面的规则工作。我的资料在「我的资料」文件夹里，请先读完，缺的信息一次性问我，不要替我编造。改完后生成网站并打开预览给我看。',
        deploy: '请先完整阅读项目根目录的 AGENTS.md 和 DEPLOY.md，按「第三阶段：部署上线」帮我把网站部署到我自己的服务器上。需要我提供的信息一次性问我，上线后告诉我网址和还没做完的事。'
    };
    try {
        const txt = fs.readFileSync(path.join(__dirname, '../交给AI的提示语.txt'), 'utf8');
        const blocks = [...txt.matchAll(/={5,}\r?\n([\s\S]*?)\r?\n={5,}/g)].map(m => m[1].trim());
        prompts.content = blocks.find(b => b.includes('我的资料')) || prompts.content;
        prompts.deploy = blocks.find(b => b.includes('部署')) || prompts.deploy;
    } catch { /* 文件不在就用上面的默认提示语 */ }

    const promptBox = (id, text) => `
                <div class="prompt-box">
                    <pre class="prompt" id="${id}">${esc(text)}</pre>
                    <button class="btn" type="button" data-copy="${id}">复制这段话</button>
                </div>`;

    const guideFaq = [
        { q: "我的资料会被上传到网上吗？", a: "不会。「我的资料」文件夹只在你自己的电脑上。AI 助手只是在你电脑上读这些文件，把需要公开的内容写进网站。部署上线时只上传生成好的网页，以后你用 Git 上传网站代码时，这个文件夹里除了两份说明文件，其他东西默认也不会被上传。" },
        { q: "网页版的豆包、DeepSeek 能用吗？", a: "能聊天，但不能直接改你电脑上的文件，需要你手动复制粘贴。下面的「备用方法」写了具体怎么做。能直接改文件的 AI 助手会省事很多。" },
        { q: "改坏了怎么办？", a: "还没上线：把报错信息发给 AI 助手让它修，实在不行，重新下载一份这个网站，把「我的资料」文件夹复制过去再来一遍。已经上线：运行 npm run deploy -- --rollback，网站会退回上一个版本。" },
        { q: "这个指南页什么时候消失？", a: "网站里的名字换成你自己的之后，重新生成（双击「一键启动.bat」），这个指南页和每页顶部的提示条就会自动消失，不会被带到线上。" },
        { q: "没有服务器和域名，能先做网站吗？", a: "能。前三步都在你自己电脑上完成，不花钱。等内容满意了再买服务器和域名。买之前先看项目里的 DEPLOY.md：服务器选中国大陆还是香港，差别主要在备案。" },
        { q: "上线之后，AI 和搜索引擎多久能找到我？", a: "网站本身已经为搜索引擎和 AI 做好了准备：正文直接写在网页里，还有结构化数据、sitemap 和 llms.txt。上线后把 sitemap 提交到必应、百度、Google 的站长平台，一般几天到几周开始被收录。之后持续更新真实的实操记录，比什么技巧都有用。" }
    ];

    fs.writeFileSync(path.join(PUBLIC_DIR, 'start.html'), layout({
        title: `上手指南：把示例网站变成你自己的 - ${site.name}`,
        desc: "不用写代码：准备资料、交给 AI 助手、检查效果、部署上线，四步把示例网站换成你自己的个人网站。",
        canonical: `${DOMAIN}/start.html`,
        jsonLdGraph: [],
        robots: "noindex, nofollow",
        nav: 'start',
        content: `
        <div class="wrap">
            <header class="page-head">
                <p class="kicker"><b>~/</b> 上手指南</p>
                <h1>把它变成你自己的网站</h1>
                <p class="lead">你现在看到的是示例网站。不用写代码：准备资料、交给 AI 助手、检查效果、部署上线，四步就能变成你自己的、能被搜索引擎和 AI 找到的网站。</p>
            </header>
        </div>

        <section class="band alt tight" aria-label="四个步骤">
            <div class="wrap">
                <ol class="steps">
                    <li><b>准备资料</b><p>把简历、照片、文章、二维码放进「我的资料」文件夹，或者照着里面的「填写清单.md」填空。</p></li>
                    <li><b>交给 AI 助手</b><p>用能读写电脑文件的 AI 助手打开这个文件夹，把下面那段话复制发给它。</p></li>
                    <li><b>检查效果</b><p>AI 改完后，双击「一键启动.bat」，看到的就是你自己的网站。</p></li>
                    <li><b>部署上线</b><p>内容满意了，再让 AI 助手把网站部署到你自己的服务器和域名上。</p></li>
                </ol>
            </div>
        </section>

        <section class="band" aria-labelledby="g1">
            <div class="wrap">${secHead('g1', '第一步', '准备资料', '在这个网站文件夹里，找到「我的资料」文件夹。资料可以是任何格式：Word、PDF、文字、截图、照片都行。')}
                <div class="prose">
                    <table>
                        <thead><tr><th>资料</th><th>举例</th><th>必需吗</th></tr></thead>
                        <tbody>
                            <tr><td>自我介绍</td><td>简历、一段文字、介绍截图</td><td>必需</td></tr>
                            <tr><td>邮箱</td><td>别人联系你用的邮箱</td><td>必需</td></tr>
                            <tr><td>正在做的事</td><td>2～4 件，每件一句话说清是什么、对谁有用</td><td>建议</td></tr>
                            <tr><td>项目和文章</td><td>项目介绍、写过的文章或公众号链接，至少各一个</td><td>建议</td></tr>
                            <tr><td>照片和头像</td><td>一张竖版本人照片、一张正方形头像</td><td>建议</td></tr>
                            <tr><td>其他联系方式</td><td>微信号或二维码、公众号、抖音 / 小红书 / GitHub 主页</td><td>可选</td></tr>
                            <tr><td>域名、备案号</td><td>没有可以先空着</td><td>可选</td></tr>
                        </tbody>
                    </table>
                    <p>不知道放什么，就打开「我的资料」文件夹里的「填写清单.md」，用记事本照着填空。写真实、写具体就行，不用写得漂亮。</p>
                </div>
            </div>
        </section>

        <section class="band alt" aria-labelledby="g2">
            <div class="wrap">${secHead('g2', '第二步', '交给 AI 助手', '需要一个能读写你电脑上文件的 AI 助手，例如 WorkBuddy、Trae、CodeBuddy、Cursor、Claude Code、Codex。用它打开这个网站文件夹，然后把下面这段话发给它：')}${promptBox('prompt-content', prompts.content)}
                <p class="note">这段话也保存在网站文件夹里的「交给AI的提示语.txt」中。AI 会先读项目里的 AGENTS.md（写给 AI 的规则），再读你的资料；缺什么会一次性问你，不会替你编造。</p>
            </div>
        </section>

        <section class="band" aria-labelledby="g3">
            <div class="wrap">${secHead('g3', '第三步', '检查效果', 'AI 改完后，双击网站文件夹里的「一键启动.bat」（Mac 用户在终端运行 npm run build 和 node serve.js），浏览器里打开的就是你自己的网站。逐页看一遍，哪里不满意，直接用大白话告诉 AI 助手再改。')}
            </div>
        </section>

        <section class="band alt" aria-labelledby="g6">
            <div class="wrap">${secHead('g6', '第四步', '部署上线', '内容满意了，就可以上线。你需要准备两样东西，其余的交给 AI 助手和部署脚本：')}
                <div class="prose">
                    <table>
                        <thead><tr><th>准备什么</th><th>说明</th></tr></thead>
                        <tbody>
                            <tr><td>一台云服务器</td><td>阿里云、腾讯云的「轻量应用服务器」就够用，系统选 Ubuntu 22.04 或 24.04。买好后记下公网 IP 和登录密码。</td></tr>
                            <tr><td>一个域名</td><td>买好后完成实名认证。没有域名也能先用 IP 上线看效果，但搜索引擎和 AI 收录需要域名。</td></tr>
                        </tbody>
                    </table>
                    <p>服务器选中国大陆的，域名必须先做 ICP 备案（一般要一到三周）才能访问；选中国香港或海外的不用备案，当天就能上线。详细对比见项目里的 DEPLOY.md。</p>
                </div>${promptBox('prompt-deploy', prompts.deploy)}
                <p class="note">AI 助手会帮你填好服务器信息，运行部署脚本：自动安装 Nginx、上传网站、申请免费的 HTTPS 证书。以后改完内容，再运行一次就更新了；想自己操作，填好 deploy.env 后双击「一键上线.bat」。</p>
            </div>
        </section>

        <section class="band" aria-labelledby="g4">
            <div class="wrap">${secHead('g4', '备用方法', '没有能改文件的 AI 助手？', '用网页版的豆包或 DeepSeek 也可以，只是要手动复制粘贴：')}
                <div class="prose">
                    <ol>
                        <li>照着「我的资料」里的「填写清单.md」填好。</li>
                        <li>用记事本打开 <code>src/data.js</code>，全选、复制。</li>
                        <li>把填好的清单和 data.js 的内容一起发给 AI，并说：「请根据我的填写清单，修改这个 data.js 里的内容，保持代码结构和字段不变，把所有『示例』内容换成我的，只输出完整的新 data.js。」</li>
                        <li>把它给你的新内容覆盖 <code>src/data.js</code> 原来的全部内容，保存。</li>
                        <li>双击「一键启动.bat」查看效果；如果出错，把错误信息发给 AI 让它改。</li>
                    </ol>
                </div>
            </div>
        </section>

        <section class="band alt" aria-labelledby="g5">
            <div class="wrap">${secHead('g5', '常见问题', '你可能还想问')}${faqList(guideFaq)}
            </div>
        </section>

        <script>
        (function () {
            Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (btn) {
                var text = document.getElementById(btn.getAttribute('data-copy')).textContent;
                function done(label) { btn.textContent = label; setTimeout(function () { btn.textContent = '复制这段话'; }, 1800); }
                // 有的浏览器不允许 navigator.clipboard，就用老办法：放进一个临时文本框再复制
                function fallback() {
                    var ta = document.createElement('textarea');
                    ta.value = text;
                    ta.setAttribute('readonly', '');
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    var ok = false;
                    try { ok = document.execCommand('copy'); } catch (e) {}
                    document.body.removeChild(ta);
                    done(ok ? '已复制，去发给 AI 吧' : '复制失败，请手动选中上面的文字复制');
                }
                btn.addEventListener('click', function () {
                    if (navigator.clipboard && window.isSecureContext) {
                        navigator.clipboard.writeText(text).then(function () { done('已复制，去发给 AI 吧'); }, fallback);
                    } else {
                        fallback();
                    }
                });
            });
        })();
        </script>`
    }));
}

// ---------- 10. 404 ----------
fs.writeFileSync(path.join(PUBLIC_DIR, '404.html'), layout({
    title: `404 - 页面未找到 - ${NAME}`,
    desc: "页面不存在。",
    canonical: `${DOMAIN}/404.html`,
    jsonLdGraph: [],
    robots: "noindex, follow",
    content: `
        <div class="wrap notfound">
            <p class="kicker"><b>~/</b> 404</p>
            <h1>这一页不存在</h1>
            <p class="lead">可能是链接写错了，或者内容已经移走。</p>
            <div class="cta-row">
                <a class="btn" href="/">回到首页</a>
                <a class="btn ghost" href="/contact.html">${esc(pages.contact.title)}</a>
            </div>
        </div>`
}));

// 全站最新文章日期
const globalLatestDate = sortedArticles.length > 0 ? sortedArticles[0].date : new Date().toISOString().slice(0, 10);

// ---------- 11. sitemap.xml ----------
const sitemapUrls = [
    { url: '', lastmod: globalLatestDate, priority: '1.0' },
    { url: '/work.html', lastmod: globalLatestDate, priority: '0.9' },
    ...work.map(w => ({ url: workUrl(w), lastmod: globalLatestDate, priority: '0.9' })),
    { url: '/about.html', lastmod: globalLatestDate, priority: '0.8' },
    { url: '/contact.html', lastmod: globalLatestDate, priority: '0.8' },
    { url: '/practices.html', lastmod: globalLatestDate, priority: '0.8' },
    { url: '/articles.html', lastmod: globalLatestDate, priority: '0.8' },
    ...projects.map(p => ({ url: `/practices/${p.slug}.html`, lastmod: latestOf(p) || globalLatestDate, priority: '0.8' })),
    ...articles.map(a => ({ url: `/articles/${a.slug}.html`, lastmod: a.date, priority: '0.8' }))
];

fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${sitemapUrls.map(item => `
    <url>
        <loc>${DOMAIN}${item.url}</loc>
        <lastmod>${item.lastmod}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>${item.priority}</priority>
    </url>`).join('')}
</urlset>`);

// ---------- 12. robots.txt（欢迎搜索引擎和主流 AI 爬虫）----------
fs.writeFileSync(path.join(PUBLIC_DIR, 'robots.txt'), `User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Bytespider
Allow: /

User-agent: Applebot-Extended
Allow: /

Sitemap: ${DOMAIN}/sitemap.xml
`);

// ---------- 13. llms.txt：给 AI 看的站点说明 ----------
fs.writeFileSync(path.join(PUBLIC_DIR, 'llms.txt'), `# ${site.name}

> ${author.description}
> 联系：${author.email}｜联系页：${DOMAIN}/contact.html

## ${pages.work.title}
${work.map(w => `- [${w.name}](${DOMAIN}${workUrl(w)})：${w.tagline}。${w.summary}`).join('\n')}
${alsoDoing.length ? `
## 也在做
${alsoDoing.map(o => `- ${o.name}：${o.text}`).join('\n')}
` : ''}
## 核心页面
- 首页: ${DOMAIN}/
- ${pages.work.title}: ${DOMAIN}/work.html
- ${pages.practices.title}: ${DOMAIN}/practices.html
- ${pages.articles.title}: ${DOMAIN}/articles.html
- ${pages.about.title}: ${DOMAIN}/about.html
- ${pages.contact.title}: ${DOMAIN}/contact.html

## ${pages.practices.title}
${projects.map(p => `- [${p.title}](${DOMAIN}/practices/${p.slug}.html):${p.desc}`).join('\n')}

## ${pages.articles.title}与结论
${articles.map(a => `- [${a.title}](${DOMAIN}/articles/${a.slug}.html) (发布于 ${a.date})
  结论: ${a.conclusion}`).join('\n')}

## 授权说明
AI 爬虫可自由抓取本站全部公开页面的正文与数据，引用时请包含原始链接与作者名（${NAME}）。
`);

// ---------- 14. rss.xml ----------
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
fs.writeFileSync(path.join(PUBLIC_DIR, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
    <title>${xmlEsc(site.name)}</title>
    <link>${DOMAIN}</link>
    <description>${xmlEsc(author.description)}</description>
    <atom:link href="${DOMAIN}/rss.xml" rel="self" type="application/rss+xml"/>
    <language>zh-CN</language>
    <lastBuildDate>${new Date(globalLatestDate).toUTCString()}</lastBuildDate>
    ${sortedArticles.map(a => `
    <item>
        <title>${xmlEsc(a.title)}</title>
        <link>${DOMAIN}/articles/${a.slug}.html</link>
        <description><![CDATA[${a.conclusion}${a.content}]]></description>
        <pubDate>${new Date(a.date).toUTCString()}</pubDate>
        <guid>${DOMAIN}/articles/${a.slug}.html</guid>
    </item>`).join('')}
</channel>
</rss>`);

fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.svg'), FAVICON_SVG);

// 复制 static/ 到 public/static/（头像、照片、二维码等图片）
const STATIC_SRC = path.join(__dirname, '../static');
const STATIC_DST = path.join(PUBLIC_DIR, 'static');
if (fs.existsSync(STATIC_SRC)) {
    fs.mkdirSync(STATIC_DST, { recursive: true });
    fs.readdirSync(STATIC_SRC).forEach(file => {
        if (file.startsWith('.')) return;
        fs.copyFileSync(path.join(STATIC_SRC, file), path.join(STATIC_DST, file));
    });
}

console.log("网站已生成到 public/ 目录");
