import { type ConversionPort, engineNotImplemented } from "@magna-carta/conversion/port";
import type { Bindings } from "../app.ts";

// The engine ConversionPort the consumer runs. The heavy native engines (native libvips, LibreOffice
// headless, FFmpeg, the future Rust PDF engine) run in a dedicated conversion worker that owns the
// engine Container(s) — outbound-disabled, no public surface, its own deploy/scaling — and the app
// worker reaches them through a thin service-binding adapter implementing this same ConversionPort.
// That adapter (and a small-raster wasm-vips in-process fast-path) lands when the conversion worker is
// built; the split is the existing ConversionPort boundary, so the consumer/DO/queue do not change.
// Until then every conversion is engine-not-implemented — tests inject their own fake port at the
// consumer's resolver seam, so this default is never exercised in a test.
const deferredPort: ConversionPort = {
  convert: () => Promise.resolve(engineNotImplemented()),
};

export function resolveEnginePort(_env: Bindings): ConversionPort {
  // The real adapter is selected here from a service binding to the dedicated conversion worker once
  // that worker exists; deferred until then.
  return deferredPort;
}
