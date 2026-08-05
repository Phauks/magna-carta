import { strToU8, zipSync } from "fflate";

// Hermetic `.docx` fixtures, built programmatically so a test can craft the exact awkward shape it is
// about — a placeholder split across five runs, a merge field, a macro payload hidden under an
// innocuous part name — without a committed binary nobody can read in review.

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export const WORD_NAMESPACE =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export const MAIN_DOCUMENT_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

export interface DocxParts {
  contentTypes?: string;
  rels?: string;
  documentRels?: string;
  document?: string;
  core?: string;
  app?: string;
  header?: string;
  footer?: string;
  footnotes?: string;
  // Any further part, keyed by its full Open Packaging Conventions part name.
  extra?: Record<string, string | Uint8Array>;
  // Parts to omit entirely, so a test can build a deliberately broken package.
  omit?: readonly string[];
}

// One paragraph whose text is split into the given run fragments — the shape Word produces when a
// spellcheck mark, a language change, or a revision identifier lands mid-word.
export function paragraphOfRuns(...fragments: readonly string[]): string {
  const runs = fragments
    .map((fragment) => `<w:r><w:t xml:space="preserve">${fragment}</w:t></w:r>`)
    .join("");
  return `<w:p>${runs}</w:p>`;
}

export function documentXml(...paragraphs: readonly string[]): string {
  return `${DECLARATION}<w:document ${WORD_NAMESPACE}><w:body>${paragraphs.join("")}</w:body></w:document>`;
}

export function headerXml(...paragraphs: readonly string[]): string {
  return `${DECLARATION}<w:hdr ${WORD_NAMESPACE}>${paragraphs.join("")}</w:hdr>`;
}

export function footerXml(...paragraphs: readonly string[]): string {
  return `${DECLARATION}<w:ftr ${WORD_NAMESPACE}>${paragraphs.join("")}</w:ftr>`;
}

export function footnotesXml(...paragraphs: readonly string[]): string {
  return `${DECLARATION}<w:footnotes ${WORD_NAMESPACE}><w:footnote w:id="1">${paragraphs.join("")}</w:footnote></w:footnotes>`;
}

// The complex-field shape Word writes for an inserted merge field: begin, instruction (itself split
// across runs, which is what Word actually does for a long field code), separate, cached result, end.
export function complexMergeFieldParagraph(
  fieldName: string,
  cachedResult = `«${fieldName}»`,
): string {
  const half = Math.ceil(fieldName.length / 2);
  return (
    "<w:p>" +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> MERGEFIELD  ${fieldName.slice(0, half)}</w:instrText></w:r>` +
    `<w:r><w:instrText xml:space="preserve">${fieldName.slice(half)}  \\* MERGEFORMAT </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    `<w:r><w:rPr><w:b/></w:rPr><w:t>${cachedResult}</w:t></w:r>` +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    "</w:p>"
  );
}

export function simpleMergeFieldParagraph(fieldName: string): string {
  return (
    `<w:p><w:fldSimple w:instr=" MERGEFIELD  ${fieldName}  \\* MERGEFORMAT ">` +
    `<w:r><w:t>«${fieldName}»</w:t></w:r>` +
    "</w:fldSimple></w:p>"
  );
}

const DEFAULT_CONTENT_TYPES = `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${MAIN_DOCUMENT_CONTENT_TYPE}"/></Types>`;

const DEFAULT_RELS = `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DEFAULT_DOCUMENT_RELS = `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

const DEFAULT_CORE = `${DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Template Author</dc:creator></cp:coreProperties>`;

const DEFAULT_APP = `${DECLARATION}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Example Firm</Company></Properties>`;

// Assemble a minimal but structurally valid `.docx`. Override any part to craft a scenario.
export function buildDocx(overrides: DocxParts = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(overrides.contentTypes ?? DEFAULT_CONTENT_TYPES),
    "_rels/.rels": strToU8(overrides.rels ?? DEFAULT_RELS),
    "word/_rels/document.xml.rels": strToU8(overrides.documentRels ?? DEFAULT_DOCUMENT_RELS),
    "word/document.xml": strToU8(
      overrides.document ?? documentXml(paragraphOfRuns("A template with no placeholders at all.")),
    ),
    "docProps/core.xml": strToU8(overrides.core ?? DEFAULT_CORE),
    "docProps/app.xml": strToU8(overrides.app ?? DEFAULT_APP),
  };
  if (overrides.header !== undefined) files["word/header1.xml"] = strToU8(overrides.header);
  if (overrides.footer !== undefined) files["word/footer1.xml"] = strToU8(overrides.footer);
  if (overrides.footnotes !== undefined) files["word/footnotes.xml"] = strToU8(overrides.footnotes);
  for (const [name, content] of Object.entries(overrides.extra ?? {})) {
    files[name] = typeof content === "string" ? strToU8(content) : content;
  }
  for (const name of overrides.omit ?? []) delete files[name];
  return zipSync(files);
}

// A stand-in VBA project payload. The bytes do not matter to any code path under test — every check is
// on the package's declarations and part set — so this is a marker rather than a real project.
export const VBA_PROJECT_BYTES: Uint8Array = strToU8("stand-in vbaProject payload");
