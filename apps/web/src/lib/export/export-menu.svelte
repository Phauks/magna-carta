<script lang="ts">
  /*
   * The one Download menu every exporting surface uses — a ghost trigger and one entry per format,
   * all rendering the same tabular export document the page builds from what it shows. Adding a
   * format everywhere is one entry in FORMATS here; a page adopting export is this component plus
   * its document builder. The builder is a function, not a value, so the document's generation
   * instant is the moment of the click rather than the last render.
   */
  import { onMount } from "svelte";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Download from "@lucide/svelte/icons/download";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import { toast } from "@magna-carta/design-system/toast";
  import { keepExportOnShelf, readDownloadPreferences } from "./download-shelf.ts";
  import { markShelfChanged } from "./download-shelf-signal.svelte.ts";
  import { renderCsvExport } from "./render-csv.ts";
  import { renderPdfExport } from "./render-pdf.ts";
  import { renderRemoteExport } from "./render-remote.ts";
  import { renderTextExport } from "./render-text.ts";
  import { renderXlsxExport } from "./render-xlsx.ts";
  import {
    ExportRenderError,
    exportFilename,
    saveExport,
    type TabularExportDocument,
  } from "./tabular-export.ts";

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
     * Sync string for the text formats; a Blob promise for the Excel renderer (lazy library), the
     * PDF composer (a Web Worker) and Word, which renders server-side through render-remote.ts.
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
      render: renderPdfExport,
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

  // The member's own preference, read once when the menu mounts. Absent or unreadable resolves to
  // the default — generate onto the shelf — because that is the behavior that loses nothing: the
  // item is kept either way, and a member who wanted the file immediately takes it from the shelf
  // in one more click. Guessing the other way would drop files somebody did not ask for.
  let saveImmediately = $state(false);
  onMount(() => {
    void readDownloadPreferences(fetch).then((outcome) => {
      if (outcome.kind === "ok") saveImmediately = outcome.value.saveImmediately;
    });
  });

  /*
   * Exporting GENERATES onto the member's shelf; it does not save a file. That is the point: several
   * exports can be gathered and taken together, rather than each one dropping into the browser's
   * download folder as it is made. The format still matters here — it is what the item is made for,
   * and what its download will default to — which is why the menu keeps its formats.
   *
   * With the member's download-immediately preference on, the file is rendered and saved in the same
   * act and the shelf records the format as taken. That is the only difference between the two
   * paths: whether the bytes are produced now or when the member comes for them.
   */
  async function download(format: ExportFormat): Promise<void> {
    const renderedDocument = exportDocument();
    if (renderedDocument === null) return;
    try {
      if (saveImmediately) {
        saveExport(
          await format.render(renderedDocument),
          exportFilename(renderedDocument, format.extension),
          format.contentType,
        );
      }
      const outcome = await keepExportOnShelf(
        fetch,
        renderedDocument,
        format.extension,
        saveImmediately,
      );
      if (outcome.kind !== "ok") {
        const errorId = outcome.kind === "problem" ? outcome.problem.errorId : undefined;
        const suffix = errorId === undefined ? "" : ` (Error ID ${errorId})`;
        if (saveImmediately) {
          // The member already has their file; only the kept copy was lost.
          toast.error(`Downloaded, but it could not be added to your Downloads.${suffix}`);
          return;
        }
        /*
         * The default path produced NOTHING yet — no file, and no shelf item. Generating instead of
         * downloading is only an improvement while the shelf works; when it refuses, a member who
         * asked for a report must not be left with neither. So fall back to what exporting used to
         * do and hand them the file, then say plainly that it was not kept.
         */
        try {
          saveExport(
            await format.render(renderedDocument),
            exportFilename(renderedDocument, format.extension),
            format.contentType,
          );
          toast.error(`Downloaded instead: it could not be added to your Downloads.${suffix}`);
        } catch {
          toast.error(`That export could not be produced.${suffix}`);
        }
        return;
      }
      // Tell the top-bar tray, so it appears there at once rather than at the next page load — which
      // is the moment a member looks up to see where their export went.
      markShelfChanged();
      if (!saveImmediately) {
        toast.success(`Added to Downloads as ${format.extension.toUpperCase()}`);
      }
    } catch (failure) {
      // Only reachable on the immediate path, where a render happens here; the document formats
      // render server-side, so the server's own sentence is the actionable one.
      const message =
        failure instanceof ExportRenderError
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
    aria-label="Export the report"
  >
    <Download class="size-16" aria-hidden="true" />
    Export
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
