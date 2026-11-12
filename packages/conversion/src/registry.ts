import type { ConversionEdge, Format, FormatId } from "./format.ts";

export const FORMATS: readonly Format[] = [
  { id: "png", label: "PNG", mediaType: "image/png", extensions: ["png"] },
  { id: "jpeg", label: "JPEG", mediaType: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { id: "webp", label: "WebP", mediaType: "image/webp", extensions: ["webp"] },
  { id: "tiff", label: "TIFF", mediaType: "image/tiff", extensions: ["tif", "tiff"] },
  { id: "gif", label: "GIF", mediaType: "image/gif", extensions: ["gif"] },
  { id: "bmp", label: "BMP", mediaType: "image/bmp", extensions: ["bmp"] },
  {
    id: "docx",
    label: "Word (DOCX)",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
  },
  {
    id: "xlsx",
    label: "Excel (XLSX)",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: ["xlsx"],
  },
  {
    id: "pptx",
    label: "PowerPoint (PPTX)",
    mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extensions: ["pptx"],
  },
  // The legacy binary office formats. They are SOURCES ONLY — there is an edge out of each and none
  // back in, because writing a 1997 binary format is not something anybody should be helped to do,
  // and the reason these are here at all is that a production received from another party is full of
  // them and nothing memory-safe reads them.
  {
    id: "doc",
    label: "Word 97-2003 (DOC)",
    mediaType: "application/msword",
    extensions: ["doc"],
  },
  {
    id: "xls",
    label: "Excel 97-2003 (XLS)",
    mediaType: "application/vnd.ms-excel",
    extensions: ["xls"],
  },
  {
    id: "ppt",
    label: "PowerPoint 97-2003 (PPT)",
    mediaType: "application/vnd.ms-powerpoint",
    extensions: ["ppt"],
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
  // A searchable PDF is a PDF (same media type and extension) that carries a recognized text layer.
  // It is a distinct format node rather than a pdf->pdf edge because a conversion target must differ
  // from its source: pathfinding treats from===to as "no path", and "make this searchable" is a real,
  // selectable target a user asks for.
  {
    id: "searchable-pdf",
    label: "Searchable PDF",
    mediaType: "application/pdf",
    extensions: ["pdf"],
  },
  { id: "eml", label: "Email (EML)", mediaType: "message/rfc822", extensions: ["eml"] },
  {
    id: "msg",
    label: "Outlook (MSG)",
    mediaType: "application/vnd.ms-outlook",
    extensions: ["msg"],
  },
  { id: "mp4", label: "MP4", mediaType: "video/mp4", extensions: ["mp4"] },
  { id: "mov", label: "QuickTime", mediaType: "video/quicktime", extensions: ["mov"] },
  { id: "mkv", label: "Matroska", mediaType: "video/x-matroska", extensions: ["mkv"] },
  { id: "webm", label: "WebM", mediaType: "video/webm", extensions: ["webm"] },
  // A playable MP4 is an MP4 (same media type and extension) that every browser plays: H.264 video,
  // AAC sound, the movie header first. It is a distinct node rather than an mp4->mp4 edge because an
  // HEVC phone video is already an MP4, pathfinding treats from===to as "no path", and "make this
  // play here" is a real request. Ordered after mp4 so detection still names an .mp4 file mp4.
  {
    id: "playable-mp4",
    label: "Playable MP4",
    mediaType: "video/mp4",
    extensions: ["mp4"],
  },
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

// image-pdf edges: raster images to PDF via the raster Container's image-to-PDF path (server-only;
// the browser wasm path cannot write PDF). bmp is included here though not in the libvips raster
// interconversion set — the raster Container handles it via the same route.
const IMAGE_PDF_SOURCES: readonly FormatId[] = ["png", "jpeg", "webp", "tiff", "gif", "bmp"];
const imagePdfEdges: ConversionEdge[] = [];
for (const from of IMAGE_PDF_SOURCES) {
  imagePdfEdges.push({ from, to: "pdf", engineId: "image-pdf", recipeRef: "image-pdf", weight: 1 });
}

// LibreOffice office edges (deferred bodies). wpd->odt and odt->pdf together let pathfinding chain
// wpd->pdf with no direct edge.
const officeEdges: readonly ConversionEdge[] = [
  { from: "docx", to: "pdf", engineId: "libreoffice", recipeRef: "pdf", weight: 1 },
  { from: "odt", to: "pdf", engineId: "libreoffice", recipeRef: "pdf", weight: 1 },
  { from: "docx", to: "odt", engineId: "libreoffice", recipeRef: "odt", weight: 1 },
  { from: "wpd", to: "odt", engineId: "libreoffice", recipeRef: "odt", weight: 1 },
  // Legacy binary to its modern equivalent. This is the ONLY route the platform has into a 1997
  // binary office file: no memory-safe parser for them exists at usable fidelity, so the consented,
  // network-isolated office container is the whole answer, and these three edges are what make a
  // legacy document readable — by the file converter a member drives, and by the discovery
  // extraction router, which converts and then reads the conversion with its own pure-Rust engine.
  { from: "doc", to: "docx", engineId: "libreoffice", recipeRef: "docx", weight: 1 },
  { from: "xls", to: "xlsx", engineId: "libreoffice", recipeRef: "xlsx", weight: 1 },
  { from: "ppt", to: "pptx", engineId: "libreoffice", recipeRef: "pptx", weight: 1 },
  // The modern packages onward to PDF, so pathfinding can chain doc->docx->pdf and a member asking
  // for a PDF of a legacy document gets one hop-chain rather than a dead end.
  { from: "xlsx", to: "pdf", engineId: "libreoffice", recipeRef: "pdf", weight: 1 },
  { from: "pptx", to: "pdf", engineId: "libreoffice", recipeRef: "pdf", weight: 1 },
];

// email->PDF (deferred).
const otherEdges: readonly ConversionEdge[] = [
  { from: "eml", to: "pdf", engineId: "email", recipeRef: "pdf", weight: 1 },
  { from: "msg", to: "pdf", engineId: "email", recipeRef: "pdf", weight: 1 },
];

// Video into an MP4 every browser plays, through the pure-Rust transcode engine. The sources are the
// containers it reads (MP4, QuickTime, Matroska) carrying H.264 or HEVC; the engine refuses any other
// codec inside them. WebM has no edge: its VP8, VP9 and AV1 video has no Rust decoder in the engine.
const transcodeEdges: readonly ConversionEdge[] = [
  ...(["mp4", "mov", "mkv"] as const).map((from) => ({
    from,
    to: "playable-mp4",
    engineId: "transcode" as const,
    recipeRef: "mp4-h264-aac-faststart",
    weight: 1,
  })),
  ...(["mov", "mkv"] as const).map((from) => ({
    from,
    to: "mp4",
    engineId: "transcode" as const,
    recipeRef: "mp4-h264-aac-faststart",
    weight: 1,
  })),
];

// pdf -> searchable-pdf via the OCR engine: recognize the scanned pages and write an invisible text
// layer, leaving a page that already has text untouched. The engine ignores the recipe (the request
// is just the PDF bytes), but every edge names one, so this records what the hop does.
const ocrEdges: readonly ConversionEdge[] = [
  {
    from: "pdf",
    to: "searchable-pdf",
    engineId: "ocr",
    recipeRef: "searchable-text-layer",
    weight: 1,
  },
];

export const EDGES: readonly ConversionEdge[] = [
  ...rasterEdges,
  ...imagePdfEdges,
  ...officeEdges,
  ...otherEdges,
  ...transcodeEdges,
  ...ocrEdges,
];

const FORMAT_BY_ID = new Map(FORMATS.map((f) => [f.id, f]));

export function getFormat(id: FormatId): Format | undefined {
  return FORMAT_BY_ID.get(id);
}

export function edgesFrom(id: FormatId): readonly ConversionEdge[] {
  return EDGES.filter((e) => e.from === id);
}
