import { describe, expect, it } from "vitest";
import { candidateFilters, planPathFilters } from "./path-filters.mjs";

// A filesystem view built from a description rather than a real tree, so each rule is exercised
// against the shape it exists for. `directories` maps a token to whether a vitest project is
// reachable from it; anything absent is "not a directory here" and must be passed through untouched.
const viewOf = (directories) => (token) =>
  token in directories
    ? { absolutePath: `/repo/${token}`, holdsProject: directories[token] }
    : undefined;

const REPOSITORY = viewOf({
  tooling: true,
  "tooling/clean": true,
  packages: true,
  docs: false,
  changelog: false,
});

describe("candidateFilters", () => {
  it("takes the positional arguments", () => {
    expect(candidateFilters(["tooling", "packages"])).toEqual([
      { index: 0, token: "tooling" },
      { index: 1, token: "packages" },
    ]);
  });

  it("skips options", () => {
    expect(candidateFilters(["--watch", "--silent"])).toEqual([]);
  });

  it("skips a leading subcommand, which is not a filter", () => {
    expect(candidateFilters(["run", "tooling"])).toEqual([{ index: 1, token: "tooling" }]);
    // ...but the same word later along IS a positional filter, and a directory called `run` would be
    // a legitimate thing to filter on.
    expect(candidateFilters(["list", "packages", "run"])).toEqual([
      { index: 1, token: "packages" },
      { index: 2, token: "run" },
    ]);
  });

  it("skips the value of a name-valued option, which is not a path", () => {
    expect(candidateFilters(["--reporter", "json", "tooling"])).toEqual([
      { index: 2, token: "tooling" },
    ]);
    expect(candidateFilters(["-t", "docs", "tooling"])).toEqual([{ index: 2, token: "tooling" }]);
    expect(candidateFilters(["--project", "clean", "tooling"])).toEqual([
      { index: 2, token: "tooling" },
    ]);
  });

  it("still takes a filter that follows a boolean option", () => {
    // `pnpm test --watch tooling` is an ordinary thing to type, so a rule that treated every
    // post-option argument as suspect would leave the common case unresolved.
    expect(candidateFilters(["--watch", "tooling"])).toEqual([{ index: 1, token: "tooling" }]);
    expect(candidateFilters(["run", "-u", "tooling"])).toEqual([{ index: 2, token: "tooling" }]);
  });

  it("keeps the argument after an option that carries its own value", () => {
    // The shape the gate's invocations use — the option is self-contained, so what follows it is
    // unambiguously a filter.
    expect(candidateFilters(["run", "--shard=1/8", "packages"])).toEqual([
      { index: 2, token: "packages" },
    ]);
  });
});

describe("planPathFilters", () => {
  it("resolves a directory filter to an absolute path, which is what the runner matches on", () => {
    const plan = planPathFilters(["tooling"], REPOSITORY);
    expect(plan.arguments).toEqual(["/repo/tooling"]);
    expect(plan.resolved).toEqual(["tooling"]);
    expect(plan.refusals).toEqual([]);
  });

  it("resolves a directory that is itself inside a project just the same", () => {
    expect(planPathFilters(["run", "tooling/clean"], REPOSITORY).arguments).toEqual([
      "run",
      "/repo/tooling/clean",
    ]);
  });

  it("leaves options and their values alone", () => {
    const plan = planPathFilters(
      ["run", "--reporter", "json", "--shard=1/8", "tooling"],
      REPOSITORY,
    );
    expect(plan.arguments).toEqual(["run", "--reporter", "json", "--shard=1/8", "/repo/tooling"]);
  });

  it("passes through a filter that is not a directory — a substring filter still means what it said", () => {
    // `select.test.mjs` is a real and useful filter; it is not a path from the repository root, and
    // rewriting it would break a spelling that works.
    const plan = planPathFilters(["select.test.mjs"], REPOSITORY);
    expect(plan.arguments).toEqual(["select.test.mjs"]);
    expect(plan.resolved).toEqual([]);
    expect(plan.refusals).toEqual([]);
  });

  it("refuses a directory that holds no project, and says the filter matched nothing", () => {
    const plan = planPathFilters(["docs"], REPOSITORY);
    expect(plan.refusals).toHaveLength(1);
    expect(plan.refusals[0]).toContain('"docs"');
    expect(plan.refusals[0]).toContain("matched nothing");
    // The distinction the runner's own message loses: not "no tests here", but "nothing selected".
    expect(plan.refusals[0]).not.toMatch(/no test files found/i);
    expect(plan.refusals[0]).toContain("lint:test-registration");
  });

  it("reports every unreachable filter, not just the first", () => {
    expect(planPathFilters(["docs", "changelog"], REPOSITORY).refusals).toHaveLength(2);
  });

  it("does not refuse a mixed selection on account of the reachable half", () => {
    // One good filter plus one dead one is still a mistake worth stopping for: the run would silently
    // narrow to the good half, which is the failure shape that keeps a green gate looking honest.
    const plan = planPathFilters(["tooling", "docs"], REPOSITORY);
    expect(plan.resolved).toEqual(["tooling"]);
    expect(plan.refusals).toHaveLength(1);
  });

  it("leaves an argument list with no filters completely untouched", () => {
    expect(planPathFilters(["--watch"], REPOSITORY).arguments).toEqual(["--watch"]);
    expect(planPathFilters([], REPOSITORY).arguments).toEqual([]);
  });
});
