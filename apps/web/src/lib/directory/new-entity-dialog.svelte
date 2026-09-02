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
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import {
    createDirectoryOrganization,
    createDirectoryPerson,
    findDuplicateCandidates,
    readDirectoryEntity,
    type DirectoryEntityKind,
  } from "./directory-api.ts";
  import { directoryEntityName, entityRecordHref } from "./entity-presentation.ts";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";

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

  let submitting = $state(false);
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

  async function submit(): Promise<void> {
    if (!ready || submitting) return;
    submitting = true;
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
    submitting = false;
    if (outcome.kind === "ok") {
      onCreated(outcome.value.id);
      reset();
      open = false;
      return;
    }
    failure = stated(
      outcome.failure,
      "The record could not be created.",
      "Nothing was recorded, so nothing was half-created.",
    );
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-2xl">
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Dialog.Title>
          {kind === "person" ? "New Person" : "New Organization"}
        </Dialog.Title>
        <Dialog.Description>
          {kind === "person"
            ? "The name recorded here is the name this person currently carries. Every other name they have held is added to the record afterwards."
            : "The legal name is the record. A display name is what the firm calls this organization when it is not writing a pleading."}
        </Dialog.Description>
      </div>

      {#if kind === "person"}
        <div class="grid grid-cols-2 gap-16">
          <div class="flex flex-col gap-8">
            <Label for="new-person-prefix">Prefix</Label>
            <Input id="new-person-prefix" bind:value={prefix} placeholder={placeholderOf("Prefix")} />
          </div>
          <div class="flex flex-col gap-8">
            <Label for="new-person-suffix">Suffix</Label>
            <Input id="new-person-suffix" bind:value={suffix} placeholder={placeholderOf("Suffix")} />
          </div>
          <div class="flex flex-col gap-8">
            <Label for="new-person-given">Given name</Label>
            <Input
              id="new-person-given"
              bind:value={given}
              placeholder={placeholderOf("Given name")}
            />
          </div>
          <div class="flex flex-col gap-8">
            <Label for="new-person-middle">Middle name</Label>
            <Input
              id="new-person-middle"
              bind:value={middle}
              placeholder={placeholderOf("Middle name")}
            />
          </div>
          <div class="col-span-2 flex flex-col gap-8">
            <Label for="new-person-family">Family name</Label>
            <Input
              id="new-person-family"
              bind:value={family}
              placeholder={placeholderOf("Family name")}
            />
          </div>
        </div>
      {:else}
        <div class="flex flex-col gap-16">
          <div class="flex flex-col gap-8">
            <Label for="new-organization-legal-name">Legal name</Label>
            <Input
              id="new-organization-legal-name"
              bind:value={legalName}
              placeholder={placeholderOf("Legal name")}
            />
          </div>
          <div class="flex flex-col gap-8">
            <Label for="new-organization-display-name">Display name</Label>
            <Input
              id="new-organization-display-name"
              bind:value={displayName}
              placeholder={placeholderOf("Display name")}
            />
          </div>
        </div>
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

      {#if failure !== null}
        <FailureNotice
          failure={failure.failure}
          title="The Record Could Not Be Created"
          fallback={failure.fallback}
          whenSilent={failure.whenSilent}
        />
      {/if}

      <div class="flex items-center justify-end gap-8">
        {#if checking}
          <span class="me-auto text-xs text-text-muted">Checking the firm's record</span>
        {/if}
        <Dialog.Close
          class={buttonClasses({ variant: "secondary", size: "default" })}
          disabled={submitting}
        >
          Cancel
        </Dialog.Close>
        <Button variant="primary" disabled={!ready || submitting} onclick={submit}>
          {submitting ? "Recording" : kind === "person" ? "Record Person" : "Record Organization"}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
