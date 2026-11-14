<script module lang="ts">
  /*
   * EntityPicker — the field a person or an organization is chosen in. The catalog shows it in the
   * states a search puts it through: a query below the floor, an ordinary answer, a capped one, a
   * search that could not run, one that finds nothing, the field refused, the field collecting
   * several picks, and the field that adds what it cannot find.
   *
   * The search behind every story is a fake over a small fixture directory. It answers after a
   * short delay so the settle and the searching state are real, and it is counted, so the stories
   * can assert that a query below the floor never reaches it and a settled one reaches it once.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import EntityPicker from "../lib/components/entity-picker/entity-picker.svelte";
  import type {
    EntityPickerAnswer,
    EntitySearch,
    PickableEntity,
  } from "../lib/components/entity-picker/types.ts";

  const { Story } = defineMeta({
    title: "Compound Inputs/EntityPicker",
    component: EntityPicker,
    parameters: {
      // Bits' prop types materialize every HTML attribute as a control; whitelist the props that
      // actually change this showcase. The search and the callbacks are not controls.
      controls: {
        include: ["multiple", "kinds", "excluded", "minimumQueryLength", "label", "disabled", "disabledReason"],
      },
      // The listbox scrolls but is driven by the input's aria-activedescendant (arrow keys move the
      // highlight and scroll it into view), so it needs no tabbable content of its own. axe's
      // scrollable-region-focusable cannot model that and reports a false positive.
      a11y: { config: { rules: [{ id: "scrollable-region-focusable", enabled: false }] } },
    },
  });

  type EntityPickerStoryArgs = ComponentProps<typeof EntityPicker>;

  /*
   * The fixture directory. The order is deliberate and is NOT alphabetical: it stands in for the
   * server's relevance order, and the first story asserts the list keeps it.
   */
  const DIRECTORY: readonly PickableEntity[] = [
    { identifier: "entity-okafor", name: "Adaeze Okafor", kind: "person", aside: "Counsel of record" },
    { identifier: "entity-adamson", name: "Adamson Freight", kind: "organization" },
    { identifier: "entity-adair", name: "Adair, Priya", kind: "person", aside: "Matched on Priya Adair" },
    { identifier: "entity-meridian", name: "Meridian Holdings", kind: "organization", aside: "Meridian Holdings, L.L.C." },
    { identifier: "entity-rees", name: "Bartholomew Rees", kind: "person" },
  ];

  const ANSWER_DELAY_MILLISECONDS = 60;

  /** How many times each fake search has been asked. Reset by the story that counts. */
  const calls = { ordinary: 0 };

  function matching(query: string): PickableEntity[] {
    const needle = query.toLowerCase();
    return DIRECTORY.filter((entity) => entity.name.toLowerCase().includes(needle));
  }

  /** Answers after a short delay, and stops answering the moment the question is withdrawn. */
  function later(answer: EntityPickerAnswer, delay: number, signal: AbortSignal): Promise<EntityPickerAnswer> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(answer), delay);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("withdrawn"));
      });
    });
  }

  const ordinarySearch: EntitySearch = (query, signal) => {
    calls.ordinary += 1;
    return later({ hits: matching(query), capped: false }, ANSWER_DELAY_MILLISECONDS, signal);
  };

  const cappedSearch: EntitySearch = (query, signal) =>
    later({ hits: matching(query), capped: true }, ANSWER_DELAY_MILLISECONDS, signal);

  const failingSearch: EntitySearch = (_query, signal) =>
    new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the directory is unreachable")), ANSWER_DELAY_MILLISECONDS);
      signal.addEventListener("abort", () => clearTimeout(timer));
    });

  const SLOW_DELAY_MILLISECONDS = 4000;
  const slowSearch: EntitySearch = (query, signal) =>
    later({ hits: matching(query), capped: false }, SLOW_DELAY_MILLISECONDS, signal);

  function pause(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  /** Leaves the page clickable for the next story: an open panel keeps the body pointer-inert. */
  async function closeListbox(body: ReturnType<typeof within>): Promise<void> {
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
    await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
  }
</script>

<script lang="ts">
  let chosen = $state<PickableEntity | null>(null);
  let party = $state<PickableEntity | null>(null);
  let parties = $state<PickableEntity[]>([]);
  let created = $state<string>("nothing");
  let cleared = $state(0);
</script>

{#snippet singleTemplate(args: EntityPickerStoryArgs)}
  <div class="max-w-sm">
    <EntityPicker
      {...args}
      search={ordinarySearch}
      bind:value={chosen}
      onClear={() => (cleared += 1)}
    />
    <p>Chosen: {chosen?.name ?? "nobody"}. Cleared: {cleared}.</p>
  </div>
{/snippet}

<Story
  name="Single"
  template={singleTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const input = canvas.getByRole<HTMLInputElement>("combobox", { name: "Person or organization" });
    calls.ordinary = 0;

    await step("The ghost text is the field's name, not an instruction", async () => {
      await expect(input).toHaveAttribute("placeholder", "Person or organization");
    });

    await step("Two characters state the floor and never reach the search", async () => {
      await userEvent.type(input, "Ad");
      await waitFor(() => expect(body.getByText("Type one more character to search the directory.")).toBeVisible());
      await pause(400);
      expect(calls.ordinary).toBe(0);
    });

    await step("A third character asks once, after the settle, and lists the hits as given", async () => {
      await userEvent.type(input, "a");
      await waitFor(() => expect(body.getAllByRole("option").length).toBe(3));
      expect(calls.ordinary).toBe(1);
      const names = body.getAllByRole("option").map((row) => row.textContent);
      expect(names[0]).toContain("Adaeze Okafor");
      expect(names[1]).toContain("Adamson Freight");
      expect(names[2]).toContain("Adair, Priya");
      await waitFor(() => expect(body.getByText("Matched on Priya Adair")).toBeVisible());
    });

    await step("Picking a hit puts its name in the field, with one control to let it go", async () => {
      await userEvent.click(body.getByRole("option", { name: /Adamson Freight/ }));
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await expect(input).toHaveValue("Adamson Freight");
      await expect(canvas.getByRole("button", { name: "Remove Adamson Freight" })).toBeVisible();
      await expect(canvas.getByText("Chosen: Adamson Freight. Cleared: 0.")).toBeVisible();
    });

    await step("Arriving in the field selects the name, so typing replaces it", async () => {
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
      // Leave the field, then arrive in it again: arriving is what selects the name.
      await userEvent.click(document.body);
      input.focus();
      await waitFor(() => {
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe("Adamson Freight".length);
      });
      await userEvent.keyboard("Mer");
      await expect(input).toHaveValue("Mer");
    });

    await step("Leaving without a pick returns the field to naming the selection", async () => {
      await waitFor(() => expect(body.getByRole("option", { name: /Meridian Holdings/ })).toBeVisible());
      await closeListbox(body);
      await expect(input).toHaveValue("Adamson Freight");
    });

    await step("Removing the chip empties the field", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Remove Adamson Freight" }));
      await expect(input).toHaveValue("");
      await expect(canvas.getByText("Chosen: nobody. Cleared: 1.")).toBeVisible();
    });
  }}
/>

{#snippet multipleTemplate(args: EntityPickerStoryArgs)}
  <div class="max-w-sm">
    <EntityPicker {...args} multiple search={ordinarySearch} bind:values={parties} label="Party" />
    <p>Parties: {parties.map((entity) => entity.name).join(", ") || "none"}.</p>
  </div>
{/snippet}

<Story
  name="Multiple"
  template={multipleTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("A pick becomes a chip above the field, and the field empties", async () => {
      const input = canvas.getByRole("combobox", { name: "Party" });
      await userEvent.type(input, "Ada");
      await userEvent.click(await body.findByRole("option", { name: /Adaeze Okafor/ }));
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: "Remove Adaeze Okafor" })).toBeVisible(),
      );
      await expect(canvas.getByRole("combobox", { name: "Party" })).toHaveValue("");
      await expect(canvas.getByText("Parties: Adaeze Okafor.")).toBeVisible();
    });

    await step("What is already picked is not offered again", async () => {
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
      const input = canvas.getByRole("combobox", { name: "Party" });
      await userEvent.type(input, "Ada");
      await waitFor(() => expect(body.getAllByRole("option").length).toBe(2));
      expect(body.queryByRole("option", { name: /Adaeze Okafor/ })).toBeNull();
      await closeListbox(body);
    });

    await step("Removing a chip takes the pick back", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Remove Adaeze Okafor" }));
      await expect(canvas.getByText("Parties: none.")).toBeVisible();
    });
  }}
/>

{#snippet cappedTemplate(args: EntityPickerStoryArgs)}
  <div class="max-w-sm">
    <EntityPicker {...args} search={cappedSearch} />
  </div>
{/snippet}

<Story
  name="Capped"
  template={cappedTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("A capped answer lists what came back and says more matched", async () => {
      await userEvent.type(canvas.getByRole("combobox", { name: "Person or organization" }), "Ada");
      // Three hits and the capped note, which rides the list as a row nobody can pick.
      await waitFor(() => expect(body.getAllByRole("option").length).toBe(4));
      await waitFor(() =>
        expect(body.getByText("More matches exist than are shown. Narrow the search to see the rest.")).toBeVisible(),
      );
      await closeListbox(body);
    });
  }}
/>

{#snippet failingTemplate(args: EntityPickerStoryArgs)}
  <div class="max-w-sm">
    <EntityPicker {...args} search={failingSearch} />
  </div>
{/snippet}

<Story
  name="Failed"
  template={failingTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("A search that could not run is stated, never shown as no matches", async () => {
      await userEvent.type(canvas.getByRole("combobox", { name: "Person or organization" }), "Ada");
      await waitFor(() => expect(body.getByText("Couldn't search the directory.")).toBeVisible());
      expect(body.queryByText("No record matches that search.")).toBeNull();
      await expect(body.getByRole("option", { name: "Try Again" })).toBeVisible();
    });

    await step("Trying again asks the same question, and states the same answer", async () => {
      await userEvent.click(body.getByRole("option", { name: "Try Again" }));
      await waitFor(() => expect(body.getByText("Searching the directory")).toBeVisible());
      await waitFor(() => expect(body.getByText("Couldn't search the directory.")).toBeVisible());
      await closeListbox(body);
    });
  }}
/>

{#snippet slowTemplate(args: EntityPickerStoryArgs)}
  <div class="max-w-sm">
    <EntityPicker {...args} search={slowSearch} />
  </div>
{/snippet}

<Story
  name="Searching"
  template={slowTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("While a question is out, the list says so", async () => {
      await userEvent.type(canvas.getByRole("combobox", { name: "Person or organization" }), "Ada");
      await waitFor(() => expect(body.getByText("Searching the directory")).toBeVisible());
      await closeListbox(body);
    });
  }}
/>

<Story
  name="NoMatch"
  template={singleTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("A query nothing matches says so, in the list", async () => {
      await userEvent.type(canvas.getByRole("combobox", { name: "Person or organization" }), "Zzz");
      await waitFor(() => expect(body.getByText("No record matches that search.")).toBeVisible());
      await closeListbox(body);
    });
  }}
/>

{#snippet createTemplate(args: EntityPickerStoryArgs)}
  <div class="max-w-sm">
    <EntityPicker
      {...args}
      search={ordinarySearch}
      bind:value={party}
      label="Payee"
      kinds={["organization"]}
      onCreate={(typed, kind) => {
        created = typed;
        // The caller makes the record and hands it back; the picker changed no selection itself.
        party = { identifier: `entity-new-${typed}`, name: typed, kind };
      }}
    />
    <p>Created: {created}. Payee: {party?.name ?? "nobody"}.</p>
  </div>
{/snippet}

<Story
  name="Creates"
  template={createTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("A name the directory does not hold can be added from the list", async () => {
      const input = canvas.getByRole("combobox", { name: "Payee" });
      await userEvent.type(input, "Northwind Couriers");
      await waitFor(() => expect(body.getByText("No record matches that search.")).toBeVisible());
      await userEvent.click(body.getByRole("option", { name: 'Add "Northwind Couriers"' }));
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await expect(canvas.getByText("Created: Northwind Couriers. Payee: Northwind Couriers.")).toBeVisible();
      await expect(input).toHaveValue("Northwind Couriers");
    });
  }}
/>

{#snippet createEitherTemplate(args: EntityPickerStoryArgs)}
  <div class="max-w-sm">
    <EntityPicker
      {...args}
      search={ordinarySearch}
      bind:value={party}
      label="Client"
      onCreate={(typed, kind) => {
        created = `${kind}:${typed}`;
        party = typed === "" ? null : { identifier: `entity-new-${typed}`, name: typed, kind };
      }}
    />
    <p>Created: {created}. Client: {party?.name ?? "nobody"}.</p>
  </div>
{/snippet}

<Story
  name="CreatesEither"
  template={createEitherTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("The New control is there before anything is typed, and asks which kind", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "New person or organization" }));
      await waitFor(() => expect(body.getByRole("menuitem", { name: "Person" })).toBeVisible());
      await expect(body.getByRole("menuitem", { name: "Organization" })).toBeVisible();
      await userEvent.click(body.getByRole("menuitem", { name: "Person" }));
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
      await expect(canvas.getByText("Created: person:. Client: nobody.")).toBeVisible();
    });

    await step("A name nothing matches can be added as either kind from the list", async () => {
      const input = canvas.getByRole("combobox", { name: "Client" });
      await userEvent.type(input, "Northwind Couriers");
      await waitFor(() => expect(body.getByText("No record matches that search.")).toBeVisible());
      await expect(body.getByRole("option", { name: 'Add "Northwind Couriers" as a person' })).toBeVisible();
      await userEvent.click(
        body.getByRole("option", { name: 'Add "Northwind Couriers" as an organization' }),
      );
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await expect(
        canvas.getByText("Created: organization:Northwind Couriers. Client: Northwind Couriers."),
      ).toBeVisible();
      await expect(input).toHaveValue("Northwind Couriers");
    });
  }}
/>

{#snippet refusedTemplate(args: EntityPickerStoryArgs)}
  <div class="max-w-sm">
    <EntityPicker {...args} search={ordinarySearch} value={DIRECTORY[0] ?? null} />
  </div>
{/snippet}

<Story
  name="Refused"
  args={{ disabled: true, disabledReason: "The engagement is closed; its parties cannot change." }}
  template={refusedTemplate}
  play={async ({ canvas, step }) => {
    await step("A refused field stays visible, holds its selection, and says why", async () => {
      const input = canvas.getByRole("combobox", { name: "Person or organization" });
      await expect(input).toBeDisabled();
      await expect(input).toHaveAttribute(
        "title",
        "The engagement is closed; its parties cannot change.",
      );
      await expect(input).toHaveValue("Adaeze Okafor");
      await expect(canvas.getByRole("button", { name: "Remove Adaeze Okafor" })).toBeDisabled();
    });
  }}
/>
