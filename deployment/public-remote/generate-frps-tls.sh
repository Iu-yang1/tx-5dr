#!/usr/bin/env bash
set -euo pipefail
DOMAIN="${1:?Usage: generate-frps-tls.sh tunnel.example.com /etc/tx5dr-frps}"
DEST="${2:-/etc/tx5dr-frps}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Invalid hostname" >&2; exit 2; }
umask 077
mkdir -p "$DEST"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$DEST/frps-ca.key"
openssl req -x509 -new -sha256 -days 1095 -key "$DEST/frps-ca.key" \
  -subj "/CN=TX5DR FRP private CA" -out "$DEST/frps-ca.crt" \
  -addext "basicConstraints=critical,CA:TRUE"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$DEST/server.key"
openssl req -new -sha256 -key "$DEST/server.key" \
  -subj "/CN=$DOMAIN" -out "$DEST/server.csr"
cat > "$DEST/server.ext" <<EOF
subjectAltName=DNS:$DOMAIN
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF
openssl x509 -req -sha256 -days 365 -in "$DEST/server.csr" \
  -CA "$DEST/frps-ca.crt" -CAkey "$DEST/frps-ca.key" \
  -CAcreateserial -extfile "$DEST/server.ext" -out "$DEST/server.crt"
rm -f "$DEST/server.csr" "$DEST/server.ext"
chmod 640 "$DEST/server.key" "$DEST/frps-ca.key"
chmod 644 "$DEST/server.crt" "$DEST/frps-ca.crt"
echo "Copy ONLY $DEST/frps-ca.crt to the TX5DR station."
