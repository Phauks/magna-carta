import { describe, expect, it } from "vitest";
import { exemptionReason, findUngatedDecisions, readDurableObjectMethods } from "./rules.mjs";

// The rule is measured against the shape it exists to catch — which is the real one it did catch,
// reproduced here — and against the several near-misses it must leave alone.

const UNGATED = `
export class BundleBuildCoordinator extends DurableObject {
  async requestBundle(message) {
    const existing = (await this.ctx.storage.get("state")) ?? null;
    if (existing !== null && (await this.artifactsPresent(existing, bucket))) {
      return existing;
    }
    await this.ctx.storage.put("state", { status: "building" });
  }
}
`;

describe("the shape it was written for", () => {
  it("catches a decision taken across an R2 round trip", () => {
    const problems = findUngatedDecisions(readDurableObjectMethods(UNGATED));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      rule: "ungated-durable-object-decision",
      className: "BundleBuildCoordinator",
      method: "requestBundle",
    });
    expect(problems[0]?.foreign).toContain("this.artifactsPresent");
  });

  it("passes once the decision is wrapped in blockConcurrencyWhile", () => {
    const gated = UNGATED.replace(
      "    const existing",
      "    return this.ctx.blockConcurrencyWhile(async () => {\n    const existing",
    );
    expect(findUngatedDecisions(readDurableObjectMethods(gated))).toEqual([]);
  });
});

describe("what it must leave alone", () => {
  const cases = {
    "a read-then-write with only storage awaits between": `
export class Job extends DurableObject {
  async markRunning() {
    const state = await this.ctx.storage.get("state");
    await this.ctx.storage.setAlarm(Date.now() + 1);
    await this.ctx.storage.put("state", { ...state, status: "running" });
  }
}`,
    "a write with no preceding read — nothing was decided": `
export class Job extends DurableObject {
  async markCommitted(id) {
    await this.progress().broadcast();
    await this.ctx.storage.put("tombstone", id);
  }
}`,
    "a non-storage await AFTER the write, which is a consequence not a decision": `
export class Job extends DurableObject {
  async start(message) {
    const existing = await this.ctx.storage.get("state");
    if (existing) return existing;
    await this.ctx.storage.put("state", { status: "queued" });
    await this.env.QUEUE.send(message);
  }
}`,
    "a read with no write at all": `
export class Job extends DurableObject {
  async status() {
    return await this.ctx.storage.get("state");
  }
}`,
    "an alarm, which no second caller races": `
export class Job extends DurableObject {
  override async alarm() {
    const state = await this.ctx.storage.get("state");
    await this.reportSomewhere(state);
    await this.ctx.storage.put("state", { ...state, status: "failed" });
  }
}`,
  };

  for (const [description, source] of Object.entries(cases)) {
    it(description, () => {
      expect(findUngatedDecisions(readDurableObjectMethods(source))).toEqual([]);
    });
  }

  it("a file with no Durable Object in it", () => {
    expect(readDurableObjectMethods("export async function plain() { return 1; }")).toEqual([]);
  });
});

describe("the escape hatch", () => {
  it("honours a marked method", () => {
    const marked = UNGATED.replace(
      "  async requestBundle",
      "  // durable-object-gate:allow — a second caller rebuilding is harmless here\n  async requestBundle",
    );
    expect(findUngatedDecisions(readDurableObjectMethods(marked))).toEqual([]);
  });

  it("reads the reason, and reports a bare marker as none", () => {
    expect(exemptionReason("// durable-object-gate:allow — the second caller is harmless")).toBe(
      "the second caller is harmless",
    );
    expect(exemptionReason("// durable-object-gate:allow")).toBe("");
    expect(exemptionReason("// something else")).toBeNull();
  });
});
