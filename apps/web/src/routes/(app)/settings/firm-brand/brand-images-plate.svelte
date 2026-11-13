<script lang="ts">
  /*
   * The firm's marks, on Firm Brand: the primary mark, and the additional images the firm
   * keeps beside it. Each act — add one, make one the primary, caption it, remove it — commits at
   * once against the brand-image routes, so nothing on this plate is staged. An office's letterhead
   * prints the primary mark unless the office has set a logo of its own, which is why the primary
   * is the one this plate leads with.
   *
   * The plate is one of the settings page's plates, so it takes the shared shell's rows and adds
   * nothing of its own around them.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FileInput from "@magna-carta/design-system/file-input";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { formatInstant, formatNumber } from "@magna-carta/design-system/formatters";
  import Star from "@lucide/svelte/icons/star";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { Failure } from "$lib/api/request.ts";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { fileToBase64 } from "$lib/offices/offices-api.ts";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import {
    brandImageHref,
    brandImageName,
    listBrandImages,
    MAX_BRAND_IMAGE_LABEL_LENGTH,
    removeBrandImage,
    setBrandImage,
    updateBrandImage,
    type BrandImage,
    type BrandImageRole,
    type BrandImages,
  } from "$lib/settings/firm-profile-api.ts";

  let { canEdit }: { canEdit: boolean } = $props();

  let images = $state<BrandImages | null>(null);
  let readFailure = $state<Failure | null>(null);
  let reading = $state(false);
  let actionFailure = $state<StatedFailure | null>(null);
  let busy = $state<string | null>(null);

  async function load(): Promise<void> {
    readFailure = null;
    reading = true;
    const outcome = await listBrandImages(fetch);
    reading = false;
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    images = outcome.value;
  }

  $effect(() => {
    void load();
  });

  const held = $derived([
    ...(images?.primary === null || images?.primary === undefined ? [] : [images.primary]),
    ...(images?.additional ?? []),
  ]);
  const setFull = $derived(
    images !== null && images.additional.length >= images.additionalLimit,
  );

  // ---- adding one -------------------------------------------------------------------------------

  const ROLE_OPTIONS: ReadonlyArray<{ value: BrandImageRole; label: string }> = [
    { value: "primary", label: "Primary mark" },
    { value: "additional", label: "Additional image" },
  ];

  let addOpen = $state(false);
  let chosenFile = $state<File | null>(null);
  let role = $state<BrandImageRole>("primary");
  let label = $state("");
  let addFailure = $state<StatedFailure | null>(null);

  function openAdd(): void {
    chosenFile = null;
    role = images?.primary === null ? "primary" : "additional";
    label = "";
    addFailure = null;
    addOpen = true;
  }

  const addRefusal = $derived.by((): string | undefined => {
    if (chosenFile === null) return "Choose a PNG or a JPEG.";
    if (label.trim().length > MAX_BRAND_IMAGE_LABEL_LENGTH) {
      return `A caption is at most ${MAX_BRAND_IMAGE_LABEL_LENGTH} characters.`;
    }
    if (role === "additional" && setFull) {
      return "The firm already holds as many additional images as it may. Remove one first.";
    }
    return undefined;
  });

  async function commitAdd(): Promise<ActionOutcome> {
    if (addRefusal !== undefined || chosenFile === null) return "refused";
    addFailure = null;
    const outcome = await setBrandImage(
      fetch,
      {
        imageBase64: await fileToBase64(chosenFile),
        role,
        label: label.trim() === "" ? null : label.trim(),
      },
      crypto.randomUUID(),
    );
    if (outcome.kind !== "ok") {
      addFailure = stated(
        outcome.failure,
        "The image was not added.",
        "Couldn't connect. Nothing was added. Try again.",
      );
      return "refused";
    }
    await load();
    return "committed";
  }

  // ---- the acts on a held mark ------------------------------------------------------------------

  async function makePrimary(image: BrandImage): Promise<void> {
    busy = image.sha256;
    actionFailure = null;
    const outcome = await updateBrandImage(
      fetch,
      image.sha256,
      { role: "primary" },
      crypto.randomUUID(),
    );
    busy = null;
    if (outcome.kind !== "ok") {
      actionFailure = stated(outcome.failure, "The primary mark was not changed.");
      return;
    }
    await load();
  }

  let removing = $state<BrandImage | null>(null);
  let removeOpen = $state(false);
  let removeFailure = $state<StatedFailure | null>(null);

  function askRemove(image: BrandImage): void {
    removing = image;
    removeFailure = null;
    removeOpen = true;
  }

  async function commitRemove(): Promise<ActionOutcome> {
    const image = removing;
    if (image === null) return "refused";
    removeFailure = null;
    const outcome = await removeBrandImage(fetch, image.sha256, crypto.randomUUID());
    if (outcome.kind !== "ok") {
      removeFailure = stated(outcome.failure, "The image was not removed.");
      return "refused";
    }
    await load();
    return "committed";
  }

  function facts(image: BrandImage): string {
    return `${formatNumber(image.widthPixels)} by ${formatNumber(image.heightPixels)} pixels · ${image.contentType === "image/png" ? "PNG" : "JPEG"} · set ${formatInstant(image.updatedAt)}`;
  }
</script>

<SettingsPlate heading="Brand Images">
  {#if actionFailure !== null}
    <div class="py-12">
      <FailureNotice failure={actionFailure.failure} fallback={actionFailure.fallback} />
    </div>
  {/if}
  <LoadingRegion
    loading={images === null && readFailure === null}
    failed={readFailure !== null && images === null}
    refreshing={reading}
    empty={images !== null && held.length === 0}
    label="Reading the firm's marks"
    onRetry={() => void load()}
    class="flex flex-col"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="The Marks Could Not Be Read"
          fallback="The firm's brand images were not read."
          onRetry={() => void load()}
        />
      {/if}
    {/snippet}
    {#snippet emptyState()}
      <div class="flex flex-col gap-12 py-12">
        <EmptyState title="No brand images yet">
          The firm's main logo prints on every office's letterhead unless the office sets its own.
        </EmptyState>
        {#if canEdit}
          <div class="flex justify-end">
            <Button variant="primary" size="sm" onclick={openAdd}>Add an Image</Button>
          </div>
        {/if}
      </div>
    {/snippet}
    {#snippet fixture()}
      <div class="flex items-center gap-16 py-12">
        <span class="text-md">Primary mark</span>
        <span class="text-sm text-text-muted">Sample words, in the shape the marks take.</span>
      </div>
    {/snippet}

    {#each held as image (image.sha256)}
      <div class="flex items-center gap-16 py-12">
        <img
          src={brandImageHref(image.sha256)}
          alt={brandImageName(image)}
          class="max-h-64 max-w-3xs object-contain"
        />
        <div class="flex min-w-0 grow flex-col gap-4">
          <span class="flex items-baseline gap-8">
            <span class="text-md">{brandImageName(image)}</span>
            {#if image.role === "primary"}
              <Badge variant="accent">Primary</Badge>
            {/if}
          </span>
          <span class="text-sm text-text-muted">{facts(image)}</span>
        </div>
        {#if canEdit}
          <span class="flex shrink-0 items-center gap-4">
            {#if image.role !== "primary"}
              <Button
                variant="ghost"
                size="icon"
                disabled={busy === image.sha256}
                title="Make this the primary mark"
                aria-label="Make {brandImageName(image)} the primary mark"
                onclick={() => void makePrimary(image)}
              >
                <Star class="size-16" aria-hidden="true" />
              </Button>
            {/if}
            <Button
              variant="ghost"
              size="icon"
              disabled={busy === image.sha256}
              title="Remove this image"
              aria-label="Remove {brandImageName(image)}"
              onclick={() => askRemove(image)}
            >
              <Trash2 class="size-16" aria-hidden="true" />
            </Button>
          </span>
        {/if}
      </div>
    {/each}
    {#if canEdit && held.length > 0}
      <div class="flex items-center justify-end gap-8 py-12">
        <Button variant="secondary" size="sm" onclick={openAdd}>Add an Image</Button>
      </div>
    {/if}
  </LoadingRegion>
</SettingsPlate>

<ActionDialog
  bind:open={addOpen}
  heading="Add a Brand Image"
  commitLabel="Add Image"
  commitBusyLabel="Adding"
  commitRefusal={addRefusal}
  unsavedChanges={chosenFile !== null || label.trim() !== ""}
  onCommit={commitAdd}
>
  {#snippet notice()}
    {#if addFailure !== null}
      <FailureNotice
        failure={addFailure.failure}
        fallback={addFailure.fallback}
        whenSilent={addFailure.whenSilent}
      />
    {/if}
  {/snippet}
  {#snippet fields({ busy: adding })}
    <div class="flex flex-col gap-12">
      <LabelledField label="Image" hint="A PNG or a JPEG, up to two megabytes.">
        {#snippet children({ props })}
          <FileInput
            {...props}
            accept="image/png,image/jpeg"
            disabled={adding}
            onchange={(event) => {
              chosenFile = event.currentTarget.files?.[0] ?? null;
            }}
          />
        {/snippet}
      </LabelledField>
      <LabelledField label="Use" id="brand-image-role">
        {#snippet children({ props })}
          <ChoicePicker
            inputId={props.id}
            label="Use"
            options={ROLE_OPTIONS}
            bind:value={role}
            disabled={adding}
          />
        {/snippet}
      </LabelledField>
      <LabelledField label="Caption" hint="What the image is, in the firm's words: a seal, a wordmark.">
        {#snippet children({ props })}
          <Input {...props} bind:value={label} disabled={adding} />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>

<ActionDialog
  bind:open={removeOpen}
  kind="destructive"
  heading="Remove Brand Image"
  commitLabel="Remove Image"
  commitBusyLabel="Removing"
  unsavedChanges={false}
  onCommit={commitRemove}
>
  {#snippet subtitle()}{removing === null ? "" : brandImageName(removing)}{/snippet}
  {#snippet notice()}
    {#if removeFailure !== null}
      <FailureNotice failure={removeFailure.failure} fallback={removeFailure.fallback} />
    {/if}
  {/snippet}
  {#snippet fields()}
    <p class="text-sm">
      Documents already produced keep the mark they were produced with.
      {#if removing?.role === "primary"}
        Offices that printed this logo will print none until another main logo is set.
      {/if}
    </p>
  {/snippet}
</ActionDialog>
