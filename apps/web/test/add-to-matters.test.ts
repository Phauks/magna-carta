/*
 * Adding a template to several matters, driven against fake ports.
 *
 * What is pinned: every matter gets its own submission under its own key, one matter's refusal does
 * not stop the others, a document that landed with blanks is its own standing rather than "landed",
 * a job that outlives the wait is reported as still running rather than as failed, and the summary
 * sentence counts what a person would count.
 */
import { describe, expect, it } from "vitest";
import type { AssemblyStatus } from "@magna-carta/api-client";
import { ApiCallFailed } from "../src/lib/api/api-client.ts";
import {
  addTemplateToMatters,
  blankLines,
  isSettled,
  standingFromStatus,
  standingLine,
  summarizeStandings,
  summarySentence,
  type AddToMattersPorts,
  type MatterAssemblyStanding,
} from "../src/lib/templates/add-to-matters.ts";

const status = (overrides: Partial<AssemblyStatus> = {}): AssemblyStatus => ({
  assemblyId: "documentAssembly_1",
  status: "done",
  outcome: "succeeded",
  outputFormat: "docx",
  fileId: "file_1",
  fileVersionId: "fileVersion_1",
  absentFieldKeys: [],
  frozenMergeFieldNames: [],
  reason: null,
  ...overrides,
});

interface Script {
  /** What each matter's submit does: an assembly id, or a refusal. */
  readonly submit: Record<string, string | ApiCallFailed>;
  /** The statuses each assembly answers, in order; the last one repeats. */
  readonly statuses: Record<string, AssemblyStatus[]>;
}

function scriptedPorts(script: Script) {
  const submits: string[] = [];
  const polls: Record<string, number> = {};
  const ports: AddToMattersPorts = {
    async submit(matterId, body, key) {
      submits.push(`${matterId}:${body.templateVersionId}:${body.outputFormat}:${key}`);
      const answer = script.submit[matterId];
      if (answer instanceof ApiCallFailed) throw answer;
      if (answer === undefined) throw new Error(`unscripted matter ${matterId}`);
      return { assemblyId: answer };
    },
    async status(_matterId, assemblyId) {
      const answers = script.statuses[assemblyId] ?? [];
      const index = polls[assemblyId] ?? 0;
      polls[assemblyId] = index + 1;
      const answer = answers[Math.min(index, answers.length - 1)];
      if (answer === undefined) throw new Error(`unscripted assembly ${assemblyId}`);
      return answer;
    },
    async sleep() {},
  };
  return { ports, submits, polls };
}

const refusal = new ApiCallFailed({
  problem: { status: 403, detail: "You cannot assemble on this matter.", title: "Refused" },
  request: "POST /api/v1/matters/matter_b/assemblies",
  failedAt: new Date(),
});

describe("a status read as a standing", () => {
  it("is null while the job runs, failed with its reason, filed, or filed with blanks", () => {
    expect(standingFromStatus(status({ status: "queued" }))).toBeNull();
    expect(standingFromStatus(status({ status: "running" }))).toBeNull();
    expect(standingFromStatus(status({ status: "failed", reason: "conversion-failed" }))).toEqual({
      kind: "failed",
      reason: "conversion-failed",
    });
    expect(standingFromStatus(status({ outputFormat: "pdf" }))).toEqual({
      kind: "landed",
      fileId: "file_1",
      outputFormat: "pdf",
    });
    const blanks = standingFromStatus(status({ absentFieldKeys: ["client.displayName"] }));
    expect(blanks?.kind).toBe("landed-with-blanks");
    expect(blankLines(blanks as MatterAssemblyStanding)).toEqual([
      "The matter could not supply: client.displayName.",
    ]);
  });
});

describe("the batch", () => {
  it("submits every matter under its own key and reports each on its own", async () => {
    const { ports, submits } = scriptedPorts({
      submit: { matter_a: "asm_a", matter_b: refusal, matter_c: "asm_c" },
      statuses: {
        asm_a: [status({ status: "running" }), status({ fileId: "file_a" })],
        asm_c: [status({ fileId: "file_c", frozenMergeFieldNames: ["ClientName"] })],
      },
    });
    const changes: string[] = [];
    const standings = await addTemplateToMatters(
      {
        templateVersionId: "documentTemplateVersion_1",
        outputFormat: "pdf",
        targets: [
          { matterId: "matter_a", label: "A" },
          { matterId: "matter_b", label: "B" },
          { matterId: "matter_c", label: "C" },
        ],
      },
      {
        ports,
        keyFor: (matterId) => `key-${matterId}`,
        onChange: (matterId, standing) => changes.push(`${matterId}:${standing.kind}`),
        concurrency: 1,
      },
    );
    expect(submits).toEqual([
      "matter_a:documentTemplateVersion_1:pdf:key-matter_a",
      "matter_b:documentTemplateVersion_1:pdf:key-matter_b",
      "matter_c:documentTemplateVersion_1:pdf:key-matter_c",
    ]);
    expect(standings.get("matter_a")).toEqual({
      kind: "landed",
      fileId: "file_a",
      outputFormat: "docx",
    });
    expect(standings.get("matter_b")?.kind).toBe("refused");
    expect(standings.get("matter_c")?.kind).toBe("landed-with-blanks");
    // Every matter is announced as waiting first, and every move after that is reported.
    expect(changes.slice(0, 3)).toEqual([
      "matter_a:waiting",
      "matter_b:waiting",
      "matter_c:waiting",
    ]);
    expect(changes).toContain("matter_a:assembling");
    expect(changes).toContain("matter_b:refused");
    expect([...standings.values()].every(isSettled)).toBe(true);
  });

  it("reports a job that outlives the wait as still running, never as failed", async () => {
    const { ports, polls } = scriptedPorts({
      submit: { matter_a: "asm_a" },
      statuses: { asm_a: [status({ status: "running" })] },
    });
    const standings = await addTemplateToMatters(
      {
        templateVersionId: "documentTemplateVersion_1",
        outputFormat: "docx",
        targets: [{ matterId: "matter_a", label: "A" }],
      },
      { ports, keyFor: () => "key" },
    );
    expect(standings.get("matter_a")).toEqual({ kind: "still-running", assemblyId: "asm_a" });
    expect(polls["asm_a"]).toBe(20);
  });

  it("runs no wider than the concurrency asked for", async () => {
    let inFlight = 0;
    let widest = 0;
    const ports: AddToMattersPorts = {
      async submit(matterId) {
        inFlight += 1;
        widest = Math.max(widest, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { assemblyId: `asm_${matterId}` };
      },
      async status() {
        inFlight -= 1;
        return status();
      },
      async sleep() {},
    };
    await addTemplateToMatters(
      {
        templateVersionId: "v",
        outputFormat: "docx",
        targets: ["a", "b", "c", "d", "e"].map((id) => ({ matterId: id, label: id })),
      },
      { ports, keyFor: (id) => id, concurrency: 2 },
    );
    expect(widest).toBeLessThanOrEqual(2);
  });
});

describe("what the batch came to", () => {
  it("counts filed, blanks, failures and the still-running, and says it in one sentence", () => {
    const standings = new Map<string, MatterAssemblyStanding>([
      ["a", { kind: "landed", fileId: "f", outputFormat: "docx" }],
      [
        "b",
        {
          kind: "landed-with-blanks",
          fileId: "g",
          outputFormat: "docx",
          absentFieldKeys: ["x"],
          frozenMergeFieldNames: [],
        },
      ],
      ["c", { kind: "failed", reason: null }],
      ["d", { kind: "refused", stage: "submitting", failure: refusal.failure }],
      ["e", { kind: "still-running", assemblyId: "z" }],
    ]);
    const summary = summarizeStandings(standings);
    expect(summary).toEqual({ landed: 1, withBlanks: 1, failed: 2, stillRunning: 1, total: 5 });
    expect(summarySentence(summary)).toBe(
      "The document is on 2 matters; 1 of them with blanks to look at; 1 matter still being built; 2 matters did not get one.",
    );
    expect(summarySentence(summarizeStandings(new Map()))).toBe("Nothing was added.");
  });

  it("reads a refusal in the server's words where it gave any", () => {
    expect(standingLine({ kind: "refused", stage: "submitting", failure: refusal.failure })).toBe(
      "You cannot assemble on this matter.",
    );
    expect(standingLine({ kind: "failed", reason: null })).toBe("The document could not be built");
    expect(standingLine({ kind: "landed", fileId: "f", outputFormat: "pdf" })).toBe(
      "On the matter as a PDF",
    );
  });
});
