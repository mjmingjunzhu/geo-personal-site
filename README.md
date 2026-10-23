# 个人网站框架（对搜索引擎和 AI 友好）

一个中文个人网站框架。**所有内容都写在一个文件里**（`src/data.js`），运行一条命令，就能生成一整套静态网页：首页、在做的事、项目、实操记录、关于、联系页，外加 sitemap、RSS 和给 AI 看的 `llms.txt`。

不需要会写代码：改文字、放图片、运行命令，就是你的网站了。

> 这个框架来自 [朱明君](https://mingjunzhu.com) 的个人网站，整理成通用版本开源出来。

---

## 它有什么特点

- **对搜索引擎和 AI 友好（SEO / GEO）**：正文直接写在网页源码里，ChatGPT、DeepSeek、豆包这类 AI 的爬虫不用运行脚本就能读到全部内容。每一页都自动生成结构化数据（JSON-LD），还会生成 `sitemap.xml`、`robots.txt`、`rss.xml` 和 `llms.txt`。
- **快**：纯静态网页，不加载任何外部字体和脚本，中国大陆访问也不受影响。
- **手机、电脑都能看**，自带浅色 / 深色切换（访客的选择会被记住）。
- **联系表单（可选）**：留言存进本地 SQLite 数据库，同时发邮件通知你；自带隐藏陷阱字段和频率限制，挡掉大部分垃圾留言。不需要的话可以完全不用。

## 生成哪些页面

| 页面 | 地址 | 内容来自 data.js 的 |
|---|---|---|
| 首页 | `/` | `site`、`author`、`home` |
| 在做的事 | `/work.html`，每个方向一个 `/work/xxx.html` | `work` |
| 项目 | `/practices.html`，每个项目一个详情页 | `projects` |
| 实操记录（文章） | `/articles.html`，每篇一个详情页 | `articles` |
| 关于 | `/about.html` | `pages.about` |
| 联系 | `/contact.html` | `pages.contact`、`contact` |

---

## 快速开始

### 1. 安装 Node.js

到 [nodejs.org](https://nodejs.org) 下载安装 **LTS 版本**（18 或更高）。

### 2. 下载这个项目

点 GitHub 页面上绿色的 **Code → Download ZIP**，解压；或者用 Git：

```bash
git clone https://github.com/mjmingjunzhu/geo-personal-site.git
```

### 3. 运行

**Windows**：双击 `一键启动.bat`。它会自动安装依赖、生成网站，并在浏览器里打开预览。

**Mac / Linux / 命令行**：

```bash
npm install
npm run build
node serve.js
```

浏览器打开 <http://localhost:3000> 就能看到示例网站。

---

## 把它变成你的网站

打开 `src/data.js`，从上往下改。文件里每一项都写了中文注释，带「示例」字样的都是演示内容。

1. **`DOMAIN`**：改成你的域名，比如 `https://yourname.com`
2. **`site`**：网站名、首页标题、浏览器标签上的那个字、备案号
3. **`author`**：你的名字、一句话简介、邮箱、头像和照片
4. **`home`**：首页的大标题、介绍、各分区的标题、常见问题
5. **`work`**：你在做的几件事（3 个左右最合适），每件会生成一个详情页
6. **`projects`**、**`articles`**：项目和实操记录。文章正文用 HTML 写，可以用 `<h2>` `<p>` `<ul>` `<table>` `<code>` 等标签
7. **`pages`**、**`contact`**：各页面的标题、说明和联系页设置

**图片**：头像、照片、微信二维码放进 `static/` 文件夹，再把路径填进 `data.js`，比如 `"/static/avatar.jpg"`。

**改完之后**：重新运行 `npm run build`（或者再双击一次 `一键启动.bat`），刷新浏览器就能看到变化。

> 不要直接改 `public/` 里的文件，那是生成出来的，下次生成会被覆盖。
> 想改颜色、字号、间距，改 `src/style.css`。

---

## 联系表单（可选）

不配置也没关系：网站照样能看，表单提交时会提示访客改用邮件联系。想让表单真正收留言：

1. 复制 `.env.example`，改名为 `.env`，按里面的注释填好邮箱的 SMTP 信息和后台口令
2. 启动后端：

   ```bash
   node server/index.js
   ```

   （Windows 双击 `一键启动.bat` 时，如果检测到 `.env` 会自动在后台启动它）

3. 留言会存进 `server/data/leads.db`，同时发邮件到 `NOTIFY_TO`；访问 <http://localhost:3000/admin> 输入口令可以查看所有留言

> `.env` 里有你的邮箱密码，已经被 `.gitignore` 排除，**不要把它提交到任何代码仓库，也不要发给别人**。

---

## 上线部署

1. 在服务器上运行 `npm run build`，把 `public/` 目录交给 Nginx（或任何静态网站托管服务）
2. 如果用联系表单：在服务器上用 pm2 之类的工具常驻运行 `node server/index.js`，并让 Nginx 把 `/api/` 反向代理到 `127.0.0.1:3011`。留言后台 `/admin` 建议不要对公网开放，有新留言时你会收到邮件
3. 中国大陆的服务器需要做 ICP 备案，备案号填进 `data.js` 的 `site.icp`，页脚会自动显示

Nginx 配置示例：

```nginx
server {
    server_name yourname.com;
    root /path/to/public;
    error_page 404 /404.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3011;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

---

## 目录结构

```text
src/
  data.js       ← 全部内容，改这个
  style.css     ← 样式
  build.js      ← 生成网页的脚本，一般不用改
server/
  index.js      ← 联系表单后端（可选）
  test-e2e.js   ← 联系表单的自动测试（会真实写入数据库、发邮件）
static/         ← 放你的图片
public/         ← 生成的网站（自动生成，不要手改）
serve.js        ← 本地预览服务器
一键启动.bat     ← Windows 双击启动
.env.example    ← 联系表单配置模板
```

## 常见问题

**改了 data.js 之后报错了？**
多半是少了逗号、引号没配对。看报错信息里的行号，回到 `data.js` 对应位置检查。

**怎么加一篇文章？**
在 `articles` 里照着示例复制一段，改 `id`、`slug`（会变成网址，用英文和连字符）、标题、日期、结论和正文，再重新生成。

**不想要某个板块？**
大部分板块留空就不显示：比如 `alsoDoing: []`、`cases: []`、`home.faq: []`、`pages.about.principles: []`。

---

## 许可证

[MIT](./LICENSE)：可以免费使用、修改、商用，保留原作者的版权声明即可。
