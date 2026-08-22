import type { FormFillFinish, FormFiller } from "@magna-carta/document-assembly/fill-form";
import type { AcroFormReader, FormTemplateScrub } from "@magna-carta/document-assembly/pdf-form";
import {
  resolvePdfFormEnginePort,
  type PdfServiceFetcher,
} from "../documents/pdf-engine-binding.ts";

// The three PDF operations a form template needs, wired to the one PDF engine this platform has.
//
// `@magna-carta/document-assembly` stays pure TypeScript with no WebAssembly and no PDF syntax in it,
// exactly as it stays free of the metadata inspector's engine on the word-processing side: it declares
// the reader, the scrub, and the filler as seams, and this module is where they meet the engine. That
// is what keeps the fill decision — which box gets which value, which absence shows a marker, which one
// fails the assembly — testable without a PDF at all.
//
// The engine is `crates/pdf-core` compiled to WebAssembly, and it RUNS IN THE SIGN WORKER rather than
// here — the same engine, one filler, reached over a service binding instead of bundled (see
// ../documents/pdf-engine-binding.ts for why, and for the three states that binding has). Where it
// executes is a deployment fact; there is still NO SECOND WAY to fill a form and none should be added,
// because a firm's court form has one appearance and a second filler would be a second answer to what
// the filed document looks like.
//
// WHAT THE SEAMS RETURN, AND WHAT THEY THROW. Undefined means the engine looked and refused these
// bytes — a document over the size cap, a decompression bomb, an encrypted file, or something that is
// not a PDF at all. An empty field list is a different answer, and the caller tells the two apart.
// A THROW is not a verdict about the document: `PdfEngineUnavailableError` says no engine is deployed
// and `PdfEngineFaultError` says the deployed one would not answer. Neither is swallowed here, because
// swallowing them would file the refusal a document earned onto a document nothing read.

export interface AssemblyFormEngine {
  readonly readAcroFormFields: AcroFormReader;
  readonly scrubFormTemplate: FormTemplateScrub;
  readonly fillAcroForm: FormFiller;
}

export function formEngineFor(service: PdfServiceFetcher | undefined): AssemblyFormEngine {
  const engine = resolvePdfFormEnginePort(service);

  const readAcroFormFields: AcroFormReader = async (bytes) => {
    const fields = await engine.readFields(bytes);
    return fields?.map((field) => ({
      name: field.name,
      kind: field.kind,
      required: field.required,
      page: field.page,
      value: field.value,
      options: field.options,
      readOnly: field.readOnly,
    }));
  };

  // The form template's scrub, and the direct counterpart of the OOXML metadata scrub on the
  // word-processing path: document metadata, embedded attachments, the XFA dataset, whatever entries
  // the uploaded form was carrying, the structure tree, bookmarks, and optional-content configuration
  // all come out ONCE here rather than on every document the template produces.
  //
  // Clearing the existing entries is the load-bearing one. A firm uploads the form it last filed, and a
  // template that quietly carried the previous client's answers into every document assembled from it
  // is the worst confidentiality failure this subsystem could produce.
  const scrubFormTemplate: FormTemplateScrub = (bytes) => engine.scrub(bytes);

  const fillAcroForm: FormFiller = (bytes, values, finish) => engine.fill(bytes, values, finish);

  return { readAcroFormFields, scrubFormTemplate, fillAcroForm };
}

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
// required parameter precisely so it cannot acquire one, and the engine's own wire surface requires it
// too, so the decision cannot be lost by omission on the way across the binding either.
export const FILLED_FORM_FINISH: FormFillFinish = "interactive";
