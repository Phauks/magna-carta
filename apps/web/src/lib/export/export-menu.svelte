<script lang="ts">
  /*
   * The one Download menu every exporting surface uses — a ghost trigger and one entry per format,
   * all rendering the same tabular export document the page builds from what it shows. Adding a
   * format everywhere is one entry in FORMATS here; a page adopting export is this component plus
   * its document builder. The builder is a function, not a value, so the document's generation
   * instant is the moment of the click rather than the last render.
   */
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Download from "@lucide/svelte/icons/download";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { renderCsvExport } from "./render-csv.ts";
  import { renderTextExport } from "./render-text.ts";
  import { exportFilename, saveExport, type TabularExportDocument } from "./tabular-export.ts";

  let {
    exportDocument,
    disabled = false,
  }: {
    /** Builds the document at click time; null while the page has nothing to export. */
    exportDocument: () => TabularExportDocument | null;
    disabled?: boolean;
  } = $props();

  interface ExportFormat {
    readonly label: string;
    readonly extension: string;
    readonly contentType: string;
    readonly render: (renderedDocument: TabularExportDocument) => string;
  }

  const FORMATS: readonly ExportFormat[] = [
    {
      label: "Plain Text (.txt)",
      extension: "txt",
      contentType: "text/plain;charset=utf-8",
      render: renderTextExport,
    },
    {
      label: "Spreadsheet (.csv)",
      extension: "csv",
      contentType: "text/csv;charset=utf-8",
      render: renderCsvExport,
    },
  ];

  function download(format: ExportFormat): void {
    const renderedDocument = exportDocument();
    if (renderedDocument === null) return;
    saveExport(
      format.render(renderedDocument),
      exportFilename(renderedDocument, format.extension),
      format.contentType,
    );
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    {disabled}
    class={buttonClasses({ variant: "ghost", size: "default" })}
    aria-label="Download the report"
  >
    <Download class="size-16" aria-hidden="true" />
    Download Report
    <ChevronDown class="size-16" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" style="inline-size: var(--mc-size-popover)">
    {#each FORMATS as format (format.extension)}
      <DropdownMenu.Item onSelect={() => download(format)}>
        {format.label}
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
