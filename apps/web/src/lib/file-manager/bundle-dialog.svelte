<script lang="ts">
  /*
   * Download as Bundle: the selection as one archive, made the way it has to travel.
   *
   * The format, how hard it is compressed, an optional password, a part size for an archive that
   * has to fit an email or a disc, whether the folders are kept, and a contents list with each
   * file's hash. The defaults are what most bundles want, so the commit is one press for most
   * people. The panel owns only the question; the host sends it and reports what came back.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import * as Select from "@magna-carta/design-system/select";
  import {
    COMPRESSION_ITEMS,
    DEFAULT_BUNDLE_CHOICES,
    FORMAT_ITEMS,
    LAYOUT_ITEMS,
    SPLIT_ITEMS,
    bundleRefusal,
    type BundleChoices,
    type BundleCompression,
    type BundleFormat,
    type BundleLayout,
  } from "./bundle-request.ts";

  let {
    open = $bindable(false),
    summary,
    failure,
    onConfirm,
    onDismiss,
  }: {
    open?: boolean;
    /** What is being bundled, as the reader would say it: "3 files and 1 folder". */
    summary: string;
    failure: string | null;
    onConfirm: (choices: BundleChoices) => Promise<ActionOutcome>;
    onDismiss: () => void;
  } = $props();

  let format = $state<BundleFormat>(DEFAULT_BUNDLE_CHOICES.format);
  let compression = $state<BundleCompression>(DEFAULT_BUNDLE_CHOICES.compression);
  let password = $state("");
  let split = $state<string>("none");
  let layout = $state<BundleLayout>(DEFAULT_BUNDLE_CHOICES.layout);
  let manifest = $state(DEFAULT_BUNDLE_CHOICES.manifest);

  function reset(): void {
    format = DEFAULT_BUNDLE_CHOICES.format;
    compression = DEFAULT_BUNDLE_CHOICES.compression;
    password = "";
    split = "none";
    layout = DEFAULT_BUNDLE_CHOICES.layout;
    manifest = DEFAULT_BUNDLE_CHOICES.manifest;
  }

  const choices = $derived<BundleChoices>({
    format,
    compression,
    password,
    partBytes: split === "none" ? null : Number(split),
    layout,
    manifest,
  });
  const refusal = $derived(bundleRefusal(choices));
  const splitConflicts = $derived(refusal !== undefined && choices.partBytes !== null);
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Download as Bundle"
  subtitle={{ facts: [summary] }}
  commitLabel="Build Bundle"
  commitBusyLabel="Building"
  commitRefusal={refusal}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={() => onConfirm(choices)}
  {onDismiss}
>
  {#snippet fields({ busy })}
    <div class="grid gap-16 sm:grid-cols-2">
      <div class="flex flex-col gap-8">
        <Label id="bundle-format-label">Format</Label>
        <Select.Root
          type="single"
          items={FORMAT_ITEMS}
          allowDeselect={false}
          disabled={busy}
          bind:value={() => format, (next) => (format = next as BundleFormat)}
        >
          <Select.Trigger aria-labelledby="bundle-format-label"><Select.Value /></Select.Trigger>
          <Select.Content>
            {#each FORMAT_ITEMS as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex flex-col gap-8">
        <Label id="bundle-compression-label">Compression</Label>
        <Select.Root
          type="single"
          items={COMPRESSION_ITEMS}
          allowDeselect={false}
          disabled={busy}
          bind:value={() => compression, (next) => (compression = next as BundleCompression)}
        >
          <Select.Trigger aria-labelledby="bundle-compression-label"><Select.Value /></Select.Trigger>
          <Select.Content>
            {#each COMPRESSION_ITEMS as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex flex-col gap-8 sm:col-span-2">
        <Label for="bundle-password">Password</Label>
        <PasswordInput
          id="bundle-password"
          autocomplete="new-password"
          placeholder="Optional. Encrypts with AES-256"
          disabled={busy}
          bind:value={password}
        />
      </div>

      <div class="flex flex-col gap-8">
        <Label id="bundle-split-label">Split Into Parts Of</Label>
        <Select.Root type="single" items={SPLIT_ITEMS} allowDeselect={false} disabled={busy} bind:value={split}>
          <Select.Trigger aria-labelledby="bundle-split-label" aria-invalid={splitConflicts}>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each SPLIT_ITEMS as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex flex-col gap-8">
        <Label id="bundle-layout-label">Folders</Label>
        <Select.Root
          type="single"
          items={LAYOUT_ITEMS}
          allowDeselect={false}
          disabled={busy}
          bind:value={() => layout, (next) => (layout = next as BundleLayout)}
        >
          <Select.Trigger aria-labelledby="bundle-layout-label"><Select.Value /></Select.Trigger>
          <Select.Content>
            {#each LAYOUT_ITEMS as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex items-center gap-8 sm:col-span-2">
        <Checkbox id="bundle-manifest" bind:checked={manifest} disabled={busy} />
        <Label for="bundle-manifest" class="font-normal">Include a contents list with each file's hash</Label>
      </div>
    </div>
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <Alert.Root variant="warning">
        <Alert.Title>The Bundle Was Not Made</Alert.Title>
        <Alert.Description>{failure}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}
</ActionDialog>
