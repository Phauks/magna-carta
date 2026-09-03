<script lang="ts">
  /*
   * Conflicts Check — the firm's own surface for the screen a lawyer runs before taking a matter,
   * and re-runs when circumstances change.
   *
   * This is the Form archetype: a grouped-section form at a readable measure, then the record it
   * writes. It is deliberately not a search box. A conflicts check is a professional-responsibility
   * act with a record behind it — what was searched, what could not be, what surfaced, and who
   * concluded what — and the shape of this screen is the shape of that act.
   *
   * NAMING A MATTER CHANGES WHAT CAN BE SEARCHED. With a matter, the matter's own parties join the
   * subjects and the imputation class has something to join the firm's members against. Without
   * one, imputation records unavailable — which the check says out loud rather than leaving out.
   *
   * WHAT THIS SCREEN CANNOT OFFER, AND SAYS SO. Nothing serves a list of the checks a firm has run,
   * so there is no history here; the block that would hold one renders in its place, refused, naming
   * what it waits on. A matter's own standing is reachable, because that read exists.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Combobox from "@magna-carta/design-system/combobox";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import Separator from "@magna-carta/design-system/separator";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import { goto } from "$app/navigation";
  import CheckRunner from "$lib/conflicts/check-runner.svelte";
  import Badge from "@magna-carta/design-system/badge";
  import { formatInstant, personName } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    listConflictsChecks,
    RUN_CHECK_PERMISSION,
    type ConflictsCheckSummary,
  } from "$lib/conflicts/conflicts-api.ts";
  import { triggerVocabulary } from "$lib/conflicts/conflicts-vocabulary.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import {
    listMatters,
    readSession,
    type MatterSummary,
    type SessionBootstrap,
  } from "$lib/matters/matters-api.ts";

  let session = $state<SessionBootstrap | null>(null);
  let matters = $state<readonly MatterSummary[]>([]);
  let matterQuery = $state("");
  let settledMatterQuery = $state("");
  let chosenMatter = $state<MatterSummary | null>(null);
  let bootstrapped = $state(false);

  /*
   * The checks this firm has run. One page, newest first — the block used to keep its place saying
   * the platform knew the question and could not answer it.
   */
  let history = $state<ConflictsCheckSummary[] | null>(null);
  let historyHasMore = $state(false);
  let historyFailure = $state<StatedFailure | null>(null);

  // The shared roster, so a manual run names the member who asked rather than printing a handle.
  const memberNames = $derived(
    new Map((firmRoster.members ?? []).map((member) => [member.userId, member.displayName])),
  );

  $effect(() => {
    void firmRoster.load(fetch);
  });

  $effect(() => {
    void (async () => {
      const outcome = await listConflictsChecks(fetch);
      if (outcome.kind !== "ok") {
        historyFailure = stated(outcome.failure, "The checks this firm has run could not be read.");
        return;
      }
      history = outcome.value.data;
      historyHasMore = outcome.value.nextCursor !== null;
    })();
  });

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  // The typed query settles before it is sent: a docket read per keystroke is a request per
  // keystroke, and the firm's own search over title, number and client is the authoritative one.
  $effect(() => {
    const typed = matterQuery;
    const timer = setTimeout(() => (settledMatterQuery = typed), 250);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const asked = settledMatterQuery.trim();
    let live = true;
    void (async () => {
      const outcome = await listMatters(fetch, { scope: "caseload", search: asked });
      if (!live) return;
      // A docket that cannot be read leaves the picker empty; the check itself does not need one.
      matters = outcome.kind === "ok" ? outcome.value.data : [];
    })();
    return () => {
      live = false;
    };
  });

  const permissions = $derived(session?.permissions ?? null);
  const mayRun = $derived(permissions === null || permissions.includes(RUN_CHECK_PERMISSION));

  /**
   * How a matter reads in the picker and back on the form: its number where it has one. A
   * consultation's tentative number counts — running a check against one is the whole point of
   * taking the consultation, and the number is what the result will be filed under.
   */
  function matterLine(matter: MatterSummary): string {
    const number = matter.matterNumber ?? matter.consultationNumber;
    return number === null ? matter.title : `${number} · ${matter.title}`;
  }

  function chooseMatter(value: string | string[]): void {
    const id = Array.isArray(value) ? (value[0] ?? "") : value;
    chosenMatter = matters.find((matter) => matter.id === id) ?? null;
  }
</script>

<svelte:head>
  <title>Conflicts Check · Magna Carta</title>
</svelte:head>

<ScreenHeader
  title="Conflicts Check"
  class="mb-24"
>
  {#snippet meta()}
    <span>Search the firm's record, and keep what the search did</span>
  {/snippet}
</ScreenHeader>

{#if session !== null && !mayRun}
  <Alert.Root variant="info" class="mb-16">
    <Alert.Title>Running A Check Is Not Available To This Account</Alert.Title>
    <Alert.Description>
      {permissionRefusal("Running a check", "conflicts:run")} Reading a matter's standing is a
      separate permission.
    </Alert.Description>
  </Alert.Root>
{/if}

<div class="flex max-w-3xl flex-col gap-24">
  <section class="flex flex-col gap-16">
    <h2 class="text-base font-semibold">The Matter</h2>
    <div class="flex flex-col gap-8">
      <Label for="conflicts-matter">Matter</Label>
      <Combobox.Root
        type="single"
        items={matters.map((matter) => ({ value: matter.id, label: matterLine(matter) }))}
        inputValue={matterQuery}
        onValueChange={chooseMatter}
      >
        <Combobox.Input
          id="conflicts-matter"
          placeholder="Matter"
          autocomplete="off"
          oninput={(event) => (matterQuery = event.currentTarget.value)}
        />
        <Combobox.Content>
          {#each matters as matter (matter.id)}
            <Combobox.Item value={matter.id} label={matterLine(matter)}>
              {matterLine(matter)}
            </Combobox.Item>
          {/each}
        </Combobox.Content>
      </Combobox.Root>
    </div>

    {#if chosenMatter !== null}
      <div class="flex flex-wrap items-center gap-8">
        <Button
          variant="secondary"
          onclick={() => void goto(`/conflicts/matters/${chosenMatter?.id ?? ""}`)}
        >
          <ScrollText class="size-16" aria-hidden="true" />
          Read where this matter stands
        </Button>
        <Button variant="ghost" onclick={() => (chosenMatter = null)}>Clear the matter</Button>
      </div>
    {/if}
  </section>

  <Separator />

  <CheckRunner
    matterId={chosenMatter?.id ?? null}
    matterLabel={chosenMatter === null ? null : matterLine(chosenMatter)}
    {permissions}
    onRan={(checkId) => void goto(`/conflicts/checks/${checkId}`)}
  />

  <Separator />

  <section class="flex flex-col gap-8">
    <h2 class="text-base font-semibold">Earlier Checks</h2>
    {#if historyFailure !== null}
      <FailureNotice
        failure={historyFailure.failure}
        subject="The checks this firm has run"
        fallback={historyFailure.fallback}
      />
    {:else if history === null}
      <p class="text-sm text-text-muted" aria-busy="true">Reading the checks this firm has run.</p>
    {:else if history.length === 0}
      <p class="text-sm text-text-muted">
        This firm has run no conflicts checks yet. That is a fact about the record, and says nothing
        about any matter.
      </p>
    {:else}
      <ul class="flex flex-col divide-y divide-border-default">
        {#each history as check (check.id)}
          <li class="flex flex-wrap items-baseline gap-x-12 gap-y-4 py-8">
            <a class="text-sm underline underline-offset-2" href="/conflicts/checks/{check.id}">
              {formatInstant(check.createdAt)}
            </a>
            <span class="text-sm text-text-muted">{triggerVocabulary(check.trigger).label}</span>
            <!-- What set it going, and who asked where anybody did. An automated run is nobody's
                 act, and saying so is different from leaving the actor blank. -->
            <span class="text-xs text-text-subtle">
              {check.triggerSource === "manual"
                ? personName(memberNames.get(check.actorUserId ?? "") ?? null, {
                    whenUnrecorded: check.actorUserId ?? "a member",
                  })
                : check.triggerSource === null
                  ? "The row does not say what started it"
                  : "Run automatically"}
            </span>
            {#if check.floorRaised}
              <!-- It searched WIDER than asked. Worth the row, because it explains a result set
                   larger than the requester expected. -->
              <Badge variant="neutral">Raised to the firm floor</Badge>
            {/if}
            <span class="ms-auto text-sm tabular-nums text-text-muted">
              {check.hitCount}
              {check.hitCount === 1 ? "candidate" : "candidates"}
            </span>
          </li>
        {/each}
      </ul>
      {#if historyHasMore}
        <p class="text-xs text-text-subtle">
          The most recent {history.length} checks. Older ones are on the record and are not shown
          here.
        </p>
      {/if}
    {/if}
  </section>
</div>
