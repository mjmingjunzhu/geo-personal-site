// ============================================================
// 全站内容的唯一来源：改这个文件，再运行 npm run build，网站就变成你的
// 所有带「示例」字样的内容都是演示用的，换成你自己的即可
// ============================================================

// 你的域名（用于 canonical、sitemap、结构化数据），上线前改成你自己的
const DOMAIN = "https://example.com";

// ---------- 站点 ----------
const site = {
    name: "你的名字｜个人网站",          // 网站名：分享卡片、RSS 标题、结构化数据里用
    homeTitle: "你的名字｜一句话说清你在做什么", // 首页的浏览器标题
    faviconText: "你",                  // 浏览器标签小图标上显示的一个字
    icp: ""                             // 备案号（中国大陆服务器需要），拿到后填写；留空则页脚不显示
};

// ---------- 你本人 ----------
const author = {
    name: "你的名字",
    jobTitle: "",                       // 一句话身份标签，显示在左上角名字下面；留空则显示域名
    description: "你的名字，在某个城市。正在做三件事：示例一、示例二、示例三。（这句话会出现在页脚、搜索结果摘要、RSS 和给 AI 看的 llms.txt 里）",
    email: "you@example.com",
    telephone: "",                      // 选填；填了会写进结构化数据
    wechat: "",                         // 微信号，选填；填了联系页会出现「复制微信号」按钮
    url: DOMAIN,
    location: "某个城市",
    avatar: "",                         // 左上角头像（正方形图），放进 static/ 后填 "/static/avatar.jpg"；留空显示占位圆圈
    photo: "",                          // 首页和关于页的照片（4:5 竖图），例如 "/static/photo.jpg"；留空则不显示
    photoSmall: "",                     // 给手机用的小图（480×600），选填
    photoAlt: "",                       // 照片的文字描述，例如 "某某坐在窗边看书"
    replyTime: "",                      // 联系页的回复时间，例如 "2 天"；留空则不显示
    // 其他平台的主页，会出现在联系页，并写进结构化数据（帮助搜索引擎和 AI 认出是同一个人）
    socials: [
        // { name: "GitHub", label: "your-name", url: "https://github.com/your-name" },
        // { name: "抖音", label: "@你的名字", url: "https://www.douyin.com/user/xxxx" }
    ]
};

// ---------- 首页 ----------
const home = {
    eyebrow: "你的名字 · 某个城市",
    headline: ["一句话说清，", "你在做什么。"],  // 大标题分两行，第二行会用强调色
    sub: "这里写两三句话：你是谁、正在做哪几件事、为什么值得别人继续往下看。示例：我在某个城市，用 AI 帮自己和身边的小生意做获客，每件事都先在自己身上跑通，再写成实操记录。",
    notes: ["先在自己身上跑通", "过程都写成实操记录", "欢迎来聊"],  // 按钮下面的三个小点
    sections: {
        work: { kicker: "01 / 在做的事", title: "正在做的三件事", text: "每一件都先在自己身上跑通，过程写成实操记录。" },
        process: { kicker: "02 / 我的做法", title: "先自己跑通，再分享出来" },
        projects: { kicker: "03 / 正在跑的项目", title: "说的，我自己先做到", text: "这些项目都在实际运营，对应的做法都写成了实操记录。" },
        articles: { kicker: "04 / 实操记录", title: "我在做的事，都写下来了", text: "每篇开头先写结论。" },
        also: { kicker: "05 / 也在做", title: "除此之外，也在做这些" },
        faq: { kicker: "06 / 常见问题", title: "你可能想问的" }
    },
    // 「我的做法」三步
    process: [
        { title: "先自己跑通", text: "新方法先用在自己的项目上，确认有效，再拿出来讲。" },
        { title: "写成实操记录", text: "做法、踩过的坑、结果，都公开写在这个网站上。" },
        { title: "和同行交流", text: "你在做类似的事，或者卡在某一步，欢迎来聊。" }
    ],
    // 首页常见问题（也会写进结构化数据，AI 和搜索引擎能直接读到）
    faq: [
        { q: "这个网站是用什么做的？（示例问题）", a: "用一个开源的个人网站框架：内容写在一个文件里，运行一条命令生成整站静态网页，对搜索引擎和 AI 都很友好。" },
        { q: "可以和你交流吗？（示例问题）", a: "可以。邮件、微信都行，也可以在联系页留言。说说你在做什么、卡在哪一步，我看到会回复。" }
    ]
};

// ---------- 在做的事（3 个方向左右最合适）----------
// 每个方向会生成一个详情页：/work/<slug>.html
const work = [
    {
        id: "geo",
        slug: "geo",
        name: "示例方向一：让 AI 读懂你的网站",
        short: "GEO",
        tagline: "让 ChatGPT、DeepSeek、豆包这类 AI 在回答问题时提到你",
        summary: "越来越多人直接问 AI 找答案。AI 的回答里没有你，你就不在别人的候选名单里。这个方向研究怎样让 AI 读得懂一个网站、愿意引用它。",
        forWho: [
            "想让客户在 AI 里找到自己的小企业",
            "想做个人品牌、希望被 AI 推荐的个人"
        ],
        deliverables: [
            { title: "可见性检查", text: "看一个品牌在主流 AI 助手里有没有被提到、被怎么描述。" },
            { title: "内容结构优化", text: "把信息整理成 AI 读得懂、愿意引用的结构。" },
            { title: "持续监测", text: "定期复查被 AI 引用的情况。" }
        ],
        faq: [
            { q: "GEO 和 SEO 有什么区别？", a: "SEO 是让网页在搜索结果里排得靠前；GEO 是让 AI 助手在回答问题时提到你、引用你。两者都需要。" }
        ]
    },
    {
        id: "content",
        slug: "content",
        name: "示例方向二：用 AI 做内容",
        short: "AI 内容",
        tagline: "把一个想法，用 AI 变成文章、短视频脚本和海报",
        summary: "这里写你在这个方向上具体在做什么、为什么做、做到了哪一步。写得越具体，越容易被人和 AI 记住。",
        forWho: [
            "想持续输出内容、但时间不够的个人",
            "想让团队用 AI 提效的小公司"
        ],
        deliverables: [
            { title: "选题与提纲", text: "示例：用 AI 把零散想法整理成提纲。" },
            { title: "初稿与改写", text: "示例：让 AI 出初稿，人来把关事实和语气。" },
            { title: "多平台分发", text: "示例：一篇内容改写成不同平台的版本。" }
        ],
        faq: [
            { q: "AI 写的内容可信吗？", a: "示例回答：AI 负责初稿，事实和观点由人来核对和负责。" }
        ]
    },
    {
        id: "infra",
        slug: "infra",
        name: "示例方向三：个人数字基础设施",
        short: "数字基础设施",
        tagline: "域名、邮箱、网站这些属于自己的东西，自己搭",
        summary: "平台会变，规则会改，属于自己的域名、邮箱和网站才是长期资产。这个网站本身就是其中一部分。",
        forWho: [
            "不想把所有内容都放在别人平台上的个人",
            "想有一个正经对外门面的小团队"
        ],
        deliverables: [
            { title: "域名与邮箱", text: "示例：给自己的域名配一个邮箱。" },
            { title: "个人网站", text: "示例：用这个框架搭一个自己的网站。" },
            { title: "长期维护", text: "示例：每个月更新一次在做的事和实操记录。" }
        ],
        faq: [
            { q: "不懂代码能搭吗？", a: "能。改 src/data.js 里的文字，运行一条命令就能生成网站。" }
        ]
    }
];

// ---------- 也在做（首页和「在做的事」页底部展示）----------
const alsoDoing = [
    { name: "示例：线下分享", text: "一句话说明这件事。" },
    { name: "示例：免费培训", text: "一句话说明这件事。" },
    { name: "示例：长期交流", text: "一句话说明这件事。" }
];

// ---------- 例子 / 案例（选填）----------
// 格式：{ industry: "某五金出口工厂", workId: "geo", problem: "遇到的问题", did: "怎么做的", result: "结果（尽量有数字）" }
// 留空数组则首页不显示案例区
const cases = [];

// ---------- 各页面的标题和说明 ----------
const pages = {
    work: {
        nav: "在做的事",
        title: "在做的事",
        lead: "正在做的几件事，每一件都先在自己身上跑通，过程写成实操记录。",
        description: "正在做的几件事：示例一、示例二、示例三。每一件都先在自己身上跑通，过程写成实操记录。"
    },
    practices: {
        nav: "项目",
        title: "正在跑的项目",
        lead: "这些项目都在实际运营。新的做法，我都先在这里跑通，再拿出来讲。",
        description: "正在运营的项目，以及每个项目对应的方向和实操记录。"
    },
    articles: {
        nav: "实操记录",
        title: "实操记录",
        lead: "我在做的事，都写在这里。按时间倒序，每篇开头先写结论。",
        description: "做事过程中的实操记录，每篇开头先写结论。"
    },
    about: {
        nav: "关于",
        title: "关于",
        heading: "关于你的名字",
        lead: "在某个城市。一句话说清你在做什么。",
        description: "你的名字是谁、为什么在做这些事，以及做事的习惯。",
        paragraphs: [
            "第一段：你在做哪几件事。",
            "第二段：你为什么开始做这些，最好讲一个真实的起因。",
            "第三段：你做事的习惯或原则。",
            "第四段：除此之外你还在做什么。"
        ],
        principles: ["先自己跑通。", "过程写下来。", "不夸大。"]  // 关于页底部的深色卡片，留空数组则不显示
    },
    contact: {
        nav: "联系",
        title: "联系我",
        lead: "你在做类似的事，或者卡在某一步，欢迎来聊。留言、邮件、微信都可以，我看到会回复。",
        description: "联系方式：留言、邮件、微信都可以。"
    }
};

// ---------- 联系页 ----------
const contact = {
    topics: ["示例方向一", "示例方向二", "示例方向三", "其他"],  // 留言表单里「想聊什么」的选项
    wechatAccount: "",   // 公众号名称，选填
    wechatQr: ""         // 微信二维码图片，放进 static/ 后填 "/static/wechat-qr.jpg"；留空则电脑上不显示二维码
};

// ---------- 项目 ----------
// workId 填「在做的事」里某个方向的 id，项目页和文章末尾会关联过去；没有对应方向就不填
const projects = [
    {
        id: "p1",
        slug: "this-website",
        title: "示例项目：这个网站本身",
        short: "个人网站",
        workId: "infra",
        status: "进行中",       // 「进行中」会显示为绿色
        desc: "用开源框架搭自己的个人网站：内容写在一个文件里，生成静态网页，对搜索引擎和 AI 友好。"
    },
    {
        id: "p2",
        slug: "example-project",
        title: "示例项目二",
        short: "示例",
        workId: "content",
        status: "持续迭代",
        desc: "一句话写清这个项目是什么、做到了哪一步。"
    }
];

// ---------- 实操记录（文章）----------
// content 是 HTML：可以用 <h2> <h3> <p> <ul> <ol> <table> <code> <strong> <blockquote>
// qa 是文末的问答，会写进结构化数据；relatedSlugs 填相关文章的 slug
const articles = [
    {
        id: "a1",
        slug: "how-to-use-this-template",
        projectId: "p1",
        title: "示例文章：怎么用这个框架搭自己的网站",
        date: "2026-10-23",
        conclusion: "所有内容都在 src/data.js 里：改文字、放图片、运行 npm run build，就能得到一个完整的个人网站。",
        content: "<h2>第一步：改 src/data.js</h2><p>打开 <code>src/data.js</code>，从上往下改：</p><ul><li><strong>site</strong>：网站名、首页标题、备案号</li><li><strong>author</strong>：你的名字、简介、邮箱、头像和照片</li><li><strong>home</strong>：首页的大标题和各个分区</li><li><strong>work</strong>：你在做的几件事，每件会生成一个详情页</li><li><strong>projects</strong> 和 <strong>articles</strong>：项目和实操记录</li><li><strong>pages</strong> 和 <strong>contact</strong>：各页面的标题和联系页设置</li></ul><h2>第二步：放图片</h2><p>头像、照片、二维码放进 <code>static/</code> 文件夹，再把路径填进 data.js，例如 <code>/static/avatar.jpg</code>。</p><h2>第三步：生成网站</h2><table><thead><tr><th>命令</th><th>作用</th></tr></thead><tbody><tr><td><code>npm install</code></td><td>第一次使用时安装依赖</td></tr><tr><td><code>npm run build</code></td><td>生成 public/ 下的整站网页</td></tr><tr><td><code>node serve.js</code></td><td>在本地打开预览</td></tr></tbody></table><blockquote>不要直接改 public/ 里的文件，下次生成会被覆盖。</blockquote>",
        qa: [
            { q: "改完内容为什么网页没变？", a: "需要重新运行 npm run build，再刷新浏览器。" },
            { q: "可以改颜色和字体吗？", a: "可以，样式都在 src/style.css 里。" }
        ],
        relatedSlugs: ["how-to-write-a-record"]
    },
    {
        id: "a2",
        slug: "how-to-write-a-record",
        projectId: "p2",
        title: "示例文章：一篇实操记录怎么写",
        date: "2026-10-20",
        conclusion: "先写结论，再写过程，最后写踩过的坑。具体的事实和数字，比漂亮的形容词更容易被人和 AI 记住。",
        content: "<p>这是一篇示例文章，演示一篇实操记录的常见结构。</p><h2>先写结论</h2><p>读者和 AI 都喜欢开门见山。文章开头的「先说结论」框，读的就是 data.js 里的 <code>conclusion</code> 字段。</p><h2>再写过程</h2><ol><li>当时要解决什么问题</li><li>具体怎么做的，用了什么工具</li><li>结果怎样，最好有数字</li></ol><h2>最后写坑</h2><p>踩过的坑往往是最有价值的部分，也是最能体现真实性的部分。</p>",
        qa: [
            { q: "一篇写多长合适？", a: "示例回答：把事情讲清楚就够了，不必凑字数。" }
        ],
        relatedSlugs: ["how-to-use-this-template"]
    }
];

module.exports = { DOMAIN, site, author, home, work, alsoDoing, cases, pages, contact, projects, articles };
