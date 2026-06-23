# magna-carta-convert (containers/convert) — CLAUDE.md

**Purpose.** The native-libvips conversion engine for the document-conversion pipeline — a
`linux/amd64` Cloudflare Container. An HTTP service (`GET /ready`, `POST /convert`) that accepts
a source document body with conversion headers and returns the converted bytes. The worker side
(`apps/convert-worker`) reaches it via `getContainer(env.LIBVIPS_CONTAINER, "libvips")`.

**Status.** Placeholder only. The `Dockerfile` contains a base image stub. The real implementation
builds the libvips service (format negotiation, recipe application, streaming I/O) when the
conversion engine work lands. The stub satisfies `wrangler deploy --dry-run` validation so the
worker binding and Durable Object configuration can be committed before the engine is built.

## Planned HTTP surface

- `GET /ready` — fast, side-effect-free health probe (the Container's `pingEndpoint`); used by
  the warm-poke cron every 20 minutes to keep the instance alive within `sleepAfter`.
- `POST /convert` — receives the source document as a streaming body with headers:
  - `x-source-format` — MIME type or format name of the input.
  - `x-target-format` — MIME type or format name of the desired output.
  - `x-recipe` (optional) — JSON-encoded recipe overrides for quality/profile/pages.
  Returns the converted bytes with an appropriate `Content-Type`, or a non-2xx status on failure.

## Key design notes

- **Deploy-time build**, not a pre-built image: built from this Dockerfile via `wrangler deploy`
  (same pattern as `containers/scan`). Build context is this directory.
- **No runtime egress** expected: source bytes come in via the worker service binding; no outbound
  calls to external conversion services.
- **Streaming I/O**: the worker forwards the body as a stream (`duplex: "half"`); the container
  service must not buffer the full body before beginning conversion on large documents.
