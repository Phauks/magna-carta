import { makeZip } from "client-zip";

// The bytes of the files the local development seed (src/http/routes/developer/dev-seed.ts) puts on
// its matter. Only the seed imports this module.

const ARCHIVE_SAMPLE_NAME = "Case Documents.zip";

// Real zip bytes with nested directories, so browsing inside an archive has something local to
// read. Built through the same library the bundle download streams through, so the central
// directory is a faithful one rather than a hand-maintained blob.
async function sampleArchiveBytes(): Promise<Uint8Array> {
  const lastModified = new Date("2026-05-14T10:30:00Z");
  const entries = [
    "case-documents/retainer-agreement.txt",
    "case-documents/engagement-notes.txt",
    "case-documents/pleadings/complaint.txt",
    "case-documents/pleadings/answer.txt",
    "case-documents/discovery/requests/first-set-requests.txt",
    "case-documents/discovery/production/bates-000001.txt",
    "case-documents/discovery/production/bates-000002.txt",
    "case-documents/exhibits/exhibit-a-contract.txt",
  ].map((name) => ({
    name,
    lastModified,
    input: `Seeded archive member ${name} for local development.\n`,
  }));
  return new Uint8Array(await new Response(makeZip(entries)).arrayBuffer());
}

// Three small PDFs of different lengths, so a list, a cover sheet and a Bates range have pages to count.
const PDF_SAMPLES = [
  { name: "Purchase Agreement.pdf", pages: 3 },
  { name: "Inspection Report.pdf", pages: 2 },
  { name: "Demand Letter.pdf", pages: 1 },
] as const;

/** A plain PDF of `pages` letter-size pages, each with its title and page number in Helvetica. */
function samplePdfBytes(title: string, pages: number): Uint8Array {
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>"];
  const kids = Array.from({ length: pages }, (_, index) => `${3 + index * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  const fontObject = 3 + pages * 2;
  for (let index = 0; index < pages; index += 1) {
    const content =
      `BT /F1 20 Tf 72 700 Td (${title}) Tj 0 -30 Td /F1 12 Tf ` +
      `(Page ${index + 1} of ${pages}. Seeded sample for local development.) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let text = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const crossReference = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) text += `${String(offset).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReference}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

/** Every sample the seed files at the top of its matter, by name: the name is the convergence key. */
export const SAMPLE_FILES: ReadonlyArray<{
  readonly name: string;
  readonly contentType: string;
  readonly bytes: () => Promise<Uint8Array> | Uint8Array;
}> = [
  { name: ARCHIVE_SAMPLE_NAME, contentType: "application/zip", bytes: sampleArchiveBytes },
  ...PDF_SAMPLES.map((sample) => ({
    name: sample.name,
    contentType: "application/pdf",
    bytes: () => samplePdfBytes(sample.name.replace(/\.pdf$/, ""), sample.pages),
  })),
];
