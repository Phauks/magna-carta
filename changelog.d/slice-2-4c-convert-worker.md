---
category: Added
---

**Dedicated conversion worker (`magna-carta-convert`).** A new `apps/convert-worker` Cloudflare Worker hosts the conversion engine Container(s) and is the execution home for the heavy native engines. The app worker reaches it over a `CONVERT` service binding — no public surface, outbound networking disabled — and `resolveEnginePort` in `conversion-engine.ts` returns the `serviceBindingPort` adapter automatically once the binding is present, leaving the `ConversionJob` Durable Object, the queue consumer, and all routes in the app worker unchanged. The in-container libvips engine image (`containers/convert/`) is a deploy-time activation: build the image, deploy the worker, and the `CONVERT` binding activates real conversions. Until then `resolveEnginePort` returns the deferred port and all conversion routes remain fully functional with `engine-not-implemented` results.
