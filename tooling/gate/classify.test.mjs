import { describe, expect, it } from "vitest";
import { acceptanceFor, changedContainers, classify } from "./classify.mjs";

describe("classify", () => {
  it("treats documentation and the rendered trackers as non-code", () => {
    const result = classify([
      "docs/conventions/dates.md",
      "CLAUDE.md",
      "STATUS.json",
      "changelog.d/a-slug.md",
      "status.d/0-1.md",
      "roadmap.d/thing.md",
    ]);
    expect(result.code).toBe(false);
    expect(result.codeFiles).toEqual([]);
    expect(result.rust).toBe(false);
    expect(result.containers).toBe(false);
  });

  it("keeps a source file that lives under a documentation path", () => {
    const result = classify(["docs/tools/render.mjs", "docs/index.md"]);
    expect(result.codeFiles).toEqual(["docs/tools/render.mjs"]);
    expect(result.code).toBe(true);
  });

  it("reaches the rust dimension from crates/ or the toolchain pin, not from a crate README", () => {
    expect(classify(["crates/pdf-core/src/lib.rs"]).rust).toBe(true);
    expect(classify(["rust-toolchain.toml"]).rust).toBe(true);
    expect(classify(["crates/README.md"]).rust).toBe(false);
    expect(classify(["containers/scan/src/main.rs"]).rust).toBe(false);
  });

  it("reaches the containers dimension only from containers/", () => {
    expect(classify(["containers/scan/Dockerfile"]).containers).toBe(true);
    expect(classify(["containers/scan/README.md"]).containers).toBe(false);
    expect(classify(["apps/scan-worker/src/index.ts"]).containers).toBe(false);
  });
});

describe("changedContainers", () => {
  it("names each container once, sorted, ignoring files directly under containers/", () => {
    expect(
      changedContainers([
        "containers/scan/src/main.rs",
        "containers/scan/Dockerfile",
        "containers/bundle/tests/acceptance.sh",
        "containers/docker-build.sh",
      ]),
    ).toEqual(["bundle", "scan"]);
  });
});

describe("acceptanceFor", () => {
  it("maps a covered container to its suite and a listed one to null", () => {
    expect(acceptanceFor("scan")).toBe("containers/scan/tests/eicar_e2e.sh");
    expect(acceptanceFor("ocr")).toBeNull();
  });

  it("refuses a container that is neither mapped nor listed", () => {
    expect(() => acceptanceFor("brand-new")).toThrow(/neither mapped/);
  });
});
