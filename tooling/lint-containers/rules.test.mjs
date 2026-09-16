import { describe, expect, it } from "vitest";

import {
  ROOT_RUNTIME_STAGES,
  RULES,
  SELF_TEST,
  TAG_ONLY_BASES,
  check,
  isDockerfile,
  isRuntimeStage,
  parseInstructions,
  parseStages,
} from "./rules.mjs";

describe("the self-test table", () => {
  it.each(SELF_TEST.map((sample) => [sample.label, sample]))("%s", (_label, sample) => {
    const found = check(sample.file, sample.source);
    if (sample.rule === null) {
      expect(found.map((one) => one.rule)).toEqual([]);
    } else {
      expect(found.map((one) => one.rule)).toContain(sample.rule);
    }
  });

  it("has a positive sample for every rule in the table", () => {
    const fired = new Set(
      SELF_TEST.filter((sample) => sample.rule !== null).map((sample) => sample.rule),
    );
    // base-image-tag and base-image-digest share one rule function, so the distinct rule names are
    // one more than the number of functions.
    expect(fired.size).toBe(RULES.length + 1);
  });
});

describe("parsing", () => {
  it("drops comments and blank lines and upper-cases the keyword", () => {
    const parsed = parseInstructions("# a comment\n\nfrom debian:bookworm-slim\n");
    expect(parsed).toEqual([{ line: 3, keyword: "FROM", argument: "debian:bookworm-slim" }]);
  });

  it("folds a continuation onto the line it started on", () => {
    const source =
      "FROM debian:bookworm-slim\nRUN set -eux; \\\n    apt-get update; \\\n    true\n";
    const run = parseInstructions(source).find((one) => one.keyword === "RUN");
    expect(run.line).toBe(2);
    expect(run.argument).toBe("set -eux; apt-get update; true");
  });

  it("reads a platform flag off the FROM without mistaking it for the image", () => {
    const [stage] = parseStages("FROM --platform=linux/amd64 debian:bookworm-slim AS build\n");
    expect(stage.reference).toBe("debian:bookworm-slim");
    expect(stage.alias).toBe("build");
  });

  it("assigns each instruction to the stage it follows", () => {
    const source =
      "FROM rust:1-bookworm AS build\nRUN cargo build\nFROM debian:bookworm-slim\nUSER convert\n";
    const stages = parseStages(source);
    expect(stages).toHaveLength(2);
    expect(stages[0].instructions.map((one) => one.keyword)).toEqual(["RUN"]);
    expect(stages[1].instructions.map((one) => one.keyword)).toEqual(["USER"]);
  });
});

describe("what counts as a runtime image", () => {
  it("is derived from ENTRYPOINT, CMD or EXPOSE rather than listed", () => {
    const [runs] = parseStages('FROM debian:bookworm-slim\nENTRYPOINT ["/bin/service"]\n');
    const [exposes] = parseStages("FROM collabora/code:latest\nEXPOSE 9980\n");
    const [builds] = parseStages("FROM rust:1-bookworm\nRUN cargo build\n");
    const [exports] = parseStages("FROM scratch AS export\nCOPY --from=build /out /\n");
    expect(isRuntimeStage(runs)).toBe(true);
    expect(isRuntimeStage(exposes)).toBe(true);
    expect(isRuntimeStage(builds)).toBe(false);
    expect(isRuntimeStage(exports)).toBe(false);
  });
});

describe("findings", () => {
  it("points at the line the instruction started on and carries a fix", () => {
    const source =
      "FROM debian:bookworm-slim\n# a note\nADD https://example.test/x.tar.gz /tmp/\nUSER service\nEXPOSE 8080\n";
    const [found] = check("containers/new-thing/Dockerfile", source);
    expect(found.rule).toBe("add-from-url");
    expect(found.line).toBe(3);
    expect(found.fix).toContain("sha256sum");
  });
});

describe("the ratchet tables", () => {
  it("gives every entry a reason, because the reason is the point of the table", () => {
    for (const [reference, reason] of TAG_ONLY_BASES) {
      expect(reason.length, reference).toBeGreaterThan(30);
    }
    for (const [file, reason] of ROOT_RUNTIME_STAGES) {
      expect(reason.length, file).toBeGreaterThan(30);
    }
  });

  it("holds only paths, never globs, so a stale entry is detectable", () => {
    for (const file of ROOT_RUNTIME_STAGES.keys()) {
      expect(file).not.toContain("*");
      expect(isDockerfile(file)).toBe(true);
    }
  });
});

describe("which files are checked", () => {
  it("recognizes all three naming shapes in this repository", () => {
    expect(isDockerfile("containers/scan/Dockerfile")).toBe(true);
    expect(isDockerfile("containers/scan/Dockerfile.validate-prefilter")).toBe(true);
    expect(isDockerfile("crates/pdf-core/wasm.Dockerfile")).toBe(true);
    expect(isDockerfile("containers/docker-build.sh")).toBe(false);
    expect(isDockerfile("containers/scan/.dockerignore")).toBe(false);
  });
});
