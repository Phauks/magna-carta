import type { ConversionEdge, Format, FormatId } from "./format.ts";

export const FORMATS: readonly Format[] = [
  { id: "png", label: "PNG", mediaType: "image/png", extensions: ["png"] },
  { id: "jpeg", label: "JPEG", mediaType: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { id: "webp", label: "WebP", mediaType: "image/webp", extensions: ["webp"] },
  { id: "tiff", label: "TIFF", mediaType: "image/tiff", extensions: ["tif", "tiff"] },
  { id: "gif", label: "GIF", mediaType: "image/gif", extensions: ["gif"] },
  {
    id: "docx",
    label: "Word (DOCX)",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
  },
  {
    id: "odt",
    label: "OpenDocument Text",
    mediaType: "application/vnd.oasis.opendocument.text",
    extensions: ["odt"],
  },
  {
    id: "wpd",
    label: "WordPerfect",
    mediaType: "application/vnd.wordperfect",
    extensions: ["wpd"],
  },
  { id: "pdf", label: "PDF", mediaType: "application/pdf", extensions: ["pdf"] },
  { id: "eml", label: "Email (EML)", mediaType: "message/rfc822", extensions: ["eml"] },
  {
    id: "msg",
    label: "Outlook (MSG)",
    mediaType: "application/vnd.ms-outlook",
    extensions: ["msg"],
  },
  { id: "mp4", label: "MP4", mediaType: "video/mp4", extensions: ["mp4"] },
  { id: "mov", label: "QuickTime", mediaType: "video/quicktime", extensions: ["mov"] },
  { id: "webm", label: "WebM", mediaType: "video/webm", extensions: ["webm"] },
];

// libvips raster interconversions: every ordered pair of raster formats is a direct edge. The
// libvips recipe is just the target id (the adapter maps it to a vips write suffix).
const RASTER: readonly FormatId[] = ["png", "jpeg", "webp", "tiff", "gif"];
const rasterEdges: ConversionEdge[] = [];
for (const from of RASTER) {
  for (const to of RASTER) {
    if (from !== to) {
      rasterEdges.push({ from, to, engineId: "libvips", recipeRef: to, weight: 1 });
    }
  }
}

// LibreOffice office edges (deferred bodies). wpd->odt and odt->pdf together let pathfinding chain
// wpd->pdf with no direct edge.
const officeEdges: readonly ConversionEdge[] = [
  { from: "docx", to: "pdf", engineId: "libreoffice", recipeRef: "pdf", weight: 1 },
  { from: "odt", to: "pdf", engineId: "libreoffice", recipeRef: "pdf", weight: 1 },
  { from: "docx", to: "odt", engineId: "libreoffice", recipeRef: "odt", weight: 1 },
  { from: "wpd", to: "odt", engineId: "libreoffice", recipeRef: "odt", weight: 1 },
];

// email->PDF (deferred) and A/V transcode (deferred).
const otherEdges: readonly ConversionEdge[] = [
  { from: "eml", to: "pdf", engineId: "email", recipeRef: "pdf", weight: 1 },
  { from: "msg", to: "pdf", engineId: "email", recipeRef: "pdf", weight: 1 },
  { from: "mov", to: "mp4", engineId: "ffmpeg", recipeRef: "mp4-h264-aac-faststart", weight: 1 },
  { from: "webm", to: "mp4", engineId: "ffmpeg", recipeRef: "mp4-h264-aac-faststart", weight: 1 },
];

export const EDGES: readonly ConversionEdge[] = [...rasterEdges, ...officeEdges, ...otherEdges];

const FORMAT_BY_ID = new Map(FORMATS.map((f) => [f.id, f]));

export function getFormat(id: FormatId): Format | undefined {
  return FORMAT_BY_ID.get(id);
}

export function edgesFrom(id: FormatId): readonly ConversionEdge[] {
  return EDGES.filter((e) => e.from === id);
}
