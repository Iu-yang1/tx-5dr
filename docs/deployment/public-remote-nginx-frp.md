# TX5DR 网页公网远控：Nginx + FRP

这是 [PR #47](https://github.com/Iu-yang1/tx-5dr/pull/47) 的 **Nginx + FRP** 方案，替代早期 Caddy 入口。适用于家宽 CGNAT、Windows / Electron 台站和具有公网 IP 的 Linux VPS。公众仅访问 `https://radio.example.com`，不需要安装 FRP、VPN 或私有根证书。

## 网络拓扑

```text
公网浏览器 -- HTTPS/WSS TCP 443 --> VPS Nginx --> 127.0.0.1:18076 (frps TCP 代理)
                                                    |
电台主机 TX5DR Web Gateway (本机 8076) <-- frpc <-- TLS TCP 7000 --> VPS frps

公网浏览器 -- WebRTC UDP 50110 --> VPS frps UDP --> frpc --> TX5DR UDP 50110
                                  UDP 受限时使用现有 ws-compat WebSocket 回退
```

Nginx、frps 运行在 VPS；Windows 本机只运行 TX5DR 和独立的 frpc 子进程。**绝对不要**把 Nginx 插入 FT8/FT4/Q65 解码线程、CI-V / CAT、音频采集回调或 PTT 业务流程；外部 FRP 崩溃不得强制重启电台后端。

## 端口与身份边界

| VPS 端口 | 公网访问 | 用途 |
| --- | --- | --- |
| TCP 80 | 开放 | HTTP-01 ACME 验证、重定向至 HTTPS |
| TCP 443 | 开放 | Nginx TLS、HTTP API、WSS 控制及 WS 降级音频 |
| TCP 7000 | 建议仅允许电台出口 IP | frpc ↔ frps TLS 认证通道 |
| UDP 50110 | 开放 | WebRTC DataChannel 直通 FRP UDP |
| TCP 18076 | **必须阻断公网入站** | 只允许 VPS 本机 Nginx 访问 frps 的 Web 转发口 |
| 本机 4000 / 4532 / 8443 | 不开放 | TX5DR 后端、Hamlib、桌面内置 HTTPS |

云厂商安全组和 VPS 主机防火墙**必须同时**禁止公网 TCP 18076。FRP 的 `proxyBindAddr` 同时作用于 TCP/UDP 监听，直接改成 `127.0.0.1` 会阻止公网 UDP 50110；因此当前单 frps 实例方案依靠防火墙隔离 TCP 18076，而不是错误地把所有 FRP 代理绑定到环回。请检查 VPS 上的实际监听列表。

**公网客户端 IP 必须由 Nginx 直接生成**，不可使用 `$proxy_add_x_forwarded_for` 来拼接未经验证的浏览器 XFF。本项目模板使用 `X-Forwarded-For $remote_addr`；TX5DR 网页网关仅在显式启用可信本机代理、匹配公网域名及 `https` 来源时才采用该地址。若日后将 Cloudflare/CDN 放在 Nginx 前，请另行设置严格的可信代理 IP 列表，不要直接信任公网提供的 XFF。

## 一、在 VPS 安装 Nginx 和 frps

1. 从发行版官方仓库安装 Nginx 与 Certbot，例如 Debian/Ubuntu：`sudo apt update && sudo apt install -y nginx certbot`。从 https://github.com/fatedier/frp/releases 获取匹配平台的 **frps**，校验下载源和版本，安装到 `/usr/local/bin/frps`。确认 VPS 已解析域名 `radio.example.com` 和 `tunnel.example.com`，其中 `radio.example.com` 用于 Web，`tunnel.example.com` 用于 FRP TLS 和公网 UDP ICE。DNS 为直接解析到 VPS 的模式；若使用 Cloudflare DNS，请禁用普通 HTTP 代理用于 `tunnel.example.com`。
2. 创建 `tx5dr-frp` 系统账户及 `/etc/tx5dr-frps`、`/var/lib/tx5dr-frp` 目录。复制 `deployment/public-remote/frps.toml.example` 为 `/etc/tx5dr-frps/frps.toml`。直接使用现有 FRP 服务端的 `auth.token`（TX5DR 不强制最低字符数，也不需要修改其他服务器）；若新建独立 FRP 服务，建议使用随机强令牌。限制配置权限 `root:tx5dr-frp`、`0640`。
3. 运行 `sudo bash deployment/public-remote/generate-frps-tls.sh tunnel.example.com /etc/tx5dr-frps` 生成 **FRP 专用的私有 CA 和服务端 TLS 证书**。确保 `server.key` 仅对 frps 用户/组可读，禁止把 `frps-ca.key` 或 `server.key` 复制到电台主机；只将 `frps-ca.crt` 分发给 frpc 验证服务端身份。示例 FRPS 服务器叶证书需在 365 天有效期之前轮换。
4. 安装 `deployment/public-remote/tx5dr-frps.service` 为 systemd 服务，执行 `sudo systemctl daemon-reload && sudo systemctl enable --now tx5dr-frps`，查看 `sudo journalctl -u tx5dr-frps -f` 排查错误。
5. 在云安全组及主机防火墙分别放通 80/443、7000/TCP 和 50110/UDP，**禁止外部访问 18076/TCP**，再核对 `ss -lntup`。未确认隔离前不要开放公网域名。

## 二、Nginx HTTPS 首次签发与自动续期

Nginx 采用两阶段部署，避免首次启动时因为尚未存在证书文件而导致 `nginx -t` 失败。不要对公众直接发布 TX5DR 自签名证书。

1. 创建 ACME 目录：`sudo mkdir -p /var/www/letsencrypt/.well-known/acme-challenge`。将 `deployment/public-remote/nginx-tx5dr-http-bootstrap.conf.example` 复制到 `/etc/nginx/conf.d/tx5dr.conf`，将示例域名替换为你真实域名。
2. `sudo nginx -t && sudo systemctl reload nginx`。此时只提供 HTTP-01 证书验证文件，对其他页面返回 404。
3. 在 VPS 用 Webroot 获取公信 HTTPS 证书：`sudo certbot certonly --webroot -w /var/www/letsencrypt -d radio.example.com`。Certbot 将交互收集账户电子邮箱等信息。请确保公网 TCP 80 可达。
4. 将 `deployment/public-remote/nginx-tx5dr.conf.example` 复制到 `/etc/nginx/conf.d/tx5dr.conf`，修正 `server_name` 与 `/etc/letsencrypt/live/<你的域名>/fullchain.pem` 和 `privkey.pem` 路径。执行 `sudo nginx -t && sudo systemctl reload nginx`。
5. 将 `deployment/public-remote/nginx-cert-renew-hook.sh` 安装到 `/etc/letsencrypt/renewal-hooks/deploy/tx5dr-nginx-reload` 并设置可执行；检查 Certbot 自动续期定时器，然后运行 `sudo certbot renew --dry-run` 验证。证书续期成功后仅 reload Nginx，不重启电台主机。
6. Nginx 入口使用 `proxy_http_version 1.1`、`Upgrade`/条件 `Connection` 头支持 WebSocket。配置 `proxy_read_timeout 3600s` 避免空闲 WebSocket 被默认 60 秒超时提前断开。Nginx 到 FRP Web 转发使用 upstream keepalive；不要把 TCP 443 的反代拿去代理 WebRTC UDP。

如果 VPS 上已有 Nginx 其他站点，请先检查 `nginx -T`，避免 `server_name`、端口、`map` 变量或已有 `/etc/nginx/conf.d/tx5dr.conf` 冲突。模板用于 Debian/Ubuntu 标准 `conf.d` 位于 `http` 上下文的配置方式。

## 三、Windows / Electron TX5DR

1. 取得官方 `frpc.exe`，保存到固定本机路径；与 VPS `frps` 版本保持兼容。TX5DR 不会自动下载或偷偷安装软件。
2. 系统设置 → 访问范围选 `public`，添加允许的 Origin `https://radio.example.com` 并保存，确保启用登录鉴权，默认关闭匿名公共查看。
3. 在 **Nginx + FRP** 设置卡片填写 frpc 路径、FRP Server=`tunnel.example.com`、端口 `7000`、公网域名 `radio.example.com`、Web TCP 端口 `18076`、公网与本地 UDP 端口 `50110`、FRP 私有 CA `frps-ca.crt` 路径及**与 VPS `frps.toml` 完全相同的原有 Token（无最低字符数限制）**，然后保存并手动启动。
4. 在系统设置 → 实时音频配置 `RTC Public Host = tunnel.example.com`、`RTC Public UDP Port = 50110`，并保留 `auto` 传输策略；FRP UDP 不通时使用已有 `ws-compat` 备用链路。
5. 公网浏览器访问 `https://radio.example.com`，核对无证书警告、API/HTTPS、控制 WSS、WebRTC DataChannel 与音频收发。如出站网络限制 UDP，验证 WSS 降级路径和断线重连。
6. `frpc` 独立进程默认不自动启动，用户显式启用 `autoStart` 后才在 TX5DR 启动后运行，且仅在 TX5DR 鉴权启用时允许启动。VPS 的 Nginx、FRPS 是独立服务，不消耗台站的 FFT、MFKS/WSJT-X 解码线程预算。

首次变更可信公网域名可能只重启 TX5DR **网页网关**，导致浏览器 WebSocket 短暂重连；它不会主动重启后端、CAT 或 DSP。请在非发射时隙修改公网访问配置。FRP 连接恢复/停止不应该改变电台链路或 PTT 状态。

## 四、可选 TURN 与公网失联安全

部分运营商限制 UDP，可在受控的 coturn 服务端启用 REST shared-secret authentication，并在 TX5DR **后端环境**中配置：

```ini
RTC_DATA_AUDIO_TURN_URL=turns:turn.example.com:5349?transport=tcp
RTC_DATA_AUDIO_TURN_SHARED_SECRET=REPLACE_WITH_COTURN_STATIC_AUTH_SECRET_AT_LEAST_32_CHARS
RTC_DATA_AUDIO_TURN_TTL_SECONDS=43200
```

每个 RTC Session 生成短期凭证，公开诊断接口不应暴露长期 TURN 密钥。若 TURN 过期，需要安全地重建 RTC。长期密钥不得写入浏览器前端或公开 Nginx 配置。

上线前需要验证 Viewer/Operator 权限、匿名只读限制、断线时 PTT 必须释放、服务器重启恢复、4G/5G 音频延迟、不同运营商弱网、24h 稳定性。解码 CPU 利用率及音频实时性应与未启用 FRP 基线对比；降低 frpc 进程优先级不能确保网络 QoS 或绝对 CPU 资源隔离。

## 文档来源

- Nginx WebSocket 反向代理：https://nginx.org/en/docs/http/websocket.html
- Nginx HTTP proxy module：https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- Nginx realip 模块（仅可信反向代理）：https://nginx.org/en/docs/http/ngx_http_realip_module.html
- Certbot 文档：https://certbot.eff.org/instructions
- FRP 官方项目：https://github.com/fatedier/frp

部署文档与工作流提供配置模板及语法验证，不表示已操作你的 VPS、DNS、真实证书、FRP 二进制或无线电设备。