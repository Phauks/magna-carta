import type { EngineId, FormatId, Placement } from "./format.ts";
import { findPath } from "./pathfinding.ts";

// Where each engine can run. libvips runs in the browser (wasm-vips) and in a Container; the others
// are native, server-only engines (the LibreOffice fork-pool, the email render, the video transcode
// Container, and the raster Container's image-to-PDF path).
const ENGINE_PLACEMENTS: Record<EngineId, readonly Placement[]> = {
  libvips: ["local", "server"],
  libreoffice: ["server"],
  email: ["server"],
  transcode: ["server"],
  "image-pdf": ["server"],
  ocr: ["server"],
};

export function enginePlacements(id: EngineId): readonly Placement[] {
  return ENGINE_PLACEMENTS[id];
}

function engineRunsLocally(id: EngineId): boolean {
  return ENGINE_PLACEMENTS[id].includes("local");
}

// Whether a conversion can run entirely on the user's device — every hop's engine is local-capable —
// so a surface can offer "convert on your device" instead of "send to servers". No path → false.
export function canConvertLocally(from: FormatId, to: FormatId): boolean {
  const path = findPath(from, to);
  return path.ok && path.path.every((edge) => engineRunsLocally(edge.engineId));
}
