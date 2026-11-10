// A conversion engine. libvips is implemented now; the rest are registered but their bodies are
// deferred to the execution substrate (Container/Durable-Object orchestration, the LibreOfficeKit
// fork-pool). transcode is the pure-Rust audio/video engine (containers/transcode): H.264 or HEVC
// video in MP4, QuickTime or Matroska, out to an MP4 every browser plays. image-pdf is the raster Container's image-to-PDF path (server-only).
// ocr is the recognition engine that writes a searchable text layer onto a scanned PDF — it already
// runs as its own service, reached in the worker through the OCR service binding rather than the
// dedicated conversion worker.
export type EngineId = "libvips" | "libreoffice" | "email" | "transcode" | "image-pdf" | "ocr";

// Where an engine can run: "local" = in the browser (wasm) on the user's device, no upload; "server"
// = in a Container. libvips runs both; the native engines (LibreOffice, email render, the video
// transcode) are server-only. Lets a surface offer "convert on your device" vs "send to servers".
export type Placement = "local" | "server";

// A stable, lowercase format key — both the registry node id and how callers name source/target.
export type FormatId = string;

export interface Format {
  readonly id: FormatId;
  readonly label: string;
  readonly mediaType: string;
  readonly extensions: readonly string[];
}

// A single conversion step. One engine per edge (no candidates): the converter is in-house only, so
// there is nothing to choose between. `recipeRef` names the engine-specific recipe; `weight` is the
// pathfinding cost (lower preferred).
export interface ConversionEdge {
  readonly from: FormatId;
  readonly to: FormatId;
  readonly engineId: EngineId;
  readonly recipeRef: string;
  readonly weight: number;
}
