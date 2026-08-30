<script lang="ts">
  /*
   * The Directory — the firm's one book of the people and organizations it deals with, and the List
   * archetype's landing for them.
   *
   * IT IS SEARCHED, NOT BROWSED, and that is the firm's record rather than a choice made here. The
   * directory answers a name: it matches three-character windows of every name it has ever held for
   * anybody, current and former alike, so a typo and a maiden name both land. What it does not
   * answer is "show me everyone" — there is no listing, and a screen that faked one by searching for
   * a common letter would be presenting an accident as an index. So the resting state says what to
   * type rather than showing an arbitrary page of the firm's clients.
   *
   * The answer is also CAPPED. A ranked search returns its best matches, not all of them, and the
   * line under a capped answer says so — "no more matches" and "we stopped counting" look identical
   * otherwise, and a person deciding whether a client is already on file would act on the
   * difference.
   *
   * Rows are in the firm's own relevance order and are NOT re-sorted here. Sorting a capped answer
   * would put the best of an arbitrary slice at the top and read as the best of the firm's record.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Building2 from "@lucide/svelte/icons/building-2";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import { goto } from "$app/navigation";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import {
    searchDirectory,
    DIRECTORY_EDIT_PERMISSION,
    type DirectoryEntityKind,
    type DirectorySearchHit,
  } from "$lib/directory/directory-api.ts";
  import { isAskableQuery, MINIMUM_QUERY_LENGTH } from "$lib/directory/directory-search.ts";
  import {
    entityRecordHref,
    searchHitKindLabel,
  } from "$lib/directory/entity-presentation.ts";
  import EntityIdentity from "$lib/directory/entity-identity.svelte";
  import NewEntityDialog from "$lib/directory/new-entity-dialog.svelte";

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
  const createDisabledReason = $derived(
    session === null
      ? "Reading your session."
      : mayEdit
        ? undefined
        : "Adding to the directory needs the directory:edit permission, which this account does not hold.",
  );

  // ---- the search ------------------------------------------------------------------------------

  let typed = $state("");
  let asked = $state("");
  let hits = $state<readonly DirectorySearchHit[] | null>(null);
  let capped = $state(false);
  let failure = $state<string | null>(null);
  let reloadToken = $state(0);

  // The typed query settles before it is sent: one request per keystroke asks the firm's record a
  // question nobody has finished asking.
  $effect(() => {
    const query = typed;
    const timer = setTimeout(() => (asked = query), 300);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const query = asked.trim();
    void reloadToken;
    if (!isAskableQuery(query)) {
      hits = null;
      capped = false;
      failure = null;
      return;
    }
    let cancelled = false;
    hits = null;
    failure = null;
    void (async () => {
      const outcome = await searchDirectory(fetch, query);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        hits = outcome.value.data;
        capped = outcome.value.capped;
        return;
      }
      hits = [];
      capped = false;
      failure =
        outcome.kind === "transport"
          ? "Nothing answered. The directory could not be searched."
          : (outcome.problem.detail ?? "The directory could not be searched.");
    })();
    return () => {
      cancelled = true;
    };
  });

  const askable = $derived(isAskableQuery(asked));

  // ---- adding a record -------------------------------------------------------------------------

  let dialogOpen = $state(false);
  let dialogKind = $state<DirectoryEntityKind>("person");

  function openNew(kind: DirectoryEntityKind): void {
    dialogKind = kind;
    dialogOpen = true;
  }
</script>

<svelte:head>
  <title>Directory · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>Directory</Masthead.Title>
    <Masthead.Meta>
      <span>Clients, parties, counsel and courts, in one book</span>
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    <Button
      variant="secondary"
      disabled={!mayEdit}
      title={createDisabledReason}
      onclick={() => openNew("organization")}
    >
      <Building2 class="size-16" aria-hidden="true" />
      New organization
    </Button>
    <Button
      variant="primary"
      disabled={!mayEdit}
      title={createDisabledReason}
      onclick={() => openNew("person")}
    >
      <UserPlus class="size-16" aria-hidden="true" />
      New person
    </Button>
  </Masthead.Actions>
</Masthead.Root>

{#if createDisabledReason !== undefined && session !== null}
  <Alert.Root variant="info" class="mb-16">
    <Alert.Title>Adding To The Directory Is Not Available To This Account</Alert.Title>
    <Alert.Description>{createDisabledReason}</Alert.Description>
  </Alert.Root>
{/if}

<section class="flex flex-col gap-16">
  <div class="flex flex-col gap-8">
    <Label for="directory-search">Search</Label>
    <Input
      id="directory-search"
      type="search"
      class="max-w-md"
      bind:value={typed}
      placeholder={placeholderOf("Search")}
    />
  </div>

  {#if failure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>The Directory Could Not Be Searched</Alert.Title>
      <Alert.Description>
        {failure}
        <Button variant="secondary" class="mt-8" onclick={() => (reloadToken += 1)}>
          <RotateCcw class="size-16" aria-hidden="true" />
          Try again
        </Button>
      </Alert.Description>
    </Alert.Root>
  {:else if !askable}
    <EmptyState title="Search The Firm's Book">
      {#snippet actions()}
        <Button
          variant="primary"
          disabled={!mayEdit}
          title={createDisabledReason}
          onclick={() => openNew("person")}
        >
          <UserPlus class="size-16" aria-hidden="true" />
          New person
        </Button>
      {/snippet}
      Every name the firm has ever recorded for somebody is searched, the ones they no longer go by
      included, and a misspelling still finds them. It takes {MINIMUM_QUERY_LENGTH} letters to ask.
    </EmptyState>
  {:else if hits === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Searching the directory">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if hits.length === 0}
    <EmptyState title="Nothing Matches That Search">
      {#snippet actions()}
        <Button
          variant="primary"
          disabled={!mayEdit}
          title={createDisabledReason}
          onclick={() => openNew("person")}
        >
          <UserPlus class="size-16" aria-hidden="true" />
          New person
        </Button>
      {/snippet}
      No name on the firm's record answers to that, current or former. Recording them is what puts
      them in front of the next conflicts check.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">
        Directory records matching the search, in the firm's own relevance order
      </DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Name</DataTable.Head>
          <DataTable.Head>Kind</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each hits as hit (hit.entityId)}
          <DataTable.Row
            ondblclick={() => void goto(entityRecordHref(hit.entityId))}
          >
            <DataTable.Cell>
              <EntityIdentity
                kind={hit.entityKind === "organization" ? "organization" : "person"}
                name={hit.displayName}
                href={entityRecordHref(hit.entityId)}
              />
            </DataTable.Cell>
            <DataTable.Cell>{searchHitKindLabel(hit.entityKind)}</DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>

    {#if capped}
      <p class="text-xs text-text-muted">
        The firm holds more matches than are shown. These are the closest; narrowing the search
        reaches the rest.
      </p>
    {/if}
  {/if}
</section>

<NewEntityDialog
  bind:open={dialogOpen}
  kind={dialogKind}
  onCreated={(entityId) => void goto(entityRecordHref(entityId))}
/>
