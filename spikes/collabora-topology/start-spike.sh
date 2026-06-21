#!/bin/sh
# Spike entrypoint: run the RSS sidecar, enable Collabora's local-filesystem backend (no WOPI host
# needed to measure coolwsd's resource behaviour), then hand off to the stock Collabora entrypoint.
#
# Open a document via:  /browser/dist/cool.html?file_path=file:///opt/spike-docs/small.txt&permission=edit
# 9981: busybox httpd serving the /__rss CGI in the background (-f foreground would block).
mkdir -p /tmp/cgi-bin && ln -sf /usr/local/bin/rss-probe.sh /tmp/cgi-bin/__rss
busybox httpd -p 9981 -h /tmp &

# TLS is terminated at the Cloudflare edge, so coolwsd speaks plain http on 9980 but must still emit
# https:// URLs (ssl.termination=true). The filesystem backend opens the baked test docs by path.
export extra_params="${extra_params} --o:storage.filesystem[@allow]=true --o:ssl.enable=false --o:ssl.termination=true"
export DONT_GEN_SSL_CERT=1

# Hand off to the stock entrypoint so --use-env-vars + extra_params still drive coolwsd unchanged.
exec /start-collabora-online.sh "$@"
