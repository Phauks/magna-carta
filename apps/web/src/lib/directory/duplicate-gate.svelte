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
   */
  import Button from "@magna-carta/design-system/button";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import { findDuplicateCandidates, readDirectoryEntity, type DirectoryEntityKind } from "./directory-api.ts";
  import { directoryEntityName, entityRecordHref } from "./entity-presentation.ts";
  import SectionHeading from "./sections/section-heading.svelte";

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
      return;
    }
    let cancelled = false;
    checking = true;
    const timer = setTimeout(() => {
      void (async () => {
        const outcome = await findDuplicateCandidates(fetch, { kind, ...question });
        if (cancelled) return;
        if (outcome.kind !== "ok") {
          candidates = [];
          checking = false;
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

<div class="flex flex-col gap-4" aria-busy={checking ? "true" : undefined}>
  <SectionHeading label="May Already Be In The Directory" count={ready ? candidates.length : null} />
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
  {:else if checking}
    <p class="sr-only">Checking the directory</p>
  {/if}
</div>
