<script lang="ts">
  /*
   * New Form — naming a public intake form and what a visitor reads at the top of it.
   *
   * IT ASKS FOR TWO NAMES, and the distinction is worth the second field: the firm's own name for
   * the form is what a member scans a list for ("PI enquiries, website"), and the title is what a
   * stranger reads on the page ("Tell us what happened"). One field serving both produces a page
   * headed with an internal label.
   *
   * NO QUESTIONS ARE ASKED HERE. A form is created empty and in draft, and the builder is where its
   * questions are written — because writing questions is the work, and a dialog is the wrong shape
   * for it. Nothing is on the internet until the form is published from the builder.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { createIntakeForm, newWriteKey } from "./intake-forms-api.ts";

  interface Props {
    open: boolean;
    readonly onCreated: (formId: string) => void;
  }

  let { open = $bindable(), onCreated }: Props = $props();

  let name = $state("");
  let title = $state("");
  let introduction = $state("");
  let failure = $state<StatedFailure | null>(null);

  const refusal = $derived(
    name.trim() === ""
      ? "Give the form a name."
      : title.trim() === ""
        ? "Give the form a title — this is what a visitor reads at the top."
        : undefined,
  );

  function reset(): void {
    name = "";
    title = "";
    introduction = "";
    failure = null;
  }

  async function create(): Promise<ActionOutcome> {
    if (refusal !== undefined) return "refused";
    failure = null;
    const outcome = await createIntakeForm(
      fetch,
      {
        name: name.trim(),
        title: title.trim(),
        introduction: introduction.trim() === "" ? null : introduction.trim(),
      },
      newWriteKey(),
    );
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "That form could not be created.");
      return "refused";
    }
    onCreated(outcome.value.id);
    return "done";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="New Form"
  subtitle="A page on the internet that somebody who is not yet a client fills in. It is created empty and stays off the internet until you publish it."
  commitLabel="Create Form"
  commitBusyLabel="Creating"
  commitRefusal={refusal}
  unsavedChanges={name.trim() !== "" || title.trim() !== ""}
  onOpen={reset}
  onCommit={create}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-6">
        <Label for="intake-form-name">Name</Label>
        <Input
          id="intake-form-name"
          bind:value={name}
          disabled={busy}
          autocomplete="off"
        />
        <p class="text-xs text-text-muted">
          What your firm calls it. Only members see this.
        </p>
      </div>

      <div class="flex flex-col gap-6">
        <Label for="intake-form-title">Title</Label>
        <Input id="intake-form-title" bind:value={title} disabled={busy} autocomplete="off" />
        <p class="text-xs text-text-muted">
          What a visitor reads at the top of the page.
        </p>
      </div>

      <div class="flex flex-col gap-6">
        <Label for="intake-form-introduction">Introduction</Label>
        <Textarea
          id="intake-form-introduction"
          rows={3}
          bind:value={introduction}
          disabled={busy}
        />
        <p class="text-xs text-text-muted">
          Optional. A line or two above the questions.
        </p>
      </div>

      {#if failure !== null}
        <FailureNotice
          failure={failure.failure}
          title="The Form Was Not Created"
          fallback={failure.fallback}
        />
      {/if}
    </div>
  {/snippet}
</ActionDialog>
