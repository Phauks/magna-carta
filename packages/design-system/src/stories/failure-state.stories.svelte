<script module lang="ts">
  /*
   * FailureState — Feedback. One story per SCALE, because that is what genuinely differs: a panel
   * shows the four facts and gets out of the way; a screen has room to be complete and carries the
   * trace and the ordered remedy. The third story is the reassurance line doing its job, which is
   * the sentence this component exists to make sure never goes missing.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import Button from "../lib/components/button/index.ts";
  import FailureState from "../lib/components/failure-state/failure-state.svelte";

  const ROWS = [
    { label: "Request", value: "GET /matters/mat_8QK2/costs", mono: true },
    { label: "Answer", value: "503" },
    { label: "Time", value: "31 Aug 2026, 2:07 PM" },
    { label: "Error ID", value: "err_7FQ2K9XW", mono: true },
  ];

  const TRACE = `Magna Carta — error report
build: 6b4fed0 (production, built 2026-08-31T20:14:02.000Z)
route: /matters/mat_8QK2/costs
request: GET /matters/mat_8QK2/costs
failed: 2026-08-31T21:07:44.318Z
copied: 2026-08-31T21:09:02.001Z
status: 503
problem type: https://api.magnacarta.esq/problems/upstream-unavailable
detail: The costs could not be read just now.
error id: err_7FQ2K9XW
correlation id: cor_01JB9K3M2ZT4
network: online`;

  const STEPS = [
    "Retry: a brief interruption usually clears on the next read.",
    "Check your connection, and whether the matter's other tabs load.",
    "If it keeps failing, report it with the Error ID above.",
  ];

  const { Story } = defineMeta({
    title: "Feedback/FailureState",
    component: FailureState,
    args: {
      title: "Costs could not be read",
      message: "The service is briefly unavailable.",
      reassurance:
        "The record itself is unaffected: nothing was changed by this failure, and the costs are still on the firm's record.",
      rows: ROWS,
      trace: TRACE,
      showTrace: false,
    },
    parameters: {
      controls: { include: ["title", "message", "reassurance", "note", "showTrace"] },
    },
  });

  type FailureStateStoryArgs = ComponentProps<typeof FailureState>;
</script>

<!-- Panel scale: the failure replaces one panel's body while the rest of the screen keeps working,
     so it stays compact and skips the trace and the ordered remedy. -->
<Story
  name="Panel scale"
  play={async ({ canvas, step }) => {
    await step("It says the record survived, before anything else", async () => {
      await expect(canvas.getByText(/The record itself is unaffected/)).toBeVisible();
    });
    await step("The Error ID is on the screen, not in a console", async () => {
      await expect(canvas.getByText("err_7FQ2K9XW")).toBeVisible();
    });
  }}
>
  {#snippet template(args: FailureStateStoryArgs)}
    <FailureState {...args}>
      {#snippet actions()}
        <Button variant="primary" size="sm">Retry</Button>
        <Button variant="secondary" size="sm">Report a problem</Button>
      {/snippet}
    </FailureState>
  {/snippet}
</Story>

<!-- Screen scale: the failure owns the body, so it carries the whole trace and ends on the ordered
     remedy — whose last step is the only one that reaches a person. -->
<Story name="Screen scale" args={{ showTrace: true, steps: STEPS }}>
  {#snippet template(args: FailureStateStoryArgs)}
    <FailureState {...args}>
      {#snippet actions()}
        <Button variant="primary">Retry</Button>
        <Button variant="secondary">Report a problem</Button>
      {/snippet}
    </FailureState>
  {/snippet}
</Story>

<!-- A refusal with a way THROUGH. The remedy is not a Retry — retrying would refuse identically —
     so the control is the one that actually finishes the job. -->
<Story
  name="A remedy, not a retry"
  args={{
    title: "You do not have access to this matter",
    message: "Ross v. Delacroix Holdings is restricted.",
    reassurance: "Nothing about the matter has been disclosed by this attempt.",
    rows: [
      { label: "Request", value: "GET /matters/mat_8QK2", mono: true },
      { label: "Answer", value: "403" },
      { label: "Time", value: "31 Aug 2026, 2:07 PM" },
      { label: "Error ID", value: "err_4WJ8HN2A", mono: true },
    ],
    showTrace: false,
  }}
>
  {#snippet template(args: FailureStateStoryArgs)}
    <FailureState {...args}>
      {#snippet actions()}
        <Button variant="primary" size="sm">Request access</Button>
      {/snippet}
    </FailureState>
  {/snippet}
</Story>

<!-- Nothing answered, and a budget the server published. The note carries the fact the message has
     no room for. -->
<Story
  name="With an attempt budget"
  args={{
    title: "Too many attempts",
    message: "Wait a moment, then try again. Nothing was changed.",
    reassurance: undefined,
    note: "2 attempts remain.",
    rows: [
      { label: "Request", value: "POST /invitations/redemptions", mono: true },
      { label: "Answer", value: "429" },
      { label: "Time", value: "31 Aug 2026, 2:07 PM" },
      { label: "Error ID", value: "err_2M4XB1PD", mono: true },
    ],
    showTrace: false,
  }}
>
  {#snippet template(args: FailureStateStoryArgs)}
    <FailureState {...args}>
      {#snippet actions()}
        <Button variant="secondary" size="sm" disabled>Retry in 47s</Button>
      {/snippet}
    </FailureState>
  {/snippet}
</Story>

<!-- Summary-led: the area, the action and the kind of failure lead, and the facts wait behind Show
     details. The shape the app's failed panels and crash screens take. -->
<Story
  name="Summary"
  args={{
    summary: ["Meetings", "App fault: TypeError"],
    showTrace: true,
  }}
  play={async ({ canvas, step }) => {
    await step("The summary leads and the facts are closed", async () => {
      await expect(canvas.getByRole("list", { name: "What failed" })).toHaveTextContent(
        "App fault: TypeError",
      );
      await expect(canvas.queryByText("err_7FQ2K9XW")).toBeNull();
    });
    await step("Show details opens them", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Show details" }));
      await expect(canvas.getByText("err_7FQ2K9XW")).toBeVisible();
    });
  }}
>
  {#snippet template(args: FailureStateStoryArgs)}
    <FailureState {...args}>
      {#snippet actions()}
        <Button variant="primary">Reload</Button>
        <Button variant="secondary">Report a problem</Button>
      {/snippet}
    </FailureState>
  {/snippet}
</Story>
