<script lang="ts">
  /*
   * The PDF Editor's tools, one tab each, over the same document: the body both hosts share. The
   * matter route (/documents/[id]/pdf) and the File Workbench draw their own header above it and
   * hand it the subject; which tools are offered, and what each does with what it makes, follow from
   * the subject's kind (`editor-subject.ts`).
   *
   * A tool that needs a matter stays a tab on a bench file and says why it is shut, in one line.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import BatesTool from "./bates-tool.svelte";
  import FormsTool from "./forms-tool.svelte";
  import PagesTool from "./pages-tool.svelte";
  import RedactTool from "./redact-tool.svelte";
  import SecureTool from "./secure-tool.svelte";
  import SigningTool from "./signing-tool.svelte";
  import WatermarkTool from "./watermark-tool.svelte";
  import { editorToolById, editorToolsFor, toolAvailability, type EditorSubject } from "./editor-subject.ts";

  let {
    subject,
    tool = $bindable("pages"),
    reopenKey,
    onSaved,
  }: {
    subject: EditorSubject;
    /** The tab on show. */
    tool?: string;
    /** A tab is opened afresh whenever this changes, so it never works from bytes a save replaced. */
    reopenKey: string | number;
    /** A save replaced the matter file's current version. */
    onSaved: () => void;
  } = $props();

  const tools = $derived(editorToolsFor(subject.kind));
  const shut = $derived(toolAvailability(editorToolById(tool)?.id ?? "pages", subject.kind));
</script>

<Tabs.Root bind:value={tool} class="flex-none">
  <Tabs.List aria-label="PDF tools" class="flex-wrap">
    {#each tools as one (one.id)}
      <Tabs.Trigger value={one.id}>
        <one.icon class="size-16" aria-hidden="true" />
        {one.label}
      </Tabs.Trigger>
    {/each}
  </Tabs.List>
</Tabs.Root>

<FullHeightSection class="-mx-24 flex flex-col border-t border-border-default">
  {#key reopenKey}
    {#if !shut.available}
      <div class="p-24">
        <Alert.Root variant="info">
          <Alert.Title>Not Available on the Bench</Alert.Title>
          <Alert.Description>{shut.reason}</Alert.Description>
        </Alert.Root>
      </div>
    {:else if tool === "pages"}
      <PagesTool {subject} {onSaved} />
    {:else if tool === "redact"}
      <RedactTool {subject} />
    {:else if tool === "forms"}
      <FormsTool {subject} {onSaved} />
    {:else if tool === "watermark"}
      <WatermarkTool {subject} />
    {:else if tool === "secure"}
      <SecureTool {subject} />
    {:else if subject.kind === "matter" && tool === "bates"}
      <BatesTool file={subject.file} />
    {:else if subject.kind === "matter" && tool === "signature"}
      <SigningTool file={subject.file} />
    {/if}
  {/key}
</FullHeightSection>
