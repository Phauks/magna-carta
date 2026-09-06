import { describe, expect, it } from "vitest";
import type {
  MatterPlanTaskTemplateId,
  MatterPlanTemplateId,
} from "@magna-carta/identifiers/types";
import {
  acceptMatterPlan,
  addPlanTaskTemplate,
  createPlanTemplate,
  editPlanTaskTemplate,
  editPlanTemplate,
  plansOfferedForMatter,
  proposeMatterPlan,
  removePlanTaskTemplate,
  setPlanTemplateActive,
} from "../src/plan-service.ts";
import { readPlanTaskTemplates } from "../src/plan-statements.ts";
import {
  readMatterTask,
  selectMatterTasksStatement,
  type MatterTaskRow,
} from "../src/task-statements.ts";
import { addCalendarDays } from "../src/validation.ts";
import {
  ACTOR,
  COLLEAGUE,
  MATTER,
  MATTER_TYPE,
  OTHER_MATTER,
  OTHER_MATTER_TYPE,
  clock,
  commit,
  migratedDatabase,
  options,
  seedAssignment,
  seedFirm,
  visibility,
} from "./support.ts";

const planOptions = { clock, actorUserId: ACTOR };
const proposeOptions = { clock, visibility };

async function firmWithPlan(
  steps: readonly Parameters<typeof addPlanTaskTemplate>[2][] = [],
  matterTypeId = MATTER_TYPE,
) {
  const database = migratedDatabase();
  seedFirm(database.raw);
  const plan = createPlanTemplate(
    database.database,
    { name: "Personal injury intake", matterTypeId },
    planOptions,
  );
  await commit(database.database, plan.effect);
  const stepIds: MatterPlanTaskTemplateId[] = [];
  for (const step of steps) {
    const added = await addPlanTaskTemplate(database.database, plan.templateId, step, planOptions);
    await commit(database.database, added.effect);
    stepIds.push(added.taskTemplateId);
  }
  return { ...database, templateId: plan.templateId, stepIds };
}

describe("the offset, which is the one piece of arithmetic here", () => {
  it("adds plain calendar days and says so by landing on a weekend", () => {
    // 2026-06-09 is a Tuesday; +12 is a Sunday. No weekend skip, no holiday calendar — deliberately,
    // because deriving a date from a rule is the engine the calendar refuses to build. This is the
    // cost that makes propose-and-confirm the right instantiation.
    expect(addCalendarDays("2026-06-09", 12)).toBe("2026-06-21");
    expect(new Date("2026-06-21T00:00:00Z").getUTCDay()).toBe(0);
  });

  it("crosses months, years and a leap day without special-casing any of them", () => {
    expect(addCalendarDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("treats zero as the anchor day itself", () => {
    expect(addCalendarDays("2026-06-09", 0)).toBe("2026-06-09");
  });
});

describe("authoring a plan", () => {
  it("refuses an anchor the vocabulary does not have", async () => {
    const { database, templateId } = await firmWithPlan();
    await expect(
      addPlanTaskTemplate(
        database,
        templateId,
        { title: "Serve the complaint", dueAnchor: "service_date", offsetDays: 14 },
        planOptions,
      ),
    ).rejects.toMatchObject({ code: "plan-unknown-anchor" });
  });

  it("refuses an anchor with no offset and an offset with no anchor", async () => {
    const { database, templateId } = await firmWithPlan();
    await expect(
      addPlanTaskTemplate(
        database,
        templateId,
        { title: "Open the file", dueAnchor: "matter_opened" },
        planOptions,
      ),
    ).rejects.toMatchObject({ code: "plan-anchor-without-offset" });
    await expect(
      addPlanTaskTemplate(
        database,
        templateId,
        { title: "Open the file", offsetDays: 3 },
        planOptions,
      ),
    ).rejects.toMatchObject({ code: "plan-offset-without-anchor" });
  });

  it("refuses an offset that is a typo rather than a schedule", async () => {
    const { database, templateId } = await firmWithPlan();
    await expect(
      addPlanTaskTemplate(
        database,
        templateId,
        { title: "Far future", dueAnchor: "matter_opened", offsetDays: 36_500 },
        planOptions,
      ),
    ).rejects.toMatchObject({ code: "plan-offset-out-of-range" });
  });

  it("refuses a cycle at authoring time, where the graph is small", async () => {
    const { database, templateId, stepIds } = await firmWithPlan([
      { title: "First" },
      { title: "Second" },
    ]);
    const [first, second] = stepIds as [MatterPlanTaskTemplateId, MatterPlanTaskTemplateId];
    await commit(
      database,
      (
        await editPlanTaskTemplate(
          database,
          second,
          { title: "Second", blockedByTemplateTaskId: first },
          planOptions,
        )
      ).effect,
    );
    await expect(
      editPlanTaskTemplate(
        database,
        first,
        { title: "First", blockedByTemplateTaskId: second },
        planOptions,
      ),
    ).rejects.toMatchObject({ code: "plan-blocking-cycle" });
  });

  it("refuses a predecessor from another plan", async () => {
    const { database, templateId, stepIds } = await firmWithPlan([{ title: "First" }]);
    const other = createPlanTemplate(
      database,
      { name: "Estate intake", matterTypeId: OTHER_MATTER_TYPE },
      planOptions,
    );
    await commit(database, other.effect);
    await expect(
      addPlanTaskTemplate(
        database,
        other.templateId,
        { title: "Borrowed", blockedByTemplateTaskId: stepIds[0] },
        planOptions,
      ),
    ).rejects.toMatchObject({ code: "plan-unknown-task-template" });
    expect(templateId).not.toBe(other.templateId);
  });

  it("stops a step waiting on one that is removed", async () => {
    const { database, stepIds } = await firmWithPlan([{ title: "First" }, { title: "Second" }]);
    const [first, second] = stepIds as [MatterPlanTaskTemplateId, MatterPlanTaskTemplateId];
    await commit(
      database,
      (
        await editPlanTaskTemplate(
          database,
          second,
          { title: "Second", blockedByTemplateTaskId: first },
          planOptions,
        )
      ).effect,
    );
    await commit(database, (await removePlanTaskTemplate(database, first, planOptions)).effect);
    const remaining = await readPlanTaskTemplates(database, await firstTemplateOf(database));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.blocked_by_template_task_id).toBeNull();
  });
});

async function firstTemplateOf(database: Parameters<typeof readPlanTaskTemplates>[0]) {
  const { results } = await database
    .prepare("SELECT id FROM matter_plan_template LIMIT 1")
    .all<{ id: MatterPlanTemplateId }>();
  return results[0]?.id as MatterPlanTemplateId;
}

describe("which plans a matter is offered", () => {
  it("offers a plan bound to the matter's type, and one bound to no type at all", async () => {
    const { database, templateId } = await firmWithPlan([{ title: "Open the file" }]);
    const everyMatter = createPlanTemplate(
      database,
      { name: "Firm-wide opening steps", matterTypeId: null },
      planOptions,
    );
    await commit(database, everyMatter.effect);
    const offered = await plansOfferedForMatter(database, MATTER, visibility);
    expect(offered.map((plan) => plan.id).toSorted()).toEqual(
      [templateId, everyMatter.templateId].toSorted(),
    );
    // The type-bound one is not offered on a matter of another type; the untyped one still is.
    const onOther = await plansOfferedForMatter(database, OTHER_MATTER, visibility);
    expect(onOther.map((plan) => plan.id)).toEqual([everyMatter.templateId]);
  });

  it("stops offering a plan that is deactivated, and offers it again when reactivated", async () => {
    const { database, templateId } = await firmWithPlan([{ title: "Open the file" }]);
    await commit(
      database,
      (await setPlanTemplateActive(database, templateId, false, planOptions)).effect,
    );
    expect(await plansOfferedForMatter(database, MATTER, visibility)).toHaveLength(0);
    await commit(
      database,
      (await setPlanTemplateActive(database, templateId, true, planOptions)).effect,
    );
    expect(await plansOfferedForMatter(database, MATTER, visibility)).toHaveLength(1);
  });

  it("refuses to propose a deactivated plan", async () => {
    const { database, templateId } = await firmWithPlan([{ title: "Open the file" }]);
    await commit(
      database,
      (await setPlanTemplateActive(database, templateId, false, planOptions)).effect,
    );
    await expect(
      proposeMatterPlan(database, MATTER, templateId, proposeOptions),
    ).rejects.toMatchObject({ code: "plan-inactive" });
  });
});

describe("proposing", () => {
  it("writes nothing, and a declined proposal leaves zero rows", async () => {
    const { database, templateId } = await firmWithPlan([
      { title: "Open the file", dueAnchor: "matter_opened", offsetDays: 0 },
      { title: "Send the engagement letter", dueAnchor: "matter_opened", offsetDays: 3 },
    ]);
    const proposal = await proposeMatterPlan(database, MATTER, templateId, proposeOptions);
    expect(proposal.tasks).toHaveLength(2);
    // THE POINT OF THE WHOLE DESIGN: proposing is a read. Declining is doing nothing.
    const { results } = await selectMatterTasksStatement(database, MATTER, {
      limit: 50,
      visibility,
      viewerUserId: ACTOR,
    }).all<MatterTaskRow>();
    expect(results).toHaveLength(0);
  });

  it("renders each date from the matter's opened day by plain calendar addition", async () => {
    // The matter opened 2026-06-09, recorded as a civil date.
    const { database, templateId } = await firmWithPlan([
      { title: "Day zero", dueAnchor: "matter_opened", offsetDays: 0 },
      { title: "Two weeks", dueAnchor: "matter_opened", offsetDays: 14 },
      { title: "No date", dueAnchor: "none" },
    ]);
    const proposal = await proposeMatterPlan(database, MATTER, templateId, proposeOptions);
    const byTitle = new Map(proposal.tasks.map((task) => [task.title, task]));
    expect(byTitle.get("Day zero")?.dueOn).toBe("2026-06-09");
    expect(byTitle.get("Two weeks")?.dueOn).toBe("2026-06-23");
    expect(byTitle.get("No date")?.dueOn).toBeNull();
    // A dated line carries a zone and an undated one must not — the task record's own shape rule,
    // applied to the proposal so an accepted line is already valid.
    expect(byTitle.get("Day zero")?.timeZone).not.toBeNull();
    expect(byTitle.get("No date")?.timeZone).toBeNull();
  });

  it("reads an opened_at recorded as an instant the same way as one recorded as a date", async () => {
    // OTHER_MATTER's opened_at is "2026-06-12T00:00:00.000Z". The anchor wants the day, so the read
    // cuts ten characters rather than parsing a shape the column holds inconsistently.
    const { database, templateId } = await firmWithPlan(
      [{ title: "Day zero", dueAnchor: "matter_opened", offsetDays: 0 }],
      OTHER_MATTER_TYPE,
    );
    const proposal = await proposeMatterPlan(database, OTHER_MATTER, templateId, proposeOptions);
    expect(proposal.tasks[0]?.dueOn).toBe("2026-06-12");
  });

  it("resolves a role against the matter's live team, and says which role it could not fill", async () => {
    const { database, raw, templateId } = await firmWithPlan([
      { title: "Draft the letter", defaultAssigneeRole: "assigned_paralegal" },
      { title: "Review it", defaultAssigneeRole: "supervising_attorney" },
    ]);
    // One of the two roles is staffed on this matter; the other is not.
    seedAssignment(raw, MATTER, COLLEAGUE, "assigned_paralegal");
    const proposal = await proposeMatterPlan(database, MATTER, templateId, proposeOptions);
    const filled = proposal.tasks.find((task) => task.title === "Draft the letter");
    expect(filled?.assigneeUserId).toBe(COLLEAGUE);
    const unfilled = proposal.tasks.find((task) => task.title === "Review it");
    // An unresolved role arrives as a NAMED role with a null member, so the reviewer sees which one
    // could not be filled rather than an unexplained blank — and never silently as the responsible
    // attorney, which would be the platform inventing an obligation for somebody.
    expect(unfilled?.defaultAssigneeRole).toBe("supervising_attorney");
    expect(unfilled?.assigneeUserId).toBeNull();
  });
});

describe("accepting", () => {
  it("writes only the steps that were kept", async () => {
    const { database, templateId, stepIds } = await firmWithPlan([
      { title: "Open the file", dueAnchor: "matter_opened", offsetDays: 0 },
      { title: "Send the engagement letter", dueAnchor: "matter_opened", offsetDays: 3 },
      { title: "Order the records", dueAnchor: "matter_opened", offsetDays: 30 },
    ]);
    const accepted = await acceptMatterPlan(
      database,
      {
        matterId: MATTER,
        templateId,
        accepted: [{ taskTemplateId: stepIds[0] as MatterPlanTaskTemplateId }],
      },
      { ...planOptions, visibility },
    );
    await commit(database, accepted.effect);
    const { results } = await selectMatterTasksStatement(database, MATTER, {
      limit: 50,
      visibility,
      viewerUserId: ACTOR,
    }).all<MatterTaskRow>();
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Open the file");
  });

  it("carries the provenance on every task it writes", async () => {
    const { database, templateId, stepIds } = await firmWithPlan([{ title: "Open the file" }]);
    const accepted = await acceptMatterPlan(
      database,
      {
        matterId: MATTER,
        templateId,
        accepted: [{ taskTemplateId: stepIds[0] as MatterPlanTaskTemplateId }],
      },
      { ...planOptions, visibility },
    );
    await commit(database, accepted.effect);
    const task = await readMatterTask(database, accepted.taskIds[0] as never, visibility, ACTOR);
    expect(task?.plan_template_id).toBe(templateId);
    expect(task?.plan_task_template_id).toBe(stepIds[0]);
  });

  it("takes the reviewer's date over the one the template proposed", async () => {
    const { database, templateId, stepIds } = await firmWithPlan([
      { title: "Due on a Sunday", dueAnchor: "matter_opened", offsetDays: 12 },
    ]);
    const proposal = await proposeMatterPlan(database, MATTER, templateId, proposeOptions);
    expect(proposal.tasks[0]?.dueOn).toBe("2026-06-21");
    const accepted = await acceptMatterPlan(
      database,
      {
        matterId: MATTER,
        templateId,
        accepted: [
          {
            taskTemplateId: stepIds[0] as MatterPlanTaskTemplateId,
            dueOn: "2026-06-22",
            timeZone: "America/Los_Angeles",
          },
        ],
      },
      { ...planOptions, visibility },
    );
    await commit(database, accepted.effect);
    const task = await readMatterTask(database, accepted.taskIds[0] as never, visibility, ACTOR);
    expect(task?.due_on).toBe("2026-06-22");
  });

  it("keeps a waits-on link between two kept steps, and drops one whose predecessor was not kept", async () => {
    const { database, templateId, stepIds } = await firmWithPlan([
      { title: "First" },
      { title: "Second" },
    ]);
    const [first, second] = stepIds as [MatterPlanTaskTemplateId, MatterPlanTaskTemplateId];
    await commit(
      database,
      (
        await editPlanTaskTemplate(
          database,
          second,
          { title: "Second", blockedByTemplateTaskId: first },
          planOptions,
        )
      ).effect,
    );

    // Both kept: the link survives, pointing at the handle minted in the same batch.
    const both = await acceptMatterPlan(
      database,
      {
        matterId: MATTER,
        templateId,
        accepted: [{ taskTemplateId: first }, { taskTemplateId: second }],
      },
      { ...planOptions, visibility },
    );
    await commit(database, both.effect);
    const secondTask = await readMatterTask(database, both.taskIds[1] as never, visibility, ACTOR);
    expect(secondTask?.blocked_by_task_id).toBe(both.taskIds[0]);

    // Only the successor kept: it waits on nothing rather than on a task nobody created.
    const alone = await acceptMatterPlan(
      database,
      { matterId: MATTER, templateId, accepted: [{ taskTemplateId: second }] },
      { ...planOptions, visibility },
    );
    await commit(database, alone.effect);
    const orphan = await readMatterTask(database, alone.taskIds[0] as never, visibility, ACTOR);
    expect(orphan?.blocked_by_task_id).toBeNull();
  });

  it("refuses a step the plan does not propose for this matter", async () => {
    const { database, templateId } = await firmWithPlan([{ title: "Open the file" }]);
    await expect(
      acceptMatterPlan(
        database,
        {
          matterId: MATTER,
          templateId,
          accepted: [
            { taskTemplateId: "matterPlanTaskTemplate_neverEx" as MatterPlanTaskTemplateId },
          ],
        },
        { ...planOptions, visibility },
      ),
    ).rejects.toMatchObject({ code: "plan-task-template-mismatch" });
  });

  it("refuses an acceptance that kept nothing", async () => {
    const { database, templateId } = await firmWithPlan([{ title: "Open the file" }]);
    await expect(
      acceptMatterPlan(
        database,
        { matterId: MATTER, templateId, accepted: [] },
        { ...planOptions, visibility },
      ),
    ).rejects.toMatchObject({ code: "plan-nothing-accepted" });
  });
});

describe("nothing reconciles", () => {
  it("leaves an accepted task byte-identical when every field of its template changes", async () => {
    const { database, templateId, stepIds } = await firmWithPlan([
      { title: "Open the file", body: "As it was", dueAnchor: "matter_opened", offsetDays: 3 },
    ]);
    const accepted = await acceptMatterPlan(
      database,
      {
        matterId: MATTER,
        templateId,
        accepted: [{ taskTemplateId: stepIds[0] as MatterPlanTaskTemplateId }],
      },
      { ...planOptions, visibility },
    );
    await commit(database, accepted.effect);
    const before = await readMatterTask(database, accepted.taskIds[0] as never, visibility, ACTOR);

    // Change the plan out from under it, in every way a plan can change.
    await commit(
      database,
      (
        await editPlanTemplate(
          database,
          templateId,
          {
            name: "Renamed entirely",
            description: "And described",
            matterTypeId: OTHER_MATTER_TYPE,
          },
          planOptions,
        )
      ).effect,
    );
    await commit(
      database,
      (
        await editPlanTaskTemplate(
          database,
          stepIds[0] as MatterPlanTaskTemplateId,
          {
            title: "Completely different",
            body: "Rewritten",
            priority: "urgent",
            dueAnchor: "matter_opened",
            offsetDays: 900,
            defaultAssigneeRole: "somebody_else",
          },
          planOptions,
        )
      ).effect,
    );
    await commit(
      database,
      (await setPlanTemplateActive(database, templateId, false, planOptions)).effect,
    );

    const after = await readMatterTask(database, accepted.taskIds[0] as never, visibility, ACTOR);
    // A template edit that silently moved a due date on an open matter would be a docketing change
    // nobody authorized and nobody saw. There is no drift report and no prompt, because both are the
    // live link wearing a disguise.
    expect(after).toEqual(before);
  });
});
