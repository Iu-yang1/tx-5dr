# TX5DR 公网远控：Caddy + FRP 一键部署（VPS）

适合 Debian/Ubuntu 公网 VPS + Windows TX5DR 电台主机。VPS 自动安装 **TX5DR 专用 frps 实例、Caddy HTTPS/WSS、专用 TLS CA 和最小防火墙规则**，并生成随机 FRP Token。**不会修改其他 FRP 服务器的配置或 Token**。后台独立 frpc 进程继续与电台的 CAT/PTT、DSP、收发音频隔离。

## 一、一键安装

在 **VPS 上**使用 root 或 sudo，下载并检查脚本后执行：

```bash
curl -fsSL 'https://raw.githubusercontent.com/Iu-yang1/tx-5dr/main/deployment/public-remote/install-caddy-frp.sh' -o /tmp/install-caddy-frp.sh
less /tmp/install-caddy-frp.sh
sudo bash /tmp/install-caddy-frp.sh --host radio.example.com --frp-port 17000 --web-port 18076 --udp-port 52000
```

- `--host`：**可省略**。脚本将使用 HTTPS 服务自动查询 VPS 的公网 IPv4；也可以填写真实 DNS 域名、IPv4。
- `--frp-port`：Windows frpc 连接 VPS 的 TLS TCP 控制端口，自定义（示例 17000，默认 7000）。
- `--web-port`：frps TCP 代理端口，供 VPS Caddy 经 `127.0.0.1` 访问（示例/默认 18076），**必须阻断公网**。
- `--udp-port`：浏览器 WebRTC UDP 直通转发端口（示例 52000，默认 50110）。
- `--frp-version`：官方下载版本，默认 0.72.0，附带从同一官方 Release 下载的 SHA256 清单校验。
- `--dry-run`：显示规划且不下载、不改文件、不动防火墙；`--reconfigure` 才允许修改已有 TX5DR 部署端口或地址；`--rotate-token --reconfigure` 才更换 TX5DR Token。

**没有公网 DNS 域名也可以部署**。IP 直连使用 Caddy 2.11.2 或更新版本，并为 Let's Encrypt ACME 显式启用 `shortlived` profile。公网 IP 证书只有 **160 小时**有效期，请确保 Caddy 证书管理目录持久化、续期和公网 80/443 一直可用，安装后需要以独立浏览器验证 HTTPS 证书真实可信。Caddy 官方旧版本对 IP 证书可能默认使用本地 CA，**不要以为配置通过就一定取得了公信 IP 证书**。

脚本不允许抢占当前由 Nginx/Apache 等服务使用的 80/443；如你的 VPS 已有其他网站，应先评估端口和 Caddy 配置。若已有 Caddy，它会备份 `/etc/caddy/Caddyfile`，只添加对 `/etc/caddy/tx5dr.d/*.caddy` 的导入，通过 `caddy validate` 后才启用；验证失败时恢复主配置，其他站点保持原有配置。

## 二、安装产物

| 用途 | 安装位置 |
| --- | --- |
| frps 二进制 | `/usr/local/lib/tx5dr/frps` |
| FRPS 配置 | `/etc/tx5dr-frps/frps.toml` |
| 自动生成 Token | `/etc/tx5dr-frps/frp.token`，仅 root 读取 |
| **FRPC 需要的公开 CA 证书** | `/etc/tx5dr-frps/frps-ca.crt` |
| Caddy 站点 | `/etc/caddy/tx5dr.d/tx5dr.caddy` |
| 服务 | `tx5dr-frps.service`、`tx5dr-frps-firewall.service` |
| 本次部署配置摘要 | `/root/tx5dr-frp-credentials.txt`，仅 root 读取 |

首次运行会在终端输出生成的 Token，摘要文件也包含 Token，**请不要把该文件上传到 GitHub 或公开分享**。重新运行默认保持 Token 不变。现有其他 FRP 服务的 Token 完全不受影响。

内部 FRP TLS 使用**独立 CA**，证书 SAN 会对应输入的 DNS 或公网 IPv4，浏览器只验证 Caddy 的公信证书。绝对不要把 `frps-ca.key` 或 `server.key` 复制到 Windows，Windows 只需下载 `frps-ca.crt`。

## 三、放行端口与拓扑

```text
公网浏览器 HTTPS / WSS TCP 443
    --> VPS Caddy --> 127.0.0.1:18076 (FRP TCP remote)
                            |
Windows TX5DR 网页网关 8076 <-- frpc <-- TLS FRPS TCP 17000
Windows TX5DR WebRTC UDP 50110 <-- frpc <-- VPS frps UDP 52000 <-- 公网浏览器
```

云安全组和主机防火墙**都应**允许 TCP 80、443、所选 FRP 控制端口与所选 WebRTC UDP；**必须拒绝公网 TCP 网页代理端口**。脚本通过单独的 systemd firewall service 写入一条针对网页端口的 IPv4 INPUT DROP 规则，并不会清空其他规则。云平台安全组必须另行核查，脚本无法代替云平台授权。不得公网开放 TX5DR 后端 TCP 4000、Hamlib 4532 或内置 HTTPS 8443。

FRP 的 `proxyBindAddr` 对 TCP/UDP 共享生效，因此不能简单将其设为 `127.0.0.1`（会影响公网 WebRTC UDP）；隔离 TCP 代理端口的防火墙规则不可省略。

## 四、Windows / TX5DR 客户端

下载与 VPS 兼容的官方 `frpc.exe`，在 TX5DR 系统设置中：

1. 启用用户身份认证并设置访问范围为 `public`；Allowed Origin 设为 **`https://<公网IP或域名>`**。
2. 在 **Caddy + FRP** 设置卡填写 frpc.exe 的绝对路径、FRP Server Host 和 TLS TCP 控制端口、Public Host、FRP Remote Web TCP、Remote UDP、Local UDP（默认 50110），以及安装生成的 Token。
3. 将 VPS `/etc/tx5dr-frps/frps-ca.crt` 复制到 Windows，在卡片 `FRPS CA 证书路径`（`trustedCaFile`）填其本地绝对路径，**此项必填**。不同于公信网站证书，这是用于**校验 FRPS 服务器身份**的独立 CA，绝对不能使用 `server.key` 或私钥代替。建议核对从 VPS 读取的 CA 证书 SHA256，确认下载文件确实来自你的 VPS。
4. `Web TCP 代理名称`（`webProxyName`）和 `WebRTC UDP 代理名称`（`rtcUdpProxyName`）可分别修改。默认名称仍为 `tx5dr-web` 和 `tx5dr-rtc-udp`；两者必须不同，并且在同一台 FRPS 上不能与其他客户端已有代理冲突。名称不影响独立配置的公网 TCP/UDP 端口。
5. 在实时音频设置中把 `RTC Public Host` 设为 VPS IP/域名，`RTC Public UDP Port` 设为安装的公网 UDP 端口（如 52000）。本地 TX5DR UDP 继续保留默认 50110 即可。
6. 保存、启动 FRP 穿透；使用外网 Chrome/Edge 访问 `https://<公网IP或域名>`，确认浏览器无证书警告、登录正常、控制 WSS 可用、WebRTC 音频可用，UDP 阻断时能走 `ws-compat` 回退。

### FRPC 旧版本兼容性与配置校验

- `transport.tls.useSystemCa` 从 **FRP v0.72.0** 才开始支持。此前 TX5DR 在未填写 CA 路径时输出该参数，会导致旧版 `frpc` 解析失败。现在不再生成此字段。
- 新版本默认生成 `transport.tls.enable = true`、`transport.tls.trustedCaFile = "本机证书绝对路径"` 及 `transport.tls.serverName = "FRPS 地址"`，适用于不支持 `useSystemCa` 的旧版 FRPC，同时保持服务器证书验证。
- 没有 CA 证书时，TX5DR 将返回 `tunnel_trusted_ca_required`，不会退化成 TLS 加密但跳过证书验证的连接。安装脚本已在 VPS 生成了相应 CA 证书，无须修改 FRPS Token。
- 如使用其他现有 FRPS，请从该服务器管理员获取其 TLS 服务端证书对应的**受信任 CA 公开证书**（非私钥），填入 TX5DR。
- 配置保存后可在 TX5DR 「打开配置目录」中查看生成的 `frpc.toml`（包含 Token，**不要公开**），用对应的 `frpc.exe verify -c "frpc.toml"` 检查参数是否受该版本支持。生成文件通常在启动时刷新；检查前请确认已使用新版本 TX5DR 重新生成。

**公网 IP 的 HTTPS URL 不能忽略证书错误**；公网 HTTP 也不适合依赖浏览器麦克风的远控。在 VPS 没有成功获得公信 IP 证书前，不应作为已完成验收的公网配置。

## 五、验收与管理命令

```bash
sudo systemctl status tx5dr-frps tx5dr-frps-firewall caddy
sudo journalctl -u tx5dr-frps -n 80 --no-pager
sudo journalctl -u caddy -n 80 --no-pager
sudo caddy validate --config /etc/caddy/Caddyfile
sudo ss -lntup
sudo iptables -S INPUT
```

首次验证关注：HTTPS TLS 证书 SAN、登录与权限控制、WSS、WebRTC ICE 公网候选、UDP 转发、弱网断线后 PTT 自动释放、FT8/FT4/Q65 解码负载与延迟、24 小时以上稳定运行。**本脚本仅安装 VPS**，不重启电台或替你进行实机发射/接收测试。

## 上游资料

- Caddy HTTPS：https://caddyserver.com/docs/automatic-https
- Caddy TLS ACME profile：https://caddyserver.com/docs/caddyfile/directives/tls
- Let's Encrypt 短期 IP 证书：https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/
- FRP 官方下载：https://github.com/fatedier/frp/releases
- FRP 服务端配置：https://gofrp.org/en/docs/reference/server-configures/
