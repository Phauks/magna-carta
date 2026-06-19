# Throwaway measurement image: collabora/code wrapped with a tiny RSS sidecar.
# Discarded after the spike; the production image is built separately when editing is built.
#
# collabora/code is the Development Edition (CODE) — it carries a built-in connection/document
# cap, which is exactly the ceiling the +Nth-doc RSS curve must discover. Source: Docker Hub
# r/collabora/code; sdk.collaboraonline.com CODE_Docker_image.html.
# IMPORTANT: pull the arch that matches the Cloudflare runtime (amd64). latest-arm64 is a
# different ~510MB image and will not run. Pin the digest when this is promoted to production.
FROM collabora/code:latest

# --- RSS measurement sidecar -------------------------------------------------
# The Cloudflare host metrics aggregate does NOT break out per-process RSS; the authoritative
# real-time number is /proc/<coolwsd_pid>/status VmRSS read inside the container. A tiny busybox
# httpd CGI serves it back so the Worker can poll it on a schedule without SSH.
# Redaction: this endpoint returns ONLY integer byte counts + pids — never document bytes,
# never WOPI tokens. It reads /proc, not the document jail.
USER root
COPY rss-probe.sh /usr/local/bin/rss-probe.sh
COPY start-spike.sh /usr/local/bin/start-spike.sh
RUN chmod +x /usr/local/bin/rss-probe.sh /usr/local/bin/start-spike.sh

# coolwsd listens on 9980 (the only port the base image EXPOSEs). The sidecar listens on 9981 so
# the Worker can hit /__rss without touching the editor port (containerFetch(url, 9981)).
EXPOSE 9980 9981

# Drop back to the image's non-root user (uid 1001 = `cool`) before launch. The base image already
# sets file capabilities (cap_sys_admin on coolmount, cap_sys_chroot/fowner/chown on coolforkit-caps)
# — jailing runs as 1001, no persistent root needed. Source: CollaboraOnline/online docker Dockerfile.
USER 1001

# start-spike.sh launches the busybox RSS httpd in the background, then execs the stock
# /start-collabora-online.sh so --use-env-vars / extra_params still apply unchanged.
ENTRYPOINT ["/usr/local/bin/start-spike.sh"]
