import { describe, expect, it } from "vitest";
import { detectMacroParts, macroResidue, stripMacros } from "../src/macros.ts";
import { readPackage, readPartText, writePackage, type PartMap } from "../src/ooxml/package.ts";
import {
  buildDocx,
  documentXml,
  MAIN_DOCUMENT_CONTENT_TYPE,
  paragraphOfRuns,
  VBA_PROJECT_BYTES,
  type DocxParts,
} from "./support/docx-fixture.ts";

// This is security-boundary code, so the cases here are adversarial rather than illustrative: a macro
// payload under an unexpected name, one declared only through the content-types map, one reachable only
// through a relationship, a package that claims to be a plain .docx while carrying a VBA project, and a
// stripped output that must be REFUSED if any residue survives. Name-only detection passes several of
// these, which is exactly why detection is driven by the declarations rather than the file names.

const CONTENT_TYPES_HEADER =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const RELATIONSHIPS_HEADER =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

function partsOf(overrides: DocxParts): PartMap {
  const read = readPackage(buildDocx(overrides));
  if (!read.ok) throw new Error(`fixture unreadable: ${read.reason}`);
  return read.value;
}

// A package whose VBA project sits at the conventional name and is declared and related the usual way —
// the honest macro-enabled document a firm migrating from an older system actually has.
function conventionalMacroPackage(): DocxParts {
  return {
    contentTypes:
      `${DECLARATION}${CONTENT_TYPES_HEADER}` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>' +
      '<Override PartName="/word/vbaData.xml" ContentType="application/vnd.ms-word.vbaData+xml"/>' +
      "</Types>",
    documentRels:
      `${DECLARATION}${RELATIONSHIPS_HEADER}` +
      '<Relationship Id="rId5" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>' +
      "</Relationships>",
    document: documentXml(paragraphOfRuns("Letter for {{client.displayName}}.")),
    extra: {
      "word/vbaProject.bin": VBA_PROJECT_BYTES,
      "word/vbaData.xml": `${DECLARATION}<wne:vbaSuppData xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"/>`,
    },
  };
}

describe("macro detection", () => {
  it("finds the conventional VBA project and its Word-side data part", () => {
    expect([...detectMacroParts(partsOf(conventionalMacroPackage()))].sort()).toEqual([
      "word/vbaData.xml",
      "word/vbaProject.bin",
    ]);
  });

  it("finds a macro payload hidden under an innocuous part name, via the content-types Override", () => {
    // The adversarial case name-only detection misses entirely: the project is called
    // word/embeddings/printerSettings.bin, which reads as an ordinary embedded object.
    const parts = partsOf({
      contentTypes:
        `${DECLARATION}${CONTENT_TYPES_HEADER}` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${MAIN_DOCUMENT_CONTENT_TYPE}"/>` +
        '<Override PartName="/word/embeddings/printerSettings.bin" ContentType="application/vnd.ms-office.vbaProject"/>' +
        "</Types>",
      extra: { "word/embeddings/printerSettings.bin": VBA_PROJECT_BYTES },
    });
    expect([...detectMacroParts(parts)]).toEqual(["word/embeddings/printerSettings.bin"]);
  });

  it("finds a macro payload reachable only through a relationship of a macro type", () => {
    // Declared with a harmless content type and named innocuously; only the relationship gives it away.
    const parts = partsOf({
      contentTypes:
        `${DECLARATION}${CONTENT_TYPES_HEADER}` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="dat" ContentType="application/octet-stream"/>' +
        `<Override PartName="/word/document.xml" ContentType="${MAIN_DOCUMENT_CONTENT_TYPE}"/>` +
        "</Types>",
      documentRels:
        `${DECLARATION}${RELATIONSHIPS_HEADER}` +
        '<Relationship Id="rId7" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="../word/assets/theme.dat"/>' +
        "</Relationships>",
      extra: { "word/assets/theme.dat": VBA_PROJECT_BYTES },
    });
    expect([...detectMacroParts(parts)]).toEqual(["word/assets/theme.dat"]);
  });

  it("finds a macro payload in a package that otherwise claims to be a plain document", () => {
    // The main part declares the macro-free content type — the package "is a .docx" by every surface
    // check — and it carries a VBA project anyway.
    const parts = partsOf({
      extra: { "word/vbaProject.bin": VBA_PROJECT_BYTES },
    });
    expect([...detectMacroParts(parts)]).toEqual(["word/vbaProject.bin"]);
  });

  it("does not mistake an ordinary embedded object for a macro payload", () => {
    const parts = partsOf({
      contentTypes:
        `${DECLARATION}${CONTENT_TYPES_HEADER}` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>' +
        `<Override PartName="/word/document.xml" ContentType="${MAIN_DOCUMENT_CONTENT_TYPE}"/>` +
        "</Types>",
      extra: { "word/embeddings/oleObject1.bin": VBA_PROJECT_BYTES },
    });
    expect([...detectMacroParts(parts)]).toEqual([]);
  });
});

describe("macro stripping", () => {
  it("removes the payload, its content-type declarations, and its relationships", () => {
    const stripped = stripMacros(partsOf(conventionalMacroPackage()));
    expect(stripped.removedParts).toEqual(["word/vbaData.xml", "word/vbaProject.bin"]);
    expect(stripped.parts.has("word/vbaProject.bin")).toBe(false);
    expect(stripped.parts.has("word/vbaData.xml")).toBe(false);
    const contentTypes = readPartText(stripped.parts, "[Content_Types].xml") ?? "";
    expect(contentTypes).not.toContain("vbaProject");
    expect(contentTypes).not.toContain("vbaData");
    const documentRels = readPartText(stripped.parts, "word/_rels/document.xml.rels") ?? "";
    expect(documentRels).not.toContain("vbaProject");
  });

  it("demotes a macro-enabled main-document declaration to its macro-free equivalent", () => {
    const stripped = stripMacros(partsOf(conventionalMacroPackage()));
    const contentTypes = readPartText(stripped.parts, "[Content_Types].xml") ?? "";
    expect(contentTypes).not.toContain("macroEnabled");
    expect(contentTypes).toContain(MAIN_DOCUMENT_CONTENT_TYPE);
  });

  it("keeps the document's own content intact", () => {
    const stripped = stripMacros(partsOf(conventionalMacroPackage()));
    expect(readPartText(stripped.parts, "word/document.xml") ?? "").toContain(
      "{{client.displayName}}",
    );
  });

  it("keeps a Default extension a surviving part still needs", () => {
    // A .bin Default that also describes a printer-settings part must survive the removal of a .bin
    // macro payload, or every remaining .bin part becomes undeclared and the package invalid.
    const parts = partsOf({
      contentTypes:
        `${DECLARATION}${CONTENT_TYPES_HEADER}` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>' +
        `<Override PartName="/word/document.xml" ContentType="${MAIN_DOCUMENT_CONTENT_TYPE}"/>` +
        "</Types>",
      extra: {
        "word/vbaProject.bin": VBA_PROJECT_BYTES,
        "word/embeddings/oleObject1.bin": VBA_PROJECT_BYTES,
      },
    });
    const stripped = stripMacros(parts);
    expect(stripped.removedParts).toEqual(["word/vbaProject.bin"]);
    expect(readPartText(stripped.parts, "[Content_Types].xml") ?? "").toContain('Extension="bin"');
  });

  it("leaves an external hyperlink alone even when its URL ends in a removed part's name", () => {
    // Matching a relationship by target FILENAME rather than by resolved target would drop this one and
    // leave a dangling r:id, which makes a reader declare the document damaged.
    const parts = partsOf({
      ...conventionalMacroPackage(),
      documentRels:
        `${DECLARATION}${RELATIONSHIPS_HEADER}` +
        '<Relationship Id="rId5" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>' +
        '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test/downloads/vbaProject.bin" TargetMode="External"/>' +
        "</Relationships>",
    });
    const stripped = stripMacros(parts);
    const documentRels = readPartText(stripped.parts, "word/_rels/document.xml.rels") ?? "";
    expect(documentRels).toContain("rId6");
    expect(documentRels).not.toContain("rId5");
  });

  it("is a no-op on a package that never carried a macro", () => {
    const parts = partsOf({});
    const stripped = stripMacros(parts);
    expect(stripped.removedParts).toEqual([]);
    expect([...stripped.parts.keys()].sort()).toEqual([...parts.keys()].sort());
  });
});

describe("the macro re-verification gate", () => {
  it("reports a clean package as clean", () => {
    expect(macroResidue(partsOf({}))).toEqual([]);
  });

  it("reports the stripped output of every adversarial package as clean", () => {
    for (const overrides of [
      conventionalMacroPackage(),
      { extra: { "word/vbaProject.bin": VBA_PROJECT_BYTES } },
    ]) {
      const stripped = stripMacros(partsOf(overrides));
      const reread = readPackage(writePackage(stripped.parts));
      expect(reread.ok).toBe(true);
      if (!reread.ok) continue;
      expect(macroResidue(reread.value)).toEqual([]);
    }
  });

  it("REFUSES a package whose macro part survived removal", () => {
    // The gate's whole reason to exist: an independent scan over the bytes that would be stored,
    // rather than the stripper's own assertion that it succeeded.
    const stripped = stripMacros(partsOf(conventionalMacroPackage()));
    stripped.parts.set("word/vbaProject.bin", VBA_PROJECT_BYTES);
    expect(macroResidue(stripped.parts)).toContainEqual({
      kind: "part",
      detail: "word/vbaProject.bin",
    });
  });

  it("REFUSES a package that still declares the macro-enabled main-document content type", () => {
    const parts = partsOf({
      contentTypes:
        `${DECLARATION}${CONTENT_TYPES_HEADER}` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>' +
        "</Types>",
    });
    expect(macroResidue(parts).map((finding) => finding.kind)).toContain(
      "macro-enabled-declaration",
    );
  });

  it("REFUSES a package that still carries a macro relationship, even with no payload behind it", () => {
    const parts = partsOf({
      documentRels:
        `${DECLARATION}${RELATIONSHIPS_HEADER}` +
        '<Relationship Id="rId5" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>' +
        "</Relationships>",
    });
    expect(macroResidue(parts).map((finding) => finding.kind)).toContain("relationship");
  });

  it("REFUSES a package that declares a content type for a part it no longer contains", () => {
    const parts = partsOf({
      contentTypes:
        `${DECLARATION}${CONTENT_TYPES_HEADER}` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${MAIN_DOCUMENT_CONTENT_TYPE}"/>` +
        '<Override PartName="/word/glossary/document.xml" ContentType="application/xml"/>' +
        "</Types>",
    });
    expect(macroResidue(parts).map((finding) => finding.detail)).toContain(
      "Override for absent part word/glossary/document.xml",
    );
  });
});
