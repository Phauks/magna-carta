<script lang="ts">
  /*
   * One directory record — the Record Detail archetype, for a person or an organization.
   *
   * The header names the record and says what it is; the panes beneath are the seven questions the
   * firm keeps an answer to about it, and every one of them is now answered from the firm's own
   * record rather than rendered as a shape waiting on a read.
   *
   * TWO THINGS THIS SCREEN REFUSES TO BLUR.
   *
   * An entity is not a role. This record is the person or the organization; that they are a client
   * on one matter and an opposing party on another is a fact about those matters, and it lives in
   * the Matters pane as a list of roles rather than as an attribute of the human being.
   *
   * A folded-away record still opens. A duplicate that was merged is archived, not deleted, and its
   * address keeps working: somebody following an old link has to land on something that tells them
   * where the record went, not on a 404 and not on a record that quietly pretends it still stands
   * on its own.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import {
    readDirectoryEntity,
    DIRECTORY_EDIT_PERMISSION,
    VIEW_SENSITIVE_IDENTIFIERS_PERMISSION,
    type DirectoryEntityDetail,
  } from "$lib/directory/directory-api.ts";
  import {
    directoryEntityName,
    entityKindLabel,
    entityMergedIntoIdentifier,
    entityRecordHref,
    organizationLegalNameAside,
    pronounShortForm,
  } from "$lib/directory/entity-presentation.ts";
  import { entitySectionsFor } from "$lib/directory/entity-sections.ts";
  import CategoriesPane from "$lib/directory/categories-pane.svelte";
  import ContactPane from "$lib/directory/contact-pane.svelte";
  import LifeDatesPane from "$lib/directory/life-dates-pane.svelte";
  import DuplicatesPane from "$lib/directory/duplicates-pane.svelte";
  import IdentifiersPane from "$lib/directory/identifiers-pane.svelte";
  import MattersPane from "$lib/directory/matters-pane.svelte";
  import NamesPane from "$lib/directory/names-pane.svelte";
  import PronounsPane from "$lib/directory/pronouns-pane.svelte";
  import RelationshipsPane from "$lib/directory/relationships-pane.svelte";

  let { data }: { data: { entityId: string; kind: "person" | "organization" } } = $props();

  let entity = $state<DirectoryEntityDetail | null>(null);
  let failure = $state<string | null>(null);
  let reloadToken = $state(0);
  let shownFor = $state<string | null>(null);

  $effect(() => {
    const entityId = data.entityId;
    void reloadToken;
    // Only a change of RECORD discards what is on screen. A re-read after a write is the same
    // record being read again, and blanking it would flash a skeleton over what somebody is reading.
    if (shownFor !== entityId) {
      shownFor = entityId;
      entity = null;
      failure = null;
    }
    let cancelled = false;
    void (async () => {
      const outcome = await readDirectoryEntity(fetch, entityId);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        entity = outcome.value;
        failure = null;
        return;
      }
      failure =
        outcome.kind === "transport"
          ? "Nothing answered. This record could not be read."
          : (outcome.problem.detail ?? "This record could not be read.");
    })();
    return () => {
      cancelled = true;
    };
  });

  // ---- who is asking ---------------------------------------------------------------------------

  let session = $state<SessionBootstrap | null>(null);
  let bootstrapped = $state(false);

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  const mayEdit = $derived(session?.permissions.includes(DIRECTORY_EDIT_PERMISSION) ?? false);
  const editDisabledReason = $derived(
    session === null
      ? "Reading your session."
      : mayEdit
        ? undefined
        : "Changing a directory record needs the directory:edit permission, which this account does not hold.",
  );

  const mayReveal = $derived(
    session?.permissions.includes(VIEW_SENSITIVE_IDENTIFIERS_PERMISSION) ?? false,
  );
  const revealDisabledReason = $derived(
    session === null
      ? "Reading your session."
      : mayReveal
        ? undefined
        : "Reading a sealed identifier needs the directory:viewSensitiveIdentifiers permission, which this account does not hold.",
  );

  // ---- what the header says --------------------------------------------------------------------

  const name = $derived(entity === null ? "" : directoryEntityName(entity));
  const mergedInto = $derived(entity === null ? null : entityMergedIntoIdentifier(entity));
  const pronouns = $derived(entity !== null && entity.kind === "person" ? entity.person.pronouns : null);
  const legalNameAside = $derived(
    entity !== null && entity.kind === "organization"
      ? organizationLegalNameAside(entity.organization)
      : null,
  );
  const sections = $derived(entitySectionsFor(data.kind));

  function reread(): void {
    reloadToken += 1;
  }
</script>

<svelte:head>
  <title>{name === "" ? "Directory" : name} · Magna Carta</title>
</svelte:head>

{#if failure !== null}
  <Alert.Root variant="danger">
    <Alert.Title>This Record Could Not Be Read</Alert.Title>
    <Alert.Description>
      {failure}
      <Button variant="secondary" class="mt-8" onclick={reread}>
        <RotateCcw class="size-16" aria-hidden="true" />
        Try again
      </Button>
    </Alert.Description>
  </Alert.Root>
{:else if entity === null}
  <div class="flex flex-col gap-16" aria-busy="true" aria-label="Reading the directory record">
    <Skeleton class="h-32 w-full max-w-md" />
    <Skeleton class="h-32 w-full" />
    <Skeleton class="h-32 w-full" />
  </div>
{:else}
  <div class="mb-24 flex flex-col gap-16">
    <Masthead.Root>
      <Masthead.Heading>
        <Masthead.Eyebrow>{entityKindLabel(entity.kind)}</Masthead.Eyebrow>
        <Masthead.Title>{name}</Masthead.Title>
        <Masthead.Meta>
          {#if pronouns !== null}
            <span>{pronounShortForm(pronouns)}</span>
          {/if}
          {#if legalNameAside !== null}
            {#if pronouns !== null}
              <Masthead.MetaSeparator />
            {/if}
            <span>{legalNameAside}</span>
          {/if}
        </Masthead.Meta>
      </Masthead.Heading>
      <Masthead.Actions>
        {#if mergedInto !== null}
          <Badge variant="neutral" class="uppercase" style="letter-spacing: var(--mc-tracking-caps)">
            Folded in
          </Badge>
        {/if}
      </Masthead.Actions>
    </Masthead.Root>

    {#if mergedInto !== null}
      <Alert.Root variant="info">
        <Alert.Title>This Record Was Folded Into Another</Alert.Title>
        <Alert.Description>
          It is archived and no longer stands on its own. Everything recorded against it moved to the
          surviving record, and the names it carried still find it.
          <a class="underline underline-offset-2" href={entityRecordHref(mergedInto)}>
            Open the surviving record
          </a>
        </Alert.Description>
      </Alert.Root>
    {/if}
  </div>

  <Tabs.Root value={sections[0]?.id ?? "names"}>
    <Tabs.List>
      {#each sections as section (section.id)}
        <Tabs.Trigger value={section.id}>
          {section.label}
          <MaturityBadge stage={section.stage} />
        </Tabs.Trigger>
      {/each}
    </Tabs.List>

    <Tabs.Content value="names">
      <NamesPane {entity} {mayEdit} {editDisabledReason} onRecorded={reread} />
    </Tabs.Content>

    <Tabs.Content value="contact">
      <ContactPane entityId={data.entityId} {mayEdit} {editDisabledReason} />
    </Tabs.Content>

    {#if entity.kind === "person"}
      <Tabs.Content value="dates">
        <LifeDatesPane
          person={entity.person}
          {mayEdit}
          {editDisabledReason}
          onRecorded={reread}
        />
      </Tabs.Content>

      <Tabs.Content value="pronouns">
        <PronounsPane
          person={entity.person}
          {mayEdit}
          {editDisabledReason}
          onRecorded={reread}
        />
      </Tabs.Content>
    {/if}

    <Tabs.Content value="identifiers">
      <IdentifiersPane
        entityId={data.entityId}
        kind={entity.kind}
        {mayEdit}
        {editDisabledReason}
        {mayReveal}
        {revealDisabledReason}
      />
    </Tabs.Content>

    <Tabs.Content value="duplicates">
      <DuplicatesPane {entity} {mayEdit} {editDisabledReason} onMerged={reread} />
    </Tabs.Content>

    <Tabs.Content value="relationships">
      <RelationshipsPane entityId={data.entityId} />
    </Tabs.Content>

    <Tabs.Content value="matters">
      <MattersPane entityId={data.entityId} />
    </Tabs.Content>

    <Tabs.Content value="categories">
      <CategoriesPane entityId={data.entityId} kind={entity.kind} {mayEdit} {editDisabledReason} />
    </Tabs.Content>
  </Tabs.Root>
{/if}
