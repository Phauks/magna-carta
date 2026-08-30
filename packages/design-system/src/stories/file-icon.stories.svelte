<script module lang="ts">
  /*
   * FileIcon — Data Display. The component has no simple two-value variant axis; its "variant" is
   * the file category, a large set best shown as one labelled grid rather than a dozen sidebar
   * stories. So the catalog is: a controllable Primary (pick a category and a size, or type a
   * content type / file name and watch it resolve), a "File types" showcase of the whole mapping, a
   * "Badge at every size" story that measures the badge on each size the component offers, a
   * "Folders" pair, and a hidden behaviour story that proves the pure resolver. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import FileIcon from "../lib/components/file-icon/index.ts";
  import type { FileIconSize } from "../lib/components/file-icon/variants.ts";

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
    "program",
    "unknown",
  ] as const;

  const SIZES = ["sm", "default", "lg"] as const;

  const { Story } = defineMeta({
    title: "Data Display/FileIcon",
    component: FileIcon,
    args: { category: "pdf", size: "default" },
    argTypes: {
      category: { control: "select", options: CATEGORIES },
      size: { control: "select", options: SIZES },
    },
  });

  type FileIconStoryArgs = ComponentProps<typeof FileIcon>;

  // A representative file per category for the showcase grid. Real names, because the badge is the
  // file's own extension and a made-up name would show a made-up badge.
  const SAMPLES: { category: (typeof CATEGORIES)[number]; fileName: string }[] = [
    { category: "pdf", fileName: "Complaint.pdf" },
    { category: "word", fileName: "Motion-to-Compel.docx" },
    { category: "word", fileName: "Retainer-1998.doc" },
    { category: "excel", fileName: "Trust-Ledger.xlsx" },
    { category: "powerpoint", fileName: "Closing-Deck.pptx" },
    { category: "image", fileName: "Exhibit-A.png" },
    { category: "video", fileName: "Deposition.mp4" },
    { category: "audio", fileName: "Voicemail.m4a" },
    { category: "archive", fileName: "Production.zip" },
    { category: "text", fileName: "Notes.txt" },
    { category: "code", fileName: "schema.json" },
    { category: "email", fileName: "Correspondence.eml" },
    { category: "program", fileName: "Viewer-Setup.exe" },
    { category: "unknown", fileName: "unknown.bin" },
  ];

  // The badged types, longest word first — a four-letter extension is the hardest case, so it is
  // the one the size measurements are read from.
  const BADGED: { fileName: string; badge: string }[] = [
    { fileName: "Motion-to-Compel.docx", badge: "DOCX" },
    { fileName: "Trust-Ledger.xlsx", badge: "XLSX" },
    { fileName: "Complaint.pdf", badge: "PDF" },
    { fileName: "Retainer-1998.doc", badge: "DOC" },
  ];

  /*
   * The mapping as it must reach the screen: one file per kind, the Lucide glyph it draws, and the
   * badge it carries (absent where the glyph already says what the file is). The two audio and
   * video entries name the glyphs Lucide's own numbered aliases resolve to.
   */
  const DRAWN: { fileName: string; glyph: string; badge?: string }[] = [
    { fileName: "Complaint.pdf", glyph: "file", badge: "PDF" },
    { fileName: "Motion-to-Compel.docx", glyph: "file-text", badge: "DOCX" },
    { fileName: "Retainer-1998.doc", glyph: "file-text", badge: "DOC" },
    { fileName: "Trust-Ledger.xlsx", glyph: "file-spreadsheet", badge: "XLSX" },
    { fileName: "Exhibit-A.png", glyph: "file-image" },
    { fileName: "Deposition.mp4", glyph: "file-video-camera" },
    { fileName: "Voicemail.m4a", glyph: "file-headphone" },
    { fileName: "Production.zip", glyph: "file-archive" },
    { fileName: "Viewer-Setup.exe", glyph: "file-cog" },
  ];

  /** A tenth of a pixel is as fine as these measurements need to read in a failure message. */
  function round(value: number): number {
    return Math.round(value * 10) / 10;
  }

  /** The rendered box of an element, rounded to a tenth of a pixel for readable failures. */
  function box(element: Element): {
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    center: number;
  } {
    const rectangle = element.getBoundingClientRect();
    return {
      left: round(rectangle.left),
      right: round(rectangle.right),
      bottom: round(rectangle.bottom),
      width: round(rectangle.width),
      height: round(rectangle.height),
      center: round(rectangle.left + rectangle.width / 2),
    };
  }
</script>

<!-- The controllable Primary — pick a category and a size, or clear the category and type a
     `contentType` / `fileName` to watch resolution pick the glyph and the badge. The file name
     beside the glyph is its label (the composite itself is decorative), the real file-row shape. -->
{#snippet template(args: FileIconStoryArgs)}
  <span class="inline-flex items-center gap-8">
    <FileIcon {...args} />
    <span class="text-sm">{args.fileName ?? args.category ?? "file"}</span>
  </span>
{/snippet}

<Story
  name="Default"
  args={{ category: "pdf", fileName: "Complaint.pdf", size: "default" }}
  {template}
  play={async ({ canvasElement, step }) => {
    const composite = canvasElement.querySelector(".mc-file-icon");
    const glyph = canvasElement.querySelector(".mc-file-icon-glyph");
    const badge = canvasElement.querySelector(".mc-file-icon-badge");

    await step("Renders a decorative composite (the file name is the label)", async () => {
      await expect(composite).not.toBeNull();
      await expect(composite?.tagName.toLowerCase()).toBe("span");
      await expect(composite).toHaveAttribute("aria-hidden", "true");
      await expect(glyph?.tagName.toLowerCase()).toBe("svg");
    });

    await step("A pdf draws the empty sheet, never the letter-T glyph", async () => {
      await expect(glyph?.getAttribute("class")).toContain("lucide-file");
      await expect(glyph?.getAttribute("class")).not.toContain("lucide-file-type");
      await expect(glyph?.getAttribute("class")).not.toContain("lucide-file-text");
    });

    await step("The badge is real text, never drawn geometry", async () => {
      await expect(badge?.textContent).toBe("PDF");
      await expect(badge?.querySelectorAll("svg").length).toBe(0);
      await expect(badge?.querySelectorAll("path").length).toBe(0);
    });
  }}
/>

<!-- The whole mapping, labelled. The badge carries the file's own extension so it agrees with the
     File Type column; an image, a video, an audio file and an archive have a glyph that already
     says what they are, so they carry none. -->
<Story name="File types">
  {#snippet template()}
    <ul class="grid list-none grid-cols-2 gap-x-24 gap-y-12 p-0">
      {#each SAMPLES as sample (sample.fileName)}
        <li class="inline-flex items-center gap-8">
          <FileIcon fileName={sample.fileName} />
          <span class="text-sm">{sample.fileName}</span>
        </li>
      {/each}
    </ul>
  {/snippet}
</Story>

<!-- Every size the component offers, with the badged types on each. The play function measures the
     badge on each one rather than asserting that it exists: a badge can be present and still be
     clipped, off-centre, or lifted off the glyph's lower edge.

     What the measurements read, in Chromium at a device-pixel ratio of 1 (the widest word, DOCX,
     is the binding case):

       sm       16x16 box  badge 20.4x10  overhangs the glyph by 2.2 per side
       default  20x20 box  badge 20.4x10  overhangs by 0.2 per side
       lg       24x24 box  badge 20.4x10  sits 1.8 inside the glyph on each side

     The word holds one type step across all three, so it is exactly as legible on the small icon
     as on the large one; what changes is how much of the glyph it leaves showing (62% of the block
     extent at sm, 50% at default, 42% at lg). The overhang is bounded below by the tightest gap a
     file row puts between the icon and the file name, which is why it is asserted rather than
     merely observed. -->
<Story
  name="Badge at every size"
  play={async ({ canvasElement, step }) => {
    // The tightest gap a file row leaves between the icon and the name it labels; the badge may
    // overhang the glyph, but never by enough to reach the text on either side of it.
    const rowGap = 8;

    for (const size of SIZES) {
      const row = canvasElement.querySelector(`[data-size-row="${size}"]`);
      await expect(row).not.toBeNull();

      for (const badged of BADGED) {
        const composite = row?.querySelector(`[data-file="${badged.fileName}"] .mc-file-icon`);
        const badge = composite?.querySelector(".mc-file-icon-badge");
        const glyph = composite?.querySelector(".mc-file-icon-glyph");

        await step(`${size}: ${badged.badge} rides the glyph`, async () => {
          await expect(badge).not.toBeNull();
          await expect(badge?.textContent).toBe(badged.badge);

          const compositeBox = box(composite!);
          const badgeBox = box(badge!);
          const glyphBox = box(glyph!);

          // The glyph fills the box the size names — it is not Lucide's own default spilling out.
          await expect(glyphBox.width).toBe(compositeBox.width);
          await expect(glyphBox.height).toBe(compositeBox.height);
          // The whole word is drawn: nothing is clipped by the chip it sits in.
          await expect(badge!.scrollWidth).toBeLessThanOrEqual(badge!.clientWidth + 1);
          // Legible: the label holds one type step across every size, never shrinking with the box.
          await expect(window.getComputedStyle(badge!).fontSize).toBe("8px");
          // Centred on the glyph, and flush with its lower edge — at every size.
          await expect(Math.abs(badgeBox.center - compositeBox.center)).toBeLessThanOrEqual(0.6);
          await expect(Math.abs(badgeBox.bottom - compositeBox.bottom)).toBeLessThanOrEqual(0.6);
          // It rides the glyph rather than replacing it: the glyph is still the taller mark.
          await expect(badgeBox.height).toBeLessThan(glyphBox.height);
          // A word wider than a small glyph overhangs it, and must stay clear of the file name.
          await expect(badgeBox.width - compositeBox.width).toBeLessThanOrEqual(rowGap);
        });
      }
    }
  }}
>
  {#snippet template()}
    <div class="flex flex-col gap-24">
      {#each SIZES as size (size)}
        <div class="flex flex-col gap-8" data-size-row={size}>
          <span class="text-sm">{size}</span>
          <ul class="flex list-none flex-wrap items-center gap-24 p-0">
            {#each BADGED as badged (badged.fileName)}
              <li class="inline-flex items-center gap-8" data-file={badged.fileName}>
                <FileIcon fileName={badged.fileName} {size} />
                <span class="text-sm">{badged.fileName}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
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

<!-- Behaviour: the rendered mapping. Which Lucide glyph each kind draws is a claim about what
     reaches the screen, so it is asserted off the rendered <svg> rather than off the resolver (the
     pure vocabulary — kind, tone, badge word — is unit-tested in test/file-icon-mapping.test.ts).
     Tagged out of the sidebar and Docs, still run by the test addon. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvasElement, step }) => {
    const glyphFor = (fileName: string): SVGElement => {
      const composite = canvasElement.querySelector(`[data-file="${fileName}"]`);
      return composite!.querySelector(".mc-file-icon-glyph")!;
    };

    await step("Every kind draws the glyph the mapping names", async () => {
      for (const drawn of DRAWN) {
        await expect(glyphFor(drawn.fileName).getAttribute("class")).toContain(
          `lucide-${drawn.glyph}`,
        );
      }
    });

    await step("A pdf draws the empty sheet, never the letter-T glyph", async () => {
      // The root cause of "a red file with a T": Lucide's file-type glyph IS a letter T.
      const pdf = glyphFor("Complaint.pdf").getAttribute("class");
      await expect(pdf).toContain("lucide-file ");
      await expect(pdf).not.toContain("lucide-file-type");
      await expect(pdf).not.toContain("lucide-file-text");
    });

    await step("A legacy doc and a docx share a glyph and differ by their badge", async () => {
      const legacy = canvasElement.querySelector('[data-file="Retainer-1998.doc"]');
      const current = canvasElement.querySelector('[data-file="Motion-to-Compel.docx"]');
      await expect(glyphFor("Retainer-1998.doc").getAttribute("class")).toBe(
        glyphFor("Motion-to-Compel.docx").getAttribute("class"),
      );
      await expect(legacy?.querySelector(".mc-file-icon-badge")?.textContent).toBe("DOC");
      await expect(current?.querySelector(".mc-file-icon-badge")?.textContent).toBe("DOCX");
    });

    await step("Only the confusable document types carry a badge", async () => {
      for (const drawn of DRAWN) {
        const composite = canvasElement.querySelector(`[data-file="${drawn.fileName}"]`);
        const badge = composite?.querySelector(".mc-file-icon-badge");
        if (drawn.badge === undefined) {
          await expect(badge).toBeNull();
        } else {
          await expect(badge?.textContent).toBe(drawn.badge);
        }
      }
    });

    await step("The executable is the one glyph drawn in a tone of its own", async () => {
      await expect(glyphFor("Viewer-Setup.exe")).toHaveAttribute("data-tone", "danger");
      await expect(glyphFor("Complaint.pdf")).toHaveAttribute("data-tone", "default");
    });

    await step("A named composite is an image with that name, not a hidden decoration", async () => {
      const named = canvasElement.querySelector('[data-file="named"]');
      await expect(named).toHaveAttribute("role", "img");
      await expect(named).not.toHaveAttribute("aria-hidden");
      await expect(named?.querySelector(".mc-file-icon-glyph")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });
  }}
>
  {#snippet template()}
    <ul class="flex list-none flex-wrap gap-16 p-0">
      {#each DRAWN as drawn (drawn.fileName)}
        <li data-file={drawn.fileName}>
          <FileIcon fileName={drawn.fileName} />
        </li>
      {/each}
      <li>
        <FileIcon fileName="Complaint.pdf" aria-label="Complaint, pdf" data-file="named" />
      </li>
    </ul>
  {/snippet}
</Story>
