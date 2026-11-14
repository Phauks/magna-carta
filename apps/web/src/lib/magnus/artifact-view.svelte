<script lang="ts">
  /*
   * One document Magnus wrote, open in the pane: its versions, the one on screen, and what can be
   * done with it.
   *
   * The owner's board drew it this way: back to the list, the document's name, and a stepper
   * through its versions; a find over the version on screen; Copy and Download; the list of
   * versions, with Show Changes marking the paragraphs that differ from the version before; and,
   * when an earlier version is on screen, a line saying so with Restore This Version. Restoring adds
   * a version and overwrites none, so it needs no confirmation. Only the conversation's author
   * restores, because only the author works in the conversation; a supervisor reads.
   *
   * Each version's text is read when it is first shown and kept for the life of the view, so
   * stepping back and forth does not ask again. Nothing about the text is logged.
   */
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import History from "@lucide/svelte/icons/history";
  import Search from "@lucide/svelte/icons/search";
  import Button from "@magna-carta/design-system/button";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { copyText } from "@magna-carta/design-system/failure-details";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import Input from "@magna-carta/design-system/input";
  import Switch from "@magna-carta/design-system/switch";
  import { toast } from "@magna-carta/design-system/toast";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import MarkedText from "$lib/search/marked-text.svelte";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import {
    artifactFileName,
    changedParagraphs,
    countMatches,
    paragraphsOf,
    versionOrigin,
  } from "./artifact-text.ts";
  import { findMarks } from "./conversation-find.ts";
  import { readArtifactVersion, type MagnusArtifact } from "./magnus-api.ts";

  let {
    artifact,
    conversationId,
    versionNumber = $bindable(),
    memberName,
    canRestore,
    fetchImpl,
    onBack,
    onRestore,
  }: {
    artifact: MagnusArtifact;
    conversationId: string;
    /** The version on screen. */
    versionNumber: number;
    /** Who asks in the conversation, named on each version. */
    memberName: string;
    /** True when the reader started the conversation, so may put a version back. */
    canRestore: boolean;
    fetchImpl: typeof fetch;
    onBack: () => void;
    onRestore: (versionNumber: number) => Promise<boolean>;
  } = $props();

  const texts = $state<Record<number, string>>({});
  let readFailed = $state(false);
  let find = $state("");
  let showChanges = $state(false);
  let restoring = $state(false);

  const count = $derived(artifact.versions.length);
  const latest = $derived(artifact.versions.at(-1)?.versionNumber ?? 1);
  const position = $derived(
    artifact.versions.findIndex((version) => version.versionNumber === versionNumber),
  );
  const onScreen = $derived(artifact.versions[position]);
  const previousNumber = $derived(
    position > 0 ? (artifact.versions[position - 1]?.versionNumber ?? null) : null,
  );
  const text = $derived(texts[versionNumber] ?? null);
  const paragraphs = $derived(text === null ? [] : paragraphsOf(text));
  const changed = $derived(
    showChanges && text !== null && previousNumber !== null
      ? changedParagraphs(text, texts[previousNumber] ?? null)
      : new Set<number>(),
  );
  const matches = $derived(text === null ? 0 : countMatches(text, find));

  async function ensureText(number: number): Promise<void> {
    if (texts[number] !== undefined) return;
    const outcome = await readArtifactVersion(fetchImpl, conversationId, artifact.id, number);
    if (outcome.kind !== "ok") {
      readFailed = true;
      return;
    }
    readFailed = false;
    texts[number] = outcome.value.content;
  }

  $effect(() => {
    void ensureText(versionNumber);
    if (showChanges && previousNumber !== null) void ensureText(previousNumber);
  });

  function step(by: 1 | -1): void {
    const next = artifact.versions[position + by];
    if (next !== undefined) versionNumber = next.versionNumber;
  }

  async function copyVersion(): Promise<void> {
    if (text === null) return;
    const result = await copyText(text);
    if (result === "copied") toast.success(`Copied version ${versionNumber}.`);
    else toast.error("Could not copy the document. Download it instead.");
  }

  async function download(extension: "md" | "txt"): Promise<void> {
    if (text === null) return;
    const name = artifactFileName(artifact.title, versionNumber, extension);
    const where = await saveToTarget(
      text,
      name,
      extension === "md" ? "text/markdown" : "text/plain",
    );
    toast.success(where === "folder" ? `Saved ${name} to your folder.` : `Downloaded ${name}.`);
  }

  async function restore(): Promise<void> {
    restoring = true;
    const restored = await onRestore(versionNumber);
    restoring = false;
    if (restored) {
      const from = versionNumber;
      versionNumber = latest;
      toast.success(`Version ${from} is back as the newest version.`);
    }
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex items-center gap-8 border-b border-border-default bg-surface-raised px-16 py-8">
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon-sm"
            aria-label="Back to the documents"
            onclick={onBack}
          >
            <ArrowLeft class="size-16" aria-hidden="true" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">Back</Tooltip.Content>
    </Tooltip.Root>
    <h3 class="min-w-0 flex-1 truncate text-sm font-semibold">{artifact.title}</h3>
    <div class="flex items-center gap-4 text-xs text-text-muted">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Earlier version"
        disabled={position <= 0}
        onclick={() => step(-1)}
      >
        <ChevronLeft class="size-16" aria-hidden="true" />
      </Button>
      <span aria-live="polite">Version {versionNumber} of {count}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Later version"
        disabled={position >= count - 1}
        onclick={() => step(1)}
      >
        <ChevronRight class="size-16" aria-hidden="true" />
      </Button>
    </div>
  </div>

  <div class="flex items-center gap-8 px-16 pt-8" role="search" aria-label="Find in this document">
    <Search class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
    <Input
      bind:value={find}
      size="sm"
      class="min-w-0 flex-1"
      aria-label="Words to find in this version"
    />
    {#if find.trim() !== ""}
      <span class="shrink-0 text-xs text-text-muted" aria-live="polite">
        {matches === 0 ? "No matches" : `${matches} ${matches === 1 ? "match" : "matches"}`}
      </span>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-8 px-16 pt-8">
    <Button variant="ghost" size="sm" disabled={text === null} onclick={() => void copyVersion()}>
      <Copy class="size-16" aria-hidden="true" />
      Copy
    </Button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonClasses({ variant: "ghost", size: "sm" })}
        disabled={text === null}
      >
        <Download class="size-16" aria-hidden="true" />
        Download
        <ChevronDown class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <DropdownMenu.Item onSelect={() => void download("md")}>Markdown (.md)</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => void download("txt")}>Plain Text (.txt)</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <p class="px-8 py-4 text-xs text-text-muted">
          Downloads version {versionNumber}, the one on screen.
        </p>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>

  <div class="flex flex-col gap-4 border-b border-border-default bg-surface-raised px-16 py-8">
    <div class="flex items-center justify-between gap-8">
      <p class="flex items-center gap-4 text-xs font-semibold">
        <History class="size-12" aria-hidden="true" />
        Versions
      </p>
      <label class="flex items-center gap-8 text-xs text-text-muted">
        Show Changes
        <Switch bind:checked={showChanges} disabled={previousNumber === null} />
      </label>
    </div>
    <ol class="flex max-h-160 flex-col gap-2 mc-scrollbar overflow-y-auto">
      {#each artifact.versions.toReversed() as version (version.versionNumber)}
        <li>
          <button
            type="button"
            class="flex w-full items-baseline gap-8 rounded-sm px-8 py-4 text-left text-xs hover:bg-surface-raised aria-pressed:bg-surface-selected"
            aria-pressed={version.versionNumber === versionNumber}
            onclick={() => (versionNumber = version.versionNumber)}
          >
            <span class="shrink-0 font-semibold">Version {version.versionNumber}</span>
            <span class="flex min-w-0 flex-1 flex-col">
              {#if version.note !== null}<span class="truncate">{version.note}</span>{/if}
              <span class="text-text-muted">
                {versionOrigin(version, memberName)} · {formatInstant(version.createdAt)}
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ol>
  </div>

  {#if onScreen !== undefined && versionNumber !== latest}
    <div
      class="flex flex-wrap items-center justify-between gap-8 bg-status-warning-subtle px-16 py-8 text-xs text-status-warning-subtle-foreground"
    >
      <span>You are looking at version {versionNumber}. The latest is version {latest}.</span>
      {#if canRestore}
        <Button variant="secondary" size="sm" disabled={restoring} onclick={() => void restore()}>
          Restore This Version
        </Button>
      {/if}
    </div>
  {/if}

  <div class="min-h-0 flex-1 mc-scrollbar overflow-y-auto px-16 py-16">
    {#if text === null}
      <p class="text-sm text-text-muted">
        {readFailed ? "This version could not be read. Try again in a moment." : "Reading this version"}
      </p>
    {:else}
      <article class="flex flex-col gap-12 text-sm leading-relaxed">
        {#each paragraphs as paragraph, index (index)}
          <!-- No whitespace inside the paragraph: it keeps the document's line breaks. -->
          <p
            class="whitespace-pre-wrap data-[changed=true]:rounded-sm data-[changed=true]:bg-accent-subtle"
            data-changed={changed.has(index)}
          >{#if find.trim() !== ""}<MarkedText
                text={paragraph}
                marks={findMarks(paragraph, find)}
              />{:else}{paragraph}{/if}</p>
        {/each}
      </article>
    {/if}
  </div>
</div>
