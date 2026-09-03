<script lang="ts">
  /*
   * Adding a person or an organization to the firm's directory.
   *
   * THE DUPLICATE CHECK RUNS BEFORE THE RECORD IS MADE, not after. The same human arrives spelled
   * three ways over a decade of files, and the cheapest moment to catch that is the moment somebody
   * is about to type them in for the fourth time. So as soon as the name is enough to ask with, the
   * firm's own record is asked, and anything it already holds under a similar spelling is shown
   * with a way to open it.
   *
   * It is a warning and not a gate, deliberately. Two people genuinely do share a name, and a
   * screen that refused the second one would be wrong about the firm's clients rather than careful
   * about its record. The person deciding is the one who knows.
   *
   * The name recorded here becomes the entity's CURRENT name and the first row of its history.
   * Anything else it has ever been called is added afterwards, in the record's own Names pane.
   *
   * THE PANEL IS THE ACTION DIALOG SHELL, so this file holds the fields, the duplicate warning and
   * the commit, and nothing about the panel itself: the dismissal, the busy state, Enter to commit
   * and the unsaved-work question are the shell's. The commit is refused, with the reason beside
   * it, until the name is enough to record; the refusal is the same sentence the duplicate check
   * waits for, because both need the same thing.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";
  import FieldRow from "@magna-carta/design-system/field-row";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    createDirectoryOrganization,
    createDirectoryPerson,
    findDuplicateCandidates,
    readDirectoryEntity,
    type DirectoryEntityKind,
  } from "./directory-api.ts";
  import { directoryEntityName, entityRecordHref } from "./entity-presentation.ts";

  let {
    open = $bindable(false),
    kind,
    onCreated,
  }: {
    open?: boolean;
    kind: DirectoryEntityKind;
    onCreated: (entityId: string) => void;
  } = $props();

  let prefix = $state("");
  let given = $state("");
  let middle = $state("");
  let family = $state("");
  let suffix = $state("");
  let legalName = $state("");
  let displayName = $state("");

  let failure = $state<StatedFailure | null>(null);

  /** What the firm may already hold under a similar spelling, resolved to names people recognize. */
  let candidates = $state<readonly { entityId: string; name: string }[]>([]);
  let checking = $state(false);

  const identityFields = $derived(
    kind === "person"
      ? { given: given.trim(), family: family.trim() }
      : { legalName: legalName.trim() },
  );

  const ready = $derived(
    kind === "person"
      ? identityFields.given !== "" && identityFields.family !== ""
      : (identityFields.legalName ?? "") !== "",
  );

  /*
   * Why the commit is unavailable, or undefined when it is available. The shell shows this beside
   * the control it refuses rather than hiding the control, so a reader is told what is still
   * missing instead of hunting for it.
   */
  const refusal = $derived(
    ready
      ? undefined
      : kind === "person"
        ? "Give the person's given name and family name."
        : "Give the organization's legal name.",
  );

  /** Whether anything has been typed. A blank form has nothing to lose, so leaving never asks. */
  const started = $derived(
    [prefix, given, middle, family, suffix, legalName, displayName].some(
      (value) => value.trim() !== "",
    ),
  );

  // The check settles before it is sent: one request per keystroke would ask the firm's record a
  // question nobody has finished asking yet.
  $effect(() => {
    const asked = { ...identityFields };
    if (!ready) {
      candidates = [];
      return;
    }
    let cancelled = false;
    checking = true;
    const timer = setTimeout(() => {
      void (async () => {
        const outcome = await findDuplicateCandidates(fetch, { kind, ...asked });
        if (cancelled) return;
        if (outcome.kind !== "ok") {
          // A check that cannot run is not a finding. It leaves the warning silent rather than
          // claiming the firm holds nobody similar.
          candidates = [];
          checking = false;
          return;
        }
        const resolved = await Promise.all(
          outcome.value.data.slice(0, 5).map(async (candidate) => {
            const detail = await readDirectoryEntity(fetch, candidate.entityId);
            return {
              entityId: candidate.entityId,
              name: detail.kind === "ok" ? directoryEntityName(detail.value) : candidate.entityId,
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

  function reset(): void {
    prefix = "";
    given = "";
    middle = "";
    family = "";
    suffix = "";
    legalName = "";
    displayName = "";
    candidates = [];
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    // A retried submit must not make a second record, so every attempt carries its own key and the
    // server answers the repeat with the first result.
    const key = crypto.randomUUID();
    const outcome =
      kind === "person"
        ? await createDirectoryPerson(
            fetch,
            {
              given: given.trim(),
              family: family.trim(),
              prefix: prefix.trim() === "" ? null : prefix.trim(),
              middle: middle.trim() === "" ? null : middle.trim(),
              suffix: suffix.trim() === "" ? null : suffix.trim(),
            },
            key,
          )
        : await createDirectoryOrganization(
            fetch,
            {
              legalName: legalName.trim(),
              displayName: displayName.trim() === "" ? null : displayName.trim(),
            },
            key,
          );
    if (outcome.kind === "ok") {
      onCreated(outcome.value.id);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The record could not be created.",
      "Nothing was recorded, so nothing was half-created.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading={kind === "person" ? "Record A Person" : "Record An Organization"}
  commitLabel={kind === "person" ? "Record Person" : "Record Organization"}
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  width="wide"
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Record Could Not Be Created"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      {#if kind === "person"}
        <FieldRow>
          <LabelledField label="Prefix">
            {#snippet children({ props })}
              <Input
                {...props}
                disabled={busy}
                bind:value={prefix}
                placeholder={placeholderOf("Prefix")}
              />
            {/snippet}
          </LabelledField>
          <LabelledField label="Suffix">
            {#snippet children({ props })}
              <Input
                {...props}
                disabled={busy}
                bind:value={suffix}
                placeholder={placeholderOf("Suffix")}
              />
            {/snippet}
          </LabelledField>
          <LabelledField label="Given name">
            {#snippet children({ props })}
              <Input
                {...props}
                disabled={busy}
                bind:value={given}
                placeholder={placeholderOf("Given name")}
              />
            {/snippet}
          </LabelledField>
          <LabelledField label="Middle name">
            {#snippet children({ props })}
              <Input
                {...props}
                disabled={busy}
                bind:value={middle}
                placeholder={placeholderOf("Middle name")}
              />
            {/snippet}
          </LabelledField>
          <LabelledField label="Family name" class="sm:col-span-2">
            {#snippet children({ props })}
              <Input
                {...props}
                disabled={busy}
                bind:value={family}
                placeholder={placeholderOf("Family name")}
              />
            {/snippet}
          </LabelledField>
        </FieldRow>
      {:else}
        <LabelledField label="Legal name">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={legalName}
              placeholder={placeholderOf("Legal name")}
            />
          {/snippet}
        </LabelledField>
        <LabelledField label="Display name">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={displayName}
              placeholder={placeholderOf("Display name")}
            />
          {/snippet}
        </LabelledField>
      {/if}

      {#if candidates.length > 0}
        <Alert.Root variant="warning">
          <Alert.Title>The Firm May Already Hold This Record</Alert.Title>
          <Alert.Description>
            <ul class="flex flex-col gap-8">
              {#each candidates as candidate (candidate.entityId)}
                <li>
                  <EntityIdentity
                    {kind}
                    name={candidate.name}
                    href={entityRecordHref(candidate.entityId)}
                  />
                </li>
              {/each}
            </ul>
          </Alert.Description>
        </Alert.Root>
      {/if}

      <!-- Mounted whether or not a check is running, with inert filler when it is not, so the
           panel's height never depends on whether the firm's record is being asked at this
           moment. -->
      <p class="text-xs text-text-muted" aria-live="polite">
        {checking ? "Checking the firm's record" : " "}
      </p>
    </div>
  {/snippet}
</ActionDialog>
