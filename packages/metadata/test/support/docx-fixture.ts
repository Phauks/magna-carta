import { strToU8, zipSync } from "fflate";

export interface DocxParts {
  contentTypes: string;
  rels: string;
  documentRels: string;
  document: string;
  core: string;
  app: string;
  custom?: string;
  comments?: string;
  header?: string;
  settings?: string;
  styles?: string;
  // Any further part, keyed by its full OPC part name (e.g. "docProps/thumbnail.jpeg").
  extra?: Record<string, string | Uint8Array>;
}

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const DEFAULTS: DocxParts = {
  contentTypes: `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  rels: `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  documentRels: `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  document: `${DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Visible body text.</w:t></w:r></w:p></w:body></w:document>`,
  core: `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:creator>Jane Author</dc:creator><cp:lastModifiedBy>Bob Reviewer</cp:lastModifiedBy><cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">2020-01-01T00:00:00Z</dcterms:created></cp:coreProperties>`,
  app: `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Old Firm LLP</Company><Template>Normal.dotm</Template><TotalTime>120</TotalTime></Properties>`,
};

// Assemble a minimal but structurally valid .docx for tests. Override any part to craft a scenario.
export function buildDocx(overrides: Partial<DocxParts> = {}): Uint8Array {
  const parts = { ...DEFAULTS, ...overrides };
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(parts.contentTypes),
    "_rels/.rels": strToU8(parts.rels),
    "word/_rels/document.xml.rels": strToU8(parts.documentRels),
    "word/document.xml": strToU8(parts.document),
    "docProps/core.xml": strToU8(parts.core),
    "docProps/app.xml": strToU8(parts.app),
  };
  if (parts.custom !== undefined) files["docProps/custom.xml"] = strToU8(parts.custom);
  if (parts.comments !== undefined) files["word/comments.xml"] = strToU8(parts.comments);
  if (parts.header !== undefined) files["word/header1.xml"] = strToU8(parts.header);
  if (parts.settings !== undefined) files["word/settings.xml"] = strToU8(parts.settings);
  if (parts.styles !== undefined) files["word/styles.xml"] = strToU8(parts.styles);
  for (const [name, content] of Object.entries(parts.extra ?? {})) {
    files[name] = typeof content === "string" ? strToU8(content) : content;
  }
  return zipSync(files);
}
