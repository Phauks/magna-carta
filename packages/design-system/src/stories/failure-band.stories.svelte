<script module lang="ts">
  /*
   * FailureBand — Feedback. One story per REMEDY, because the remedy is the band's real variant
   * axis: what changes between these is not decoration but whether the member has a way through,
   * and each one is a field the API sends that the app used to drop unread. The copy behaviour of
   * the Error ID chip rides the first story, since it is the same control in all of them.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor } from "storybook/test";
  import Button from "../lib/components/button/index.ts";
  import FailureBand from "../lib/components/failure-band/failure-band.svelte";

  const { Story } = defineMeta({
    title: "Feedback/FailureBand",
    component: FailureBand,
    args: {
      variant: "danger",
      title: "That cost could not be voided",
      message:
        "It has already been claimed on a finalized bill. Raise a credit note on the bill instead.",
      errorId: "err_7FQ2K9XW",
    },
    argTypes: {
      variant: { control: "select", options: ["info", "success", "warning", "danger"] },
    },
    parameters: {
      controls: { include: ["variant", "title", "message", "note", "errorId"] },
    },
  });

  type FailureBandStoryArgs = ComponentProps<typeof FailureBand>;
</script>

<!-- A refusal with no way round it: the band offers a report, never a Retry that would refuse
     identically. -->
<Story
  name="Refused"
  play={async ({ canvas, step }) => {
    await step("It announces assertively, being a danger", async () => {
      await expect(canvas.getByRole("alert")).toHaveTextContent("could not be voided");
    });
    await step("The Error ID is a control, named for what pressing it does", async () => {
      await expect(
        canvas.getByRole("button", { name: "Error ID err_7FQ2K9XW, copy" }),
      ).toBeVisible();
    });
    await step("Pressing it reports what actually happened", async () => {
      const chip = canvas.getByRole("button", { name: /^Error ID / });
      await userEvent.click(chip);
      // waitFor, because copying is asynchronous: the chip reads "copy" until it settles, and a
      // synchronous assertion races it. Either outcome is correct — a headless browser may refuse
      // the clipboard, and the point of this control is that it never claims a success it did not
      // have.
      await waitFor(() => expect(chip).toHaveTextContent(/copied|select to copy/));
    });
  }}
>
  {#snippet template(args: FailureBandStoryArgs)}
    <FailureBand {...args}>
      {#snippet actions()}
        <Button variant="secondary" size="sm">Report a problem</Button>
      {/snippet}
    </FailureBand>
  {/snippet}
</Story>

<!-- A lockout. Not a verdict on what was entered, and the control says when rather than failing
     again immediately. -->
<Story
  name="Rate limited"
  args={{
    variant: "warning",
    title: "Too many attempts",
    message: "Wait a moment, then try again. Nothing was changed, and nothing you sent was wrong.",
    note: "2 attempts remain.",
    errorId: "err_2M4XB1PD",
  }}
>
  {#snippet template(args: FailureBandStoryArgs)}
    <FailureBand {...args}>
      {#snippet actions()}
        <Button variant="secondary" size="sm" disabled>Retry in 47s</Button>
      {/snippet}
    </FailureBand>
  {/snippet}
</Story>

<!-- A way THROUGH, which is why it is info rather than danger: nothing is broken, and one control
     finishes the job. -->
<Story
  name="Step-up required"
  args={{
    variant: "info",
    title: "Confirm it is you",
    message: "Moving client money needs a fresh sign-in. Nothing has left the trust ledger.",
    errorId: "err_9TG5RC0K",
  }}
>
  {#snippet template(args: FailureBandStoryArgs)}
    <FailureBand {...args}>
      {#snippet actions()}
        <Button variant="primary" size="sm">Confirm identity</Button>
      {/snippet}
    </FailureBand>
  {/snippet}
</Story>

<Story
  name="Access can be requested"
  args={{
    variant: "info",
    title: "You do not have access to this matter",
    message: "It is restricted. You can ask the responsible attorney for access.",
    errorId: "err_4WJ8HN2A",
  }}
>
  {#snippet template(args: FailureBandStoryArgs)}
    <FailureBand {...args}>
      {#snippet actions()}
        <Button variant="primary" size="sm">Request access</Button>
      {/snippet}
    </FailureBand>
  {/snippet}
</Story>

<!-- No handle and no remedy: the footer row disappears entirely rather than leaving an empty rail
     or a control that does nothing. -->
<Story
  name="Nothing to press"
  args={{
    title: "Couldn't connect",
    message:
      "The request did not reach Magna Carta, or the answer never arrived. Check your connection, then try again.",
    errorId: null,
  }}
  play={async ({ canvas, step }) => {
    await step("It renders no controls at all", async () => {
      await expect(canvas.queryByRole("button")).toBeNull();
    });
  }}
>
  {#snippet template(args: FailureBandStoryArgs)}
    <FailureBand {...args} />
  {/snippet}
</Story>

<!-- A server fault, summary-led: the area, the action and the kind of failure on one line, the
     facts behind Show details, and Copy details beside the remedy. The shape the app uses for every
     failed call. -->
<Story
  name="Summary"
  args={{
    variant: "danger",
    title: "The room could not be joined",
    message: "Something went wrong on our side. Nothing was changed.",
    errorId: null,
    summary: ["Meetings", "Join meeting", "Server fault: TypeError"],
    rows: [
      { label: "Request", value: "POST /meetings/meeting_0K2/join", mono: true },
      { label: "Answer", value: "500 Internal server error" },
      {
        label: "Cause",
        value: "TypeError: Cannot read properties of undefined (reading 'sessionId')",
        mono: true,
      },
      { label: "Error ID", value: "error_0mwfnax8napiSlVeIBqj4", mono: true },
    ],
    trace: "Magna Carta — error report\narea: Meetings\nerror id: error_0mwfnax8napiSlVeIBqj4",
  }}
  play={async ({ canvas, step }) => {
    await step("The summary names the failure without opening anything", async () => {
      await expect(canvas.getByRole("list", { name: "What failed" })).toHaveTextContent(
        "Server fault: TypeError",
      );
      await expect(canvas.queryByText("error_0mwfnax8napiSlVeIBqj4")).toBeNull();
    });
    await step("Show details opens the facts, the Error ID among them", async () => {
      const toggle = canvas.getByRole("button", { name: "Show details" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(toggle);
      await expect(canvas.getByText("error_0mwfnax8napiSlVeIBqj4")).toBeVisible();
      await expect(canvas.getByRole("button", { name: "Hide details" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });
    await step("Copy details is there either way", async () => {
      await expect(canvas.getByRole("button", { name: "Copy details" })).toBeVisible();
    });
  }}
>
  {#snippet template(args: FailureBandStoryArgs)}
    <FailureBand {...args}>
      {#snippet actions()}
        <Button variant="secondary" size="sm">Retry</Button>
      {/snippet}
    </FailureBand>
  {/snippet}
</Story>
