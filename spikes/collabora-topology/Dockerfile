# Throwaway measurement image: collabora/code with Collabora's local-filesystem backend + baked text
# docs. Discarded after the spike; the production image is built separately when editing is built.
#
# collabora/code is the Development Edition (CODE) — it carries a built-in connection/document cap,
# the ceiling the +Nth-doc memory curve must discover. Pull the amd64 arch that matches the Cloudflare
# runtime; pin the digest when promoted to production. Source: Docker Hub r/collabora/code.
#
# Memory is read from Cloudflare's per-container memory metric (the number that sizes the instance),
# not an in-container sidecar; cold-start + keep-alive come from the Worker's lifecycle logs.
FROM collabora/code:latest

USER root

COPY start-spike.sh /usr/local/bin/start-spike.sh
# Strip any CRLF (the script may be authored on Windows) so the /bin/sh shebang resolves, then exec.
RUN sed -i 's/\r$//' /usr/local/bin/start-spike.sh && chmod +x /usr/local/bin/start-spike.sh

# Bake plain-text test documents — Collabora opens these as editable Writer documents. Text avoids a
# build-time office-conversion step, so cold-start reflects coolwsd + the Kit only. The "heavy"
# document is a large text body; an image-heavy .docx variant is a measured follow-up if needed.
RUN set -eux; \
    mkdir -p /opt/spike-docs; \
    printf 'Spike test document. Small.\n' > /opt/spike-docs/small.txt; \
    i=0; : > /opt/spike-docs/heavy.txt; \
    while [ "$i" -lt 6000 ]; do \
      printf 'Heavy spike paragraph %s with several words to fill out the page body.\n' "$i" >> /opt/spike-docs/heavy.txt; \
      i=$((i + 1)); \
    done; \
    chmod -R a+rX /opt/spike-docs

# coolwsd on 9980 (the only port the base image EXPOSEs).
EXPOSE 9980

# Jailing runs as the image's non-root user (uid 1001 = `cool`); the base image already sets the file
# caps coolmount/coolforkit need. Do not keep root.
USER 1001

ENTRYPOINT ["/usr/local/bin/start-spike.sh"]
