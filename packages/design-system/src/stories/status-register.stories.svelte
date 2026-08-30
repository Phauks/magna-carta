<script module lang="ts">
  /*
   * The status register — the vocabulary, laid out one story per vocabulary so the four can be read
   * against each other. There is no StatusChip component to show here, deliberately: the register
   * is data, the chip is `Badge`, and this catalog entry exists so a reader can see that a word
   * carries the same tone in every vocabulary that speaks it.
   *
   * The play functions assert the two things a picture cannot: that the meaning is on the hover
   * rather than printed under the chip, and that a withdrawn record is an ordinary chip with
   * nothing struck or dimmed.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import CircleCheckBig from "@lucide/svelte/icons/circle-check-big";
  import { expect } from "storybook/test";
  import Badge from "../lib/components/badge/index.ts";
  import {
    statusBadgeAttributes,
    statusEntry,
    statusMarkClasses,
    statusVocabulary,
    type StatusVocabulary,
  } from "../lib/status-register/index.ts";

  const { Story } = defineMeta({
    title: "Data Display/Status register",
    component: Badge,
    parameters: { controls: { include: ["variant"] } },
  });
</script>

<!-- One vocabulary as its chips, in the register's own reading order. The clean verdict renders as
     the bare mark rather than a chip, which is why the row draws whichever the entry asks for. -->
{#snippet vocabulary(name: StatusVocabulary)}
  <div class="flex flex-wrap items-center gap-8">
    {#each statusVocabulary(name) as entry (entry.label)}
      {#if entry.presentation === "mark"}
        <CircleCheckBig class={statusMarkClasses()} aria-label={entry.label} />
      {:else}
        <Badge variant={entry.tone} title={entry.meaning}>{entry.label}</Badge>
      {/if}
    {/each}
  </div>
{/snippet}

{#snippet workflowChain()}
  {@render vocabulary("workflowChain")}
{/snippet}

<Story
  name="Work in progress"
  template={workflowChain}
  play={async ({ canvas, step }) => {
    await step("The meaning rides the hover, never a sentence beneath the chip", async () => {
      await expect(canvas.getByText("Billed")).toHaveAttribute(
        "title",
        statusEntry("billed").meaning,
      );
      await expect(canvas.queryByText(statusEntry("billed").meaning)).toBeNull();
    });
    await step("A withdrawn record is an ordinary chip, struck and dimmed nowhere", async () => {
      const chip = canvas.getByText("Void");
      await expect(chip).toHaveAttribute("title", statusEntry("void").meaning);
      const painted = getComputedStyle(chip);
      await expect(painted.textDecorationLine).toBe("none");
      await expect(painted.opacity).toBe("1");
    });
  }}
/>

{#snippet invoiceStanding()}
  {@render vocabulary("invoiceStanding")}
{/snippet}

<Story
  name="Invoice standing"
  template={invoiceStanding}
  play={async ({ canvas, step }) => {
    await step("Draft is the same word, in the same tone, as the chain's", async () => {
      await expect(canvas.getByText("Draft")).toHaveAttribute(
        "title",
        statusEntry("draft").meaning,
      );
      await expect(statusBadgeAttributes("draft").variant).toBe("neutral");
    });
  }}
/>

{#snippet chargeStanding()}
  {@render vocabulary("chargeStanding")}
{/snippet}

<Story name="Charge, read off its invoice" template={chargeStanding} />

{#snippet safety()}
  {@render vocabulary("safety")}
{/snippet}

<Story
  name="File safety"
  template={safety}
  play={async ({ canvas, step }) => {
    await step("A clean, typed file carries the mark and no chip at all", async () => {
      await expect(canvas.getByLabelText("Clean").tagName.toLowerCase()).toBe("svg");
    });
    await step("An unscanned file says so in its own word, not as a warning", async () => {
      await expect(canvas.getByText("Not scanned")).toBeInTheDocument();
    });
  }}
/>
