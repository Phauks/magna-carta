<script module lang="ts">
  /*
   * FailureDetails — Feedback. Two stories, because the block has exactly two shapes: the summary a
   * panel shows, and the summary plus the whole trace a screen-scale failure shows. The Copy
   * control's honesty is the behaviour worth pinning: it must never report a success the clipboard
   * did not give it, which is the whole reason it has a status line at all.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import FailureDetails from "../lib/components/failure-details/failure-details.svelte";

  const TRACE = `Magna Carta — error report
build: 6b4fed0 (production, built 2026-08-31T20:14:02.000Z)
route: /matters/mat_8QK2/costs
request: GET /matters/mat_8QK2/costs
failed: 2026-08-31T21:07:44.318Z
copied: 2026-08-31T21:09:02.001Z
status: 503
problem type: https://api.magnacarta.esq/problems/upstream-unavailable
title: The costs service is unavailable
detail: The costs could not be read just now.
error id: err_7FQ2K9XW
correlation id: cor_01JB9K3M2ZT4
browser: Mozilla/5.0 (Windows NT 10.0; Win64; x64)
viewport: 1440x900
language: en-GB
time zone: America/Los_Angeles
network: online
breadcrumbs (oldest first):
  2026-08-31T21:07:31.002Z navigation: /matters/mat_8QK2
  2026-08-31T21:07:39.771Z action: opened the Costs tab
  2026-08-31T21:07:44.318Z request: GET /matters/mat_8QK2/costs`;

  const { Story } = defineMeta({
    title: "Feedback/FailureDetails",
    component: FailureDetails,
    args: {
      rows: [
        { label: "Request", value: "GET /matters/mat_8QK2/costs", mono: true },
        { label: "Answer", value: "503" },
        { label: "Time", value: "31 Aug 2026, 2:07 PM" },
        { label: "Error ID", value: "err_7FQ2K9XW", mono: true },
      ],
      trace: TRACE,
      showTrace: false,
    },
    parameters: { controls: { include: ["showTrace"] } },
  });

  type FailureDetailsStoryArgs = ComponentProps<typeof FailureDetails>;
</script>

<!-- Panel scale: the four facts a reader scans. The whole trace is still what Copy puts on the
     clipboard — reading and sending are not the same job. -->
<Story
  name="Summary"
  play={async ({ canvas, step }) => {
    await step("The four facts are stated, not hidden behind a console", async () => {
      await expect(canvas.getByText("Error ID")).toBeVisible();
      await expect(canvas.getByText("err_7FQ2K9XW")).toBeVisible();
    });
    await step("The trace is not shown at this scale", async () => {
      await expect(canvas.queryByText(/breadcrumbs \(oldest first\)/)).toBeNull();
    });
    await step("Copy reports what actually happened, either way", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Copy details" }));
      // findByText, not getByText: copying is asynchronous and the status line does not exist until
      // it settles, so a synchronous query races the clipboard and fails on a slow runner. Either
      // outcome is correct — a headless browser may refuse the clipboard, and the whole point of
      // this control is that it never claims a success it did not have.
      await expect(
        await canvas.findByText(/Copied|Your browser would not let us copy/),
      ).toBeVisible();
    });
  }}
>
  {#snippet template(args: FailureDetailsStoryArgs)}
    <FailureDetails {...args} />
  {/snippet}
</Story>

<!-- Screen scale: everything a report needs, visible and selectable. One click takes the whole
     block even where the clipboard is refused. -->
<Story name="With the full trace" args={{ showTrace: true }}>
  {#snippet template(args: FailureDetailsStoryArgs)}
    <FailureDetails {...args} />
  {/snippet}
</Story>

<!-- Nothing answered at all. The trace says so in as many words rather than leaving the reader to
     infer it from a missing status line. -->
<Story
  name="Couldn't connect"
  args={{
    rows: [
      { label: "Request", value: "GET /matters/mat_8QK2/costs", mono: true },
      { label: "Answer", value: "Couldn't connect" },
      { label: "Time", value: "31 Aug 2026, 2:07 PM" },
      { label: "Error ID", value: "None issued", mono: true },
    ],
    trace: `Magna Carta — error report
build: 6b4fed0 (production, built 2026-08-31T20:14:02.000Z)
route: /matters/mat_8QK2/costs
request: GET /matters/mat_8QK2/costs
failed: 2026-08-31T21:07:44.318Z
copied: 2026-08-31T21:09:02.001Z
answer: nothing answered — the request did not complete
browser: Mozilla/5.0 (Windows NT 10.0; Win64; x64)
viewport: 1440x900
language: en-GB
time zone: America/Los_Angeles
network: offline`,
    showTrace: true,
  }}
>
  {#snippet template(args: FailureDetailsStoryArgs)}
    <FailureDetails {...args} />
  {/snippet}
</Story>
