import { describe, expect, it } from "vitest";
import { disambiguate, sanitizeArchivePath } from "../src/bundle-paths.ts";

describe("disambiguate", () => {
  it("suffixes a counter before the extension on collision", () => {
    const taken = new Set<string>();
    expect(disambiguate("a/report.pdf", taken)).toBe("a/report.pdf");
    expect(disambiguate("a/report.pdf", taken)).toBe("a/report (1).pdf");
    expect(disambiguate("a/report.pdf", taken)).toBe("a/report (2).pdf");
  });
});

describe("sanitizeArchivePath", () => {
  it("replaces Windows-reserved characters per segment, keeping separators", () => {
    expect(sanitizeArchivePath('a/b<c>:d"e|f?g*h.txt')).toBe("a/b_c__d_e_f_g_h.txt");
  });
  it("strips a trailing dot or space on a segment (Windows refuses them)", () => {
    expect(sanitizeArchivePath("folder /name.")).toBe("folder/name");
  });
  it("renames a reserved device name", () => {
    expect(sanitizeArchivePath("CON/x.txt")).toBe("_CON/x.txt");
  });
});
