#!/usr/bin/env bash
# Socket activation only. Keep the existing loopback Cloudflare tunnel unchanged.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
port="$(sed -n 's/^TPLUS_SQL_PORT=//p' "$root/.env" | tail -1 | tr -d '\r\"\047')"
[[ "$port" =~ ^[0-9]+$ ]] && (( port > 1024 && port < 65536 )) || { echo 'T+ loopback port unavailable' >&2; exit 1; }
[[ -x /usr/lib/systemd/systemd-socket-proxyd ]] || { echo 'Existing systemd socket proxy unavailable' >&2; exit 1; }
unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"
mkdir -p "$root/data/tplus-bom-proxy"
chmod 755 "$root/data/tplus-bom-proxy"
cat > "$unit_dir/kdos-tplus-bom-proxy.socket" <<EOF
[Unit]
Description=KDOS BOM reader access to existing T+ loopback tunnel
[Socket]
ListenStream=$root/data/tplus-bom-proxy/tplus.sock
SocketMode=0666
DirectoryMode=0755
NoDelay=true
[Install]
WantedBy=sockets.target
EOF
cat > "$unit_dir/kdos-tplus-bom-proxy.service" <<EOF
[Unit]
Description=KDOS Unix socket to retained T+ loopback tunnel
Requires=kdos-tplus-bom-proxy.socket
[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd --exit-idle-time=5min 127.0.0.1:$port
NoNewPrivileges=true
PrivateTmp=true
RestrictAddressFamilies=AF_INET AF_UNIX
UMask=0077
EOF
systemctl --user daemon-reload
systemctl --user enable --now kdos-tplus-bom-proxy.socket
systemctl --user is-active kdos-tplus-bom-proxy.socket
