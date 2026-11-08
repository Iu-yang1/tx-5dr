# TX5DR 网页公网远控：Caddy + FRP

此方案适合家宽 CGNAT、Windows / Electron 电台主机及有公网 IPv4 的 Linux VPS。远程用户仅访问 `https://radio.example.com`，无需安装 FRP、VPN 或私有 CA。FRP 客户端是独立、低优先级操作系统进程，Caddy / frps 在 VPS 运行，不加入 CAT、PTT、DSP 或实时音频回调。

## 拓扑和端口

```text
浏览器 -- HTTPS/WSS 443 --> Caddy VPS -- TCP 18076 --> frps
                               frps <-- TLS TCP 7000 --> frpc (TX5DR 主机)
浏览器 -- RTC UDP 50110 --> frps VPS -- FRP --> TX5DR 本机 UDP 50110
```

VPS 公网入站仅允许 TCP 80、443、7000 和 UDP 50110。**必须在云防火墙与系统防火墙同时阻断公网 TCP 18076**，但 VPS 本机 Caddy 仍可连接 `127.0.0.1:18076`。不得直接公开 TX5DR 后端 4000、HTTPS 8443、Rigctld 4532 和内部管理 API。

FRPS 的 `proxyBindAddr` 是 TCP/UDP 共用设置。不能为了封锁 TCP 18076 而将其直接改为 127.0.0.1，否则外部浏览器不能连接 WebRTC UDP 50110。请依赖入站防火墙隔离 TCP 端口。

## 一、VPS 准备

1. 从 Caddy 官方渠道 https://caddyserver.com/docs/install 安装 Caddy 2，并从 https://github.com/fatedier/frp/releases 获取与架构相符且经来源校验的 `frps`，安装至 `/usr/local/bin/frps`。TX5DR 不自动下载或执行第三方二进制。
2. 创建系统用户与数据目录（例如 `useradd --system --home /var/lib/tx5dr-frp --shell /usr/sbin/nologin tx5dr-frp`），创建 `/etc/tx5dr-frps` 和 `/var/lib/tx5dr-frp`。
3. 把 `deployment/public-remote/frps.toml.example` 复制到 `/etc/tx5dr-frps/frps.toml`。将 `auth.token` 替换为至少 32 字符的强随机令牌；该令牌与 TX5DR 网页设置填写的完全相同。限制文件为 `root:tx5dr-frp` 和 `0640`。
4. 运行 `bash deployment/public-remote/generate-frps-tls.sh tunnel.example.com /etc/tx5dr-frps`，生成专用 FRP TLS 根 CA 和服务器证书。把服务端 `server.key` 设置为 `root:tx5dr-frp 0640`；只把 `frps-ca.crt` 拷贝到 Windows 台站，不得外传 `frps-ca.key` 或 `server.key`。
5. 复制 `deployment/public-remote/tx5dr-frps.service` 至 `/etc/systemd/system/tx5dr-frps.service`，运行 `systemctl daemon-reload && systemctl enable --now tx5dr-frps`。通过 `journalctl -u tx5dr-frps` 排查服务。
6. 复制 `deployment/public-remote/Caddyfile.example` 中的 site block 到 `/etc/caddy/Caddyfile`，替换 `radio.example.com`，DNS A/AAAA 必须指向 VPS。执行 `caddy validate --config /etc/caddy/Caddyfile` 后 `systemctl reload caddy`，Caddy 自动申请与续期浏览器可信证书。
7. 云安全组和 VPS 系统防火墙放行 TCP 80/443/7000、UDP 50110，并拒绝外网 TCP 18076。公共 443 应能经 Caddy 到达 FRPS 18076，而不是绕过 Caddy 直接打开 Web。

**FRPS TLS 不是浏览器 HTTPS 证书**：FRPS 允许私有 CA 签发，由 Windows frpc 配置 `trustedCaFile` 验证；公网浏览器只看 Caddy 自动签发的公信 CA 证书。FRPS 服务器叶证书有效期示例为 365 天，必须提前轮换；Caddy 的网站证书独立自动续期。FRP 默认 TLS 加密并不一定验证服务器身份，因此 TX5DR 不提供关闭校验的开关。

## 二、Windows / Electron TX5DR 设置

1. 下载官方 `frpc.exe`，放在固定的本机绝对路径（例如 `C:\\tools\\frp\\frpc.exe`）；安装版本须与 VPS 端 `frps` 兼容。
2. 在 TX5DR 系统设置 → 访问范围选 `public`，允许的 Web Origin 添加 `https://radio.example.com` 并保存。默认关闭匿名查看，并对操作员分别分配最小权限；任何发射功能均须授权。
3. 在 Caddy + FRP 卡片中填入 `frpc.exe` 路径、FRP 服务器 `tunnel.example.com`、FRP TCP 7000、公网网站域名 `radio.example.com`、VPS Web TCP 18076、UDP 50110、本机 UDP 50110，并选择 VPS 的 `frps-ca.crt` 文件。
4. 输入 VPS `auth.token`，点击“保存穿透配置”然后“启动穿透”。自动启动默认关闭，只有用户主动启用后才会在下次 TX5DR 启动时启动。配置保存在用户数据目录下 `public-tunnel` 文件夹，Token 不会通过状态查询返回，frpc.toml 权限尽量限制为所有者读取。
5. 在系统设置 → 实时音频将 `RTC Public Host` 设置为 `tunnel.example.com`（DNS-only、指向 VPS），`RTC Public UDP Port` 设置为 `50110`，音频传输模式保持 `auto`，保留 `ws-compat` 作为 UDP 无法到达时的回退路径。
6. 用外网 4G/5G 或其他宽带，在 Chrome/Edge 访问 `https://radio.example.com`。核实证书无警告、API 正常、WSS 成功、WebRTC DataChannel 实际开启，并分别测试 UDP 被阻断后 WSS 回退。

首次配置公网域名时只重启一次 TX5DR **网页网关**以启用受限可信请求头，DSP、CAT、设备进程不会被主动重启，但浏览器 WebSocket 会短暂断开。不要在正在发射或关键 FT8/FT4/Q65 时隙修改公网域名。其他 FRP 设置仅影响 frpc 外部进程，并且需要先停用再保存。

## 三、可选 TURN 中继

部分企业或移动网络可能禁止直接访问 VPS UDP 50110。TX5DR 的 WebRTC DataChannel 首选公网 UDP，随后尝试配置的 TURN（如有），最后回退 WS-compatible 音频。可在 VPS 部署经授权的 coturn，并在 TX5DR 服务端环境中设置以下配置（不要在网页或 Caddyfile 中暴露 shared secret）：

```ini
RTC_DATA_AUDIO_TURN_URL=turns:turn.example.com:5349?transport=tcp
RTC_DATA_AUDIO_TURN_SHARED_SECRET=REPLACE_WITH_COTURN_STATIC_AUTH_SECRET_AT_LEAST_32_CHARS
RTC_DATA_AUDIO_TURN_TTL_SECONDS=43200
```

TX5DR 为每次 RTC session 生成带时间戳的 HMAC-SHA1 临时访问凭证，只附加到 RTC Offer，公开连接诊断不包含凭据。最长允许 86400 秒（24 小时），长时间监听需在到期前重新建立 RTC；未配置 TURN 时行为保持不变。TURN 不会绕过 Web 端用户认证；使用共享密钥的 coturn REST API 模式需单独配置。

## 四、实时服务隔离与安全验证

- frpc 外部进程设较低调度优先级、Go `GOMAXPROCS=2`，并以有界指数退避处理非预期退出。Caddy/frps 位于 VPS。此方式减少本机资源抢占，但不是硬性 CPU 核隔离或带宽 QoS。
- 网页网关在明确配置的 `public` 模式及匹配的 Caddy 域名、loopback 链路和 HTTPS 头时才接受可信的 `X-Forwarded-*` 与访客 IP，其他请求头全部规范化，不把匿名访客的自报 XFF 当作身份。
- 不得向公网开放原生 CAT/rigctld、内部控制面或未认证的管理端点。测试 Operator/Viewer 权限、网络中断时 PTT 停止、超时和租约行为；物理发射安全仍须台站操作员实机验收。
- 记录来自不同运营商的 WSS 连接、ICE 成功率、实际音频 RTT、抖动、CPU、内存及日志，连续 24h 运行并进行 FRP/Caddy/浏览器重启和 UDP 阻断测试。

## 无法自动完成的事项

公网 VPS 操作、DNS、正式证书及防火墙需由 VPS 管理员配置并进行网络验收。桌面 TX5DR 可管理本机 frpc 生命周期，但不能自动代替 VPS 部署。若部署 Linux Server/Docker 版 TX5DR，请独立运行受管 frpc sidecar，并将 Caddy/frps 配在 VPS，不要将本机 Docker 的 8443 或 4532 直接暴露公网。
