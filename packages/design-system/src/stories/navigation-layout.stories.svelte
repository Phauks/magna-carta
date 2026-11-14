<script module lang="ts">
  /*
   * NavigationLayout — Layout (Tier 2, native). A screen's two sides: the navigation column on the
   * left, the chosen thing's content on the right. The component owns the landmark, the width, the
   * two independent scroll regions and their reserved gutters; what the navigation HOLDS is the
   * consumer's snippet, so the stories draw three different navigations through the one shape —
   * grouped section links (Settings), a control over rows (Magnus), and a control over nothing
   * (the empty case, which must still stand). `navigationWidth` is the variant axis, one story
   * each; `contentScrolls` and `navigationLabel` are Controls. The dense state rides both width
   * stories (a navigation and a page both taller than the viewport). svelte-csf v5.
   *
   * The layout cancels the app canvas's inset and takes the full height under the top bar, so each
   * story stands it inside a padded box that plays the canvas — the same frame the app shell draws.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps, Snippet } from "svelte";
  import { expect, waitFor, within } from "storybook/test";
  import NavigationLayout from "../lib/components/navigation-layout/index.ts";
  import Button from "../lib/components/button/button.svelte";
  import FieldLabel from "../lib/components/field-label/field-label.svelte";
  import * as Select from "../lib/components/select/index.ts";

  const { Story } = defineMeta({
    title: "Layout/NavigationLayout",
    component: NavigationLayout,
    args: { navigationWidth: "standard", contentScrolls: true },
    argTypes: {
      navigationWidth: { control: "select", options: ["standard", "narrow", "wide"] },
    },
    parameters: {
      controls: { include: ["navigationLabel", "navigationWidth", "contentScrolls"] },
    },
  });

  // The two snippets are the template's own, never args — spreading them from args alongside the
  // template's snippet body would name `children` twice.
  type NavigationLayoutStoryArgs = Omit<
    ComponentProps<typeof NavigationLayout>,
    "children" | "navigation"
  >;

  // Enough grouped links that the navigation outgrows the viewport, and enough prose that the page
  // does too — the dense state, where independent scrolling is the whole point.
  const SECTION_GROUPS = [
    { label: "Your account", sections: ["Profile", "Notifications", "Theme", "Security"] },
    { label: "The firm", sections: ["Firm profile", "Offices", "Users", "Matter numbering"] },
    { label: "Files", sections: ["File safety", "Document types", "Retention", "Storage"] },
    { label: "Money", sections: ["Rates", "Billing", "Trust accounts", "Payments"] },
    { label: "Matters", sections: ["Matter plans", "Intake procedures", "Conflicts", "Custodian"] },
    { label: "Calendar", sections: ["Event types", "Court rules", "Reminders", "Holidays"] },
    { label: "Documents", sections: ["Templates", "Merge fields", "Letterhead", "Signatures"] },
    { label: "Communications", sections: ["Email", "Messaging", "Client portal", "Telephony"] },
    { label: "Platform", sections: ["Versions", "Beta access", "Resources", "Diagnostics"] },
  ];
  const PARAGRAPHS = Array.from({ length: 24 }, (_, index) => `Paragraph ${index + 1}`);
  const CONVERSATIONS = Array.from({ length: 30 }, (_, index) => `Conversation ${index + 1}`);

  /** The two columns and the root, read from the rendered layout. */
  function columnsOf(canvasElement: HTMLElement): {
    root: HTMLElement;
    navigation: HTMLElement;
    content: HTMLElement;
  } {
    const root = canvasElement.querySelector<HTMLElement>(".mc-navigation-layout");
    const navigation = canvasElement.querySelector<HTMLElement>(
      '[data-navigation-layout="navigation"]',
    );
    const content = canvasElement.querySelector<HTMLElement>('[data-navigation-layout="content"]');
    if (!root || !navigation || !content) throw new Error("the layout did not render its columns");
    return { root, navigation, content };
  }

  /** A CSS length from the generated token sheet, resolved in this document. */
  function tokenPixels(name: string): number {
    const probe = document.createElement("div");
    probe.style.inlineSize = `var(${name})`;
    probe.style.position = "absolute";
    document.body.append(probe);
    const pixels = probe.getBoundingClientRect().width;
    probe.remove();
    return pixels;
  }
</script>

{#snippet canvas(inner: Snippet)}
  <!-- Plays the app shell's work canvas: the padding the layout cancels, and the scroll region it
       replaces with two of its own. -->
  <div class="mc-scrollbar overflow-y-auto bg-surface-default p-24">
    {@render inner()}
  </div>
{/snippet}

{#snippet settingsNavigation()}
  <div class="flex flex-col gap-24">
    {#each SECTION_GROUPS as group (group.label)}
      <div class="flex flex-col gap-8">
        <FieldLabel as="p">{group.label}</FieldLabel>
        <ul class="flex flex-col gap-4">
          {#each group.sections as section (section)}
            <li>
              <a href="#{section}" class="flex items-center rounded-md px-12 py-4 text-sm text-text-muted"
                >{section}</a
              >
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
{/snippet}

<!--
  A page, as a real one is: a heading, an action, then the body. The action matters beyond realism —
  the content column is a scroll region, and a scroll region a keyboard can reach is one that holds
  something focusable (axe's scrollable-region-focusable rule; the app shell's own canvas has the
  same property). Every product page carries a control; a page of pure prose would not, and this is
  where that would show.
-->
{#snippet prose()}
  <div class="flex flex-col gap-16">
    <div class="flex items-center justify-between gap-8">
      <h2 class="font-display text-xl">Profile</h2>
      <Button variant="secondary">Edit profile</Button>
    </div>
    {#each PARAGRAPHS as paragraph (paragraph)}
      <p class="text-sm text-text-muted">
        {paragraph}. The page is deliberately taller than the viewport so its column scrolls on its
        own, beside a navigation that does the same.
      </p>
    {/each}
  </div>
{/snippet}

<!-- The settings width: grouped section links on the left, a long page on the right. -->
<Story
  name="Standard"
  play={async ({ canvasElement, step }) => {
    const { root, navigation, content } = columnsOf(canvasElement);

    await step("The navigation is a named landmark", async () => {
      const landmark = within(canvasElement).getByRole("navigation", { name: "Settings sections" });
      expect(landmark).toBe(navigation);
    });

    await step("The standard column is the popover measure plus a space-24 gutter a side", async () => {
      const expected = tokenPixels("--mc-size-popover") + 2 * tokenPixels("--mc-space-24");
      await waitFor(() => expect(navigation.getBoundingClientRect().width).toBeCloseTo(expected, 0));
    });

    await step("Each column scrolls on its own, and the root never does", async () => {
      expect(getComputedStyle(navigation).overflowY).toBe("auto");
      expect(getComputedStyle(content).overflowY).toBe("auto");
      expect(getComputedStyle(root).overflowY).not.toBe("auto");
      expect(navigation.scrollHeight).toBeGreaterThan(navigation.clientHeight);
      expect(content.scrollHeight).toBeGreaterThan(content.clientHeight);
      navigation.scrollTop = 200;
      await waitFor(() => expect(navigation.scrollTop).toBeGreaterThan(0));
      expect(content.scrollTop).toBe(0);
      navigation.scrollTop = 0;
    });

    await step("Both columns reserve their scrollbar gutter, so nothing shifts when one arrives", async () => {
      expect(getComputedStyle(navigation).scrollbarGutter).toBe("stable");
      expect(getComputedStyle(content).scrollbarGutter).toBe("stable");
    });

    await step("Neither column stands taller than the layout, so the canvas never scrolls beside them", async () => {
      // The navigation column is content-box, so a full height plus its gutter overshot the row by
      // two gutters and the canvas grew a second scrollbar on every long settings page. Measured
      // here in a real layout because no reading of the class list can see an overshoot.
      const bottom = root.getBoundingClientRect().bottom;
      expect(navigation.getBoundingClientRect().bottom).toBeLessThanOrEqual(bottom + 0.5);
      expect(content.getBoundingClientRect().bottom).toBeLessThanOrEqual(bottom + 0.5);
    });
  }}
>
  {#snippet template(args: NavigationLayoutStoryArgs)}
    {#snippet inner()}
      <NavigationLayout {...args} navigationLabel="Settings sections" navigation={settingsNavigation}>
        {@render prose()}
      </NavigationLayout>
    {/snippet}
    {@render canvas(inner)}
  {/snippet}
</Story>

<!-- The narrow width: a control over rows, the shape a conversation rail takes. -->
<Story
  name="Narrow"
  args={{ navigationWidth: "narrow" }}
  play={async ({ canvasElement, step }) => {
    const { navigation } = columnsOf(canvasElement);

    await step("The narrow column is the popover measure plus a space-16 gutter a side", async () => {
      const expected = tokenPixels("--mc-size-popover") + 2 * tokenPixels("--mc-space-16");
      await waitFor(() => expect(navigation.getBoundingClientRect().width).toBeCloseTo(expected, 0));
    });

    await step("The rows scroll inside the column, under the control", async () => {
      await expect(navigation).toHaveAccessibleName("Conversations");
      expect(navigation.scrollHeight).toBeGreaterThan(navigation.clientHeight);
    });
  }}
>
  {#snippet template(args: NavigationLayoutStoryArgs)}
    {#snippet rail()}
      <div class="flex flex-col gap-8">
        <Select.Root type="single" value="recent" items={[{ value: "recent", label: "Most recent" }]}>
          <Select.Trigger aria-label="Sort conversations">
            <Select.Value placeholder="Sort" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="recent" label="Most recent" />
            <Select.Item value="name" label="Name" />
          </Select.Content>
        </Select.Root>
        <ul class="flex flex-col gap-4">
          {#each CONVERSATIONS as conversation (conversation)}
            <li>
              <a href="#{conversation}" class="flex items-center rounded-md px-12 py-4 text-sm text-text-muted"
                >{conversation}</a
              >
            </li>
          {/each}
        </ul>
      </div>
    {/snippet}
    {#snippet inner()}
      <NavigationLayout {...args} navigationLabel="Conversations" navigation={rail}>
        {@render prose()}
      </NavigationLayout>
    {/snippet}
    {@render canvas(inner)}
  {/snippet}
</Story>

<!-- The wide width: rows that carry a name over a line, the Magnus conversation rail. -->
<Story
  name="Wide"
  args={{ navigationWidth: "wide" }}
  play={async ({ canvasElement, step }) => {
    const { navigation } = columnsOf(canvasElement);

    await step("The wide column is the record-aside measure plus a space-16 gutter a side", async () => {
      const expected = tokenPixels("--mc-size-record-aside") + 2 * tokenPixels("--mc-space-16");
      await waitFor(() => expect(navigation.getBoundingClientRect().width).toBeCloseTo(expected, 0));
    });

  }}
>
  {#snippet template(args: NavigationLayoutStoryArgs)}
    {#snippet rail()}
      <div class="flex flex-col gap-8">
        <Select.Root type="single" value="recent" items={[{ value: "recent", label: "Most recent" }]}>
          <Select.Trigger aria-label="Sort conversations">
            <Select.Value placeholder="Sort" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="recent" label="Most recent" />
            <Select.Item value="name" label="Name" />
          </Select.Content>
        </Select.Root>
        <ul class="flex flex-col gap-4">
          {#each CONVERSATIONS as conversation (conversation)}
            <li>
              <a href="#{conversation}" class="flex items-center rounded-md px-12 py-4 text-sm text-text-muted"
                >{conversation}</a
              >
            </li>
          {/each}
        </ul>
      </div>
    {/snippet}
    {#snippet inner()}
      <NavigationLayout {...args} navigationLabel="Conversations" navigation={rail}>
        {@render prose()}
      </NavigationLayout>
    {/snippet}
    {@render canvas(inner)}
  {/snippet}
</Story>

<!--
  The empty navigation: a rail whose list has nothing in it yet still renders its control and keeps
  its width and its landmark, so a first conversation can be started from where the rows will be.
  Hidden from the catalog (it would stack a third copy of the layout on the Docs page); run by the
  test addon.
-->
<Story
  name="Empty navigation"
  tags={["!dev", "!autodocs"]}
  args={{ navigationWidth: "narrow" }}
  play={async ({ canvasElement, step }) => {
    const { navigation } = columnsOf(canvasElement);

    await step("With nothing to list, the column still stands at its width with its control", async () => {
      await expect(navigation).toHaveAccessibleName("Conversations");
      const expected = tokenPixels("--mc-size-popover") + 2 * tokenPixels("--mc-space-16");
      await waitFor(() => expect(navigation.getBoundingClientRect().width).toBeCloseTo(expected, 0));
      await expect(navigation.querySelector("button")).toBeVisible();
      expect(navigation.scrollHeight).toBe(navigation.clientHeight);
    });
  }}
>
  {#snippet template(args: NavigationLayoutStoryArgs)}
    {#snippet emptyRail()}
      <div class="flex flex-col gap-8">
        <Button variant="secondary">New conversation</Button>
      </div>
    {/snippet}
    {#snippet inner()}
      <NavigationLayout {...args} navigationLabel="Conversations" navigation={emptyRail}>
        <div class="flex flex-col items-start gap-16">
          <p class="text-sm text-text-muted">No conversations yet.</p>
          <Button variant="primary">Ask Magnus</Button>
        </div>
      </NavigationLayout>
    {/snippet}
    {@render canvas(inner)}
  {/snippet}
</Story>
