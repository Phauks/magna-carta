// Maps Magika's content-type label to a display label and the canonical filename extension(s) for that
// type. Magika's labels are the source of truth for detection; this table only adds the human label and
// the extension(s) we treat as "correct" for the recommendation. Keep entries to the types a firm
// actually handles; an unmapped label degrades gracefully (raw label, no recommendation).
interface LabelEntry {
  readonly human: string;
  readonly extensions: readonly string[];
}

const LABELS: Readonly<Record<string, LabelEntry>> = {
  pdf: { human: "PDF document", extensions: ["pdf"] },
  docx: { human: "Word document (OOXML)", extensions: ["docx"] },
  xlsx: { human: "Excel workbook (OOXML)", extensions: ["xlsx"] },
  pptx: { human: "PowerPoint deck (OOXML)", extensions: ["pptx"] },
  doc: { human: "Word document (legacy OLE)", extensions: ["doc"] },
  xls: { human: "Excel workbook (legacy OLE)", extensions: ["xls"] },
  ppt: { human: "PowerPoint deck (legacy OLE)", extensions: ["ppt"] },
  rtf: { human: "Rich Text Format document", extensions: ["rtf"] },
  jpeg: { human: "JPEG image", extensions: ["jpg", "jpeg"] },
  png: { human: "PNG image", extensions: ["png"] },
  gif: { human: "GIF image", extensions: ["gif"] },
  tiff: { human: "TIFF image", extensions: ["tif", "tiff"] },
  bmp: { human: "Bitmap image", extensions: ["bmp"] },
  webp: { human: "WebP image", extensions: ["webp"] },
  heif: { human: "HEIF/HEIC image", extensions: ["heic", "heif"] },
  zip: { human: "ZIP archive", extensions: ["zip"] },
  sevenzip: { human: "7-Zip archive", extensions: ["7z"] },
  rar: { human: "RAR archive", extensions: ["rar"] },
  gzip: { human: "gzip archive", extensions: ["gz"] },
  tar: { human: "tar archive", extensions: ["tar"] },
  txt: { human: "Plain text", extensions: ["txt"] },
  csv: { human: "CSV text", extensions: ["csv"] },
  json: { human: "JSON text", extensions: ["json"] },
  xml: { human: "XML text", extensions: ["xml"] },
  html: { human: "HTML document", extensions: ["html", "htm"] },
  markdown: { human: "Markdown text", extensions: ["md"] },
  python: { human: "Python source", extensions: ["py"] },
  javascript: { human: "JavaScript source", extensions: ["js"] },
  typescript: { human: "TypeScript source", extensions: ["ts"] },
  pe: { human: "Windows executable (PE)", extensions: ["exe", "dll"] },
  elf: { human: "Linux executable (ELF)", extensions: ["elf"] },
  macho: { human: "macOS executable (Mach-O)", extensions: [] },
};

export function humanLabel(label: string): string {
  return LABELS[label]?.human ?? label;
}

export function canonicalExtensions(label: string): readonly string[] {
  return LABELS[label]?.extensions ?? [];
}
