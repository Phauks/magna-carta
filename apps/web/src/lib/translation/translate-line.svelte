<script lang="ts">
  /*
   * Translate, under a piece of text somebody is reading: a text message, a note, an email. The
   * owner's ruling of 2026-11-20 is that translating where the words already are matters more than
   * the Translate screen, so any surface that shows words a member may not read drops this line
   * under them and passes the text.
   *
   * It is the line Outlook and Gmail put under a message. At rest it is a single Translate button.
   * Pressed, the translation shows beneath the original, in the member's own language (the one they
   * last translated into, else their browser's), with a picker to change it and Hide to put it
   * away. "Powered by Google Translate" sits under every translation and stands in for any notice.
   *
   * Nothing is sent until the button is pressed, and the text the surface passes is the only thing
   * sent. A member whose role does not hold tools:translation never sees the button. When the text
   * changes (a field still being typed in), the translation shown is of the old words, so it is put
   * away rather than left beside words it no longer matches.
   */
  import Languages from "@lucide/svelte/icons/languages";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import LanguagePicker from "./language-picker.svelte";
  import PoweredByGoogle from "./powered-by-google.svelte";
  import {
    languageName,
    MOST_CHARACTERS,
    readLanguages,
    rememberedTarget,
    rememberTarget,
    translateText,
    TRANSLATION_PERMISSION,
    type TranslateResponse,
    type TranslationLanguage,
  } from "./translation-api.ts";

  let {
    text,
    matterId = null,
    class: className = "",
  }: {
    /** The words to translate, exactly as the surface shows them. */
    text: string;
    /** The matter the words belong to, if any. It names the run on the firm's log. */
    matterId?: string | null;
    class?: string;
  } = $props();

  const identity = $props.id();

  let open = $state(false);
  let busy = $state(false);
  let result = $state<TranslateResponse | null>(null);
  let failure = $state<Failure | null>(null);
  let languages = $state<readonly TranslationLanguage[]>([]);
  let target = $state("");
  /** The text the shown translation is of. A translation of other words is not shown. */
  let translatedText = $state<string | null>(null);

  $effect(() => {
    void sessionPermissions.load(fetch);
  });

  const allowed = $derived(sessionPermissions.holds(TRANSLATION_PERMISSION));
  const hasWords = $derived(text.trim() !== "");
  const tooLong = $derived(text.length > MOST_CHARACTERS);

  // Words that changed after a translation put it away: it would be a translation of something else.
  $effect(() => {
    if (translatedText !== null && text !== translatedText) {
      open = false;
      result = null;
      translatedText = null;
    }
  });

  async function run(): Promise<void> {
    if (!hasWords || tooLong) return;
    open = true;
    busy = true;
    failure = null;
    if (target === "") target = rememberedTarget();
    if (languages.length === 0) {
      const listed = await readLanguages();
      if (listed.kind === "ok") languages = listed.value;
    }
    const sent = text;
    const outcome = await translateText({
      text: sent,
      target,
      ...(matterId === null ? {} : { matterId }),
    });
    busy = false;
    if (outcome.kind === "ok") {
      result = outcome.value;
      translatedText = sent;
      rememberTarget(target);
    } else {
      result = null;
      failure = outcome.failure;
    }
  }

  function hide(): void {
    open = false;
  }
</script>

{#if allowed && hasWords}
  <div class="flex flex-col gap-8 {className}">
    {#if !open}
      <div>
        <Button
          variant="ghost"
          size="sm"
          disabled={tooLong}
          title={tooLong ? "Too long to translate here. Use the Translate screen in parts." : undefined}
          onclick={run}
        >
          <Languages class="size-16" aria-hidden="true" />
          Translate
        </Button>
      </div>
    {:else}
      <section
        class="flex flex-col gap-12 rounded-md border border-border-default bg-surface-sunken p-12"
        aria-label="Translation"
      >
        <div class="flex flex-wrap items-center gap-8">
          {#if result !== null && result.source !== null}
            <span class="text-sm text-text-muted">From {languageName(languages, result.source)}</span>
          {/if}
          <div class="flex items-center gap-8">
            <Label for="{identity}-target" class="text-sm text-text-muted">To</Label>
            <div class="w-3xs">
              <LanguagePicker
                {languages}
                inputId="{identity}-target"
                label="Language"
                bind:value={target}
                disabled={busy}
                onchange={() => void run()}
              />
            </div>
          </div>
          <Button class="ms-auto" variant="ghost" size="sm" onclick={hide}>Hide</Button>
        </div>

        <LoadingRegion loading={busy} label="Translating the text">
          {#if failure !== null}
            <FailureNotice {failure} title="It Was Not Translated" onRetry={run} />
          {:else if result !== null}
            <div class="flex flex-col gap-12 text-sm whitespace-pre-line" lang={result.target}>
              {#each result.passages as passage, index (index)}
                <p>{passage.translation}</p>
              {/each}
            </div>
          {/if}
        </LoadingRegion>

        <PoweredByGoogle />
      </section>
    {/if}
  </div>
{/if}
