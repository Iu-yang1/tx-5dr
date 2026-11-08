#!/bin/sh
# Install as /etc/letsencrypt/renewal-hooks/deploy/tx5dr-nginx-reload
set -eu
/usr/sbin/nginx -t
/bin/systemctl reload nginx
