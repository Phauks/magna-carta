<script lang="ts">
  /*
   * File Workbench — where a file that belongs to no matter is brought to be read.
   *
   * Every file utility the firm has asks for the same bytes. Rather than ten screens each demanding
   * their own upload, a file is brought here once and every capability addresses it: what it is,
   * what it hashes to, what its metadata holds, what it converts to, whether it is safe. The
   * question a person actually arrives with is "I have a file, what can I do with it", and that is
   * one screen, not ten.
   *
   * ETHEREAL BY DESIGN. Nothing here is filed, and nothing here has a history. Keeping a record of
   * inspections would mean retaining information about files the firm never filed, which is exactly
   * what this area must not do. The same body serves a matter's files, where a history IS legitimate
   * because it hangs off a record that already exists; that host wires those capabilities in and
   * this one does not.
   *
   * The route is thin on purpose: it supplies the source and what the member holds, and reads the
   * capability the address names. The screen — masthead included — is the Workbench component,
   * because every control in that masthead acts on the surface rather than on the route.
   *
   * The PDF Editor opens over the bench from the PDF tab, in this route, through shallow routing
   * (`pushState`): the bench's files live in this page, so a separate route would clear the very
   * file being edited. The bench stays mounted under the editor, and the browser's Back closes it.
   *
   * The Tools layout draws this beside the tools column, and this page owns the column's
   * scrolling (its +page.ts says so): the column is a bare full-height stack, so the page takes
   * the height and carries the canvas inset itself, and the workbench's rail and panes scroll
   * inside their own frames as they always have.
   */
  import { pushState } from "$app/navigation";
  import { page } from "$app/state";
  import BenchPdfEditor from "$lib/tools/file-workbench/bench-pdf-editor.svelte";
  import type { WorkbenchFile } from "$lib/tools/file-workbench/workbench-file.ts";
  import Workbench from "$lib/tools/file-workbench/workbench.svelte";
  import { EphemeralFileSource } from "$lib/tools/file-workbench/ephemeral-source.svelte.ts";
  import { capabilityById } from "$lib/tools/file-workbench/capabilities.ts";
  import { OVERVIEW_CAPABILITY } from "$lib/tools/file-workbench/overview.ts";
  import { grantedPermissions } from "$lib/tools/tool-permissions.ts";

  const source = new EphemeralFileSource();
  const permissions = grantedPermissions();

  // The address can name a capability, which is what lets a tool in the listing open the workbench
  // already on its own reading. It is read once, at load: the tab strip is the control after that.
  let capabilityId = $state(
    capabilityById(page.url.searchParams.get("capability"))?.id ?? OVERVIEW_CAPABILITY,
  );

  const editing = $derived(page.state.benchEditor ?? null);
  const editingFile = $derived(
    editing === null ? null : (source.files.find((file) => file.id === editing.fileId) ?? null),
  );

  function openPdfEditor(file: WorkbenchFile, tool: string): void {
    pushState("", { benchEditor: { fileId: file.id, tool } });
  }
</script>

<svelte:head>
  {#if editing === null}<title>File Workbench · Magna Carta</title>{/if}
</svelte:head>

<!-- Hidden rather than unmounted while the editor is open, so the bench comes back as it was left:
     the same file chosen, on the same tab. -->
<div class="flex h-full min-h-0 flex-col" class:hidden={editing !== null}>
  <Workbench {source} {permissions} bind:capabilityId onOpenPdfEditor={openPdfEditor} />
</div>
{#if editing !== null}
  {#key editing.fileId}
    <BenchPdfEditor
      file={editingFile}
      tool={editing.tool}
      onAddFiles={(added) => void source.add(added)}
    />
  {/key}
{/if}
