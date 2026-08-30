<script module lang="ts">
  /*
   * RecordChain — the stepper and its lock.
   *
   * The stories are the states that actually occur, and the first two are the pair that matters:
   * a firm with review turned OFF gets no chain and no review words anywhere, and a firm with it on
   * gets a quiet one. The gate-off story is not an empty placeholder; absence is the design.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import RecordChain from "../lib/components/record-chain/index.ts";

  const { Story } = defineMeta({
    title: "Data Display/RecordChain",
    component: RecordChain,
    parameters: { controls: { include: ["current", "reviewGate", "lock"] } },
    argTypes: {
      current: {
        control: "select",
        options: ["draft", "submitted", "approved", "billed", "paid"],
      },
    },
  });
</script>

{#snippet gateOff()}
  <div class="max-w-md"><RecordChain current="draft" /></div>
{/snippet}

<Story
  name="Review off"
  template={gateOff}
  play={async ({ canvas, step }) => {
    await step("The review vocabulary is absent, not disabled", async () => {
      await expect(canvas.queryByText("Submitted")).toBeNull();
      await expect(canvas.queryByText("Approved")).toBeNull();
      await expect(canvas.queryByRole("list")).toBeNull();
    });
  }}
/>

{#snippet gateOn()}
  <div class="max-w-md"><RecordChain current="approved" reviewGate /></div>
{/snippet}

<Story
  name="Review on"
  template={gateOn}
  play={async ({ canvas, step }) => {
    await step("Renders the whole chain, including what is still ahead", async () => {
      await expect(canvas.getAllByRole("listitem")).toHaveLength(5);
    });
    await step("Names the step the record has actually reached", async () => {
      await expect(canvas.getByText("Approved").closest("li")).toHaveAttribute(
        "aria-current",
        "step",
      );
    });
    await step("Each step's meaning rides its hover, never a line beneath the chain", async () => {
      await expect(canvas.getByText("Billed").closest("li")).toHaveAttribute("title");
    });
  }}
/>

{#snippet lockedOnAnInvoice()}
  <div class="max-w-md">
    <RecordChain
      current="billed"
      reviewGate
      lock={{ object: { label: "Invoice 2026-114", href: "#invoice-2026-114" } }}
    />
  </div>
{/snippet}

<Story
  name="Locked, on an invoice"
  template={lockedOnAnInvoice}
  play={async ({ canvas, step }) => {
    await step("States the fact and hands over the invoice as a link", async () => {
      await expect(canvas.getByText("Billed on")).toBeInTheDocument();
      await expect(canvas.getByRole("link", { name: "Invoice 2026-114" })).toHaveAttribute(
        "href",
        "#invoice-2026-114",
      );
    });
  }}
/>

<!-- The read-only window's single lock line: no chain, because this firm does not review, and one
     statement of why the record cannot be edited. -->
{#snippet lockLineAlone()}
  <div class="max-w-md">
    <RecordChain
      current="billed"
      lock={{ object: { label: "Invoice 2026-114", href: "#invoice-2026-114" } }}
    />
  </div>
{/snippet}

<Story
  name="Lock line alone"
  template={lockLineAlone}
  play={async ({ canvas, step }) => {
    await step("The lock survives the gate being off, because the record is locked either way", async () => {
      await expect(canvas.queryByRole("list")).toBeNull();
      await expect(canvas.getByRole("link", { name: "Invoice 2026-114" })).toBeInTheDocument();
    });
    await step("Says it once", async () => {
      await expect(canvas.getAllByText(/Billed on/)).toHaveLength(1);
    });
  }}
/>
