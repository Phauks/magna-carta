import { describe, expect, it } from "vitest";
import {
  ALLOWED_LICENSE_IDENTIFIERS,
  classifyLicense,
  expressionPermissive,
  runLicensePolicySelfTest,
} from "./index.mjs";

const verdict = (license, exceptions) => classifyLicense("package", "1.0.0", license, exceptions);

describe("the policy's own self-test", () => {
  it("passes, which is what both gates run before they scan", () => {
    expect(() => runLicensePolicySelfTest()).not.toThrow();
  });
});

describe("single identifiers", () => {
  it("permits the permissive set", () => {
    for (const license of ["MIT", "Apache-2.0", "ISC", "BSD-3-Clause", "0BSD", "Zlib"]) {
      expect(verdict(license).allowed, license).toBe(true);
    }
  });

  it("permits weak copyleft, which a proprietary service may link", () => {
    for (const license of ["MPL-2.0", "LGPL-2.1", "LGPL-3.0-or-later"]) {
      expect(verdict(license).allowed, license).toBe(true);
    }
  });

  it("denies the network copyleft the gate exists for", () => {
    for (const license of ["AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later", "SSPL-1.0"]) {
      expect(verdict(license).allowed, license).toBe(false);
    }
  });

  it("denies strong copyleft and anything not on the list", () => {
    for (const license of ["GPL-2.0", "GPL-3.0-or-later", "Frobnicate-1.0", "Limited W3 License"]) {
      expect(verdict(license).allowed, license).toBe(false);
    }
  });

  it("reads identifiers case-insensitively, as the SPDX grammar requires", () => {
    expect(verdict("mit").allowed).toBe(true);
    expect(verdict("apache-2.0").allowed).toBe(true);
    expect(verdict("agpl-3.0").allowed).toBe(false);
  });

  it("reads a trailing + as the base version, the strictest reading of 'or later'", () => {
    expect(verdict("LGPL-2.1+").allowed).toBe(true);
    expect(verdict("GPL-2.0+").allowed).toBe(false);
  });
});

describe("expressions", () => {
  it("takes a permissive disjunct out of an OR", () => {
    expect(verdict("MIT OR GPL-2.0").allowed).toBe(true);
    expect(verdict("(MIT OR GPL-2.0)").allowed).toBe(true);
    expect(verdict("GPL-2.0 OR LGPL-2.1").allowed).toBe(true);
  });

  it("denies an OR whose every operand is denied", () => {
    expect(verdict("AGPL-3.0 OR SSPL-1.0").allowed).toBe(false);
  });

  it("requires every operand of an AND", () => {
    expect(verdict("Apache-2.0 AND MIT").allowed).toBe(true);
    expect(verdict("MIT AND GPL-3.0").allowed).toBe(false);
    expect(verdict("MIT AND BSD-3-Clause").allowed).toBe(true);
  });

  it("binds AND tighter than OR", () => {
    expect(expressionPermissive("MIT OR GPL-3.0 AND AGPL-3.0")).toBe(true);
    expect(expressionPermissive("AGPL-3.0 AND GPL-3.0 OR MIT")).toBe(true);
  });

  it("honours parentheses instead of stripping them", () => {
    // Stripping the parentheses re-associates this into "MIT OR (GPL-3.0 AND AGPL-3.0)" and passes a
    // crate whose terms include the AGPL. The conjunct binds whichever disjunct is chosen.
    expect(expressionPermissive("(MIT OR GPL-3.0) AND AGPL-3.0")).toBe(false);
    expect(expressionPermissive("(MIT OR Apache-2.0) AND Unicode-3.0")).toBe(true);
    expect(expressionPermissive("(Apache-2.0 OR MIT) AND BSD-3-Clause")).toBe(true);
  });

  it("judges a WITH clause by its base license, never by the exception", () => {
    expect(verdict("Apache-2.0 WITH LLVM-exception").allowed).toBe(true);
    expect(verdict("Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT").allowed).toBe(true);
    // An exception only grants permissions on top of the base; it cannot make a denied base permitted.
    expect(verdict("GPL-2.0 WITH Classpath-exception-2.0").allowed).toBe(false);
    expect(verdict("AGPL-3.0 WITH Autoconf-exception-3.0").allowed).toBe(false);
  });

  it("reads the legacy slash form as OR", () => {
    expect(verdict("MIT/Apache-2.0").allowed).toBe(true);
    expect(verdict("Apache-2.0 / MIT / MPL-2.0").allowed).toBe(true);
    expect(verdict("Unlicense/MIT").allowed).toBe(true);
    expect(verdict("AGPL-3.0/SSPL-1.0").allowed).toBe(false);
  });

  it("does not mistake the lower-case 'or' inside an identifier for an operator", () => {
    // If "or" were an operator, "LGPL-3.0-or-later AND AGPL-3.0" would parse as a permitted OR.
    expect(expressionPermissive("LGPL-3.0-or-later AND AGPL-3.0")).toBe(false);
    expect(expressionPermissive("LGPL-3.0-or-later")).toBe(true);
    expect(expressionPermissive("MIT and AGPL-3.0")).toBe(false);
  });
});

describe("what cannot be read is not permitted", () => {
  it("denies a missing, empty or unresolvable license", () => {
    for (const license of [null, undefined, "", "   ", "UNLICENSED", "unknown", "UNKNOWN"]) {
      expect(verdict(license).allowed, String(license)).toBe(false);
    }
  });

  it("denies a malformed expression rather than guessing at it", () => {
    for (const license of ["(MIT OR Apache-2.0", "MIT)", "MIT AND", "OR MIT", "MIT WITH"]) {
      expect(verdict(license).allowed, license).toBe(false);
    }
  });

  it("says why, so a finding can be acted on — without repeating the license the gate prints", () => {
    expect(verdict("AGPL-3.0").reason).toBe("not on the permissive allowlist");
    expect(verdict(null).reason).toContain("review required");
    expect(verdict("MIT").reason).toBe("MIT");
  });
});

describe("reviewed exceptions", () => {
  it("are keyed by name@version and honoured", () => {
    const exceptions = new Map([["package@1.0.0", "vendor confirmed the terms in writing"]]);
    expect(verdict("AGPL-3.0", exceptions).allowed).toBe(true);
    expect(classifyLicense("package", "2.0.0", "AGPL-3.0", exceptions).allowed).toBe(false);
  });
});

describe("the allowlist", () => {
  it("contains no copyleft the policy exists to deny", () => {
    for (const identifier of ALLOWED_LICENSE_IDENTIFIERS) {
      expect(identifier.startsWith("AGPL"), identifier).toBe(false);
      expect(identifier.startsWith("SSPL"), identifier).toBe(false);
      expect(identifier.startsWith("GPL-"), identifier).toBe(false);
    }
  });
});
