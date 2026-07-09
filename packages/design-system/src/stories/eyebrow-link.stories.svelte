<script module lang="ts">
  /*
   * EyebrowLink — Tier 1. A masthead eyebrow that navigates: the subtle letterspaced small-caps
   * kicker, rendered as an anchor with a consumer-supplied leading icon and label. There is no
   * variant axis, so the catalog is a single Docs Primary showcase; the component's own logic
   * (anchor + href, the aria-label accessible name, the decorative icon) rides a hidden, test-only
   * story so the same link is not re-rendered on the Docs page. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import EyebrowLink from "../lib/components/eyebrow-link/index.ts";

  const { Story } = defineMeta({
    title: "Navigation/Eyebrow Link",
    component: EyebrowLink,
    args: { href: "#eyebrow-link-destination" },
  });

  type EyebrowLinkStoryArgs = ComponentProps<typeof EyebrowLink>;
</script>

<!-- The showcase and Docs Primary: a return affordance naming its destination. The bare word is
     ambiguous read aloud next to a masthead, so the anchor carries an explicit "Back to Tools"
     accessible name (the visible text stays a substring — WCAG Label in Name); the arrow is
     decorative and hidden from assistive tech. -->
{#snippet template(args: EyebrowLinkStoryArgs)}
  <EyebrowLink {...args} aria-label="Back to Tools">
    <ArrowLeft class="size-12" aria-hidden="true" />
    Tools
  </EyebrowLink>
{/snippet}

<Story name="Default" {template} />

<!-- Behaviour: the component's own logic (a real <a> carrying href, the accessible name, the
     decorative icon). Tagged out of the sidebar and the Docs page, but still run by the test
     addon — so it stays covered without cluttering the catalog. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    await step("Renders an anchor carrying the given href", async () => {
      const link = canvas.getByRole("link", { name: "Back to Tools" });
      await expect(link.tagName).toBe("A");
      await expect(link).toHaveAttribute("href", "#eyebrow-link-destination");
    });
    await step("Accessible name is the consumer's aria-label; visible text is a substring", async () => {
      const link = canvas.getByRole("link", { name: "Back to Tools" });
      await expect(link).toHaveAccessibleName("Back to Tools");
      await expect(link).toHaveTextContent("Tools");
    });
    await step("The leading icon is decorative (hidden from assistive tech)", async () => {
      const icon = canvas.getByTestId("eyebrow-link-icon");
      await expect(icon).toHaveAttribute("aria-hidden", "true");
    });
  }}
>
  {#snippet template()}
    <EyebrowLink href="#eyebrow-link-destination" aria-label="Back to Tools">
      <ArrowLeft class="size-12" aria-hidden="true" data-testid="eyebrow-link-icon" />
      Tools
    </EyebrowLink>
  {/snippet}
</Story>
