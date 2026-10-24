#!/usr/bin/env bash
# =============================================================================
# 服务器端部署脚本：由 deploy/deploy.js 上传到服务器的临时目录后执行，不要单独运行
#
# 做的事（重复运行是安全的）：
#   1. 没有 Nginx 就安装
#   2. 把网页放进 /var/www/<站点>/releases/<时间>，再把 current 指过去（保留最近几个版本，可回滚）
#   3. 写 Nginx 配置 /etc/nginx/conf.d/<站点>.conf
#   4. 域名已经解析到这台服务器时，用 certbot 申请 Let's Encrypt 免费证书，开启 HTTPS（自动续期）
#   5. 需要联系表单时：安装 Node.js、放好后端代码、注册成开机自启的系统服务
#
# 输入（环境变量，由 deploy.js 传入）：
#   ACTION=deploy|rollback  SITE  DOMAIN  ALT  DNS_OK  ALT_OK  EMAIL  IP  FORM  FORM_PORT  NODE_VERSION  KEEP
# 以 "::" 开头的输出行是给 deploy.js 看的状态，不会原样显示给使用者
# =============================================================================
set -euo pipefail

STAGE="$(cd "$(dirname "$0")" && pwd)"
# 临时目录里可能有 .env，结束时一定删掉（只删 deploy.js 建的那种临时目录）
case "$STAGE" in /tmp/geo-deploy.*) trap 'rm -rf "$STAGE"' EXIT ;; esac

BASE="/var/www/$SITE"
CONF="/etc/nginx/conf.d/$SITE.conf"
CERT="/etc/letsencrypt/live/$DOMAIN/cert.pem"

say()  { echo "      $*"; }
warn() { echo "::warn::$*"; }
die()  { echo "::fail::$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "需要 root 权限。请用 root 登录，或者用有 sudo 权限的用户。"

# ---------- 回滚：current 指回上一个版本 ----------
if [ "$ACTION" = rollback ]; then
  cur="$(readlink -f "$BASE/current" 2>/dev/null || true)"
  [ -n "$cur" ] && [ -d "$cur" ] || die "服务器上还没有部署过这个网站，没有可以退回的版本。"
  prev="$( (ls -1d "$BASE"/releases/*/ 2>/dev/null || true) | sed 's:/$::' | sort | awk -v c="$cur" '$0 < c' | tail -n 1)"
  [ -n "$prev" ] || die "没有更早的版本可以退回（服务器上只保留最近 ${KEEP} 个版本）。"
  ln -sfn "$prev" "$BASE/current.tmp"
  mv -Tf "$BASE/current.tmp" "$BASE/current"
  echo "::rolledback::$(basename "$cur")::$(basename "$prev")"
  exit 0
fi

# ---------- 环境检查 ----------
if [ -d /www/server/panel ]; then
  die "这台服务器装了宝塔面板。为了不和宝塔的配置打架，脚本不会改动它。处理办法见 DEPLOY.md「服务器装了宝塔面板」。"
fi

if command -v apt-get >/dev/null 2>&1; then PM=apt
elif command -v dnf >/dev/null 2>&1; then PM=dnf
elif command -v yum >/dev/null 2>&1; then PM=yum
else die "认不出这台服务器的系统。推荐使用 Ubuntu 22.04 或 24.04。"
fi

APT_UPDATED=0
pkg_install() {
  if [ "$PM" = apt ]; then
    if [ "$APT_UPDATED" = 0 ]; then
      apt-get -o DPkg::Lock::Timeout=300 update -y >/dev/null
      APT_UPDATED=1
    fi
    DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y "$@" >/dev/null
  else
    "$PM" install -y "$@" >/dev/null
  fi
}

# ---------- Nginx ----------
if ! command -v nginx >/dev/null 2>&1; then
  say "第一次部署：安装 Nginx（一两分钟）..."
  pkg_install nginx || die "Nginx 安装失败，请看上面的报错。"
fi
systemctl enable nginx >/dev/null 2>&1 || true
systemctl start nginx >/dev/null 2>&1 || true
if ! systemctl is-active --quiet nginx; then
  who80="$(ss -ltnp 2>/dev/null | grep -E ':80\s' | head -n 3 || true)"
  die "Nginx 启动失败。80 端口可能被别的程序占用了：${who80:-没查到占用的程序，可以运行 journalctl -u nginx 看原因}"
fi

# 服务器自己的防火墙开着时，放行 80 和 443（云控制台的防火墙 / 安全组要另外去控制台放行）
# （这里和下面都用 grep ... >/dev/null 而不是 grep -q：-q 提前退出会让 pipefail 误判失败）
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep "Status: active" >/dev/null; then
  ufw allow 80/tcp >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
fi
if systemctl is-active --quiet firewalld 2>/dev/null; then
  firewall-cmd --permanent --add-service=http --add-service=https >/dev/null || true
  firewall-cmd --reload >/dev/null || true
fi

# ---------- 上传的网页变成一个新版本 ----------
TS="$(date +%Y%m%d-%H%M%S)"
REL="$BASE/releases/$TS"
mkdir -p "$REL" "$BASE/acme"
cp -r "$STAGE/public/." "$REL/"
chmod a+rx "$BASE" "$BASE/releases" "$BASE/acme"
chmod -R a+rX "$REL"
ln -sfn "$REL" "$BASE/current.tmp"
mv -Tf "$BASE/current.tmp" "$BASE/current"
# 只保留最近 KEEP 个版本
(ls -1d "$BASE"/releases/*/ || true) | sed 's:/$::' | sort -r | tail -n +"$((KEEP + 1))" | xargs -r rm -rf
say "网页已更新（版本 $TS）"

# ---------- 联系表单后端（可选）----------
if [ "$FORM" = 1 ]; then
  NODE_OK=0
  if command -v node >/dev/null 2>&1 && node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
    NODE_OK=1
  fi
  if [ "$NODE_OK" = 0 ]; then
    say "安装 Node.js $NODE_VERSION（联系表单要用）..."
    case "$(uname -m)" in
      x86_64) NARCH=x64 ;;
      aarch64|arm64) NARCH=arm64 ;;
      *) die "不支持这台服务器的 CPU 架构：$(uname -m)" ;;
    esac
    NFILE="node-$NODE_VERSION-linux-$NARCH"
    tmp="$(mktemp -d)"
    ok=0
    for mirror in "https://registry.npmmirror.com/-/binary/node" "https://nodejs.org/dist"; do
      if curl -fsSL --retry 2 -o "$tmp/$NFILE.tar.gz" "$mirror/$NODE_VERSION/$NFILE.tar.gz" \
        && curl -fsSL --retry 2 -o "$tmp/SHASUMS256.txt" "$mirror/$NODE_VERSION/SHASUMS256.txt" \
        && (cd "$tmp" && grep " $NFILE.tar.gz\$" SHASUMS256.txt | sha256sum -c - >/dev/null 2>&1); then
        ok=1
        break
      fi
    done
    [ "$ok" = 1 ] || die "Node.js 下载失败（或文件校验不通过），请检查服务器的网络。"
    mkdir -p /opt
    tar -xzf "$tmp/$NFILE.tar.gz" -C /opt
    for b in node npm npx; do ln -sfn "/opt/$NFILE/bin/$b" "/usr/local/bin/$b"; done
    rm -rf "$tmp"
    hash -r
  fi
  NODE_BIN="$(command -v node)"
  NPM_BIN="$(dirname "$(readlink -f "$NODE_BIN")")/npm"
  [ -x "$NPM_BIN" ] || NPM_BIN="$(command -v npm)"

  APP="$BASE/app"
  if ! id geosite >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin geosite 2>/dev/null \
      || useradd -r -M -s /sbin/nologin geosite
  fi
  mkdir -p "$APP/server/data"
  cp -r "$STAGE/app/." "$APP/"
  say "安装联系表单的依赖..."
  (cd "$APP" && "$NPM_BIN" ci --omit=dev --no-audit --no-fund --no-update-notifier --loglevel=error >/dev/null) || die "联系表单的依赖安装失败，请看上面的报错。"
  chown -R geosite: "$APP/server/data"
  # 留言里有访客的邮箱和电话，只让表单服务自己能读
  chmod 700 "$APP/server/data"
  chown root:geosite "$APP/.env"
  chmod 640 "$APP/.env"

  cat > "/etc/systemd/system/$SITE-form.service" <<EOF
[Unit]
Description=$SITE contact form
After=network.target

[Service]
WorkingDirectory=$APP
ExecStart=$NODE_BIN server/index.js
Restart=always
RestartSec=3
User=geosite
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$SITE-form" >/dev/null 2>&1 || true
  systemctl restart "$SITE-form" || true
  sleep 2
  if curl -fsS "http://127.0.0.1:$FORM_PORT/api/health" >/dev/null 2>&1; then
    say "联系表单后端已运行"
    echo "::form::on"
  else
    warn "联系表单后端没有正常启动。在服务器上运行 journalctl -u $SITE-form -n 30 可以看到原因（多半是 .env 没填好）。"
    echo "::form::fail"
  fi
fi

# SELinux 开着的系统（部分 CentOS 系），要给网页目录打上标签，并允许 Nginx 转发到后端
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = Enforcing ]; then
  if command -v restorecon >/dev/null 2>&1; then restorecon -R "$BASE" || true; fi
  if [ "$FORM" = 1 ]; then setsebool -P httpd_can_network_connect 1 || true; fi
fi

# ---------- Nginx 配置 ----------
install_conf() {
  if [ -f "$CONF" ]; then cp "$CONF" "$STAGE/previous.conf"; else rm -f "$STAGE/previous.conf"; fi
  cp "$1" "$CONF"
  if ! nginx -t >/dev/null 2>&1; then
    nginx -t || true
    if [ -f "$STAGE/previous.conf" ]; then cp "$STAGE/previous.conf" "$CONF"; else rm -f "$CONF"; fi
    die "Nginx 配置检查没通过，已恢复原来的配置。"
  fi
  systemctl reload nginx
}

# 有证书就用 HTTPS 版配置，否则用 HTTP 版
HTTPS=off
apply_conf() {
  if [ -n "$DOMAIN" ] && [ -f "$CERT" ]; then
    local names="$DOMAIN"
    if [ -n "$ALT" ] && openssl x509 -in "$CERT" -noout -text 2>/dev/null | grep -o "DNS:[^,]*" | grep -x "DNS:$ALT" >/dev/null; then
      names="$DOMAIN $ALT"
    fi
    sed "s|__HTTPS_NAMES__|$names|" "$STAGE/nginx-https.conf" > "$STAGE/nginx-https.final.conf"
    install_conf "$STAGE/nginx-https.final.conf"
    HTTPS=on
  else
    install_conf "$STAGE/nginx-http.conf"
    HTTPS=off
  fi
}

# 之前用 IP 上线过，现在有了域名：去掉 IP 版的配置，避免冲突
if [ "$SITE" != ip-preview ]; then rm -f /etc/nginx/conf.d/ip-preview.conf; fi
apply_conf

# ---------- HTTPS 证书 ----------
if [ -n "$DOMAIN" ] && [ "$DNS_OK" = 1 ]; then
  if ! command -v certbot >/dev/null 2>&1; then
    say "第一次开启 HTTPS：安装证书工具 certbot..."
    pkg_install certbot || { [ "$PM" != apt ] && pkg_install epel-release && pkg_install certbot; } \
      || warn "certbot 安装失败，网站先用 http 访问。"
  fi
  if command -v certbot >/dev/null 2>&1; then
    DOMS=(-d "$DOMAIN")
    if [ "$ALT_OK" = 1 ]; then DOMS+=(-d "$ALT"); fi
    if [ -n "$EMAIL" ]; then MAIL=(--email "$EMAIL"); else MAIL=(--register-unsafely-without-email); fi
    say "检查 HTTPS 证书（Let's Encrypt）..."
    # --keep-until-expiring：证书还没到期就不重复申请；--deploy-hook：自动续期后重新加载 Nginx
    if certbot certonly --webroot -w "$BASE/acme" --cert-name "$DOMAIN" "${DOMS[@]}" "${MAIL[@]}" \
        --agree-tos --non-interactive --keep-until-expiring --expand \
        --deploy-hook "systemctl reload nginx" >"$STAGE/certbot.log" 2>&1; then
      systemctl enable --now certbot.timer >/dev/null 2>&1 || systemctl enable --now certbot-renew.timer >/dev/null 2>&1 || true
      apply_conf
    else
      echo "::https-fail::"
      tail -n 12 "$STAGE/certbot.log" | sed 's/^/      | /'
    fi
  fi
fi
echo "::https::$HTTPS"

# 服务器本机先访问一次，排除 Nginx 本身的问题
code="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN:-$IP}" http://127.0.0.1/ || true)"
echo "::local::$code"
echo "::release::$TS"
