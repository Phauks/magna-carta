<script module lang="ts">
  /*
   * PrintSheet — the printable unit. The catalog shows the paper as the reader sees it before it
   * goes to a printer, because that is the whole promise: what is on the screen is what comes out.
   *
   * Four stories, because four things about it can be wrong independently: the full sheet; the
   * sheet standing ABOVE the surface it was opened from (the defect this component exists to make
   * impossible — a preview that replaces the record leaves the reader nowhere to come back to); a
   * sparse record with a history that has nothing in it yet; and a long one, which must scroll
   * inside a panel capped at the viewport rather than pushing its own actions off the screen.
   *
   * The surface underneath is a plain Dialog rather than the record window, deliberately: the
   * guarantee is that the sheet layers over WHATEVER opened it, and a fixture that knew about one
   * particular kind of window would be testing that window instead.
   *
   * The fixture is built the way a consumer must build one — the record goes through
   * `clientFacingRecord` and `printSheetFields`, so the firm's internal memo is gone before the
   * document exists. The first story's play function asserts it is nowhere on the paper, and
   * asserts the rendered page against `printSheetTextContent`, so the page and that reading of the
   * document cannot drift apart unnoticed.
   *
   * The panel portals to the body, so every play function queries `within(document.body)` rather
   * than the story canvas. Render is always an explicit named `template` snippet.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import * as Dialog from "../lib/components/dialog/index.ts";
  import PrintSheet from "../lib/components/print-sheet/print-sheet.svelte";
  import {
    clientFacingRecord,
    printSheetFields,
  } from "../lib/components/print-sheet/client-facing-projection.ts";
  import { printSheetTextContent } from "../lib/components/print-sheet/print-sheet-text.ts";
  import type { PrintSheetDocument } from "../lib/components/print-sheet/types.ts";

  const { Story } = defineMeta({
    title: "Overlay/PrintSheet",
    component: PrintSheet,
    parameters: {
      // The document and the open flag are not controls: one is the whole fixture, the other is
      // owned by the caller. The two action labels are what a consumer actually reconsiders.
      controls: { include: ["printLabel", "closeLabel"] },
    },
  });

  /** A charge as a consumer holds one, internal text and all. */
  const CHARGE = {
    date: "3 August 2026",
    dateEntered: "3 August 2026",
    timekeeper: "Dana Okoye",
    enteredBy: "Marcus Bell",
    hours: "2.50",
    hoursClockForm: "2:30",
    rate: "$350.00 per hour",
    amount: "$875.00",
    description:
      "Drafted the motion to compel, reviewed the responses served on 28 July, and conferred with opposing counsel on the outstanding requests.",
    internalMemo: "The client disputes every invoice. Bill this one to the letter.",
  };

  const CHARGE_ON_PAPER = clientFacingRecord(CHARGE);

  const WORK_FIELDS = printSheetFields(CHARGE_ON_PAPER, [
    { key: "date", label: "Date" },
    { key: "timekeeper", label: "Timekeeper" },
    { key: "hours", label: "Hours", secondaryKey: "hoursClockForm" },
    { key: "rate", label: "Rate" },
    { key: "amount", label: "Amount" },
  ]);

  const timeEntrySheet: PrintSheetDocument = {
    heading: "Time Entry",
    reference: "2026-0147.0042",
    subtitle: "Acme Holdings, commercial lease",
    sections: [
      {
        id: "facts",
        kind: "fields",
        title: "The Work",
        fields: WORK_FIELDS,
      },
      {
        id: "description",
        kind: "text",
        title: "Description",
        text: CHARGE_ON_PAPER.description,
      },
      {
        id: "history",
        kind: "history",
        title: "History",
        events: [
          {
            id: "entered",
            action: "Entered as a draft",
            at: "2026-08-03T16:20:00.000Z",
            source: "Marcus Bell",
          },
          {
            id: "submitted",
            action: "Submitted for review",
            at: "2026-08-04T09:05:00.000Z",
            source: "Dana Okoye",
          },
          {
            id: "kicked-back",
            action: "Kicked back to draft",
            at: "2026-08-04T14:40:00.000Z",
            source: "Priya Raman",
            detail: "Please split the conferral out from the drafting.",
          },
        ],
      },
    ],
    footer: "Printed 5 August 2026 by Marcus Bell.",
  };

  const sparseSheet: PrintSheetDocument = {
    heading: "Cost",
    reference: "2026-0147.0009",
    sections: [
      {
        id: "facts",
        kind: "fields",
        fields: [
          { label: "Date", value: "1 August 2026" },
          { label: "Amount", value: "$42.00" },
        ],
      },
      { id: "history", kind: "history", title: "History", events: [] },
    ],
  };

  const longSheet: PrintSheetDocument = {
    heading: "Time Entry",
    reference: "2026-0147.0058",
    subtitle: "Acme Holdings, commercial lease",
    sections: [
      {
        id: "facts",
        kind: "fields",
        title: "The Work",
        fields: WORK_FIELDS,
      },
      {
        id: "history",
        kind: "history",
        title: "History",
        events: Array.from({ length: 24 }, (_unused, index) => ({
          id: `event-${index}`,
          action: `Description amended, revision ${index + 1}`,
          at: `2026-08-${String((index % 27) + 1).padStart(2, "0")}T10:00:00.000Z`,
          source: "Dana Okoye",
        })),
      },
    ],
    footer: "Printed 5 August 2026 by Marcus Bell.",
  };
</script>

<script lang="ts">
  // One flag per story, so opening one sheet leaves the other stories' triggers alone.
  const showing = $state({ full: false, layered: false, sparse: false, long: false, record: false });
</script>

{#snippet template()}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.full = true)}
  >
    Print this entry
  </button>
  <PrintSheet sheet={timeEntrySheet} bind:open={showing.full} />
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("The sheet shows the paper, with its actions beside it", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Print this entry" }));
      const sheet = await body.findByRole("dialog");
      await waitFor(() => expect(sheet).toBeVisible());
      await expect(sheet).toHaveAccessibleName("Time Entry");
      await expect(body.getByRole("button", { name: "Print" })).toBeVisible();
      await expect(body.getByRole("button", { name: "Close" })).toBeVisible();
    });

    await step("Everything the document says is on the page, and nothing else is", async () => {
      const sheet = await body.findByRole("dialog");
      const printed = sheet.textContent ?? "";
      for (const stated of printSheetTextContent(timeEntrySheet)) {
        expect(printed).toContain(stated);
      }
    });

    await step("The firm's internal memo is not on the paper, and is not named", async () => {
      const sheet = await body.findByRole("dialog");
      const printed = sheet.textContent ?? "";
      expect(printed).not.toContain(CHARGE.internalMemo);
      expect(printed).not.toContain("Memo");
    });

    await step("Close puts the sheet away", async () => {
      await userEvent.click(body.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
    });
  }}
/>

{#snippet layeredTemplate()}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.record = true)}
  >
    Open the record
  </button>
  <Dialog.Root bind:open={showing.record}>
    <Dialog.Content>
      <Dialog.Title>Deposition preparation</Dialog.Title>
      <Dialog.Description>The record stays open behind its own printed sheet.</Dialog.Description>
      <button
        type="button"
        class="mc-button mc-button-secondary mc-button-md"
        onclick={() => (showing.layered = true)}
      >
        Print the record
      </button>
    </Dialog.Content>
  </Dialog.Root>
  <PrintSheet sheet={timeEntrySheet} bind:open={showing.layered} />
{/snippet}

<Story
  name="AboveTheSurfaceThatOpenedIt"
  template={layeredTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("The record opens first", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Open the record" }));
      await waitFor(() => expect(body.getByText("Deposition preparation")).toBeVisible());
    });

    await step("Printing lays the sheet OVER the record, which is still there", async () => {
      await userEvent.click(body.getByRole("button", { name: "Print the record" }));
      await waitFor(() => expect(body.getByText("Time Entry")).toBeVisible());
      // The record is still on the screen underneath: the sheet layered above it rather than
      // taking its place, which is what makes closing the sheet a return rather than a loss.
      await expect(body.getByText("Deposition preparation")).toBeInTheDocument();
    });

    await step("Closing the sheet gives the reader back the record", async () => {
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByText("Time Entry")).toBeNull());
      await expect(body.getByText("Deposition preparation")).toBeVisible();
    });
  }}
/>

{#snippet sparseTemplate()}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.sparse = true)}
  >
    Print the cost
  </button>
  <PrintSheet sheet={sparseSheet} bind:open={showing.sparse} />
{/snippet}

<Story
  name="LittleRecorded"
  template={sparseTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("A record with little on it prints what there is, and says so", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Print the cost" }));
      const sheet = await body.findByRole("dialog");
      await waitFor(() => expect(sheet).toBeVisible());
      await expect(body.getByText("Nothing has been recorded here yet.")).toBeVisible();
    });
  }}
/>

{#snippet longTemplate()}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.long = true)}
  >
    Print the long entry
  </button>
  <PrintSheet sheet={longSheet} bind:open={showing.long} />
{/snippet}

<Story
  name="LongerThanTheScreen"
  template={longTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("A long sheet scrolls inside the panel, and the actions stay put", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Print the long entry" }));
      const sheet = await body.findByRole("dialog");
      await waitFor(() => expect(sheet).toBeVisible());
      // The panel is capped at the viewport and only the tray holding the paper scrolls, so the
      // Print and Close buttons cannot be pushed off the bottom of a long record.
      expect(sheet.clientHeight).toBeLessThanOrEqual(window.innerHeight);
      await expect(body.getByRole("button", { name: "Print" })).toBeVisible();
    });
  }}
/>
