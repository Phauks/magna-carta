<script module lang="ts">
  /*
   * Masthead — the page's ceremonial edge (Tier 1, multi-part). Two instances: the matter
   * workspace masthead (eyebrow + serif case caption + citation meta + actions — the richest
   * form) and a plain list-page masthead. The Title defaults to the page h1; the serif display
   * face and the off-grid display weight enter the system ONLY through this component.
   * svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import * as Masthead from "../lib/components/masthead/index.ts";
  import MastheadRoot from "../lib/components/masthead/masthead.svelte";
  import Button from "../lib/components/button/index.ts";
  import Badge from "../lib/components/badge/index.ts";

  const { Story } = defineMeta({
    title: "Layout/Masthead",
    component: MastheadRoot,
    parameters: {
      controls: { include: [] },
    },
  });
</script>

<Story
  name="Matter workspace"
  play={async ({ canvas, step }) => {
    await step("The title is the page heading", async () => {
      const heading = canvas.getByRole("heading", { level: 1, name: "Pemberton v. Hale" });
      await expect(heading).toBeInTheDocument();
    });

    await step("Meta separators are punctuation, not content", async () => {
      const heading = canvas.getByRole("heading", { level: 1, name: "Pemberton v. Hale" });
      const masthead = heading.closest(".mc-masthead");
      const separator = masthead?.querySelector(".mc-masthead-meta-separator");
      await expect(separator).toHaveAttribute("aria-hidden", "true");
    });
  }}
>
  {#snippet template()}
    <Masthead.Root>
      <Masthead.Heading>
        <Masthead.Eyebrow>Matter 2026-0114</Masthead.Eyebrow>
        <Masthead.Title>Pemberton v. Hale</Masthead.Title>
        <Masthead.Meta>
          <span>Litigation</span>
          <Masthead.MetaSeparator />
          <span>Pemberton, J.</span>
          <Masthead.MetaSeparator />
          <span>A. Reyes responsible</span>
          <Badge variant="secondary">Open</Badge>
        </Masthead.Meta>
      </Masthead.Heading>
      <Masthead.Actions>
        <Button variant="secondary">Add time</Button>
        <Button variant="primary">New matter</Button>
      </Masthead.Actions>
    </Masthead.Root>
  {/snippet}
</Story>

<Story
  name="List page"
  tags={["!autodocs"]}
  play={async ({ canvas, step }) => {
    await step("A section masthead can step the heading level down", async () => {
      await expect(canvas.getByRole("heading", { level: 2, name: "Matters" })).toBeInTheDocument();
    });
  }}
>
  {#snippet template()}
    <Masthead.Root>
      <Masthead.Heading>
        <Masthead.Title level={2}>Matters</Masthead.Title>
        <Masthead.Meta>
          <span>8 open</span>
          <Masthead.MetaSeparator />
          <span>318 total</span>
        </Masthead.Meta>
      </Masthead.Heading>
      <Masthead.Actions>
        <Button variant="primary">New matter</Button>
      </Masthead.Actions>
    </Masthead.Root>
  {/snippet}
</Story>

<Story
  name="Compact density"
  play={async ({ canvas, step }) => {
    await step("The compact density steps the title down through the recipe", async () => {
      const heading = canvas.getByRole("heading", { level: 1, name: "Ashcombe v. Delderfield" });
      // 1.5rem at the catalog's 16px root. The assertion is on the RESOLVED size rather than the
      // class, because the point of the variant is that the step comes from the recipe.
      await expect(getComputedStyle(heading).fontSize).toBe("24px");
    });

    await step("The default density is untouched by it", async () => {
      const other = canvas.getByRole("heading", { level: 2, name: "Pemberton v. Hale" });
      await expect(getComputedStyle(other).fontSize).toBe("32px");
    });
  }}
>
  {#snippet template()}
    <div class="flex flex-col gap-24">
      <Masthead.Root density="compact">
        <Masthead.Heading>
          <Masthead.Title>Ashcombe v. Delderfield</Masthead.Title>
          <Masthead.Meta>
            <span>Matter 2026-0147</span>
            <Masthead.MetaSeparator />
            <span>Commercial Litigation</span>
          </Masthead.Meta>
        </Masthead.Heading>
        <Masthead.Actions>
          <Button variant="secondary">Add time</Button>
        </Masthead.Actions>
      </Masthead.Root>

      <!-- The comparison masthead sits inside a labelled section: a page has ONE banner landmark,
           and a <header> inside a section is that section's header rather than a second banner. -->
      <section aria-label="Default density, for comparison">
        <Masthead.Root>
          <Masthead.Heading>
            <Masthead.Title level={2}>Pemberton v. Hale</Masthead.Title>
            <Masthead.Meta>
              <span>Litigation</span>
            </Masthead.Meta>
          </Masthead.Heading>
        </Masthead.Root>
      </section>
    </div>
  {/snippet}
</Story>
