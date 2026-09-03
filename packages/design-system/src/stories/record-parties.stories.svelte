<script module lang="ts">
  /*
   * RecordParties — the people and organizations linked to a record, the same tab on every kind of
   * record. The catalog shows it in each of the states it has to survive: parties on it, nobody on
   * it yet, still loading, a fetch that failed, an account that may read but not change it, and a
   * record carrying more parties than fit.
   *
   * The things worth watching are behaviours rather than looks. Removing ends an association and
   * destroys nothing, so its confirmation names the person and says where they will still be; and
   * an entity already on the record is offered again, with what the record already holds about them
   * stated, and refused only in a role they already hold. All of it is asserted in the first story's
   * play.
   *
   * Every story pins the instant formatter to one locale and zone, so a stamp reads the same in
   * every reviewer's browser (the component's own default is the reader's local time, which is the
   * rule everywhere else). Render is always an explicit named `template` snippet.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import RecordParties from "../lib/components/record-parties/record-parties.svelte";
  import type { PartyLink, PartyRole, RecordParty } from "../lib/components/record-parties/types.ts";
  import type {
    EntityPickerAnswer,
    EntitySearch,
    PickableEntity,
  } from "../lib/components/entity-picker/types.ts";
  import { formatInstant, type Instant } from "../lib/formatters/instant.ts";

  const { Story } = defineMeta({
    title: "Data Display/RecordParties",
    component: RecordParties,
    args: {
      canEdit: true,
      allowNewRole: false,
      roleRequired: true,
      capacityOffered: true,
    },
    parameters: {
      // Bits' prop types materialize every HTML attribute as a control; whitelist the props that
      // actually change this showcase. The search, the callbacks and the fixtures are not controls.
      controls: {
        include: [
          "canEdit",
          "linkDisabledReason",
          "loading",
          "errorMessage",
          "errorIdentifier",
          "allowNewRole",
          "roleRequired",
          "capacityOffered",
        ],
      },
      // The picker's and the role field's listboxes scroll but are driven by their input's
      // aria-activedescendant (arrow keys move the highlight and scroll it into view), so they need
      // no tabbable content of their own. axe's scrollable-region-focusable cannot model that and
      // reports a false positive.
      a11y: { config: { rules: [{ id: "scrollable-region-focusable", enabled: false }] } },
    },
  });

  type RecordPartiesStoryArgs = ComponentProps<typeof RecordParties>;

  function pinnedInstant(at: Instant): string {
    return formatInstant(at, { locale: "en-US", timeZone: "America/New_York" });
  }

  const ROLES: readonly PartyRole[] = [
    { value: "client", label: "Client" },
    { value: "opposing-party", label: "Opposing Party" },
    { value: "witness", label: "Witness" },
    { value: "executor", label: "Executor" },
    { value: "beneficiary", label: "Beneficiary" },
    { value: "expert", label: "Expert" },
  ];

  /*
   * The record's parties. Eleanor Whitcombe is on it TWICE — the executor who is also a beneficiary,
   * the ordinary case on an estate — so the tab can be seen saying what it already holds about her
   * and refusing only the exact repeat.
   */
  const LINKED: readonly RecordParty[] = [
    {
      identifier: "party-1",
      entityIdentifier: "entity-meridian",
      name: "Meridian Holdings LLC",
      kind: "organization",
      role: "client",
      roleLabel: "Client",
      linkedAt: "2026-08-14T15:04:00Z",
      linkedBy: "Adaeze Okafor",
    },
    {
      identifier: "party-2",
      entityIdentifier: "entity-hale",
      name: "Jonathan Hale",
      kind: "person",
      role: "opposing-party",
      roleLabel: "Opposing Party",
      linkedAt: "2026-08-14T15:11:00Z",
      linkedBy: "Adaeze Okafor",
    },
    {
      identifier: "party-3",
      entityIdentifier: "entity-whitcombe",
      name: "Eleanor Whitcombe",
      kind: "person",
      role: "executor",
      roleLabel: "Executor",
      capacity: "Personal Representative",
      linkedAt: "2026-08-15T09:02:00Z",
      linkedBy: "Bartholomew Rees",
    },
    {
      identifier: "party-4",
      entityIdentifier: "entity-whitcombe",
      name: "Eleanor Whitcombe",
      kind: "person",
      role: "beneficiary",
      roleLabel: "Beneficiary",
      linkedAt: "2026-08-15T09:03:00Z",
      linkedBy: "Bartholomew Rees",
    },
    {
      identifier: "party-5",
      entityIdentifier: "entity-raman",
      name: "Priya Raman",
      kind: "person",
      role: "witness",
      roleLabel: "Witness",
      linkedAt: "2026-08-16T13:20:00Z",
      linkedBy: "Bartholomew Rees",
    },
  ];

  /*
   * The directory the fake search answers from. It deliberately holds the executor's own entity, so
   * picking her shows the "already on this record as Executor and Beneficiary" sentence.
   */
  const DIRECTORY: readonly PickableEntity[] = [
    { identifier: "entity-whitcombe", name: "Eleanor Whitcombe", kind: "person" },
    {
      identifier: "entity-whitcombe-daughters",
      name: "Whitcombe & Daughters",
      kind: "organization",
      aside: "Whitcombe and Daughters Limited",
    },
    { identifier: "entity-whitfield", name: "Marcus Whitfield", kind: "person" },
    { identifier: "entity-meridian", name: "Meridian Holdings LLC", kind: "organization" },
    { identifier: "entity-hale", name: "Jonathan Hale", kind: "person" },
    { identifier: "entity-raman", name: "Priya Raman", kind: "person" },
    { identifier: "entity-oyelaran", name: "Tunde Oyelaran", kind: "person" },
  ];

  /** How long the fake directory takes to answer: enough to show the searching state, no more. */
  const FIXTURE_ANSWER_DELAY_MILLISECONDS = 120;

  /** A directory search over the fixture, answering after a short delay and honouring the abort. */
  const fixtureSearch: EntitySearch = (query, signal) =>
    new Promise<EntityPickerAnswer>((resolve, reject) => {
      const needle = query.toLowerCase();
      const timer = setTimeout(() => {
        resolve({
          hits: DIRECTORY.filter((entity) => entity.name.toLowerCase().includes(needle)),
          capped: false,
        });
      }, FIXTURE_ANSWER_DELAY_MILLISECONDS);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("The search was superseded.", "AbortError"));
      });
    });

  const MANY_LINKED: readonly RecordParty[] = Array.from({ length: 14 }, (_unused, index) => {
    const number = String(index + 1).padStart(3, "0");
    return {
      identifier: `party-dense-${number}`,
      entityIdentifier: `entity-dense-${number}`,
      name: `Beneficiary ${number}`,
      kind: "person" as const,
      role: "beneficiary",
      roleLabel: "Beneficiary",
      linkedAt: "2026-08-16T13:20:00Z",
      linkedBy: "Bartholomew Rees",
    };
  });
</script>

<script lang="ts">
  // One record's worth of state, so the first story's acts are visible in the story itself.
  let parties = $state<RecordParty[]>([...LINKED]);
  let opened = $state<string>("nothing");
  let lastLink = $state<PartyLink | null>(null);
  let retried = $state<number>(0);

  /** What the last link asked for, in one line a play function can read back. */
  const linkedLine = $derived(
    lastLink === null
      ? "Linked: nobody yet."
      : `Linked: ${lastLink.entity.identifier} as ${lastLink.role ?? "no role"} in the capacity ${lastLink.capacity ?? "none"}.`,
  );
</script>

{#snippet defaultTemplate(args: RecordPartiesStoryArgs)}
  <div class="max-w-sm">
    <RecordParties
      {...args}
      {parties}
      roles={ROLES}
      search={fixtureSearch}
      formatInstant={pinnedInstant}
      onOpen={(party) => (opened = party.name)}
      onUnlink={(party) => {
        parties = parties.filter((entry) => entry.identifier !== party.identifier);
      }}
      onLink={(link) => {
        lastLink = link;
        parties = [
          ...parties,
          {
            identifier: `party-${link.entity.identifier}-${link.role ?? "unrolled"}`,
            entityIdentifier: link.entity.identifier,
            name: link.entity.name,
            kind: link.entity.kind,
            role: link.role ?? undefined,
            roleLabel:
              link.role === null
                ? undefined
                : (ROLES.find((role) => role.value === link.role)?.label ?? link.role),
            capacity: link.capacity ?? undefined,
            linkedAt: "2026-08-16T10:00:00Z",
            linkedBy: "Adaeze Okafor",
          },
        ];
      }}
    />
    <p>Opened: {opened}.</p>
    <p>{linkedLine}</p>
  </div>
{/snippet}

<Story
  name="WithParties"
  template={defaultTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("Everyone on the record is listed, with their role and who linked them", async () => {
      await expect(canvas.getByText("Meridian Holdings LLC")).toBeVisible();
      await expect(canvas.getByText("Jonathan Hale")).toBeVisible();
      await expect(canvas.getByText("Priya Raman")).toBeVisible();
      // The same person twice, in two roles: two rows, each its own association.
      await expect(canvas.getAllByText("Eleanor Whitcombe").length).toBe(2);
      await expect(canvas.getByText("Executor · Personal Representative")).toBeVisible();
      await expect(canvas.getByText("Beneficiary")).toBeVisible();
      await expect(canvas.getAllByText("Adaeze Okafor").length).toBeGreaterThan(0);
      // An absolute stamp, never elapsed time: "2 hours ago" decays while it is being read.
      const stamps = canvas.getAllByText(/Aug 14, 2026/);
      expect(stamps.length).toBeGreaterThan(0);
      for (const stamp of stamps) await expect(stamp).toBeVisible();
    });

    await step("Removing asks first, names the person, and says where they will still be", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /^Remove Jonathan Hale/ }));
      const confirmation = await body.findByRole("alertdialog");
      await waitFor(() => expect(confirmation).toBeVisible());
      await expect(confirmation).toHaveAccessibleName("Remove This Party?");
      await expect(confirmation).toHaveTextContent(
        "Jonathan Hale stops being linked to this record as Opposing Party.",
      );
      await expect(confirmation).toHaveTextContent(/They stay in the directory/);
      // The word the reader must never see here is Delete: this destroys nothing.
      await expect(confirmation).not.toHaveTextContent(/delete/i);
    });

    await step("The record keeps them until it is committed", async () => {
      await expect(canvas.getByText("Jonathan Hale")).toBeVisible();
      await userEvent.click(body.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(body.queryByRole("alertdialog")).toBeNull());
      await expect(canvas.getByText("Jonathan Hale")).toBeVisible();
    });

    await step("Committing ends the association and leaves the rest alone", async () => {
      const remove = canvas.getByRole("button", { name: /^Remove Jonathan Hale/ });
      await waitFor(() => expect(remove).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(remove);
      await body.findByRole("alertdialog");
      await userEvent.click(body.getByRole("button", { name: "Remove" }));
      await waitFor(() => expect(canvas.queryByText("Jonathan Hale")).toBeNull());
      await expect(canvas.getByText("Meridian Holdings LLC")).toBeVisible();
    });

    await step("Opening Add and picking someone already on the record says what it holds", async () => {
      const add = canvas.getByRole("button", { name: "Add…" });
      await waitFor(() => expect(add).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(add);
      const who = await canvas.findByRole("combobox", { name: "Person or organization" });
      await userEvent.type(who, "Whi");
      const hit = await body.findByRole("option", { name: /Eleanor Whitcombe/ });
      await userEvent.click(hit);
      await expect(
        await canvas.findByText("Already on this record as Executor and Beneficiary."),
      ).toBeVisible();
    });

    await step("A role they already hold is refused, in words", async () => {
      const role = canvas.getByRole("combobox", { name: "Role" });
      await userEvent.type(role, "Exec");
      await userEvent.click(await body.findByRole("option", { name: "Executor" }));
      await expect(
        await canvas.findByText("This record already links them in that role."),
      ).toBeVisible();
      await expect(canvas.getByRole("button", { name: /^Add: / })).toBeDisabled();
    });

    await step("A role they do not hold yet enables Add, and Add links them in it", async () => {
      const role = canvas.getByRole("combobox", { name: "Role" });
      await userEvent.clear(role);
      await userEvent.type(role, "Wit");
      await userEvent.click(await body.findByRole("option", { name: "Witness" }));
      await waitFor(() =>
        expect(canvas.queryByText("This record already links them in that role.")).toBeNull(),
      );
      // The listbox is on its way out; pressing on before it has gone would press on a layer that
      // is being torn down under the pointer.
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      const add = canvas.getByRole("button", { name: "Add" });
      await expect(add).toBeEnabled();
      await userEvent.click(add);
      await expect(
        canvas.getByText("Linked: entity-whitcombe as witness in the capacity none."),
      ).toBeVisible();
      // The add row is cleared: the way in is back, and the new row is on the list.
      await expect(canvas.getByRole("button", { name: "Add…" })).toBeVisible();
      await expect(canvas.getAllByText("Eleanor Whitcombe").length).toBe(3);
    });
  }}
/>

{#snippet emptyTemplate(args: RecordPartiesStoryArgs)}
  <div class="max-w-sm">
    <RecordParties
      {...args}
      parties={[]}
      roles={ROLES}
      search={fixtureSearch}
      formatInstant={pinnedInstant}
      onLink={() => undefined}
      onUnlink={() => undefined}
    />
  </div>
{/snippet}

<Story
  name="NobodyYet"
  template={emptyTemplate}
  play={async ({ canvas, step }) => {
    await step("It states what belongs here and leaves the way to add one in reach", async () => {
      await expect(canvas.getByText("Nobody Linked Yet")).toBeVisible();
      await expect(canvas.getByRole("button", { name: "Add…" })).toBeEnabled();
    });
  }}
/>

{#snippet loadingTemplate(args: RecordPartiesStoryArgs)}
  <div class="max-w-sm">
    <RecordParties
      {...args}
      parties={[]}
      roles={ROLES}
      search={fixtureSearch}
      loading
      formatInstant={pinnedInstant}
    />
  </div>
{/snippet}

<Story
  name="Loading"
  template={loadingTemplate}
  play={async ({ canvas, step }) => {
    await step("Placeholder rows stand in, and the wait is announced", async () => {
      await expect(canvas.getByText("Loading who is on this record")).toBeInTheDocument();
    });

    await step("Adding is not offered onto a list nobody has read yet", async () => {
      await expect(canvas.queryByRole("button", { name: "Add…" })).toBeNull();
    });
  }}
/>

{#snippet failedTemplate(args: RecordPartiesStoryArgs)}
  <div class="max-w-sm">
    <RecordParties
      {...args}
      parties={[]}
      roles={ROLES}
      search={fixtureSearch}
      errorMessage="The connection dropped before the parties arrived."
      errorIdentifier="err_4b9e2d10"
      formatInstant={pinnedInstant}
      onRetry={() => (retried += 1)}
    />
    <p>Retried {retried} times.</p>
  </div>
{/snippet}

<Story
  name="FailedToLoad"
  template={failedTemplate}
  play={async ({ canvas, step }) => {
    await step("The failure states itself and names the one that was hit", async () => {
      await expect(canvas.getByText(/The connection dropped/)).toBeVisible();
      await expect(canvas.getByText("Error err_4b9e2d10")).toBeVisible();
    });

    await step("It is recoverable: trying again is right there", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Try Again" }));
      await expect(canvas.getByText("Retried 1 times.")).toBeVisible();
    });
  }}
/>

{#snippet readOnlyTemplate(args: RecordPartiesStoryArgs)}
  <div class="max-w-sm">
    <RecordParties
      {...args}
      parties={LINKED}
      roles={ROLES}
      search={fixtureSearch}
      canEdit={false}
      linkDisabledReason="This matter is closed, so who is on it is fixed."
      formatInstant={pinnedInstant}
      onLink={() => undefined}
      onUnlink={() => undefined}
      onOpen={() => undefined}
    />
  </div>
{/snippet}

<Story
  name="ReadOnly"
  template={readOnlyTemplate}
  play={async ({ canvas, step }) => {
    await step("The controls stay where they are, refused rather than absent", async () => {
      const remove = canvas.getByRole("button", {
        name: "Remove Meridian Holdings LLC as Client: This matter is closed, so who is on it is fixed.",
      });
      await expect(remove).toBeDisabled();
      await expect(canvas.getByRole("button", { name: "Add…" })).toBeDisabled();
    });

    await step("The reason is stated once, not left to a hover", async () => {
      await expect(
        canvas.getByText("This matter is closed, so who is on it is fixed."),
      ).toBeVisible();
    });

    await step("The parties themselves are still readable", async () => {
      await expect(canvas.getByRole("button", { name: "Meridian Holdings LLC" })).toBeEnabled();
    });
  }}
/>

{#snippet denseTemplate(args: RecordPartiesStoryArgs)}
  <div class="max-w-sm">
    <RecordParties
      {...args}
      parties={MANY_LINKED}
      roles={ROLES}
      search={fixtureSearch}
      formatInstant={pinnedInstant}
      onLink={() => undefined}
      onUnlink={() => undefined}
      onOpen={() => undefined}
    />
  </div>
{/snippet}

<Story
  name="ManyParties"
  template={denseTemplate}
  play={async ({ canvas, step }) => {
    await step("A record carries as many parties as the matter has", async () => {
      await expect(canvas.getAllByRole("button", { name: /^Remove / }).length).toBe(14);
    });

    await step("The way to add one stays reachable beneath the whole list", async () => {
      await expect(canvas.getByRole("button", { name: "Add…" })).toBeEnabled();
    });
  }}
/>
