<script lang="ts">
  /*
   * The Links tab of the entry window: the continuance a setting is part of, the deadline's
   * trigger, and the settings a person LINKED it to by hand — with Link and Remove.
   *
   * IT SAYS LINK, NOT RELATE (owner, 2026-09-14: "Not sure what the relate button means"). The tab is
   * called Links, the model calls them links (entry-links.ts, createEventLink), and the button alone
   * said Relate — one act with two names, and the name a reader met first was the one the rest of the
   * product never used. The word is Link everywhere now, and the control names what it links rather
   * than standing as a bare verb.
   *
   * The tab owns its read, its form and its failure, so the window shell holds none of them. The
   * continuance ends are already on the record (written only by the continue operation); the
   * related links are one read, and each related end's title is read on that end's own path under
   * its own visibility, so a related setting this reader may not see reads as its kind and nothing
   * more. Which end is "other", and which settings may still be related, are entry-links.ts's
   * answers; this file renders them.
   *
   * RELATING STAYS WITHIN VISIBILITY. The other setting is picked from the same matter's own events
   * (or, for a firm event, the firm's events around it), because a link across matters is a link
   * across visibility and nothing here can offer one honestly.
   */
  import { parseDate } from "@internationalized/date";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as Select from "@magna-carta/design-system/select";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    createEventLink,
    deleteEventLink,
    listEventLinks,
    listFirmEvents,
    listMatterEvents,
    readFirmEvent,
    readMatterEvent,
  } from "./calendar-api.ts";
  import { optionalText } from "./draft-text.ts";
  import {
    otherEnd,
    relateChoices as relateChoicesOf,
    relatedLinksOf,
    unseenEndLabel,
    type LinkEnd,
    type RelatedLink,
  } from "./entry-links.ts";
  import type { EntryRecord, EntryReference } from "./entry-reference.ts";

  const idPrefix = $props.id();

  let {
    record,
    reading,
    verbRefusal,
    relatedCount = $bindable(0),
    onOpen,
  }: {
    /** The record on screen; null while it is being read. */
    record: EntryRecord | null;
    /**
     * Whether the record itself is still being read. The tab cannot tell that from a record that
     * failed to read by looking at `record` alone, and the two look different: one draws the shape
     * the links will take, the other draws nothing because the record pane says why.
     */
    reading: boolean;
    /** Why Link and Remove refuse, or undefined when the setting is open to them. */
    verbRefusal: string | undefined;
    /** How many related links the tab lists, for the count on the tab. */
    relatedCount?: number;
    /** Re-open the window on a neighbouring record. */
    onOpen: (reference: EntryReference) => void;
  } = $props();

  /**
   * Whether the record on screen is one of the FIRM's events rather than a matter's setting. The
   * two link to different things — a firm event to another firm event, a setting to another on the
   * same matter — so the words differ by that and nothing else.
   */
  const firmSide = $derived(record?.kind === "firmEvent");

  let relatedLinks = $state<readonly RelatedLink[] | null>(null);
  let linksFailure = $state<StatedFailure | null>(null);
  let removeFailure = $state<StatedFailure | null>(null);
  let linksGeneration = 0;

  $effect(() => {
    relatedCount = relatedLinks?.length ?? 0;
  });

  $effect(() => {
    void readLinks(record);
  });

  async function readLinks(target: EntryRecord | null): Promise<void> {
    linksGeneration += 1;
    const generation = linksGeneration;
    relatedLinks = null;
    linksFailure = null;
    removeFailure = null;
    if (target === null || target.kind === "deadline") return;
    const self: LinkEnd = { kind: target.kind, id: target.event.id };
    const outcome = await listEventLinks(fetch, {
      kind: target.kind === "event" ? "matterEvent" : "firmEvent",
      id: target.event.id,
    });
    if (generation !== linksGeneration) return;
    if (outcome.kind !== "ok") {
      linksFailure = stated(outcome.failure, "The event's links could not be read.");
      return;
    }
    const resolved = await Promise.all(
      relatedLinksOf(outcome.value.data).map(async (link): Promise<RelatedLink | null> => {
        const other = otherEnd(link, self);
        if (other === null) return null;
        const title =
          other.kind === "event"
            ? await readMatterEvent(fetch, other.id).then((read) =>
                read.kind === "ok" ? read.value.event.title : null,
              )
            : await readFirmEvent(fetch, other.id).then((read) =>
                read.kind === "ok" ? read.value.event.title : null,
              );
        return { id: link.id, note: link.note, other, title };
      }),
    );
    if (generation !== linksGeneration) return;
    relatedLinks = resolved.filter((link): link is RelatedLink => link !== null);
  }

  function openEvent(eventId: string): void {
    onOpen({ kind: "event", recordId: eventId });
  }

  function openOther(other: LinkEnd): void {
    onOpen(
      other.kind === "event"
        ? { kind: "event", recordId: other.id }
        : { kind: "firmEvent", recordId: other.id },
    );
  }

  async function unrelate(linkId: string): Promise<void> {
    if (record === null) return;
    removeFailure = null;
    const outcome = await deleteEventLink(fetch, linkId, crypto.randomUUID());
    if (outcome.kind === "ok") {
      void readLinks(record);
      return;
    }
    removeFailure = stated(outcome.failure, "The link was not removed.");
  }

  // ---- relating ---------------------------------------------------------------------------------

  let relateOpen = $state(false);
  let relateChoices = $state<readonly { value: string; label: string }[]>([]);
  let relateTargetId = $state("");
  let relateNote = $state("");
  let relateFailure = $state<StatedFailure | null>(null);
  let relateAttemptKey: string | null = null;
  const relateRefusal = $derived(
    relateTargetId === "" ? "Choose the setting to link this one to." : undefined,
  );

  /** Open the Link dialog; the window's action bar calls this. */
  export async function openRelate(): Promise<void> {
    if (record === null || record.kind === "deadline") return;
    relateTargetId = "";
    relateNote = "";
    relateFailure = null;
    relateAttemptKey = null;
    relateChoices = [];
    relateOpen = true;
    const self = record.event.id;
    const already = new Set((relatedLinks ?? []).map((link) => link.other.id));
    if (record.kind === "event") {
      const outcome = await listMatterEvents(fetch, record.event.matterId);
      if (outcome.kind === "ok") relateChoices = relateChoicesOf(outcome.value.data, self, already);
    } else {
      const anchor = parseDate(record.event.startsOn);
      const outcome = await listFirmEvents(fetch, {
        from: anchor.subtract({ days: 180 }).toString(),
        to: anchor.add({ days: 180 }).toString(),
      });
      if (outcome.kind === "ok") relateChoices = relateChoicesOf(outcome.value.data, self, already);
    }
  }

  async function commitRelate(): Promise<ActionOutcome> {
    if (record === null || record.kind === "deadline" || relateTargetId === "") return "refused";
    relateFailure = null;
    relateAttemptKey ??= crypto.randomUUID();
    const note = optionalText(relateNote);
    const outcome = await createEventLink(
      fetch,
      record.kind === "event"
        ? { fromMatterEventId: record.event.id, toMatterEventId: relateTargetId, note }
        : { fromFirmEventId: record.event.id, toFirmEventId: relateTargetId, note },
      relateAttemptKey,
    );
    if (outcome.kind === "ok") {
      relateAttemptKey = null;
      void readLinks(record);
      return "committed";
    }
    if (outcome.kind === "problem") relateAttemptKey = null;
    relateFailure = stated(
      outcome.failure,
      "The settings were not related.",
      "Couldn't connect. Nothing was linked. Try again.",
    );
    return "refused";
  }

  // Sample rows for the shape the Related list takes while it is read. Never a matter's own.
  const RELATED_FIXTURE = [
    { title: "Pretrial conference", note: "Set from the same scheduling order" },
    { title: "Hearing on the motion to compel", note: "Argued the same morning" },
  ] as const;
</script>

<!-- The shape the Related list takes while it is read: the same rows over sample words, greyed by
     the loading region. It stands in twice — while the record is read, and while the links are. -->
{#snippet relatedFixture()}
  <ul class="flex flex-col gap-8 text-sm">
    {#each RELATED_FIXTURE as link (link.title)}
      <li class="flex items-baseline justify-between gap-16">
        <div class="flex min-w-0 flex-col">
          <span class="underline underline-offset-2">{link.title}</span>
          <span class="text-text-muted">{link.note}</span>
        </div>
        <Button variant="ghost" size="sm">Remove</Button>
      </li>
    {/each}
  </ul>
{/snippet}

<!-- What acts like a link looks like a link: these re-open the window on the other record, so
     they are buttons under the hood and wear the link register on top. -->
{#if record === null && !reading}
  <!-- No record and no read in flight: the record pane states why, so this pane stays quiet. -->
  <p class="text-sm text-text-muted">&nbsp;</p>
{:else}
  <LoadingRegion
    loading={record === null}
    label="Reading the record's links"
    class="flex flex-col gap-16"
  >
    {#snippet fixture()}
      <div class="flex flex-col gap-8">
        <FieldLabel as="p">Linked</FieldLabel>
        {@render relatedFixture()}
      </div>
    {/snippet}
    {#if record?.kind === "event" && (record.event.continuedFromEventId !== null || record.event.continuedToEventId !== null)}
      {@const event = record.event}
      <dl class="flex flex-col gap-8 text-sm">
        {#if event.continuedFromEventId !== null}
          {@const fromId = event.continuedFromEventId}
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Continued from</dt>
            <dd>
              <button type="button" class="underline underline-offset-2" onclick={() => openEvent(fromId)}>
                The earlier setting
              </button>
            </dd>
          </div>
        {/if}
        {#if event.continuedToEventId !== null}
          {@const toId = event.continuedToEventId}
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Continued to</dt>
            <dd>
              <button type="button" class="underline underline-offset-2" onclick={() => openEvent(toId)}>
                The later setting
              </button>
            </dd>
          </div>
        {/if}
      </dl>
    {:else if record?.kind === "deadline" && record.deadline.triggerEventId !== null}
      {@const triggerId = record.deadline.triggerEventId}
      <dl class="flex flex-col gap-8 text-sm">
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Started by</dt>
          <dd>
            <button type="button" class="underline underline-offset-2" onclick={() => openEvent(triggerId)}>
              The setting that started the clock
            </button>
          </dd>
        </div>
      </dl>
    {/if}

    {#if record !== null && record.kind !== "deadline"}
      <div class="flex flex-col gap-8">
        <FieldLabel as="p">Linked</FieldLabel>
        {#if removeFailure !== null}
          <FailureNotice failure={removeFailure.failure} fallback={removeFailure.fallback} />
        {/if}
        <LoadingRegion
          loading={relatedLinks === null}
          failed={linksFailure !== null}
          empty={relatedLinks !== null && relatedLinks.length === 0}
          label="Reading the settings related to this one"
          fixture={relatedFixture}
          onRetry={() => void readLinks(record)}
        >
          {#snippet failure()}
            {#if linksFailure !== null}
              <FailureNotice
                failure={linksFailure.failure}
                title="The Links Could Not Be Read"
                fallback={linksFailure.fallback}
                onRetry={() => void readLinks(record)}
              />
            {/if}
          {/snippet}
          {#snippet emptyState()}
            <p class="text-sm text-text-muted">Linked to nothing.</p>
          {/snippet}
          <ul class="flex flex-col gap-8 text-sm">
            {#each relatedLinks ?? [] as link (link.id)}
              <li class="flex items-baseline justify-between gap-16">
                <div class="flex min-w-0 flex-col">
                  <button
                    type="button"
                    class="text-start underline underline-offset-2"
                    onclick={() => openOther(link.other)}
                  >
                    {link.title ?? unseenEndLabel(link.other)}
                  </button>
                  {#if link.note !== null}
                    <span class="text-text-muted">{link.note}</span>
                  {/if}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={verbRefusal !== undefined}
                  title={verbRefusal ?? "Remove the relation; both settings stay as they are"}
                  onclick={() => void unrelate(link.id)}
                >
                  Remove
                </Button>
              </li>
            {/each}
          </ul>
        </LoadingRegion>
      </div>
    {:else if record?.kind === "deadline" && record.deadline.triggerEventId === null}
      <p class="text-sm text-text-muted">No links.</p>
    {/if}
  </LoadingRegion>
{/if}

<ActionDialog
  bind:open={relateOpen}
  heading={firmSide ? "Link Two Events" : "Link Two Settings"}
  commitLabel="Link"
  commitBusyLabel="Linking"
  commitRefusal={relateRefusal}
  unsavedChanges={relateTargetId !== "" || relateNote !== ""}
  onCommit={commitRelate}
>
  {#snippet notice()}
    {#if relateFailure !== null}
      <FailureNotice
        failure={relateFailure.failure}
        title={firmSide ? "The Events Were Not Linked" : "The Settings Were Not Linked"}
        fallback={relateFailure.fallback}
        whenSilent={relateFailure.whenSilent}
      />
    {/if}
  {/snippet}
  {#snippet fields()}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-4">
        <Label for="{idPrefix}-relate-target">Setting</Label>
        {#if relateChoices.length === 0}
          <p class="text-sm text-text-muted">Nothing else to link this to.</p>
        {:else}
          <Select.Root
            type="single"
            items={[...relateChoices]}
            bind:value={relateTargetId}
            allowDeselect={false}
          >
            <Select.Trigger id="{idPrefix}-relate-target" class="w-full">
              <Select.Value placeholder={placeholderOf("Setting")} />
            </Select.Trigger>
            <Select.Content>
              {#each relateChoices as choice (choice.value)}
                <Select.Item value={choice.value} label={choice.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>
      <div class="flex flex-col gap-4">
        <Label for="{idPrefix}-relate-note">Note</Label>
        <Input id="{idPrefix}-relate-note" bind:value={relateNote} />
        <p class="text-xs text-text-muted">Reason (optional)</p>
      </div>
    </div>
  {/snippet}
</ActionDialog>
