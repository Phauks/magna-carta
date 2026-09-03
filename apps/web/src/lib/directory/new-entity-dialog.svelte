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
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import FieldRow from "@magna-carta/design-system/field-row";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import {
    createDirectoryOrganization,
    createDirectoryPerson,
    findDuplicateCandidates,
    readDirectoryEntity,
    type DirectoryEntityKind,
  } from "./directory-api.ts";
  import { directoryEntityName, entityRecordHref } from "./entity-presentation.ts";
  import EntityIdentity from "./entity-identity.svelte";

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

  /** Whether anything has been typed: what the guard asks about before a stray Escape. */
  const started = $derived(
    [prefix, given, middle, family, suffix, legalName, displayName].some(
      (value) => value.trim() !== "",
    ),
  );

  const refusal = $derived.by((): string | undefined => {
    if (ready) return undefined;
    return kind === "person"
      ? "A given name and a family name are required."
      : "A legal name is required.";
  });

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
    if (!ready) return "refused";
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
  width="wide"
  heading={kind === "person" ? "New Person" : "New Organization"}
  subtitle={kind === "person"
    ? "The name recorded here is the name this person currently carries. Every other name they have held is added to the record afterwards."
    : "The legal name is the record. A display name is what the firm calls this organization when it is not writing a pleading."}
  commitLabel={kind === "person" ? "Record Person" : "Record Organization"}
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet fields({ busy })}
    {#if kind === "person"}
      <FieldRow>
        <LabelledField label="Prefix">
          {#snippet children({ props })}
            <Input {...props} disabled={busy} bind:value={prefix} placeholder={placeholderOf("Prefix")} />
          {/snippet}
        </LabelledField>
        <LabelledField label="Suffix">
          {#snippet children({ props })}
            <Input {...props} disabled={busy} bind:value={suffix} placeholder={placeholderOf("Suffix")} />
          {/snippet}
        </LabelledField>
      </FieldRow>
      <FieldRow>
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
      </FieldRow>
      <LabelledField label="Family name">
        {#snippet children({ props })}
          <Input
            {...props}
            disabled={busy}
            bind:value={family}
            placeholder={placeholderOf("Family name")}
          />
        {/snippet}
      </LabelledField>
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
    {:else if checking}
      <p class="text-xs text-text-muted">Checking the firm's record</p>
    {/if}
  {/snippet}

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
</ActionDialog>
