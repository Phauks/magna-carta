<script module lang="ts">
  /*
   * FileIcon — Data Display. The component has no simple two-value variant axis; its "variant" is the
   * file category, a large set best shown as one labelled grid rather than a dozen sidebar stories. So
   * the catalog is: a controllable Primary (pick a category, or type a content type / file name and
   * watch it resolve), a "File types" showcase of the whole set, a "Folders" pair, and a hidden
   * behaviour story that proves the pure resolver. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import FileIcon from "../lib/components/file-icon/index.ts";
  import { resolveFileCategory } from "../lib/components/file-icon/resolve.ts";

  const CATEGORIES = [
    "pdf",
    "word",
    "excel",
    "powerpoint",
    "image",
    "video",
    "audio",
    "archive",
    "text",
    "code",
    "email",
    "unknown",
  ] as const;

  const { Story } = defineMeta({
    title: "Data Display/FileIcon",
    component: FileIcon,
    args: { category: "pdf" },
    argTypes: {
      category: { control: "select", options: CATEGORIES },
    },
  });

  type FileIconStoryArgs = ComponentProps<typeof FileIcon>;

  // A representative file per category for the showcase grid.
  const SAMPLES: { category: (typeof CATEGORIES)[number]; fileName: string }[] = [
    { category: "pdf", fileName: "Complaint.pdf" },
    { category: "word", fileName: "Engagement-Letter.docx" },
    { category: "excel", fileName: "Trust-Ledger.xlsx" },
    { category: "powerpoint", fileName: "Closing-Deck.pptx" },
    { category: "image", fileName: "Exhibit-A.png" },
    { category: "video", fileName: "Deposition.mp4" },
    { category: "audio", fileName: "Voicemail.m4a" },
    { category: "archive", fileName: "Production.zip" },
    { category: "text", fileName: "Notes.txt" },
    { category: "code", fileName: "schema.json" },
    { category: "email", fileName: "Correspondence.eml" },
    { category: "unknown", fileName: "unknown.bin" },
  ];
</script>

<!-- The controllable Primary — pick a category, or clear it and type a `contentType` / `fileName` to
     watch resolution pick the glyph. The file name beside the glyph is its label (the glyph itself is
     decorative), the real file-row shape. -->
{#snippet template(args: FileIconStoryArgs)}
  <span class="inline-flex items-center gap-8">
    <FileIcon {...args} />
    <span class="text-sm">{args.fileName ?? args.category ?? "file"}</span>
  </span>
{/snippet}

<Story
  name="Default"
  args={{ category: "pdf", fileName: "Complaint.pdf" }}
  {template}
  play={async ({ canvasElement, step }) => {
    await step("Renders a decorative glyph (the file name is the label)", async () => {
      const icon = canvasElement.querySelector(".mc-file-icon");
      await expect(icon).not.toBeNull();
      await expect(icon?.tagName.toLowerCase()).toBe("svg");
      await expect(icon).toHaveAttribute("aria-hidden", "true");
    });
  }}
/>

<!-- The whole type set, labelled — the calm, uniform-weight glyphs a file list draws beside each name. -->
<Story name="File types">
  {#snippet template()}
    <ul class="grid list-none grid-cols-2 gap-x-24 gap-y-12 p-0">
      {#each SAMPLES as sample (sample.category)}
        <li class="inline-flex items-center gap-8">
          <FileIcon category={sample.category} />
          <span class="text-sm">{sample.fileName}</span>
        </li>
      {/each}
    </ul>
  {/snippet}
</Story>

<!-- Folder rows sit above file rows in a file list; the open glyph marks an expanded folder. -->
<Story name="Folders">
  {#snippet template()}
    <div class="flex flex-col gap-12">
      <span class="inline-flex items-center gap-8">
        <FileIcon folder />
        <span class="text-sm">Pleadings</span>
      </span>
      <span class="inline-flex items-center gap-8">
        <FileIcon folder open />
        <span class="text-sm">Discovery (open)</span>
      </span>
    </div>
  {/snippet}
</Story>

<!-- Behaviour: the pure resolver's contract — content type preferred, extension fallback, folder and
     category overrides, unknown fallback. Tagged out of the sidebar and Docs, still run by the test
     addon. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ step }) => {
    await step("Content type maps to a category", async () => {
      await expect(resolveFileCategory({ contentType: "application/pdf" })).toBe("pdf");
      await expect(resolveFileCategory({ contentType: "image/png" })).toBe("image");
      await expect(resolveFileCategory({ contentType: "audio/mpeg" })).toBe("audio");
    });
    await step("Extension maps when the content type is absent", async () => {
      await expect(resolveFileCategory({ fileName: "Q3.xlsx" })).toBe("excel");
      await expect(resolveFileCategory({ fileName: "backup.7z" })).toBe("archive");
      await expect(resolveFileCategory({ fileName: "Deck.pptx" })).toBe("powerpoint");
    });
    await step("Content type wins over the extension", async () => {
      await expect(resolveFileCategory({ contentType: "application/pdf", fileName: "note.txt" })).toBe(
        "pdf",
      );
    });
    await step("An unrecognized or missing descriptor falls back to unknown", async () => {
      await expect(resolveFileCategory({ fileName: "mystery.zzz" })).toBe("unknown");
      await expect(resolveFileCategory({})).toBe("unknown");
    });
  }}
>
  {#snippet template()}
    <FileIcon category="unknown" />
  {/snippet}
</Story>
