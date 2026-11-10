<script module lang="ts">
  /*
   * SourceQuote — the citation card a claim's quoted passage sits in, one per source kind.
   *
   * The stories are the three kinds side by side in the order an answer usually cites them (the
   * statute, the case that reads it, the client's own paper), then a card with nothing but a title
   * and a passage, which is the least a caller can pass. Every word here is the story's: the
   * component holds no copy.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Button from "../lib/components/button/index.ts";
  import SourceQuote from "../lib/components/source-quote/source-quote.svelte";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";

  const STATUTE =
    "Within four years: (a) An action upon any contract, obligation or liability founded upon an instrument in writing …";
  const CASE =
    "[Sample passage: the court's statement that a breach-of-contract claim accrues at the time of breach, not when the contract was signed.]";
  const CLAUSE =
    "18.2 Any claim arising out of this Agreement must be brought within one (1) year after the cause of action accrues.";

  const { Story } = defineMeta({
    title: "Data Display/Source Quote",
    component: SourceQuote,
  });
</script>

{#snippet acts(openLabel: string)}
  <Button variant="ghost" size="sm"><ExternalLink class="size-12" aria-hidden="true" />{openLabel}</Button>
  <Button variant="ghost" size="icon-sm" aria-label="Copy citation">
    <Copy class="size-16" aria-hidden="true" />
  </Button>
{/snippet}

{#snippet threeKinds()}
  <div class="flex w-xl max-w-full flex-col gap-16">
    <SourceQuote
      kind="statute"
      kindLabel="Statute"
      number={1}
      title="Cal. Code Civ. Proc. § 337(a)"
      location="California Code of Civil Procedure, section 337, subdivision (a)"
      check="Checked against Westlaw"
      provenance="Westlaw · current through the 2026 session"
    >
      {#snippet actions()}{@render acts("Open in Westlaw")}{/snippet}
      {STATUTE}
    </SourceQuote>
    <SourceQuote
      kind="case"
      kindLabel="Case"
      number={2}
      title="[Sample case name]"
      location="[volume] Cal.App.5th [page], [pin] (Court of Appeal, [year])"
      check="Shepard's: no negative treatment"
      provenance="Lexis · retrieved 9 Nov 2026, 2:01 PM"
    >
      {#snippet actions()}{@render acts("Open in Lexis")}{/snippet}
      {CASE}
    </SourceQuote>
    <SourceQuote
      kind="file"
      kindLabel="Matter File"
      number={3}
      title="Carriage Agreement.pdf"
      location="Matter Files › Contracts · page 11, clause 18.2 · version 2"
      check="Verified Quote"
      provenance="2026-0147 Harlow v. Brennan Logistics · read 9 Nov 2026, 2:01 PM"
    >
      {#snippet actions()}{@render acts("Open at Page 11")}{/snippet}
      {CLAUSE}
    </SourceQuote>
  </div>
{/snippet}

<Story
  name="The three kinds"
  template={threeKinds}
  play={async ({ canvas, canvasElement, step }) => {
    await step("Each card names its kind and number on its tab", async () => {
      await expect(canvas.getByText("Statute")).toBeVisible();
      await expect(canvas.getByText("[3]")).toBeVisible();
    });
    await step("The quote is a blockquote inside a figure", async () => {
      const quotes = canvasElement.querySelectorAll("figure.mc-source-quote blockquote");
      await expect(quotes).toHaveLength(3);
    });
    await step("The kinds are stamped for the recipe to colour", async () => {
      const kinds = [...canvasElement.querySelectorAll("figure.mc-source-quote")].map((figure) =>
        figure.getAttribute("data-kind"),
      );
      await expect(kinds).toEqual(["statute", "case", "file"]);
    });
  }}
/>

{#snippet bare()}
  <div class="flex w-xl max-w-full flex-col">
    <SourceQuote kind="file" kindLabel="Matter File" title="Engagement Letter.pdf">
      The fee arrangement is restated only where an amendment changes it.
    </SourceQuote>
  </div>
{/snippet}

<Story
  name="The least a caller can pass"
  template={bare}
  play={async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".mc-source-quote-foot")).toBeNull();
    await expect(canvasElement.querySelector(".mc-source-quote-actions")).toBeNull();
  }}
/>
