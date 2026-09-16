import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  auditWorkspaces,
  classifyCargoPackage,
  discoverCargoManifests,
  formatFinding,
  isFirstPartyPackage,
} from "./cargo.mjs";

// A cargo metadata package, trimmed to the fields the gate reads. A registry crate carries a
// non-null `source`; a workspace member or path dependency carries null.
const crate = (name, version, license, extra = {}) => ({
  name,
  version,
  license,
  license_file: null,
  source: "registry+https://github.com/rust-lang/crates.io-index",
  ...extra,
});

const firstParty = (name) => crate(name, "0.1.0", null, { source: null });

describe("discoverCargoManifests", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "license-policy-cargo-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const manifest = (...segments) => {
    mkdirSync(join(root, ...segments), { recursive: true });
    writeFileSync(join(root, ...segments, "Cargo.toml"), "[package]\n");
  };

  it("finds the shared crates workspace and every container workspace", () => {
    manifest("crates");
    manifest("containers", "scan");
    manifest("containers", "search");
    expect(discoverCargoManifests(root)).toEqual([
      "crates/Cargo.toml",
      "containers/scan/Cargo.toml",
      "containers/search/Cargo.toml",
    ]);
  });

  it("picks up a newly added container without anyone editing a list", () => {
    manifest("crates");
    manifest("containers", "scan");
    manifest("containers", "brand-new");
    expect(discoverCargoManifests(root)).toContain("containers/brand-new/Cargo.toml");
  });

  it("ignores a container directory that holds no Cargo workspace", () => {
    manifest("crates");
    mkdirSync(join(root, "containers", "collabora"), { recursive: true });
    expect(discoverCargoManifests(root)).toEqual(["crates/Cargo.toml"]);
  });

  it("leaves out anything outside the shipped workspaces", () => {
    manifest("crates");
    manifest("spikes", "some-harness");
    expect(discoverCargoManifests(root)).toEqual(["crates/Cargo.toml"]);
  });

  it("returns nothing for a tree with no Cargo workspaces, so the gate can refuse to pass", () => {
    expect(discoverCargoManifests(root)).toEqual([]);
  });
});

describe("isFirstPartyPackage", () => {
  it("treats a null-source package as first-party, the way the npm gate treats @magna-carta/*", () => {
    expect(isFirstPartyPackage(firstParty("pdf-core"))).toBe(true);
    expect(isFirstPartyPackage(crate("serde", "1.0.0", "MIT OR Apache-2.0"))).toBe(false);
  });
});

describe("classifyCargoPackage", () => {
  it("permits a crate whose SPDX expression is permissive", () => {
    expect(classifyCargoPackage(crate("serde", "1.0.0", "MIT OR Apache-2.0")).allowed).toBe(true);
  });

  it("denies network copyleft", () => {
    const got = classifyCargoPackage(crate("something", "0.1.0", "AGPL-3.0"));
    expect(got.allowed).toBe(false);
    expect(got.reason).toContain("not on the permissive allowlist");
  });

  it("refuses to guess at a crate that has only a license_file, and names the file", () => {
    const got = classifyCargoPackage(
      crate("house-crate", "2.1.0", null, { license_file: "LICENSE-CUSTOM.txt" }),
    );
    expect(got.allowed).toBe(false);
    expect(got.reason).toContain("LICENSE-CUSTOM.txt");
    expect(got.reason).toContain("this gate does not guess");
  });

  it("still denies a crate with neither a license nor a license_file", () => {
    expect(classifyCargoPackage(crate("bare", "0.1.0", null)).allowed).toBe(false);
  });

  it("honours a reviewed exception, including over a license_file", () => {
    const exceptions = new Map([["house-crate@2.1.0", "file read on 2026-09-16: two-clause BSD"]]);
    const got = classifyCargoPackage(
      crate("house-crate", "2.1.0", null, { license_file: "LICENSE-CUSTOM.txt" }),
      exceptions,
    );
    expect(got.allowed).toBe(true);
    expect(got.reason).toContain("reviewed exception");
  });
});

describe("formatFinding", () => {
  it("prints crate@version: license, then the reason", () => {
    expect(
      formatFinding(crate("bad", "1.2.3", "AGPL-3.0"), "not on the permissive allowlist"),
    ).toBe("  bad@1.2.3: AGPL-3.0 — not on the permissive allowlist");
  });

  it("says so plainly when there is no license field at all", () => {
    expect(formatFinding(crate("bare", "0.1.0", null), "review required")).toContain(
      "bare@0.1.0: (no license field)",
    );
  });
});

describe("auditWorkspaces", () => {
  const documents = [
    {
      manifest: "crates/Cargo.toml",
      packages: [
        firstParty("pdf-core"),
        crate("serde", "1.0.0", "MIT OR Apache-2.0"),
        crate("tantivy", "0.25.0", "MIT"),
      ],
    },
    {
      manifest: "containers/search/Cargo.toml",
      packages: [
        firstParty("search-core"),
        crate("serde", "1.0.0", "MIT OR Apache-2.0"),
        crate("tantivy", "0.25.0", "MIT"),
      ],
    },
  ];

  it("passes a clean tree and counts each crate version once across workspaces", () => {
    const got = auditWorkspaces(documents);
    expect(got.findings).toEqual([]);
    expect(got.scanned).toBe(2);
    expect(got.firstParty).toBe(2);
    expect(got.licenseCounts.get("MIT")).toBe(1);
  });

  it("fails a tree carrying a network-copyleft crate, naming it and its workspace", () => {
    const got = auditWorkspaces([
      ...documents,
      {
        manifest: "containers/scan/Cargo.toml",
        packages: [crate("copyleft-thing", "3.0.0", "AGPL-3.0")],
      },
    ]);
    expect(got.findings).toHaveLength(1);
    expect(got.findings[0].name).toBe("copyleft-thing");
    expect(got.findings[0].manifest).toBe("containers/scan/Cargo.toml");
    expect(got.findings[0].line).toContain("copyleft-thing@3.0.0: AGPL-3.0");
  });

  it("does not let a first-party crate's missing license become a finding", () => {
    const got = auditWorkspaces([
      { manifest: "crates/Cargo.toml", packages: [firstParty("engine-host")] },
    ]);
    expect(got.findings).toEqual([]);
    expect(got.scanned).toBe(0);
  });

  it("reports the same crate at two versions separately", () => {
    const got = auditWorkspaces([
      {
        manifest: "crates/Cargo.toml",
        packages: [crate("twice", "1.0.0", "AGPL-3.0"), crate("twice", "2.0.0", "AGPL-3.0")],
      },
    ]);
    expect(got.findings.map((finding) => finding.version)).toEqual(["1.0.0", "2.0.0"]);
  });
});
