// Builds `intake-form.pdf`, the committed fillable-PDF fixture the form-template tests run against.
//
// IT IS BUILT RATHER THAN COPIED, for the same reason the word-processing fixtures are built
// programmatically: a real client document cannot be committed, and a form downloaded from a court
// carries somebody else's asserted rights. Everything in here is invented — a two-page intake form for a
// firm that does not exist, with one box of every kind the engine distinguishes plus one whose type the
// form does not state.
//
// Run it with `node packages/document-assembly/test/fixtures/build-fillable-form.mjs`. The output is
// committed; regenerate it only when the field set the tests need changes, and review the diff as you
// would any other fixture.
//
// The PDF is written uncompressed with a hand-built cross-reference table, so the file is readable in a
// text editor and a reviewer can see exactly which fields it declares.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const objects = [];

/** Register an object body and return its `n 0 R` reference. */
function add(body) {
  objects.push(body);
  return `${objects.length} 0 R`;
}

/** A tiny appearance stream — enough for the engine to find an on-state by name. */
function appearance(content) {
  return add(
    `<< /Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 12 12] /Length ${content.length} >>\nstream\n${content}\nendstream`,
  );
}

// Object 1 is reserved for the catalog, 2 for the page tree, 3 and 4 for the two pages: they are
// referenced by objects defined before them, so their slots are claimed up front.
const CATALOG = "1 0 R";
const PAGES = "2 0 R";
const PAGE_ONE = "3 0 R";
const PAGE_TWO = "4 0 R";
for (let index = 0; index < 4; index += 1) objects.push("");

const tickedAppearance = appearance("q 1 0 0 RG 1 1 m 11 11 l S Q");
const untickedAppearance = appearance("q Q");

// ── The fields ────────────────────────────────────────────────────────────────
//
// Each is a merged field-and-widget dictionary (its own /Rect), which is how most real forms are
// written and the shape the engine's widget collection takes as the common case.

function textField({ name, page, rect, flags = 0, value }) {
  const valueEntry = value === undefined ? "" : ` /V (${value})`;
  return add(
    `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${name}) /Ff ${flags} /Rect [${rect.join(" ")}] /DA (/Helv 10 Tf 0 g) /P ${page}${valueEntry} >>`,
  );
}

const fields = [];

// A plain text box, and the one the tests bind to the client's name.
fields.push({
  page: 1,
  ref: textField({ name: "Client_Name", page: PAGE_ONE, rect: [72, 700, 320, 718] }),
});

// A text box whose name IS a merge key, character for character. It exists to prove that an exact match
// is PROPOSED and never bound: nothing fills it in until a person confirms it.
fields.push({
  page: 1,
  ref: textField({ name: "matter.number", page: PAGE_ONE, rect: [72, 670, 320, 688] }),
});

// A REQUIRED box (/Ff bit 2), so the manifest's `required` flag has something true to record.
fields.push({
  page: 1,
  ref: textField({
    name: "Petitioner_Address",
    page: PAGE_ONE,
    rect: [72, 640, 460, 658],
    flags: 2,
  }),
});

// A box the uploaded form arrives already filled in. The scrub has to clear it — a template that carried
// the last client's answers into every document assembled from it is the worst thing this could do.
fields.push({
  page: 1,
  ref: textField({
    name: "Previously_Entered",
    page: PAGE_ONE,
    rect: [72, 610, 320, 628],
    value: "Rowan Ashcroft",
  }),
});

// A tick box, with the on and off appearances the engine reads its on-state name from.
fields.push({
  page: 1,
  ref: add(
    `<< /Type /Annot /Subtype /Widget /FT /Btn /T (Fee_Waiver_Requested) /Ff 0 /Rect [72 580 84 592] /AS /Off /AP << /N << /Yes ${tickedAppearance} /Off ${untickedAppearance} >> >> /P ${PAGE_ONE} >>`,
  ),
});

// A drop-down with a closed answer set, so a value outside it can be refused rather than written.
fields.push({
  page: 2,
  ref: add(
    `<< /Type /Annot /Subtype /Widget /FT /Ch /T (Filing_County) /Ff 0 /Rect [72 700 260 718] /Opt [(Clark) (Washoe) (Elko)] /DA (/Helv 10 Tf 0 g) /P ${PAGE_TWO} >>`,
  ),
});

// A push button: nothing a merge value can be written into, and the engine says so rather than the
// manifest quietly dropping it.
fields.push({
  page: 2,
  ref: add(
    `<< /Type /Annot /Subtype /Widget /FT /Btn /T (Print_This_Form) /Ff 65536 /Rect [400 700 470 718] /P ${PAGE_TWO} >>`,
  ),
});

// A signature field: filled by a signing ceremony, never by an assembly.
fields.push({
  page: 2,
  ref: add(
    `<< /Type /Annot /Subtype /Widget /FT /Sig /T (Attorney_Signature) /Rect [72 620 320 660] /P ${PAGE_TWO} >>`,
  ),
});

// A field whose /FT is a type no version of the specification defines. The form declares a box and does
// not say what it is; the engine must report it unclassified rather than treat it as text.
fields.push({
  page: 2,
  ref: add(
    `<< /Type /Annot /Subtype /Widget /FT /Zz /T (Unstated_Box) /Rect [72 580 320 598] /P ${PAGE_TWO} >>`,
  ),
});

// A second box for the client's name, on the other page — the many-boxes-one-merge-field case a real
// court form always has.
fields.push({
  page: 2,
  ref: textField({ name: "Client_Name_Verification", page: PAGE_TWO, rect: [72, 540, 320, 558] }),
});

const acroForm = add(
  `<< /Fields [${fields.map((field) => field.ref).join(" ")}] /DA (/Helv 10 Tf 0 g) /DR << /Font << /Helv << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> >> >> >>`,
);

const annotsFor = (page) =>
  fields
    .filter((field) => field.page === page)
    .map((field) => field.ref)
    .join(" ");

objects[0] = `<< /Type /Catalog /Pages ${PAGES} /AcroForm ${acroForm} >>`;
objects[1] = `<< /Type /Pages /Kids [${PAGE_ONE} ${PAGE_TWO}] /Count 2 >>`;
objects[2] = `<< /Type /Page /Parent ${PAGES} /MediaBox [0 0 612 792] /Annots [${annotsFor(1)}] >>`;
objects[3] = `<< /Type /Page /Parent ${PAGES} /MediaBox [0 0 612 792] /Annots [${annotsFor(2)}] >>`;

// ── Serialise ─────────────────────────────────────────────────────────────────

const parts = ["%PDF-1.7\n"];
const offsets = [];
let offset = parts[0].length;
for (const [index, body] of objects.entries()) {
  const serialised = `${index + 1} 0 obj\n${body}\nendobj\n`;
  offsets.push(offset);
  parts.push(serialised);
  offset += serialised.length;
}

const xrefOffset = offset;
let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const entry of offsets) xref += `${String(entry).padStart(10, "0")} 00000 n \n`;
xref += `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
parts.push(xref);

const out = join(dirname(fileURLToPath(import.meta.url)), "intake-form.pdf");
writeFileSync(out, Buffer.from(parts.join(""), "latin1"));
process.stdout.write(`wrote ${out} (${objects.length} objects, ${fields.length} fields)\n`);
