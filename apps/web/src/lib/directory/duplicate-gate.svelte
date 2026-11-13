<script lang="ts">
  /*
   * The gate a new record has to pass: what the firm may already hold under a similar spelling.
   *
   * It runs as soon as the name is enough to ask with, settles before it asks, and stays in view
   * beside the entry the whole time — a gate behind a tab is a gate somebody has to remember to go
   * and look at. It is a warning and not a refusal: two people do share a name, and the person
   * deciding is the one who knows. A candidate opens beside the draft, through the one gate for
   * that, because the draft is unsaved work.
   *
   * A check that cannot run is not a finding: it leaves the list empty rather than claiming the
   * firm holds nobody similar.
   *
   * THE CHECK IS A REFRESH, NEVER A PLACEHOLDER. The previous candidates stay in view while the
   * directory is asked again for the name as it now reads; the region marks itself busy and says
   * "Checking the directory" for assistive technology, and nothing is greyed. There is no absent
   * answer for a fixture to stand in for, so the region never shows one.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import { findDuplicateCandidates, readDirectoryEntity, type DirectoryEntityKind } from "./directory-api.ts";
  import { directoryEntityName, entityRecordHref } from "./entity-presentation.ts";
  import StatusMark from "@magna-carta/design-system/status-mark";
  import ScanSearch from "@lucide/svelte/icons/scan-search";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

  let {
    kind,
    given = "",
    family = "",
    legalName = "",
  }: {
    kind: DirectoryEntityKind;
    given?: string;
    family?: string;
    legalName?: string;
  } = $props();

  interface Candidate {
    entityId: string;
    name: string;
    kind: DirectoryEntityKind | null;
  }

  let candidates = $state<readonly Candidate[]>([]);
  let checking = $state(false);
  /** The directory could not be asked. Stated, never rendered as "nobody similar". */
  let failed = $state(false);

  const asked = $derived(
    kind === "person"
      ? { given: given.trim(), family: family.trim() }
      : { legalName: legalName.trim() },
  );
  const ready = $derived(
    kind === "person"
      ? asked.given !== "" && asked.family !== ""
      : (asked.legalName ?? "") !== "",
  );

  // The check settles before it is sent: one request per keystroke would ask the firm's record a
  // question nobody has finished asking yet.
  $effect(() => {
    const question = { ...asked };
    if (!ready) {
      candidates = [];
      checking = false;
      failed = false;
      return;
    }
    let cancelled = false;
    checking = true;
    failed = false;
    const timer = setTimeout(() => {
      void (async () => {
        const outcome = await findDuplicateCandidates(fetch, { kind, ...question });
        if (cancelled) return;
        if (outcome.kind !== "ok") {
          candidates = [];
          checking = false;
          failed = true;
          return;
        }
        const resolved = await Promise.all(
          outcome.value.data.slice(0, 5).map(async (candidate): Promise<Candidate> => {
            const detail = await readDirectoryEntity(fetch, candidate.entityId);
            return {
              entityId: candidate.entityId,
              name: detail.kind === "ok" ? directoryEntityName(detail.value) : candidate.entityId,
              kind: candidate.entityKind === "unknown" ? null : candidate.entityKind,
            };
          }),
        );
        if (cancelled) return;
        candidates = resolved;
        checking = false;
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
</script>

<!-- ONE SENTENCE THAT SAYS WHERE THE CHECK STANDS, not a heading over an empty list with a 0 beside
     it: what is still needed before it can run, that it found nobody, or how many it found. -->
<div class="flex flex-col gap-8">
  <p class="flex items-center gap-8 text-sm" aria-live="polite">
    {#if !ready}
      <ScanSearch class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
      <span class="text-text-muted">
        {kind === "person"
          ? "Once there is a first and last name, the Directory is checked for this person."
          : "Once there is a name, the Directory is checked for this organization."}
      </span>
    {:else if checking}
      <ScanSearch class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
      <span class="text-text-muted">Checking the Directory</span>
    {:else if failed}
      <!-- The failure itself is stated below; nothing here may read as "nobody similar". -->
    {:else if candidates.length === 0}
      <StatusMark decorative class="size-16 shrink-0" />
      <span>Nobody similar is in the Directory.</span>
    {:else}
      <TriangleAlert class="size-16 shrink-0 text-status-warning" aria-hidden="true" />
      <span class="font-semibold">
        {candidates.length === 1 ? "1 record" : `${candidates.length} records`} may be this
        {kind === "person" ? "person" : "organization"} already.
      </span>
    {/if}
  </p>
  <LoadingRegion
    loading={false}
    refreshing={checking}
    {failed}
    label="Checking the directory"
    class="flex flex-col"
  >
    {#snippet failure()}
      <Alert.Root variant="warning">
        <Alert.Title>The Directory Could Not Be Checked</Alert.Title>
        <Alert.Description>Nothing here says the firm holds nobody similar.</Alert.Description>
      </Alert.Root>
    {/snippet}
    {#if candidates.length > 0}
      <ul class="flex flex-col">
        {#each candidates as candidate (candidate.entityId)}
          <li class="flex items-center gap-8 border-b border-border-default py-4">
            <div class="min-w-0 flex-auto">
              <EntityIdentity kind={candidate.kind} name={candidate.name} size="default" />
            </div>
            <Button
              variant="secondary"
              size="sm"
              href={entityRecordHref(candidate.entityId)}
              {...opensBeside("unsaved-work")}
            >
              Open
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </LoadingRegion>
</div>
