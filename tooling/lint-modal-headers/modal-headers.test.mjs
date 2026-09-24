import { describe, expect, it } from "vitest";
import {
  ACT_VERBS,
  auditModalHeaders,
  findHeadingProblems,
  markupOf,
  modalTags,
  NOT_A_RECORD_REFERENCE,
  propNames,
  readsAsASentence,
  recordNumberIdentifiers,
  subtitleSnippets,
} from "./modal-headers.mjs";

/*
 * The modal-header rules, against fixtures.
 *
 * Each rule is given a source that violates it and one that does not, because a scan that has only
 * ever been shown its own failure case is a scan nobody knows the shape of. The pairs are lifted
 * from the panels this gate was written against: every "clean" fixture is something the application
 * really renders, and every "dirty" one is something it really rendered before 2026-09-14.
 */

const identifiers = () =>
  recordNumberIdentifiers('text("matter_number"), text("invoice_number"), text("plate_number")');

const audit = (source, path = "apps/web/src/lib/thing/panel.svelte") =>
  auditModalHeaders({ files: [{ path, source }], identifiers: identifiers() });

describe("reading the schema for what counts as a record number", () => {
  it("takes the columns as the camelCase names a surface would hold", () => {
    expect([...identifiers().keys()]).toEqual(["matterNumber", "invoiceNumber"]);
  });

  it("leaves out the numbers that are not a record's own name", () => {
    // A plate is a vehicle's registration, recorded as a fact about property. The exclusions are
    // named rather than the inclusions, so a record kind that grows a number is picked up the day
    // its column lands instead of waiting for somebody to remember this file.
    expect(NOT_A_RECORD_REFERENCE.has("plateNumber")).toBe(true);
    expect(identifiers().has("plateNumber")).toBe(false);
  });
});

describe("the heading names the act", () => {
  const problemsFor = (heading, acting = true) =>
    findHeadingProblems({ file: "f", line: 1, heading, acting }).map((problem) => problem.rule);

  it("passes an imperative", () => {
    expect(problemsFor("Write Off a Balance")).toEqual([]);
    expect(problemsFor("Apply Trust Funds")).toEqual([]);
  });

  it("refuses a question mark", () => {
    // The panel is what makes it a question: a destructive kind takes the alertdialog role and
    // traps the decision. The heading still names the act.
    expect(problemsFor("Retire This Event Type?")).toEqual(["heading-question"]);
  });

  it("refuses a capitalised article inside the title", () => {
    expect(problemsFor("Assign A Category")).toEqual(["heading-case"]);
    expect(problemsFor("File a Copy")).toEqual([]);
  });

  it("leaves the first and last words alone", () => {
    // "The Vocabulary" leads with its article and "Fold One Record Into" would end on one; neither
    // position is the mid-title capital the rule is about.
    expect(problemsFor("Add the Matter's Files")).toEqual([]);
  });

  it("refuses a bare noun where an act is being asked for", () => {
    expect(problemsFor("Matter Status")).toEqual(["heading-act"]);
  });

  it("allows the create control's noun form", () => {
    // The owner's create-control ruling of 2026-09-03 reaching the panel the control opens.
    expect(problemsFor("New Packet")).toEqual([]);
    expect(problemsFor("New Custodian of Record")).toEqual([]);
  });

  it("asks nothing of a panel that asks for nothing", () => {
    expect(problemsFor("Matter Status", false)).toEqual([]);
    expect(problemsFor("Time Sheet", false)).toEqual([]);
  });

  it("names its verbs in one place, so adding an act is one reviewed line", () => {
    expect(ACT_VERBS.has("write")).toBe(true);
    expect(ACT_VERBS.has("status")).toBe(false);
  });

  it("names the four acts a trust request and a transfer are decided by", () => {
    // The heading's verb is the control's verb: Approve, Reject and Withdraw are the queue's own
    // three, and Transfer is what the control that opens the panel says.
    expect(problemsFor("Approve Payment Out")).toEqual([]);
    expect(problemsFor("Reject Payment Out")).toEqual([]);
    expect(problemsFor("Withdraw Payment Out")).toEqual([]);
    expect(problemsFor("Transfer to Another Matter")).toEqual([]);
  });

  it("names funding, which is what a panel that moves the firm's own money into a cushion does", () => {
    // The control, the heading and the commit are one act and one word: a firm funds the
    // bank-charge cushion, and "Add Firm Funds to the Cushion" named the same act a second way.
    expect(problemsFor("Fund Cushion")).toEqual([]);
    expect(ACT_VERBS.has("fund")).toBe(true);
  });

  it("names importing, which is what a panel over a published file does", () => {
    // A bank statement reaches the platform two ways — typed in, or read out of the file the
    // institution publishes — and the second one's commit does not "record" or "add": it imports.
    expect(problemsFor("Import Statement")).toEqual([]);
    expect(ACT_VERBS.has("import")).toBe(true);
  });
});

describe("a fact is not a sentence", () => {
  it("passes what a reader needs to know about the record", () => {
    expect(readsAsASentence("this matter still owes $4,120.00")).toBe(false);
    expect(readsAsASentence("she/her")).toBe(false);
    expect(readsAsASentence("3 of 7 submitted")).toBe(false);
  });

  it("refuses a paragraph about what a subsystem is for", () => {
    expect(
      readsAsASentence(
        "A corpus of its own — its own documents, its own search index, its own access list, " +
          "and its own lifecycle.",
      ),
    ).toBe(true);
  });

  it("lets a short line ending in a full stop through", () => {
    // An abbreviation ends in one too, and the rule is deliberately biased toward silence.
    expect(readsAsASentence("Draft Bill Inc.")).toBe(false);
  });

  it("reports a subtitle snippet that is only prose", () => {
    const source = `<script lang="ts"></script>
<ActionDialog heading="Vacate This Deadline" commitLabel="Vacate">
  {#snippet subtitle()}
    No deadline was moved. Review each one against the new setting, one at a time.
  {/snippet}
</ActionDialog>`;
    expect(audit(source).problems.map((problem) => problem.rule)).toEqual(["subject-not-prose"]);
  });

  it("leaves a snippet that names its record alone", () => {
    const source = `<script lang="ts"></script>
<ActionDialog heading="Void This Draft" commitLabel="Void">
  {#snippet subtitle()}
    <RecordSubjectLine subject={subjectLine} />
  {/snippet}
</ActionDialog>`;
    expect(audit(source).problems).toEqual([]);
  });
});

describe("a number a panel was handed is a number it names", () => {
  it("reports a panel that takes one as a prop and states it nowhere", () => {
    const source = `<script lang="ts">
  let { open, matterTitle, matterNumber } = $props();
</script>
<ActionDialog heading="Record a Cost" commitLabel="Record It" subtitle={{ facts: [matterTitle] }} />`;
    const [problem] = audit(source).problems;
    expect(problem.rule).toBe("reference-shown");
    expect(problem.message).toContain("matterNumber");
  });

  it("accepts it in a reference, however that reference is bound", () => {
    // A panel that needs the reference twice binds it to a name of its own, so the object is found
    // by its SHAPE rather than by the `reference:` label.
    const source = `<script lang="ts">
  let { open, matterNumber } = $props();
  const held = { kind: "Matter", number: matterNumber };
</script>
<ActionDialog heading="Record a Cost" commitLabel="Record It" subtitle={{ reference: held }} />`;
    expect(audit(source).problems).toEqual([]);
  });

  it("accepts it in the heading, where a record's name IS its number", () => {
    const source = `<script lang="ts">
  let { open, invoiceNumber } = $props();
  const heading = \`Invoice \${invoiceNumber}\`;
</script>
<RecordWindow {heading} subtitle={{ facts: ["Thompson Estate"] }} />`;
    expect(audit(source).problems).toEqual([]);
  });

  it("accepts it through one derived alias", () => {
    // A panel that can be opened ON a matter or pick one answers `chosen ?? prop` and names the
    // result; the prop reaches the reference through that one value. One hop is resolved and a
    // chain deliberately is not — a rule that quietly followed three would be unpredictable.
    const source = `<script lang="ts">
  let { open, matterNumber, chosen } = $props();
  const effectiveMatterNumber = $derived(
    chosen?.matterNumber ?? matterNumber,
  );
</script>
<ActionDialog
  heading="Draft a Bill"
  commitLabel="Open Draft"
  subtitle={{ reference: { kind: "Matter", number: effectiveMatterNumber } }}
/>`;
    expect(audit(source).problems).toEqual([]);
  });

  it("says nothing about an identifier the panel merely reads", () => {
    // A picker's label, a guard's condition and a callback's parameter are not the panel being told
    // which record it is about. Reporting them is the shape of a gate people switch off.
    const source = `<script lang="ts">
  let { open, matters, onFinalized } = $props();
  const items = matters.map((matter) => matter.matterNumber ?? matter.id);
</script>
<ActionDialog heading="Draft a Bill" commitLabel="Open Draft" />`;
    expect(audit(source).problems).toEqual([]);
  });
});

describe("reading a file", () => {
  it("finds both shells, in source order", () => {
    const markup = markupOf('<RecordWindow heading="A" />\n<ActionDialog heading="B" />');
    expect(modalTags(markup).map((tag) => tag.shell)).toEqual(["RecordWindow", "ActionDialog"]);
  });

  it("never matches a mention inside a comment or the script", () => {
    const source = `<script lang="ts">
  // <ActionDialog heading="Not A Real Panel?" />
</script>
<!-- <ActionDialog heading="Also Not A Panel?" /> -->`;
    expect(modalTags(markupOf(source))).toEqual([]);
    expect(audit(source).problems).toEqual([]);
  });

  it("reads a subtitle snippet whole, past a branch of its own", () => {
    const markup = markupOf(`{#snippet subtitle()}
  {#if open}yes{/if}
  tail
{/snippet}`);
    expect(subtitleSnippets(markup)[0].body).toContain("tail");
  });

  it("takes the props from the destructuring, not the type beside it", () => {
    const names = propNames(`let {
      open = $bindable(false),
      matterNumber = null,
      onFinalized,
    }: {
      open?: boolean;
      matterNumber?: string | null;
      onFinalized: (invoiceNumber: string) => void;
    } = $props();`);
    expect(names.has("matterNumber")).toBe(true);
    expect(names.has("invoiceNumber")).toBe(false);
  });
});

describe("the allowance list is itself audited", () => {
  const dirty = `<script lang="ts"></script>
<ActionDialog heading="Assign A Category" commitLabel="Assign" />`;

  it("stands a violation down when one is recorded", () => {
    const result = auditModalHeaders({
      files: [{ path: "f.svelte", source: dirty }],
      identifiers: identifiers(),
      allowances: [
        { rule: "heading-case", file: "f.svelte", text: 'capitalises "A"', reason: "recorded" },
      ],
    });
    expect(result.problems).toEqual([]);
    expect(result.standing).toHaveLength(1);
  });

  it("fails when an allowance has outlived its violation", () => {
    // The same discipline tooling/lint-one-ui holds its list to: a list nobody re-reads is how a
    // gate goes quiet without anybody noticing.
    const result = auditModalHeaders({
      files: [{ path: "f.svelte", source: '<ActionDialog heading="Assign a Category" />' }],
      identifiers: identifiers(),
      allowances: [
        { rule: "heading-case", file: "f.svelte", text: 'capitalises "A"', reason: "recorded" },
      ],
    });
    expect(result.problems.map((problem) => problem.rule)).toEqual(["allowance"]);
  });
});
