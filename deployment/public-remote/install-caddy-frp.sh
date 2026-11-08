#!/usr/bin/env bash
# TX5DR dedicated VPS Caddy + FRPS installer. Debian/Ubuntu only.
set -Eeuo pipefail
umask 077
help() { cat <<'EOF'
Usage: sudo bash install-caddy-frp.sh [options]
  --host HOST           DNS hostname or public IPv4 (default: auto-detect public IPv4)
  --frp-port N          FRP control TCP port (default 7000)
  --web-port N          Web TCP proxy port (default 18076, blocked externally)
  --udp-port N          WebRTC UDP public port (default 50110)
  --frp-version X.Y.Z   Official FRP version (default 0.72.0)
  --reconfigure         Permit changing an existing TX5DR deployment
  --rotate-token        Generate another dedicated token; requires --reconfigure
  --dry-run             Show settings without network/system changes
  --help                This help
Never edits other frps configs, services or tokens.
EOF
}
fail() { echo "[TX5DR] ERROR: $*" >&2; exit 1; }
log() { echo "[TX5DR] $*"; }
as_port() {
  [[ "$1" =~ ^[0-9]+$ ]] || fail "Invalid port $1"
  local value=$((10#$1))
  (( value >= 1 && value <= 65535 )) || fail "Invalid port $1"
  printf '%d' "$value"
}
HOST=''; FP=''; WP=''; UP=''; VERSION=0.72.0; ROTATE=0; FORCE=0; DRY=0
while (( $# )); do
  case "$1" in
    --host|--frp-port|--web-port|--udp-port|--frp-version)
      (( $# >= 2 )) || fail "Missing value for $1"
      case "$1" in
        --host) HOST="$2" ;; --frp-port) FP="$2" ;;
        --web-port) WP="$2" ;; --udp-port) UP="$2" ;;
        --frp-version) VERSION="$2" ;;
      esac
      shift 2 ;;
    --reconfigure) FORCE=1; shift ;;
    --rotate-token) ROTATE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --help|-h) help; exit 0 ;;
    *) fail "Unknown option $1" ;;
  esac
done
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Bad FRP version'
(( EUID == 0 || DRY )) || fail 'Run as root / with sudo'
[[ -f /etc/os-release ]] || fail 'Debian/Ubuntu only'
. /etc/os-release
[[ "$ID" == ubuntu || "$ID" == debian ]] || fail 'Debian/Ubuntu only'
command -v python3 >/dev/null || fail 'python3 required'
STATE=/etc/tx5dr-frps/install.env
OLDHOST=''; OLDFP=''; OLDWP=''; OLDUP=''
if [[ -f "$STATE" ]]; then
  [[ "$(stat -c %u "$STATE")" == 0 ]] || fail 'State file must be owned by root'
  . "$STATE"
  OLDHOST="$TX5DR_HOST"; OLDFP="$TX5DR_FRP"; OLDWP="$TX5DR_WEB"; OLDUP="$TX5DR_UDP"
fi
if [[ -z "$HOST" ]]; then HOST="$OLDHOST"; fi
if [[ -z "$HOST" && DRY -eq 1 ]]; then HOST=radio.example.com; fi
if [[ -z "$HOST" ]]; then
  command -v curl >/dev/null || fail 'Use --host or install curl'
  HOST="$(curl -4fsSL --connect-timeout 5 --max-time 10 https://api.ipify.org)" ||
    fail 'Cannot detect public IP: pass --host'
fi
if [[ -z "$FP" ]]; then FP="$OLDFP"; fi
if [[ -z "$WP" ]]; then WP="$OLDWP"; fi
if [[ -z "$UP" ]]; then UP="$OLDUP"; fi
if [[ -z "$FP" ]]; then FP=7000; fi
if [[ -z "$WP" ]]; then WP=18076; fi
if [[ -z "$UP" ]]; then UP=50110; fi
FP="$(as_port "$FP")"; WP="$(as_port "$WP")"; UP="$(as_port "$UP")"
[[ "$FP" != "$WP" && "$FP" != "$UP" && "$WP" != "$UP" ]] ||
  fail 'Choose distinct FRP, web and UDP ports'
[[ "$FP" != 80 && "$FP" != 443 && "$WP" != 80 && "$WP" != 443 ]] ||
  fail 'FRP TCP ports cannot overlap Caddy 80/443'
MODE="$(python3 - "$HOST" <<'PY'
import ipaddress,re,sys
s=sys.argv[1]
try:
    v=ipaddress.ip_address(s)
except ValueError:
    if not re.fullmatch(r'[A-Za-z0-9.-]{1,253}',s) or '.' not in s or '..' in s or any(
        not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', part)
        for part in s.split('.')
    ): sys.exit(2)
    print('dns')
else:
    if v.version!=4 or not v.is_global: sys.exit(2)
    print('ipv4')
PY
)" || fail 'Invalid public hostname/IPv4'
if [[ -n "$OLDHOST" && FORCE -eq 0 ]]; then
  [[ "$HOST" == "$OLDHOST" && "$FP" == "$OLDFP" && "$WP" == "$OLDWP" && "$UP" == "$OLDUP" && ROTATE -eq 0 ]] ||
    fail 'Existing TX5DR installation differs; use --reconfigure explicitly'
fi
log "Plan: $MODE host=$HOST, HTTPS TCP 443, FRP TCP $FP, web TCP $WP, RTC UDP $UP"
if (( DRY )); then log 'Dry run: no changes made'; exit 0; fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg openssl python3 tar iptables iproute2
for edge in 80 443; do
  if ss -H -ltnp "( sport = :$edge )" | grep -q .; then
    ss -H -ltnp "( sport = :$edge )" | grep -q caddy ||
      fail "TCP $edge is occupied by another web server; do not overwrite it"
  fi
done
if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    -o /etc/apt/sources.list.d/caddy-stable.list
  chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  apt-get update -qq
  apt-get install -y caddy
fi
if [[ "$MODE" == ipv4 ]]; then
  CV="$(caddy version | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | cut -c2-)"
  python3 - "$CV" <<'PY' || fail 'IP certificate requires Caddy >= 2.11.2'
import sys
assert tuple(map(int,sys.argv[1].split('.'))) >= (2,11,2)
PY
fi
case "$(dpkg --print-architecture)" in
  amd64) ARCH=amd64 ;; arm64) ARCH=arm64 ;; armhf) ARCH=arm_hf ;;
  *) fail 'Unsupported FRPS architecture' ;;
esac
printf -v ARCHIVE 'frp_%s_linux_%s.tar.gz' "$VERSION" "$ARCH"
URL="https://github.com/fatedier/frp/releases/download/v$VERSION"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fL --retry 3 -o "$TMP/$ARCHIVE" "$URL/$ARCHIVE"
curl -fL --retry 3 -o "$TMP/checksums" "$URL/frp_sha256_checksums.txt"
SHA="$(awk -v filename="$ARCHIVE" '$NF==filename{print $1}' "$TMP/checksums" | head -1)"
[[ "$SHA" =~ ^[0-9a-fA-F]{64}$ ]] || fail 'Missing FRP SHA256 in official manifest'
printf '%s  %s\n' "$SHA" "$TMP/$ARCHIVE" | sha256sum -c - || fail 'Checksum mismatch'
tar -xzf "$TMP/$ARCHIVE" -C "$TMP"
printf -v EXE '%s/frp_%s_linux_%s/frps' "$TMP" "$VERSION" "$ARCH"
[[ -f "$EXE" ]] || fail 'FRPS binary missing'

install -d -m 755 /usr/local/lib/tx5dr /etc/caddy/tx5dr.d
id tx5dr-frp >/dev/null 2>&1 ||
  useradd --system --home-dir /var/lib/tx5dr-frp --shell /usr/sbin/nologin tx5dr-frp
install -d -o tx5dr-frp -g tx5dr-frp -m 750 /var/lib/tx5dr-frp
install -d -o root -g tx5dr-frp -m 750 /etc/tx5dr-frps
install -m 755 "$EXE" /usr/local/lib/tx5dr/frps
if [[ ! -s /etc/tx5dr-frps/frp.token || ROTATE -eq 1 ]]; then
  openssl rand -hex 32 > /etc/tx5dr-frps/frp.token
fi
TOKEN="$(tr -d '\r\n' < /etc/tx5dr-frps/frp.token)"
[[ -n "$TOKEN" ]] || fail 'Token empty'
chmod 600 /etc/tx5dr-frps/frp.token
if [[ ! -f /etc/tx5dr-frps/frps-ca.crt || ! -f /etc/tx5dr-frps/server.key || FORCE -eq 1 ]]; then
  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 \
    -subj '/CN=TX5DR FRPS CA' -keyout /etc/tx5dr-frps/frps-ca.key \
    -out /etc/tx5dr-frps/frps-ca.crt >/dev/null 2>&1
  openssl req -new -newkey rsa:3072 -nodes -subj "/CN=$HOST" \
    -keyout /etc/tx5dr-frps/server.key -out "$TMP/frps.csr" >/dev/null 2>&1
  if [[ "$MODE" == ipv4 ]]; then SAN="IP:$HOST"; else SAN="DNS:$HOST"; fi
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$SAN" > "$TMP/san.ext"
  openssl x509 -req -in "$TMP/frps.csr" -CA /etc/tx5dr-frps/frps-ca.crt \
    -CAkey /etc/tx5dr-frps/frps-ca.key -CAcreateserial -days 365 \
    -sha256 -extfile "$TMP/san.ext" -out /etc/tx5dr-frps/server.crt >/dev/null 2>&1
fi
chown root:tx5dr-frp /etc/tx5dr-frps/server.key /etc/tx5dr-frps/server.crt
chmod 640 /etc/tx5dr-frps/server.key
chmod 644 /etc/tx5dr-frps/server.crt /etc/tx5dr-frps/frps-ca.crt
chmod 600 /etc/tx5dr-frps/frps-ca.key
cat > /etc/tx5dr-frps/frps.toml <<EOF
bindAddr = "0.0.0.0"
bindPort = $FP
proxyBindAddr = "0.0.0.0"
auth.method = "token"
auth.token = "$TOKEN"
transport.tls.force = true
transport.tls.certFile = "/etc/tx5dr-frps/server.crt"
transport.tls.keyFile = "/etc/tx5dr-frps/server.key"
allowPorts = [{ single = $WP }, { single = $UP }]
maxPortsPerClient = 2
log.level = "warn"
EOF
chown root:tx5dr-frp /etc/tx5dr-frps/frps.toml
chmod 640 /etc/tx5dr-frps/frps.toml
/usr/local/lib/tx5dr/frps verify -c /etc/tx5dr-frps/frps.toml || fail 'FRPS verify failed'
cat > /usr/local/lib/tx5dr/firewall-web.sh <<EOF
#!/bin/sh
set -eu
iptables -C INPUT -p tcp --dport $WP ! -s 127.0.0.1 -j DROP 2>/dev/null ||
  iptables -I INPUT 1 -p tcp --dport $WP ! -s 127.0.0.1 -j DROP
EOF
chmod 755 /usr/local/lib/tx5dr/firewall-web.sh
cat > /etc/systemd/system/tx5dr-frps-firewall.service <<'EOF'
[Unit]
Description=Protect TX5DR FRP web TCP proxy
Before=tx5dr-frps.service
[Service]
Type=oneshot
ExecStart=/usr/local/lib/tx5dr/firewall-web.sh
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/tx5dr-frps.service <<'EOF'
[Unit]
Description=Isolated TX5DR FRPS instance
After=network-online.target tx5dr-frps-firewall.service
Requires=tx5dr-frps-firewall.service
Wants=network-online.target
[Service]
Type=simple
User=tx5dr-frp
Group=tx5dr-frp
WorkingDirectory=/var/lib/tx5dr-frp
ExecStart=/usr/local/lib/tx5dr/frps -c /etc/tx5dr-frps/frps.toml
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=strict
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
CADDYFILE=/etc/caddy/Caddyfile
[[ -f "$CADDYFILE" ]] || touch "$CADDYFILE"
BACKUP="/etc/caddy/Caddyfile.pre-tx5dr.$(date +%Y%m%d-%H%M%S)"
cp -a "$CADDYFILE" "$BACKUP"
if ! grep -Fqx 'import /etc/caddy/tx5dr.d/*.caddy' "$CADDYFILE"; then
  printf '\n# TX5DR managed site\nimport /etc/caddy/tx5dr.d/*.caddy\n' >> "$CADDYFILE"
fi
TLS=''
if [[ "$MODE" == ipv4 ]]; then
  TLS="$(cat <<'EOF'
    tls {
        issuer acme https://acme-v02.api.letsencrypt.org/directory {
            profile shortlived
        }
    }
EOF
)"
fi
cat > /etc/caddy/tx5dr.d/tx5dr.caddy <<EOF
$HOST {
    encode zstd gzip
$TLS
    reverse_proxy 127.0.0.1:$WP {
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Host {host}
        header_up X-Forwarded-Proto https
        header_up X-Real-IP {remote_host}
        stream_close_delay 5m
    }
}
EOF
chmod 644 /etc/caddy/tx5dr.d/tx5dr.caddy
if ! caddy validate --config "$CADDYFILE" --adapter caddyfile; then
  cp -a "$BACKUP" "$CADDYFILE"
  fail "Caddy validation failed; original config restored ($BACKUP)"
fi
{
  printf 'TX5DR_HOST=%q\n' "$HOST"
  printf 'TX5DR_FRP=%q\n' "$FP"
  printf 'TX5DR_WEB=%q\n' "$WP"
  printf 'TX5DR_UDP=%q\n' "$UP"
} > "$STATE"
chmod 600 "$STATE"
systemctl daemon-reload
systemctl enable tx5dr-frps-firewall tx5dr-frps >/dev/null
systemctl restart tx5dr-frps-firewall || fail 'Firewall failed; refusing FRPS startup'
systemctl restart tx5dr-frps || fail 'FRPS startup failed'
systemctl is-active --quiet tx5dr-frps || fail 'FRPS inactive'
systemctl enable caddy >/dev/null
if systemctl is-active --quiet caddy; then
  systemctl reload caddy || fail 'Caddy reload failed'
else
  systemctl start caddy || fail 'Caddy start failed'
fi
CREDS=/root/tx5dr-frp-credentials.txt
cat > "$CREDS" <<EOF
TX5DR Caddy + dedicated FRP
Public HTTPS URL: https://$HOST
FRP Server Host: $HOST
FRP Control TCP Port: $FP
FRP Token: $TOKEN
FRP Web TCP Remote Port: $WP
WebRTC Public UDP Port: $UP
WebRTC Local UDP Port: 50110 (default)
RTC Public Host: $HOST
RTC Public UDP Port: $UP
frpc Trusted CA: /etc/tx5dr-frps/frps-ca.crt (copy public cert to Windows)
Cloud security group: ALLOW TCP 80/443/$FP and UDP $UP
Cloud security group: DENY TCP $WP
Never directly expose TCP 4000/4532/8443
EOF
chmod 600 "$CREDS"
log "Installed: https://$HOST"
log "Token: $TOKEN (also in root-only $CREDS)"
log "Copy FRPC CA: /etc/tx5dr-frps/frps-ca.crt"
log "Cloud firewall: allow TCP 80/443/$FP & UDP $UP; deny TCP $WP"
log 'Caddy certificate check: journalctl -u caddy -f'
if [[ "$MODE" == ipv4 ]]; then
  log 'IP certificates are 160h shortlived; verify browser trust and Caddy renewals.'
fi
