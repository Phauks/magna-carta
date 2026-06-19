#!/bin/sh
# Spike entrypoint: run the RSS sidecar, then hand off to the stock Collabora entrypoint.
# 9981: busybox httpd serving the /__rss CGI in the background (-f foreground would block).
mkdir -p /tmp/cgi-bin && ln -sf /usr/local/bin/rss-probe.sh /tmp/cgi-bin/__rss
busybox httpd -p 9981 -h /tmp &
# Hand off to the stock entrypoint so --use-env-vars + extra_params still drive coolwsd unchanged.
exec /start-collabora-online.sh "$@"
