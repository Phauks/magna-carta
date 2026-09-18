import { extensionsOfCategory } from "@magna-carta/design-system/file-icon";
import { describe, expect, it } from "vitest";
import {
  familiesOpenedBy,
  FILE_TYPE_FAMILIES,
  officeEditorOpens,
  OPEN_METHODS,
  openMethodOfCategory,
} from "../src/lib/documents/file-type-register.ts";

/*
 * The register is one object read two ways — the file manager decides Open from it and the
 * settings screen lists it — so what these hold is that it is fit to be read either way: every
 * extension appears once and in the shape a name resolves to, every family opens a way the screen
 * can name, and the families the platform reads itself list exactly what the file-type table knows.
 */

describe("FILE_TYPE_FAMILIES", () => {
  it("lists every extension once, lowercase, without a dot, and sorted within its family", () => {
    const seen = new Map<string, string>();
    for (const family of FILE_TYPE_FAMILIES) {
      expect(family.extensions).toEqual([...family.extensions].sort());
      for (const extension of family.extensions) {
        expect(extension).toMatch(/^[0-9a-z]+$/);
        expect(
          seen.get(extension),
          `${extension} is listed by both ${seen.get(extension) ?? ""} and ${family.id}`,
        ).toBeUndefined();
        seen.set(extension, family.id);
      }
    }
  });

  it("opens every family a way the screen can name, and names every way at least once", () => {
    const methods = new Set(OPEN_METHODS.map((method) => method.id));
    for (const family of FILE_TYPE_FAMILIES) expect(methods.has(family.method)).toBe(true);
    for (const method of OPEN_METHODS) {
      expect(familiesOpenedBy(method.id).length, method.id).toBeGreaterThan(0);
    }
  });

  it("gives the editor the office formats and keeps plain text for the text editor", () => {
    for (const extension of [
      "docx",
      "doc",
      "odt",
      "rtf",
      "xlsx",
      "xls",
      "ods",
      "csv",
      "pptx",
      "ppt",
      "odp",
      "key",
      "numbers",
      "pages",
      "vsdx",
      "wpd",
    ]) {
      expect(officeEditorOpens(extension), extension).toBe(true);
    }
    // Collabora opens plain text too; the platform's own editor is the register's answer for it.
    expect(officeEditorOpens("txt")).toBe(false);
    expect(familiesOpenedBy("text-editor").flatMap((family) => family.extensions)).toContain("txt");
    // Images and the portable document are read by the platform itself, never the container.
    for (const extension of ["png", "jpg", "svg", "pdf"]) {
      expect(officeEditorOpens(extension), extension).toBe(false);
    }
  });

  it("lists the platform-read families exactly as the file-type table knows them", () => {
    const byId = new Map(FILE_TYPE_FAMILIES.map((family) => [family.id, family]));
    expect(byId.get("pdf")?.extensions).toEqual(extensionsOfCategory("pdf"));
    expect(byId.get("images")?.extensions).toEqual(extensionsOfCategory("image"));
    expect(byId.get("archives")?.extensions).toEqual(extensionsOfCategory("archive"));
    expect(byId.get("text-and-code")?.extensions).toEqual(
      [...extensionsOfCategory("text"), ...extensionsOfCategory("code")].sort(),
    );
  });
});

describe("openMethodOfCategory", () => {
  it("answers every category the file-type table can resolve, and null only for unknown", () => {
    expect(openMethodOfCategory("word")).toBe("office-editor");
    expect(openMethodOfCategory("excel")).toBe("office-editor");
    expect(openMethodOfCategory("powerpoint")).toBe("office-editor");
    expect(openMethodOfCategory("text")).toBe("text-editor");
    expect(openMethodOfCategory("code")).toBe("text-editor");
    expect(openMethodOfCategory("pdf")).toBe("pdf-viewer");
    expect(openMethodOfCategory("image")).toBe("preview");
    expect(openMethodOfCategory("email")).toBe("preview");
    expect(openMethodOfCategory("archive")).toBe("archive");
    expect(openMethodOfCategory("program")).toBe("download");
    expect(openMethodOfCategory("unknown")).toBeNull();
  });
});
