import { describe, expect, it } from "vitest";
import {
  BLOCKED_BUILD_SCRIPTS,
  BUILD_SCRIPT_GRANTS,
  NATIVE_BINARY_FAMILIES,
  NATIVE_CRATES,
  SELF_TEST,
  SYSTEM_ENGINES,
  familyOf,
  grantProblems,
  judge,
  readBuildScriptGrants,
  readNativeBinaryFamilies,
  readNativeCrates,
  standingNotices,
} from "./register.mjs";

const ALL_TABLES = [
  ["BUILD_SCRIPT_GRANTS", BUILD_SCRIPT_GRANTS],
  ["BLOCKED_BUILD_SCRIPTS", BLOCKED_BUILD_SCRIPTS],
  ["SYSTEM_ENGINES", SYSTEM_ENGINES],
  ["NATIVE_BINARY_FAMILIES", NATIVE_BINARY_FAMILIES],
  ["NATIVE_CRATES", NATIVE_CRATES],
];

const STATUSES = new Set(["memory-safe", "consented", "surfaced", "pending-removal", "blocked"]);

describe("the self-test table", () => {
  it.each(SELF_TEST.map((sample) => [sample.label, sample]))("%s", (_label, sample) => {
    expect(sample.run()).toEqual(sample.expect);
  });
});

describe("the register", () => {
  it.each(ALL_TABLES)("%s gives every entry a status, a language and a reason", (_name, table) => {
    for (const [key, entry] of table) {
      expect(STATUSES, key).toContain(entry.status);
      expect(entry.language, key).toBeTruthy();
      expect(entry.reason, key).toBeTruthy();
      // A memory-safe entry only has to say what the thing is. Anything the gate SURFACES has to
      // carry the reasoning, because that text is what a person rules on.
      if (entry.status !== "memory-safe") {
        expect(entry.reason.length, key).toBeGreaterThan(80);
      }
    }
  });

  it("surfaces everything that is not memory-safe, and stays quiet about what is", () => {
    const surfaced = new Set(standingNotices().map((notice) => notice.name));
    // The consented exception and the stale grant are the two entries that must always be visible.
    expect(surfaced).toContain("clamav / clamd (containers/scan)");
    expect(surfaced).toContain("sharp");
    // A Rust binary is not a golden-rule-14 concern and must not be in the noise.
    expect(surfaced).not.toContain("lightningcss");
  });

  it("records the stale grant as pending removal rather than quietly permitting it", () => {
    expect(BUILD_SCRIPT_GRANTS.get("sharp").status).toBe("pending-removal");
    expect(BUILD_SCRIPT_GRANTS.get("sharp").reason).toContain("libvips");
  });
});

describe("reading onlyBuiltDependencies", () => {
  it("reads the sequence and stops at the next top-level key", () => {
    const source = [
      "packages:",
      '  - "apps/*"',
      "",
      "# a comment above the block",
      "onlyBuiltDependencies:",
      "  - workerd",
      "  # a comment inside the block",
      "  - esbuild",
      "",
      "catalog:",
      "  zod: 4.4.3",
      "",
    ].join("\n");
    expect(readBuildScriptGrants(source)).toEqual(["workerd", "esbuild"]);
  });

  it("returns null when the block is gone, which the runner treats as a failure", () => {
    expect(readBuildScriptGrants('packages:\n  - "apps/*"\n')).toBeNull();
  });
});

describe("collapsing platform packages", () => {
  it("keeps the tool and drops the platform", () => {
    expect(familyOf("@esbuild/linux-x64")).toBe("@esbuild");
    expect(familyOf("@img/sharp-libvips-linuxmusl-arm64")).toBe("@img/sharp-libvips");
    expect(familyOf("@rolldown/binding-wasm32-wasi")).toBe("@rolldown/binding");
    expect(familyOf("@voidzero-dev/vite-plus-darwin-arm64")).toBe("@voidzero-dev/vite-plus");
  });

  it("leaves a name with no platform tokens alone", () => {
    expect(familyOf("fsevents")).toBe("fsevents");
    expect(familyOf("@cloudflare/containers")).toBe("@cloudflare/containers");
  });
});

describe("reading the lockfiles", () => {
  it("finds only the packages constrained to a platform", () => {
    const lockfile = [
      "packages:",
      "",
      "  '@esbuild/linux-x64@0.28.2':",
      "    resolution: {integrity: sha512-aaaa}",
      "    cpu: [x64]",
      "    os: [linux]",
      "",
      "  fsevents@2.3.3:",
      "    resolution: {integrity: sha512-bbbb}",
      "    os: [darwin]",
      "",
      "  zod@4.4.3:",
      "    resolution: {integrity: sha512-cccc}",
      "",
      "snapshots:",
      "",
    ].join("\n");
    expect(readNativeBinaryFamilies(lockfile)).toEqual(["@esbuild", "fsevents"]);
  });

  it("reports a missing packages section rather than an empty answer", () => {
    expect(readNativeBinaryFamilies("lockfileVersion: '9.0'\n")).toBeNull();
  });

  it("finds a -sys crate and a cc-building crate, including the first block in the file", () => {
    const lockfile = [
      "[[package]]",
      'name = "zstd-sys"',
      'version = "2.0.0"',
      "",
      "[[package]]",
      'name = "ring"',
      'version = "0.17.0"',
      'dependencies = [\n "cc",\n "getrandom",\n]',
      "",
      "[[package]]",
      'name = "serde"',
      'version = "1.0.0"',
      "",
    ].join("\n");
    expect(readNativeCrates(lockfile)).toEqual(["ring", "zstd-sys"]);
  });
});

describe("judgement", () => {
  it("refuses an unexplained addition to the grant list", () => {
    const problems = grantProblems(["workerd", "esbuild", "sharp", "canvas"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "unregistered", name: "canvas" });
    expect(problems[0].fix).toContain("golden rule 14");
  });

  it("refuses a register entry whose grant has gone, except the one pending removal", () => {
    expect(grantProblems(["esbuild", "sharp"]).map((one) => one.name)).toEqual(["workerd"]);
    expect(grantProblems(["workerd", "esbuild"])).toEqual([]);
  });

  it("passes a registered arrival and refuses an unregistered one", () => {
    const problems = judge("Cargo.lock", ["ring", "brotli-sys"], NATIVE_CRATES, () => "add it");
    expect(problems.map((one) => one.name)).toEqual(["brotli-sys"]);
  });
});
