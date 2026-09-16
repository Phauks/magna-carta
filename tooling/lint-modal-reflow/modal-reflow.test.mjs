// What the modal-reflow detector must and must not see. The four cases here are the four judgements
// the rule makes, each one a real shape from this codebase rather than an invented one.
import { describe, expect, it } from "vitest";
import { modalReflowFindings } from "./modal-reflow.mjs";

describe("modalReflowFindings", () => {
  it("finds a press that reveals content inside the window", () => {
    const found = modalReflowFindings(`
<ActionDialog kind="form" bind:open heading="Change Status">
  {#snippet fields()}
    <Button aria-expanded={formOpen} onclick={() => (formOpen = !formOpen)}>Set Location</Button>
    {#if formOpen}<OfficePicker />{/if}
  {/snippet}
</ActionDialog>
`);
    expect(found.map((finding) => finding.expression)).toEqual(["formOpen"]);
  });

  it("reads a snippet the window is handed, wherever in the file it is written", () => {
    // The two-sided panels write their right side at the bottom of the file, past the closing tag.
    const found = modalReflowFindings(`
<ActionDialog kind="reading" bind:open context={physicalFile}></ActionDialog>

{#snippet physicalFile()}
  <Button aria-expanded={shown} onclick={() => (shown = !shown)}>Set Location</Button>
{/snippet}
`);
    expect(found.map((finding) => finding.expression)).toEqual(["shown"]);
  });

  it("leaves a screen's own fold alone, even where the screen also opens a window", () => {
    const found = modalReflowFindings(`
<section>
  <Button aria-expanded={historyShown} onclick={() => (historyShown = !historyShown)}>History</Button>
</section>

<ActionDialog kind="form" bind:open heading="Record Something"></ActionDialog>
`);
    expect(found).toEqual([]);
  });

  it("leaves the control that OPENS the window alone — that reveal is a second panel", () => {
    const found = modalReflowFindings(`
<button aria-expanded={open} onclick={() => (open = true)}>Matter Status</button>
<ActionDialog kind="reading" bind:open heading="Matter Status"></ActionDialog>
`);
    expect(found).toEqual([]);
  });

  it("honours the house escape comment on the line", () => {
    const found = modalReflowFindings(`
<ActionDialog kind="form" bind:open heading="Report a Bug">
  <!-- fitness-allow: the diagnostics fold predates the ruling --><Button aria-expanded={shown} />
</ActionDialog>
`);
    expect(found).toEqual([]);
  });
});
