<script lang="ts">
  /*
   * Opening a matter. The form is the contract's own required set and nothing more: a title, which
   * of the two starting statuses the file takes, and the responsible attorney. Everything else the
   * firm may fill now or later from the matter itself.
   *
   * The number is not on this form and never will be. A matter number is drawn by the firm's own
   * counter at the moment the matter opens, atomically, so that two people opening a matter at once
   * cannot be handed the same number. Offering a field for it would be offering to break that.
   *
   * The responsible attorney is the one field that renders and cannot yet be changed. The contract
   * requires the identifier, the session says who is asking, and nothing on the server publishes
   * the firm's members, so the honest shape is the real field showing the real person, disabled,
   * saying what it waits on.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import VocabularyPicker from "./vocabulary-picker.svelte";
  import {
    createMatter,
    type LocationSummary,
    type MatterTypeSummary,
    type SessionBootstrap,
  } from "./matters-api.ts";

  let {
    open = $bindable(false),
    session,
    matterTypes,
    locations,
    onCreated,
  }: {
    open?: boolean;
    /** Who is opening the matter. The responsible attorney until a member directory exists. */
    session: SessionBootstrap;
    matterTypes: readonly MatterTypeSummary[];
    locations: readonly LocationSummary[];
    /** Called once the matter exists, so the list can re-read and the screen can say what landed. */
    onCreated: (created: { matterId: string; matterNumber: string | null }) => void;
  } = $props();

  type StartingStatus = "open" | "prospective";

  let title = $state("");
  let startingStatus = $state<StartingStatus>("open");
  let clientDisplayName = $state("");
  let clientCode = $state("");
  let matterTypeId = $state<string | null>(null);
  let locationId = $state<string | null>(null);
  let description = $state("");
  let submitting = $state(false);
  let failure = $state<string | null>(null);
  let numberingHint = $state(false);

  // A matter opens as one of two things. Closed is somewhere a matter arrives, never somewhere it
  // starts, so it is not offered.
  const STARTING_STATUS_ITEMS: readonly { value: StartingStatus; label: string }[] = [
    { value: "open", label: "Open the matter and draw its number" },
    { value: "prospective", label: "Record a consultation, unnumbered for now" },
  ];

  const trimmedTitle = $derived(title.trim());
  const readyToSubmit = $derived(trimmedTitle !== "" && !submitting);

  // Only active types are offered. A deactivated type is part of the firm's history, not a choice
  // it is still making.
  const typeOptions = $derived(
    matterTypes.filter((type) => type.active).map((type) => ({ id: type.id, name: type.name })),
  );
  // Same for a closed office: it stays on the matters already filed against it, and is not offered.
  const locationOptions = $derived(
    locations
      .filter((location) => location.status === "active")
      .map((location) => ({ id: location.id, name: location.name })),
  );

  function reset(): void {
    title = "";
    numberingHint = false;
    startingStatus = "open";
    clientDisplayName = "";
    clientCode = "";
    matterTypeId = null;
    locationId = null;
    description = "";
    failure = null;
  }

  /** Null for an untouched optional field: an empty box is "not recorded", never an empty string. */
  function orNull(text: string): string | null {
    const trimmed = text.trim();
    return trimmed === "" ? null : trimmed;
  }

  async function submit(): Promise<void> {
    if (!readyToSubmit) return;
    submitting = true;
    failure = null;
    numberingHint = false;
    const outcome = await createMatter(
      fetch,
      {
        title: trimmedTitle,
        status: startingStatus,
        description: orNull(description),
        matterTypeId,
        locationId,
        responsibleMemberId: session.user.id,
        clientDisplayName: orNull(clientDisplayName),
        clientCode: orNull(clientCode),
      },
      // A retried submit must not open a second matter, so every attempt carries its own key and
      // the server answers the repeat with the first result.
      crypto.randomUUID(),
    );
    submitting = false;
    if (outcome.kind === "ok") {
      onCreated(outcome.value);
      reset();
      open = false;
      return;
    }
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. The matter was not opened, so nothing was half-created."
        : (outcome.problem.detail ?? "The matter could not be opened.");
    // A refused OPEN is almost always the number draw: the firm has no active numbering scheme, or
    // its active one wants a segment this matter cannot supply. Both are settings, and both are
    // fixed in one place, so the refusal says where rather than leaving a person to guess. The
    // condition is the request, not the server's wording, which is prose and may be reworded.
    numberingHint =
      outcome.kind === "problem" && outcome.problem.status === 422 && startingStatus === "open";
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Title>New Matter</Dialog.Title>
    <Dialog.Description>
      A matter is the file of record for everything the firm does on it. Only the title is needed
      now; the rest can be filled from the matter itself at any time.
    </Dialog.Description>

    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="new-matter-title">Title</Label>
        <Input
          id="new-matter-title"
          bind:value={title}
          disabled={submitting}
          aria-describedby="new-matter-title-hint"
        />
        <p id="new-matter-title-hint" class="text-xs text-text-muted">
          What the firm calls this file: "Pemberton v. Hale", "Estate of A. Marsh".
        </p>
      </div>

      <div class="flex flex-col gap-8">
        <Label id="new-matter-status-label">How it starts</Label>
        <Select.Root
          type="single"
          items={[...STARTING_STATUS_ITEMS]}
          bind:value={startingStatus}
          allowDeselect={false}
          disabled={submitting}
        >
          <Select.Trigger aria-labelledby="new-matter-status-label">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each STARTING_STATUS_ITEMS as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
        <p class="text-xs text-text-muted">
          Opening draws the firm's next matter number. A consultation stays unnumbered until the
          firm takes it, and sits under Consultations rather than on the docket.
        </p>
      </div>

      <!-- Paired in rows: the client and its code are one fact in two boxes, and so are the two
           firm vocabularies. Keeping the form inside the dialog's height matters more than a hint
           under every field, so only the fields that carry a real dependency keep one. -->
      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="new-matter-client">Client</Label>
          <Input id="new-matter-client" bind:value={clientDisplayName} disabled={submitting} />
          <p class="text-xs text-text-muted">The name as it should print.</p>
        </div>
        <div class="flex flex-col gap-8">
          <Label for="new-matter-client-code">Client code</Label>
          <Input id="new-matter-client-code" bind:value={clientCode} disabled={submitting} />
          <p class="text-xs text-text-muted">The firm's own short code, where its numbering uses one.</p>
        </div>
      </div>

      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="new-matter-practice-area">Practice area</Label>
          <VocabularyPicker
            options={typeOptions}
            bind:value={matterTypeId}
            inputId="new-matter-practice-area"
            label="Practice area"
            whenEmpty="This firm has no matter types yet. They are set up in Settings, and a matter opens perfectly well without one."
          />
        </div>
        <div class="flex flex-col gap-8">
          <Label for="new-matter-location">Location</Label>
          <VocabularyPicker
            options={locationOptions}
            bind:value={locationId}
            inputId="new-matter-location"
            label="Location"
            whenEmpty="This firm has no Locations yet. A matter with none takes the firm's own default."
          />
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <div class="flex items-center gap-8">
          <Label for="new-matter-responsible">Responsible attorney</Label>
          <MaturityBadge stage="soon" />
        </div>
        <Input id="new-matter-responsible" value={session.user.name} disabled readonly />
        <p class="text-xs text-text-muted">
          The matter opens under the person creating it. Choosing a colleague waits on a firm member
          directory: nothing on the server publishes the firm's members yet, so there is no honest
          list to pick from.
        </p>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="new-matter-description">Description</Label>
        <Textarea id="new-matter-description" bind:value={description} disabled={submitting} />
      </div>
    </div>

    {#if failure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>The Matter Was Not Opened</Alert.Title>
        <Alert.Description>
          {failure}
          {#if numberingHint}
            <span class="block">
              A matter draws its number from the firm's numbering scheme, which is set in
              <a class="underline underline-offset-2" href="/settings/matter-numbering">
                Settings, under Matter numbering
              </a>. Recording this as a consultation instead needs no scheme: a consultation is
              unnumbered until the firm opens it.
            </span>
          {/if}
        </Alert.Description>
      </Alert.Root>
    {/if}

    <div class="flex items-center gap-8">
      <Button variant="primary" disabled={!readyToSubmit} onclick={submit}>
        {submitting ? "Opening" : "Open matter"}
      </Button>
      <Dialog.Close
        class={buttonClasses({ variant: "secondary", size: "default" })}
        disabled={submitting}
      >
        Cancel
      </Dialog.Close>
      {#if trimmedTitle === ""}
        <p class="text-xs text-text-muted">A matter needs a title before it can be opened.</p>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
