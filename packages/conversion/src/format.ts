// A conversion engine. libvips is implemented now; the rest are registered but their bodies are
// deferred to the execution substrate (Container/Durable-Object orchestration, the LibreOfficeKit
// fork-pool, the FFmpeg sandbox).
export type EngineId = "libvips" | "libreoffice" | "email" | "ffmpeg";

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
