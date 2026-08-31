<script lang="ts">
  /*
   * Withdrawing a note.
   *
   * The reason is required, and the dialog is where it is captured, because the reason is the only
   * thing left standing where the text used to be. What this has to make unmissable is the pair of
   * facts a reader needs before pressing: the words stop being shown everywhere, including the
   * matter's activity history, and nothing is deleted.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as AlertDialog from "@magna-carta/design-system/alert-dialog";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { newWriteKey, retractMatterNote, type MatterNote } from "./notes-api.ts";

  let {
    open = $bindable(false),
    note,
    authorName,
    onRetracted,
  }: {
    open?: boolean;
    note: MatterNote | null;
    authorName: string;
    onRetracted: () => void;
  } = $props();

  let reason = $state("");
  let sending = $state(false);
  let failure = $state<string | null>(null);

  // A fresh subject clears the last one's half-typed reason and its refusal, so a dialog reopened on
  // a different note never carries a sentence written about another one.
  $effect(() => {
    const subject = note?.id ?? null;
    if (subject === null) return;
    reason = "";
    failure = null;
  });

  const identity = $derived(
    note === null ? "" : `${authorName}, ${formatInstant(note.createdAt)}`,
  );
  const ready = $derived(reason.trim().length > 0 && !sending);

  async function withdraw(): Promise<void> {
    if (note === null || !ready) return;
    sending = true;
    failure = null;
    const outcome = await retractMatterNote(fetch, note.id, reason.trim(), newWriteKey());
    sending = false;
    if (outcome.kind === "ok") {
      open = false;
      onRetracted();
      return;
    }
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. The note was not withdrawn and is unchanged."
        : `${outcome.problem.detail ?? "The note was not withdrawn."}${
            outcome.problem.errorId === undefined ? "" : ` Error ID ${outcome.problem.errorId}.`
          }`;
  }
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Title>Withdraw Note</AlertDialog.Title>
    <AlertDialog.Description>{identity}</AlertDialog.Description>

    {#if failure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Nothing Changed</Alert.Title>
        <Alert.Description>{failure}</Alert.Description>
      </Alert.Root>
    {/if}

    <p class="text-sm">
      The text stops being shown anywhere, including this matter&rsquo;s activity history. The record
      that the note existed, who wrote it, and who withdrew it stays. Nothing is deleted.
    </p>

    <div class="flex flex-col gap-4">
      <Label for="note-retraction-reason">Reason</Label>
      <Textarea
        id="note-retraction-reason"
        bind:value={reason}
        rows={3}
        disabled={sending}
        maxlength={500}
      />
      <p class="text-xs text-text-muted">
        Say why the note came down, not what it said. This is what stays in its place.
      </p>
    </div>

    <div class="flex justify-end gap-8">
      <AlertDialog.Cancel
        class={buttonClasses({ variant: "secondary", size: "default" })}
        disabled={sending}
      >
        Cancel
      </AlertDialog.Cancel>
      <!-- Bits' Action does not self-close: the write decides when the panel goes, so a refusal
           stays on screen with its reason rather than closing over it. -->
      <AlertDialog.Action
        class={buttonClasses({ variant: "destructive", size: "default" })}
        disabled={!ready}
        title="Stop showing this note's text and keep the record that it existed"
        onclick={(event) => {
          event.preventDefault();
          void withdraw();
        }}
      >
        Withdraw Note
      </AlertDialog.Action>
    </div>
  </AlertDialog.Content>
</AlertDialog.Root>
