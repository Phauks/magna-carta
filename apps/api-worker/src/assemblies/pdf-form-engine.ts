import type { FormFillFinish, FormFiller } from "@magna-carta/document-assembly/fill-form";
import type { AcroFormReader, FormTemplateScrub } from "@magna-carta/document-assembly/pdf-form";
import { ensureReady, fillForm, readForm, sanitizeDocument } from "@magna-carta/pdf";
import pdfWasmModule from "@magna-carta/pdf/src/pkg/pdf_core_bg.wasm";

// The three PDF operations a form template needs, wired to the one PDF engine this platform has.
//
// `@magna-carta/document-assembly` stays pure TypeScript with no WebAssembly and no PDF syntax in it,
// exactly as it stays free of the metadata inspector's engine on the word-processing side: it declares
// the reader, the scrub, and the filler as seams, and this module is where they meet the engine. That
// is what keeps the fill decision — which box gets which value, which absence shows a marker, which one
// fails the assembly — testable without a PDF at all.
//
// The engine is `crates/pdf-core` compiled to WebAssembly. There is NO SECOND WAY to fill a form here
// and none should be added: a firm's court form has one appearance, and a second filler would be a
// second answer to what the filed document looks like.

// The engine's module has to be handed in explicitly under Workers — there is no URL to fetch it from.
// `ensureReady` caches the first initialization, so the later argument-less calls the engine's own entry
// points make resolve against this module.
async function readyEngine(): Promise<void> {
  await ensureReady(pdfWasmModule);
}

// Read the AcroForm field set. Undefined is "these bytes are not a PDF this engine will read" — a
// document over the size cap, a decompression bomb, an encrypted file, or something that is not a PDF
// at all. An empty array is a different answer, and the caller tells the two apart.
export const readAcroFormFields: AcroFormReader = async (bytes) => {
  try {
    await readyEngine();
    return (await readForm(bytes)).map((field) => ({
      name: field.name,
      kind: field.kind,
      required: field.required,
      page: field.page,
      value: field.value,
      options: field.options,
      readOnly: field.readOnly,
    }));
  } catch {
    return undefined;
  }
};

// The form template's scrub, and the direct counterpart of the OOXML metadata scrub on the
// word-processing path: document metadata, embedded attachments, the XFA dataset, whatever entries the
// uploaded form was carrying, the structure tree, bookmarks, and optional-content configuration all come
// out ONCE here rather than on every document the template produces.
//
// Clearing the existing entries is the load-bearing one. A firm uploads the form it last filed, and a
// template that quietly carried the previous client's answers into every document assembled from it is
// the worst confidentiality failure this subsystem could produce.
export const scrubFormTemplate: FormTemplateScrub = async (bytes) => {
  try {
    await readyEngine();
    return (await sanitizeDocument(bytes)).pdf;
  } catch {
    return undefined;
  }
};

export const fillAcroForm: FormFiller = async (bytes, values, finish) => {
  try {
    await readyEngine();
    const filled = await fillForm(bytes, Object.fromEntries(values), {
      flatten: finish === "flattened",
    });
    return filled.pdf;
  } catch {
    return undefined;
  }
};

// WHAT A FILLED FORM IS WHEN IT IS FILED — the one place the platform answers it.
//
// The choice between an interactive form and a flattened one is a product decision the firm owner has
// not made: a flattened form is what a signature wants, and an interactive one is what a firm wants when
// the recipient still has to complete a box. Until it is answered, this is `interactive`, because
// FLATTENING IS IRREVERSIBLE — a flattened form cannot be corrected, and a document that can still be
// fixed is the safer thing to have filed while the question is open.
//
// When the answer arrives it is this constant, or this constant becomes a read of a per-template column.
// Nothing downstream has a default of its own to unpick: `fillFormTemplate` takes the finish as a
// required parameter precisely so it cannot acquire one.
export const FILLED_FORM_FINISH: FormFillFinish = "interactive";
