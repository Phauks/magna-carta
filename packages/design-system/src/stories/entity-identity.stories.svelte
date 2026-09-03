<script module lang="ts">
  /*
   * EntityIdentity — the one mark for a person or an organization wherever one is named. The
   * catalog shows it in each shape it takes: the two kinds, the name as a link and as a quiet
   * control, a record folded into another, and the chip that stands inside a field with its remove
   * control offered and refused.
   *
   * The kind is a fact the caller supplies and the pronouns arrive already short; nothing on this
   * mark is inferred from a name, and the stories hand it facts the same way a screen would.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, within } from "storybook/test";
  import EntityIdentity from "../lib/components/entity-identity/entity-identity.svelte";

  const { Story } = defineMeta({
    title: "Data Display/EntityIdentity",
    component: EntityIdentity,
    args: { kind: "person", name: "Adaeze Okafor" },
    parameters: {
      controls: {
        include: [
          "kind",
          "name",
          "size",
          "pronouns",
          "merged",
          "href",
          "aside",
          "removeLabel",
          "disabled",
          "disabledReason",
        ],
      },
    },
  });

  type EntityIdentityStoryArgs = ComponentProps<typeof EntityIdentity>;
</script>

<script lang="ts">
  let opened = $state(0);
  let removed = $state(0);
</script>

{#snippet plainTemplate(args: EntityIdentityStoryArgs)}
  <div class="max-w-sm">
    <EntityIdentity {...args} />
  </div>
{/snippet}

<Story
  name="Person"
  args={{ pronouns: "she/her", aside: "Counsel of record" }}
  template={plainTemplate}
  play={async ({ canvas, step }) => {
    await step("The name, the stated pronouns and the aside are all shown", async () => {
      await expect(canvas.getByText("Adaeze Okafor")).toBeVisible();
      await expect(canvas.getByText("she/her")).toBeVisible();
      await expect(canvas.getByText("Counsel of record")).toBeVisible();
    });

    await step("The kind is read out, not only drawn", async () => {
      await expect(canvas.getByText("Person")).toBeInTheDocument();
    });
  }}
/>

<Story
  name="Organization"
  args={{ kind: "organization", name: "Meridian Holdings", aside: "Meridian Holdings, L.L.C." }}
  template={plainTemplate}
  play={async ({ canvas, step }) => {
    await step("An organization carries its own glyph and its own kind word", async () => {
      await expect(canvas.getByText("Meridian Holdings")).toBeVisible();
      await expect(canvas.getByText("Organization")).toBeInTheDocument();
    });
  }}
/>

<Story
  name="Linked"
  args={{ href: "#adaeze-okafor", pronouns: "she/her" }}
  template={plainTemplate}
  play={async ({ canvas, step }) => {
    await step("Given an address, the name is the link to the record", async () => {
      const link = canvas.getByRole("link", { name: "Adaeze Okafor" });
      await expect(link).toHaveAttribute("href", "#adaeze-okafor");
    });
  }}
/>

{#snippet opensTemplate(args: EntityIdentityStoryArgs)}
  <div class="max-w-sm">
    <EntityIdentity {...args} onOpen={() => (opened += 1)} />
    <p>Opened: {opened}.</p>
  </div>
{/snippet}

<Story
  name="Opens"
  template={opensTemplate}
  play={async ({ canvas, step }) => {
    await step("Without an address, the name is a quiet control that opens the record", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Adaeze Okafor" }));
      await expect(canvas.getByText("Opened: 1.")).toBeVisible();
    });
  }}
/>

<Story
  name="FoldedIn"
  args={{ merged: true, aside: "Now Adaeze Okafor-Reyes" }}
  template={plainTemplate}
  play={async ({ canvas, step }) => {
    await step("A record folded into another says so beside the name", async () => {
      await expect(canvas.getByText("Folded in")).toBeVisible();
    });
  }}
/>

{#snippet chipTemplate(args: EntityIdentityStoryArgs)}
  <div class="flex flex-wrap items-center gap-4">
    <EntityIdentity {...args} size="sm" onRemove={() => (removed += 1)} />
    <EntityIdentity {...args} size="sm" kind="organization" name="Meridian Holdings" onRemove={() => (removed += 1)} />
    <p>Removed: {removed}.</p>
  </div>
{/snippet}

<Story
  name="Chip"
  template={chipTemplate}
  play={async ({ canvas, step }) => {
    await step("The chip names the record on one line and offers to remove it", async () => {
      await expect(canvas.getByText("Adaeze Okafor")).toBeVisible();
      await userEvent.click(canvas.getByRole("button", { name: "Remove Adaeze Okafor" }));
      await expect(canvas.getByText("Removed: 1.")).toBeVisible();
    });
  }}
/>

<Story
  name="ChipRefused"
  args={{ disabled: true, disabledReason: "This party is named on the engagement letter." }}
  template={chipTemplate}
  play={async ({ canvas, step }) => {
    await step("A refused remove control stays visible and says why", async () => {
      const remove = canvas.getByRole("button", { name: "Remove Adaeze Okafor" });
      await expect(remove).toBeDisabled();
      await expect(remove).toHaveAttribute(
        "title",
        "This party is named on the engagement letter.",
      );
      await expect(within(remove.parentElement as HTMLElement).getByText("Adaeze Okafor")).toBeVisible();
    });
  }}
/>
