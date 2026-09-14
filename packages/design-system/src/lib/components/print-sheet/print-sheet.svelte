<script lang="ts">
  /*
   * PrintSheet — the printable unit.
   *
   * Every record the platform holds can be printed on its own, and this is the one thing that
   * prints it. It shows the paper first: the reader sees the sheet, and Print then hands the
   * browser THAT SHEET rather than a second rendering of it, so what comes out of the printer is
   * what was on the screen. The print stylesheet (print-sheet.css) is what makes the two the same
   * page instead of two implementations that drift.
   *
   * IT LAYERS ABOVE WHAT OPENED IT; IT NEVER REPLACES IT. A record's own window is a dialog, and
   * the sheet opened from it is another dialog above that one, so closing the sheet gives the
   * reader back the record they were reading, exactly where they left it. This is structural, not
   * a convention to be careful about: the component owns nothing but its own `open`, is given no
   * reference to whatever is underneath, and has no callback through which it could close one. The
   * only way it could take a record window off the screen is if a caller wired both to one flag,
   * which is why `open` is the sheet's own state and is documented as such.
   *
   * IT KNOWS NO RECORD TYPES. A time entry, a fee, a cost and an invoice hand it the same
   * `PrintSheetDocument`, so nothing here names any of them and no record type gets its own sheet.
   *
   * IT RENDERS DATA AND NOTHING ELSE. There is deliberately no snippet prop, no raw HTML and no
   * caller-supplied formatter: everything on the paper comes from the document's own strings plus
   * the instants this file formats. That closed world is what makes the exclusion of the firm's
   * internal text provable (client-facing-projection.ts) instead of a rule callers are trusted to
   * follow, and it is why adding a snippet prop here would be a defect rather than a convenience.
   */
  import Printer from "@lucide/svelte/icons/printer";
  import Button from "../button/button.svelte";
  import * as Dialog from "../dialog/index.ts";
  import { eventInstantAttribute, eventInstantText } from "../event-rail/event-instant.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { PRINT_SHEET_EMPTY_HISTORY_TEXT } from "./print-sheet-text.ts";
  import type { PrintSheetDocument } from "./types.ts";

  let {
    sheet,
    open = $bindable(false),
    printLabel = "Print",
    closeLabel = "Close",
    class: className,
  }: {
    /** Everything the paper says. The sheet renders this and nothing else. */
    sheet: PrintSheetDocument;
    /**
     * Whether the sheet is showing. It is the SHEET's own state: the surface underneath keeps its
     * own, stays open beneath this one, and is there again when this closes.
     */
    open?: boolean;
    /** The action that hands this sheet to the browser. */
    printLabel?: string;
    /** The action that puts the sheet away and returns the reader to what is underneath. */
    closeLabel?: string;
    class?: string;
  } = $props();

  let pageElement = $state<HTMLElement | null>(null);

  const EVENT_META_SEPARATOR = "·";
  /** What the metadata line's second half is, for a reader who cannot see the layout. It is the
      source rather than the person because what caused an event is not always a person. */
  const SOURCE_LABEL = "Source";

  function printThisSheet(): void {
    /*
     * The panel carries layout containment (the dialog primitive sets it so a large page behind a
     * dialog costs nothing to lay out). A box with layout containment is monolithic — a printer
     * cannot break it across pages — so a sheet longer than one page would print its first page
     * and stop. Lifting it for the duration of the print keeps the long sheet whole, and it is
     * restored the moment the print is over. Written through the CSSOM rather than a style
     * attribute, which the platform's style-src forbids: packages/design-system/test/csp-spike.
     */
    const element = pageElement;
    if (element === null) {
      window.print();
      return;
    }
    const restoreContainment = (): void => {
      element.style.removeProperty("contain");
    };
    element.style.setProperty("contain", "none");
    window.addEventListener("afterprint", restoreContainment, { once: true });
    window.print();
    restoreContainment();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    bind:ref={pageElement}
    showClose={false}
    class={mergeClasses(
      "mc-print-sheet-page max-w-3xl print:max-h-none print:max-w-none",
      className,
    )}
  >
    <div class="mc-print-sheet-scroll mc-scrollbar">
      <article class="mc-print-sheet">
        <header class="mc-print-sheet-masthead">
          <Dialog.Title level={2} class="mc-print-sheet-heading">{sheet.heading}</Dialog.Title>
          {#if sheet.reference !== undefined}
            <p class="mc-print-sheet-reference">{sheet.reference}</p>
          {/if}
          {#if sheet.subtitle !== undefined}
            <Dialog.Description class="mc-print-sheet-subtitle">{sheet.subtitle}</Dialog.Description>
          {/if}
        </header>

        {#each sheet.sections as section (section.id)}
          <section class="mc-print-sheet-section">
            {#if section.title !== undefined}
              <h3 class="mc-print-sheet-section-title">{section.title}</h3>
            {/if}

            {#if section.kind === "fields"}
              <dl class="mc-print-sheet-fields">
                {#each section.fields as field (field.label)}
                  <dt class="mc-print-sheet-field-label">{field.label}</dt>
                  <dd class="mc-print-sheet-field-value">
                    {field.value}
                    {#if field.secondary !== undefined}
                      <span class="mc-print-sheet-field-secondary">{field.secondary}</span>
                    {/if}
                  </dd>
                {/each}
              </dl>
            {:else if section.kind === "text"}
              <p class="mc-print-sheet-text">{section.text}</p>
            {:else if section.events.length === 0}
              <!-- structured-empty-allow: a printed sheet is paper, not a surface data arrives on;
                   an empty history prints as one sentence, and the fields list in the sibling
                   branch is a different section kind rather than this section's frame -->
              <p class="mc-print-sheet-empty">{PRINT_SHEET_EMPTY_HISTORY_TEXT}</p>
            {:else}
              <ol class="mc-print-sheet-events">
                {#each section.events as event (event.id)}
                  <li class="mc-print-sheet-event">
                    <p class="mc-print-sheet-event-action">{event.action}</p>
                    <p class="mc-print-sheet-event-meta">
                      <time
                        class="mc-print-sheet-event-instant"
                        datetime={eventInstantAttribute(event.at)}
                      >
                        {eventInstantText(event.at)}
                      </time>
                      <span class="mc-print-sheet-event-separator" aria-hidden="true">
                        {EVENT_META_SEPARATOR}
                      </span>
                      <span class="sr-only">{SOURCE_LABEL}</span>
                      <span class="mc-print-sheet-event-source">{event.source}</span>
                    </p>
                    {#if event.detail !== undefined}
                      <blockquote class="mc-print-sheet-event-detail">{event.detail}</blockquote>
                    {/if}
                  </li>
                {/each}
              </ol>
            {/if}
          </section>
        {/each}

        {#if sheet.footer !== undefined}
          <p class="mc-print-sheet-footer">{sheet.footer}</p>
        {/if}
      </article>
    </div>

    <div class="mc-print-sheet-actions print:hidden">
      <Dialog.Close class="mc-button mc-button-secondary mc-button-md">{closeLabel}</Dialog.Close>
      <Button onclick={printThisSheet}>
        <Printer class="mc-print-sheet-print-icon" aria-hidden="true" />
        {printLabel}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
