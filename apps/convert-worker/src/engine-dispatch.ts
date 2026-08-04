// Maps a request's engine id to the Container that executes it. Both raster-served engine ids run
// in the RasterEngineContainer — it routes internally by source/target format, so raster
// interconversion and image-to-PDF share one Container. A missing header is treated as the raster
// engine so an app worker deployed ahead of this one keeps converting. LibreOffice/email/FFmpeg
// map to their own Container classes when those engines land.
export type EngineTarget = "raster";

export function engineTargetFor(engineId: string | null): EngineTarget | undefined {
  if (engineId === null || engineId === "libvips" || engineId === "image-pdf") return "raster";
  return undefined;
}
