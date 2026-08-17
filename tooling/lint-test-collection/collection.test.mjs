import { describe, expect, it } from "vitest";
import {
  driftedInvocations,
  listArgumentsFor,
  reconcile,
  specificationKey,
  unregisteredInvocations,
} from "./collection.mjs";

// This lint's whole job is to prove something about the gate, so its own reasoning has to be proved
// rather than read. Each case below constructs the failure the assertion claims to catch and checks
// it is caught, and — just as important — constructs the near-miss that is legitimately fine and
// checks it stays quiet. A guard that fires on everything is as useless as one that fires on nothing.

const asSets = (jobs) => new Map(Object.entries(jobs).map(([job, files]) => [job, new Set(files)]));

describe("reconcile — the partition the gate's test jobs must form", () => {
  const sound = {
    wholeSuite: new Set(["a [x]", "b [x]", "c [y]"]),
    collected: asSets({ "test-node": ["a [x]", "b [x]"], "test-worker": ["c [y]"] }),
    floor: 3,
  };

  it("passes a sound partition", () => {
    expect(reconcile(sound)).toEqual([]);
  });

  it("flags a registered file no job collects — the hole that reads as coverage", () => {
    const failures = reconcile({
      ...sound,
      wholeSuite: new Set([...sound.wholeSuite, "orphan [z]"]),
      floor: 0,
    });
    expect(failures.join("\n")).toContain("run nowhere");
    expect(failures.join("\n")).toContain("orphan [z]");
  });

  it("flags a file two jobs both collect — runtime paid for twice", () => {
    const failures = reconcile({
      ...sound,
      collected: asSets({ "test-node": ["a [x]", "b [x]"], "test-worker": ["b [x]", "c [y]"] }),
    });
    expect(failures.join("\n")).toContain("more than one gate job");
    expect(failures.join("\n")).toContain("b [x] — also collected by test-worker");
  });

  it("flags a job collecting something the whole suite does not — a filter cannot widen", () => {
    const failures = reconcile({
      ...sound,
      collected: asSets({
        "test-node": ["a [x]", "b [x]"],
        "test-worker": ["c [y]", "impossible [q]"],
      }),
    });
    expect(failures.join("\n")).toContain("but not by the unfiltered whole-suite run");
    expect(failures.join("\n")).toContain("impossible [q]");
  });

  it("flags a whole-suite collection that has collapsed below the floor", () => {
    const failures = reconcile({ ...sound, floor: 500 });
    expect(failures.join("\n")).toContain("below the committed floor");
  });

  it("counts the same file in two projects as two distinct entries", () => {
    const root = "/repo/";
    const shared = { file: "/repo/packages/design-system/test/button.test.ts" };
    expect(specificationKey({ ...shared, projectName: "design-system" }, root)).not.toEqual(
      specificationKey({ ...shared, projectName: "storybook" }, root),
    );
    // A file claimed by two projects is genuinely run twice, so it is NOT a duplicate-job failure.
    expect(
      reconcile({
        wholeSuite: new Set(["t [design-system]", "t [storybook]"]),
        collected: asSets({
          "test-node": ["t [design-system]"],
          "test-stories": ["t [storybook]"],
        }),
        floor: 0,
      }),
    ).toEqual([]);
  });
});

describe("driftedInvocations — the lint's copy must still be in the workflow", () => {
  const invocations = [{ job: "test-node", command: "pnpm exec vp test run --project='!x' a b" }];

  it("passes when the workflow spells the command across a folded YAML block", () => {
    const workflow = "run: >-\n  pnpm exec vp test run --project='!x'\n  a\n  b\n";
    expect(driftedInvocations(workflow, invocations)).toEqual([]);
  });

  it("flags a command the workflow no longer contains", () => {
    const workflow = "run: pnpm exec vp test run --project='!x' a\n";
    expect(driftedInvocations(workflow, invocations).join("\n")).toContain("test-node");
  });
});

describe("unregisteredInvocations — the workflow must hold no test job this lint has not seen", () => {
  const invocations = [
    { job: "test-node", command: "pnpm exec vp test run one" },
    { job: "test-worker", command: "pnpm exec vp test run two" },
  ];

  it("passes when the counts agree", () => {
    const workflow = "a: pnpm exec vp test run one\nb: pnpm exec vp test run two\n";
    expect(unregisteredInvocations(workflow, invocations)).toEqual([]);
  });

  it("flags a fourth test job added to the workflow but never registered here", () => {
    const workflow =
      "a: pnpm exec vp test run one\nb: pnpm exec vp test run two\nc: pnpm exec vp test run three\n";
    expect(unregisteredInvocations(workflow, invocations).join("\n")).toContain(
      '3 "pnpm exec vp test" invocation(s), but this lint holds 2',
    );
  });

  it("does not count a plain node script beside the runner invocations", () => {
    const workflow =
      "a: pnpm exec vp test run one\nb: pnpm exec vp test run two\nc: node tooling/migration-integrity/index.mts\n";
    expect(unregisteredInvocations(workflow, invocations)).toEqual([]);
  });

  it("does not count a comment that quotes an invocation", () => {
    // gate.yml explains its own test jobs at length, and those paragraphs name the commands. Prose
    // about a job is not a job.
    const workflow =
      "  # kept byte-identical to pnpm exec vp test run three, see the lint\n" +
      "a: pnpm exec vp test run one\nb: pnpm exec vp test run two\n";
    expect(unregisteredInvocations(workflow, invocations)).toEqual([]);
    expect(
      driftedInvocations(workflow, [{ job: "ghost", command: "pnpm exec vp test run three" }]),
    ).toHaveLength(1);
  });
});

describe("listArgumentsFor — a workflow command as a list-only selection", () => {
  const command =
    "pnpm exec vp test run --project='!storybook' --shard=${{ matrix.shard }}/${{ env.SHARD_TOTAL }} " +
    '"$PWD/packages" "$PWD/apps/web"';

  it("drops the runner prefix and the shard, unquotes, and resolves $PWD", () => {
    expect(listArgumentsFor(command, "/repo/")).toEqual([
      "--project=!storybook",
      "/repo/packages",
      "/repo/apps/web",
    ]);
  });

  it("leaves no stray positional behind when the shard expression is dropped", () => {
    // The workflow expressions collapse to a single token FIRST, so `matrix.shard` can never survive
    // as its own argument — which would silently filter the collection down to nothing.
    expect(listArgumentsFor(command, "/repo/")).not.toContain("matrix.shard");
    expect(listArgumentsFor(command, "/repo/").some((token) => token.includes("shard"))).toBe(
      false,
    );
  });
});
