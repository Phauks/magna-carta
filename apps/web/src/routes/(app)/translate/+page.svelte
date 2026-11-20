<script lang="ts">
  /*
   * Translate — paste text, pick a language, read it beside the original. Layout A of the owner's
   * three, picked 2026-11-20: two panes side by side, the languages above them, Translate below.
   *
   * Each paragraph is sent to Google Cloud Translation and comes back in order, so the right-hand pane
   * keeps the left-hand pane's paragraphs. "Powered by Google Translate" sits under the translation,
   * with a link to Google Translate itself, in place of any notice before first use (owner ruling,
   * 2026-11-20). Translation is its own service and not an AI feature, so no AI setting gates it; a
   * member's role holding tools:translation is the whole gate.
   *
   * The matter is optional and only names the run on the firm's log. Nothing is filed and nothing of
   * the text is kept, here or on the server: leaving the screen loses it, as it would in Google
   * Translate.
   */
  import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
  import Copy from "@lucide/svelte/icons/copy";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { toast } from "@magna-carta/design-system/toast";
  import { formatNumber } from "@magna-carta/design-system/formatters";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import LanguagePicker, { DETECT } from "$lib/translation/language-picker.svelte";
  import PoweredByGoogle from "$lib/translation/powered-by-google.svelte";
  import {
    charactersOf,
    languageName,
    MOST_CHARACTERS,
    readLanguages,
    rememberedTarget,
    rememberTarget,
    translateText,
    translationText,
    type TranslateResponse,
    type TranslationLanguage,
  } from "$lib/translation/translation-api.ts";

  let text = $state("");
  let source = $state(DETECT);
  let target = $state(rememberedTarget());
  let matterId = $state<string | null>(null);
  let languages = $state<readonly TranslationLanguage[]>([]);
  let languagesFailure = $state<Failure | null>(null);
  let busy = $state(false);
  let result = $state<TranslateResponse | null>(null);
  let failure = $state<Failure | null>(null);

  const firmMatters = new FirmMatters();

  $effect(() => {
    void firmMatters.load(fetch);
    void readLanguages().then((listed) => {
      if (listed.kind === "ok") languages = listed.value;
      else languagesFailure = listed.failure;
    });
  });

  const characters = $derived(charactersOf(text));
  const tooLong = $derived(text.length > MOST_CHARACTERS);
  const canTranslate = $derived(!busy && characters > 0 && !tooLong && target !== "");
  const detectedName = $derived(
    source === DETECT && result !== null && result.source !== null
      ? languageName(languages, result.source)
      : "",
  );
  // Swapping needs a known source: Detect Language has nothing to put on the other side.
  const sourceForSwap = $derived(source !== DETECT ? source : (result?.source ?? null));

  async function translate(): Promise<void> {
    if (!canTranslate) return;
    busy = true;
    failure = null;
    const outcome = await translateText({
      text,
      target,
      ...(source === DETECT ? {} : { source }),
      ...(matterId === null ? {} : { matterId }),
    });
    busy = false;
    if (outcome.kind === "ok") {
      result = outcome.value;
      rememberTarget(target);
    } else {
      failure = outcome.failure;
    }
  }

  function swap(): void {
    if (sourceForSwap === null) return;
    const translated = result === null ? "" : translationText(result);
    const previousTarget = target;
    target = sourceForSwap;
    source = previousTarget;
    if (translated !== "") {
      text = translated;
      result = null;
      void translate();
    }
  }

  function clear(): void {
    text = "";
    result = null;
    failure = null;
  }

  async function copy(): Promise<void> {
    if (result === null) return;
    try {
      await navigator.clipboard.writeText(translationText(result));
      toast.success("Translation copied.");
    } catch {
      toast.error("The translation could not be copied. Select it and copy it instead.");
    }
  }
</script>

<ScreenHeader title="Translate" class="mb-24">
  {#snippet actions()}
    <div class="flex w-full items-center gap-8 sm:w-sm">
      <Label for="translate-matter" class="text-sm text-text-muted">Matter</Label>
      <div class="min-w-0 flex-1">
        <MatterPicker
          inputId="translate-matter"
          matters={firmMatters.matters ?? []}
          capped={firmMatters.capped}
          reading={firmMatters.matters === null}
          value={matterId}
          onpick={(picked) => (matterId = picked)}
        />
      </div>
    </div>
  {/snippet}
</ScreenHeader>

{#if languagesFailure !== null}
  <div class="mb-16">
    <FailureNotice failure={languagesFailure} title="The Languages Could Not Be Read" />
  </div>
{/if}

<div class="flex flex-col gap-16">
  <div class="flex flex-col items-stretch gap-8 lg:flex-row lg:items-center">
    <div class="min-w-0 flex-1">
      <Label for="translate-source" class="sr-only">From</Label>
      <LanguagePicker
        {languages}
        inputId="translate-source"
        label="From"
        detect
        {detectedName}
        bind:value={source}
      />
    </div>
    <Button
      class="self-center"
      variant="secondary"
      size="icon"
      aria-label="Swap Languages"
      title="Swap Languages"
      disabled={sourceForSwap === null || busy}
      onclick={swap}
    >
      <ArrowLeftRight class="size-16" aria-hidden="true" />
    </Button>
    <div class="min-w-0 flex-1">
      <Label for="translate-target" class="sr-only">To</Label>
      <LanguagePicker {languages} inputId="translate-target" label="To" bind:value={target} />
    </div>
  </div>

  <div class="grid grid-cols-1 gap-16 lg:grid-cols-2">
    <div class="flex min-w-0 flex-col gap-8">
      <Label for="translate-text" class="sr-only">Text to Translate</Label>
      <Textarea
        id="translate-text"
        class="min-h-64 resize-none lg:min-h-96"
        resizable={false}
        placeholder="Text"
        aria-invalid={tooLong}
        bind:value={text}
        onkeydown={(event: KeyboardEvent) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void translate();
          }
        }}
      />
      <div class="flex items-center justify-between gap-8">
        <span class={["text-sm", tooLong ? "text-text-danger" : "text-text-muted"]}>
          {formatNumber(characters)} of {formatNumber(MOST_CHARACTERS)} characters
        </span>
        <Button variant="ghost" size="sm" disabled={text === "" || busy} onclick={clear}>
          <Trash2 class="size-16" aria-hidden="true" />
          Clear
        </Button>
      </div>
    </div>

    <div class="flex min-w-0 flex-col gap-8">
      <LoadingRegion
        loading={busy}
        label="Translating the text"
        class="min-h-64 rounded-md border border-border-default bg-surface-sunken p-12 lg:min-h-96"
        aria-label="Translation"
      >
        {#if failure !== null}
          <FailureNotice {failure} title="It Was Not Translated" onRetry={translate} />
        {:else if result !== null}
          <div class="flex flex-col gap-12 whitespace-pre-line" lang={result.target}>
            {#each result.passages as passage, index (index)}
              <p>{passage.translation}</p>
            {/each}
          </div>
        {/if}
      </LoadingRegion>
      <div class="flex items-center justify-between gap-8">
        <PoweredByGoogle />
        <Button variant="ghost" size="sm" disabled={result === null} onclick={copy}>
          <Copy class="size-16" aria-hidden="true" />
          Copy
        </Button>
      </div>
    </div>
  </div>

  <div>
    <Button disabled={!canTranslate} onclick={translate}>
      {busy ? "Translating" : "Translate"}
    </Button>
  </div>
</div>
