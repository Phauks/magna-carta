<script lang="ts">
  /*
   * One conflicts check, read back — the Record Detail archetype over the firm's append-only log.
   *
   * The order on this page is the order a reader needs it in, and it is not the order a database
   * would give. First what the search DID, in the platform's own sentences, because that is the
   * defensible part and the part a court asks about. Then the scope it ran under, verbatim, so
   * nobody has to know what the preset word meant on the day. Only then the candidates, because a
   * candidate count read without the account of the search that produced it is the number that gets
   * misread as a verdict.
   *
   * NOTHING ON THIS PAGE CONCLUDES ANYTHING. There is no summary line, no aggregate, no tick. A
   * check that surfaced nothing says the search ended; a reviewer's answer to one candidate says
   * whose conclusion it is and what they reasoned.
   *
   * THE PARTY'S NAME COSTS ONE READ, WHEN SOMEBODY OPENS A HIT. The check answers entity handles and
   * nothing names many at once, so the list states the gap and this page resolves the one entity a
   * reviewer actually opened, caching what it learns for the rest of the visit.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import Button from "@magna-carta/design-system/button";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import Separator from "@magna-carta/design-system/separator";
  import { formatInstant, personName } from "@magna-carta/design-system/formatters";
  import Printer from "@lucide/svelte/icons/printer";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import { page } from "$app/state";
  import DispositionDialog from "$lib/conflicts/disposition-dialog.svelte";
  import HitList from "$lib/conflicts/hit-list.svelte";
  import HitWindow from "$lib/conflicts/hit-window.svelte";
  import ScopeInForce from "$lib/conflicts/scope-in-force.svelte";
  import { checkReportSheet } from "$lib/conflicts/conflicts-report.ts";
  import {
    readConflictsCheck,
    scopeOfCheck,
    type CheckWithHits,
    type HitDetail,
    type ScopeInForceRecord,
  } from "$lib/conflicts/conflicts-api.ts";
  import { readDirectoryEntity } from "$lib/directory/directory-api.ts";
  import { directoryEntityName } from "$lib/directory/entity-presentation.ts";
  import { triggerVocabulary } from "$lib/conflicts/conflicts-vocabulary.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  const checkId = $derived(page.params.checkId ?? "");

  let result = $state<CheckWithHits | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let loading = $state(true);
  let session = $state<SessionBootstrap | null>(null);
  let openHit = $state<HitDetail | null>(null);
  let windowOpen = $state(false);
  let dialogOpen = $state(false);
  let printOpen = $state(false);
  let entityNames = $state<ReadonlyMap<string, string>>(new Map());
  let unnameable = $state<ReadonlySet<string>>(new Set());

  /*
   * The shape the page takes while the check is read: its own sections, over an invented search.
   * Inert and hidden from assistive technology while it stands, so none of it can be quoted as
   * what a search did.
   */
  const STATEMENT_FIXTURE: readonly string[] = [
    "Searched the Directory for 4 subject parties under balanced matching, comparing surnames, given names and dates of birth.",
    "Walked relationships to a depth of 2 and reached 31 entities; the walk completed.",
    "Prior firm history could not be searched: no corpus is registered for it.",
  ];
  const SCOPE_FIXTURE: ScopeInForceRecord = {
    sources: { party: "searched", graph: "searched", imputation: "unavailable", content: "searched" },
    strictness: "balanced",
    depth: 2,
    floorRaised: false,
    matching: null,
    traversal: null,
    candidates: null,
  };

  async function read(): Promise<void> {
    loading = true;
    const outcome = await readConflictsCheck(fetch, checkId);
    loading = false;
    if (outcome.kind === "ok") {
      result = outcome.value;
      failure = null;
      // The open hit is a copy of a row that has just been re-read; re-point it at the fresh one so
      // an answer recorded a moment ago shows on the record the window is holding.
      const held = openHit;
      if (held !== null) openHit = outcome.value.hits.find((hit) => hit.id === held.id) ?? null;
      return;
    }
    result = null;
    failure = stated(
      outcome.failure,
      "The check could not be read.",
      "The check could not be reached.",
    );
  }

  $effect(() => {
    const asked = checkId;
    if (asked === "") return;
    void read();
    void firmRoster.load(fetch);
  });

  $effect(() => {
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  const memberNames = $derived(
    new Map((firmRoster.members ?? []).map((member) => [member.userId, member.displayName])),
  );
  const reviewerName = $derived(
    openHit?.disposition === null || openHit === null
      ? null
      : (memberNames.get(openHit.disposition.reviewerUserId) ?? null),
  );
  const signedInName = $derived(session?.user.name ?? null);
  const check = $derived(result?.check ?? null);
  // The matched party arrives ON THE HIT — the check read resolves every hit's entity in one query
  // — so opening one costs no read at all. It used to cost one per hit opened, cached for the visit.
  const openPartyName = $derived(openHit?.party?.displayName ?? null);
  // A waiver names the entity that consented, which is often not the entity that matched. It costs
  // the same one read, on the same cache, for the same reason: the log answers handles.
  const openConsentingPartyName = $derived.by((): string | null => {
    const consentingPartyId = openHit?.disposition?.waiver?.givenByEntityId ?? null;
    return consentingPartyId === null ? null : (entityNames.get(consentingPartyId) ?? null);
  });

  /** One read, for a waiver's consenting party. What it learns is kept for the rest of the visit. */
  async function nameEntity(entityId: string): Promise<void> {
    if (entityNames.has(entityId) || unnameable.has(entityId)) return;
    const outcome = await readDirectoryEntity(fetch, entityId);
    if (outcome.kind !== "ok") {
      unnameable = new Set([...unnameable, entityId]);
      return;
    }
    entityNames = new Map([...entityNames, [entityId, directoryEntityName(outcome.value)]]);
  }

  function openOne(hit: HitDetail): void {
    openHit = hit;
    windowOpen = true;
    // Only the CONSENTING party still needs a read: a waiver names the entity that consented, which
    // is often not the entity that matched, and the disposition carries it as a handle. The matched
    // party came with the hit.
    const consentingPartyId = hit.disposition?.waiver?.givenByEntityId ?? null;
    if (consentingPartyId !== null) void nameEntity(consentingPartyId);
  }

  const sheet = $derived(
    result === null
      ? null
      : checkReportSheet(result, { entityNames, memberNames, printedAt: new Date() }),
  );
</script>

<svelte:head>
  <title>Conflicts Check · Magna Carta</title>
</svelte:head>

<ScreenHeader title="The Check" back="conflicts" class="mb-24">
  {#snippet meta()}
      {#if check !== null}
        <span>{formatInstant(check.createdAt)}</span>
        <Masthead.MetaSeparator />
        <span title={triggerVocabulary(check.trigger).meaning}>
          {triggerVocabulary(check.trigger).label}
        </span>
        <Masthead.MetaSeparator />
        <span>
          {check.actorUserId === null
            ? "No acting member recorded"
            : personName(memberNames.get(check.actorUserId) ?? null, {
                whenUnrecorded: check.actorUserId,
              })}
        </span>
      {/if}
  {/snippet}
  {#snippet actions()}
    {#if check !== null && check.matterId !== null}
      <Button variant="secondary" href="/conflicts/matters/{check.matterId}">
        <ScrollText class="size-16" aria-hidden="true" />
        Where the matter stands
      </Button>
    {/if}
    <Button variant="primary" disabled={sheet === null} onclick={() => (printOpen = true)}>
      <Printer class="size-16" aria-hidden="true" />
      The report
    </Button>
  {/snippet}
</ScreenHeader>

{#if failure !== null}
  <FailureNotice
    failure={failure.failure}
    title="The Check Could Not Be Read"
    fallback={failure.fallback}
    whenSilent={failure.whenSilent}
    onRetry={() => void read()}
  />
{:else}
  <LoadingRegion
    loading={loading && result === null}
    label="Reading the check"
    class="flex flex-col gap-24"
  >
    {#snippet fixture()}
      <section class="flex flex-col gap-8">
        <h2 class="text-base font-semibold" data-loading-keep>What The Search Did</h2>
        <ol class="flex flex-col gap-8 text-sm">
          {#each STATEMENT_FIXTURE as line (line)}
            <li>{line}</li>
          {/each}
        </ol>
      </section>

      <Separator />

      <section class="flex flex-col gap-16">
        <h2 class="text-base font-semibold" data-loading-keep>Scope In Force</h2>
        <ScopeInForce scope={SCOPE_FIXTURE} />
      </section>

      <Separator />

      <HitList hits={null} loading onOpen={() => undefined} />
    {/snippet}
    {#if result !== null && check !== null}
      <section class="flex flex-col gap-8">
        <h2 class="text-base font-semibold">What The Search Did</h2>
        <!-- The engine's own sentences, in the order it wrote them. Nothing here rewrites or
             summarizes them: the sentence's whole value is that the machine that ran the search
             produced it, and a firm defending its procedure quotes this. -->
        <ol class="flex flex-col gap-8 text-sm">
          {#each result.statement as line, index (`${String(index)}-${line}`)}
            <li>{line}</li>
          {/each}
        </ol>
      </section>

      <Separator />

      <section class="flex flex-col gap-16">
        <h2 class="text-base font-semibold">Scope In Force</h2>
        <ScopeInForce scope={scopeOfCheck(check)} />
      </section>

      <Separator />

      <HitList hits={result.hits} loading={loading} onOpen={openOne} />
    {/if}
  </LoadingRegion>
{/if}

{#if failure === null && result !== null && check !== null}
  <HitWindow
    bind:open={windowOpen}
    hit={openHit}
    consentingPartyName={openConsentingPartyName}
    {reviewerName}
    checkInstant={check.createdAt}
    onAnswer={() => (dialogOpen = true)}
  />

  <DispositionDialog
    bind:open={dialogOpen}
    hit={openHit}
    partyName={openPartyName}
    matterId={check.matterId}
    reviewerName={signedInName}
    permissions={session?.permissions ?? null}
    onRecorded={() => void read()}
  />

  {#if sheet !== null}
    <PrintSheet bind:open={printOpen} {sheet} />
  {/if}
{/if}
