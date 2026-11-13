<script lang="ts">
  /*
   * Filing a call or a text onto a matter — the act that exists only on the firm-wide screen.
   *
   * WHY IT IS NOT INSIDE A MATTER. Inside a matter the matter is already known, so there is nothing
   * left to decide; what a matter section offers instead is the reverse, taking a row back off. The
   * asymmetry is the whole shape of this subsystem: the firm-wide surface holds the unassigned, a
   * matter holds the assigned, and this is the one door between them.
   *
   * THE PICKER MUST NOT BE FILTERED TO OPEN MATTERS. An inbound text from a number nobody recognises
   * most often belongs to an intake or a consultation — that is what a first contact IS — and both
   * carry no matter number at all. A picker that offered only numbered matters would make the common
   * case unroutable, which is the mistake anchor-matters.svelte.ts exists to prevent.
   *
   * A CLOSED MATTER IS REFUSED BY THE SERVER, not hidden here. The list a firm can file onto is
   * offered honestly and the refusal explains itself, rather than a matter quietly not being in a
   * list somebody is scrolling for it.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordReference } from "@magna-carta/design-system/record-reference";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import { fileCommunicationToMatter, newWriteKey } from "./communications-api.ts";

  let {
    open = $bindable(false),
    communicationId,
    reference,
    matters,
    mattersCapped = false,
    onFiled,
  }: {
    open?: boolean;
    /** The row being filed. Null while nothing is chosen, which keeps the dialog closed. */
    communicationId: string | null;
    /**
     * That row by the number somebody quotes — the panel's whole answer to what is being filed. A
     * handle names it to the platform and to nobody else, so a panel that showed only the handle
     * would be asking a reader to trust it about a record they cannot check.
     */
    reference: RecordReference | null;
    /** The anchors a row may be filed onto — caseload, consultations AND intakes. */
    matters: readonly SheetMatter[];
    mattersCapped?: boolean;
    onFiled: () => void;
  } = $props();

  let chosen = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);

  const refusal = $derived(chosen === null ? "Choose the matter it belongs to." : undefined);

  function reset(): void {
    chosen = null;
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    if (communicationId === null || chosen === null) return "refused";
    // A retried submit is the same filing, not a second one.
    const outcome = await fileCommunicationToMatter(
      fetch,
      communicationId,
      chosen,
      newWriteKey(),
    );
    if (outcome.kind === "ok") {
      onFiled();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "It could not be filed onto that matter.",
      "Couldn't connect. It's still waiting to send.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="File It onto a Matter"
  subtitle={reference === null ? undefined : { reference }}
  commitLabel="File It"
  commitBusyLabel="Filing"
  commitRefusal={refusal}
  unsavedChanges={chosen !== null}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="It Was Not Filed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <LabelledField
      label="Matter"
      id="file-communication-matter"
      hint="An intake or consultation counts. A matter doesn't need a number to have a conversation."
    >
      {#snippet children({ props })}
        <MatterPicker
          {matters}
          capped={mattersCapped}
          disabled={busy}
          inputId={props.id}
          value={chosen}
          onpick={(picked) => (chosen = picked)}
        />
      {/snippet}
    </LabelledField>
  {/snippet}
</ActionDialog>
