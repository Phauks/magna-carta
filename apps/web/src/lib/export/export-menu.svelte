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
  import FileIcon from "@magna-carta/design-system/file-icon";
  import { toast } from "@magna-carta/design-system/toast";
  import { keepExportOnShelf } from "./download-shelf.ts";
  import { markShelfChanged } from "./download-shelf-signal.svelte.ts";
  import { renderCsvExport } from "./render-csv.ts";
  import { RemoteRenderError, renderRemoteExport } from "./render-remote.ts";
  import { renderTextExport } from "./render-text.ts";
  import { renderXlsxExport } from "./render-xlsx.ts";
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
    /**
     * Sync string for the text formats; a Blob promise for the Excel renderer (lazy library) and
     * for the document formats, which render server-side through render-remote.ts.
     */
    readonly render: (renderedDocument: TabularExportDocument) => string | Promise<Blob>;
  }

  const FORMATS: readonly ExportFormat[] = [
    {
      label: "Excel, Sheet per Table (.xlsx)",
      extension: "xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      render: (renderedDocument) => renderXlsxExport(renderedDocument, "worksheet-per-section"),
    },
    {
      label: "Excel, Single Sheet (.xlsx)",
      extension: "xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      render: (renderedDocument) => renderXlsxExport(renderedDocument, "single-worksheet"),
    },
    {
      label: "Word (.docx)",
      extension: "docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      render: (renderedDocument) => renderRemoteExport(renderedDocument, "docx"),
    },
    {
      label: "PDF (.pdf)",
      extension: "pdf",
      contentType: "application/pdf",
      render: (renderedDocument) => renderRemoteExport(renderedDocument, "pdf"),
    },
    {
      label: "CSV (.csv)",
      extension: "csv",
      contentType: "text/csv;charset=utf-8",
      render: renderCsvExport,
    },
    {
      label: "Plain Text (.txt)",
      extension: "txt",
      contentType: "text/plain;charset=utf-8",
      render: renderTextExport,
    },
  ];

  async function download(format: ExportFormat): Promise<void> {
    const renderedDocument = exportDocument();
    if (renderedDocument === null) return;
    try {
      saveExport(
        await format.render(renderedDocument),
        exportFilename(renderedDocument, format.extension),
        format.contentType,
      );
      // Keep it on the member's shelf so they can take it again while it is still current. The file
      // is already saved by this point, so a shelf that cannot take it costs nothing the member
      // asked for — the failure is deliberately silent rather than a toast over a download that
      // worked.
      void keepExportOnShelf(fetch, renderedDocument, format.extension).then(() => {
        // Tell the top-bar tray, so a download appears there at once rather than at the next page
        // load — which is the moment a member looks up to confirm it was kept.
        markShelfChanged();
      });
    } catch (failure) {
      // The document formats render server-side, so a render can fail after the click; the server's
      // own sentence is the actionable one, with its Error ID when the failure minted one.
      const message =
        failure instanceof RemoteRenderError
          ? failure.errorId === undefined
            ? failure.message
            : `${failure.message} (Error ID ${failure.errorId})`
          : "The export could not be produced. Try again shortly.";
      toast.error(message);
    }
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
    {#each FORMATS as format (format.label)}
      <DropdownMenu.Item onSelect={() => void download(format)}>
        <!-- The same per-type symbol the file manager draws for this format, resolved from the
             format's own MIME type so the two surfaces can never disagree. -->
        <FileIcon contentType={format.contentType} class="size-16 shrink-0" />
        {format.label}
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
