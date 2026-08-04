// Maps a request's engine id to the Container that executes it. Both raster-served engine ids run
// in the RasterEngineContainer — it routes internally by source/target format, so raster
// interconversion and image-to-PDF share one Container. The office edges run in the
// LibreOfficeEngineContainer, which dispatches on the format pair for the same reason, and is why
// the future email→PDF engine id will map here too rather than needing a Container of its own. A
// missing header is treated as the raster engine so an app worker deployed ahead of this one keeps
// converting. FFmpeg maps to its own Container class when that engine lands.
export type EngineTarget = "raster" | "libreoffice";

export function engineTargetFor(engineId: string | null): EngineTarget | undefined {
  if (engineId === null || engineId === "libvips" || engineId === "image-pdf") return "raster";
  if (engineId === "libreoffice") return "libreoffice";
  return undefined;
}
