import { absenceMarkerFor, type AssemblyAbsence } from "./assemble.ts";
import { lookupDictionaryEntry, type DictionaryEntry } from "./dictionary.ts";
import { formatMergeValue, renderingAbsenceReason } from "./format.ts";
import { isFillableFormFieldKind } from "./pdf-form.ts";
import type { FieldManifest, ManifestFormFieldSite, MergeContext, MergeValue } from "./types.ts";

// Filling a registered FORM template against a resolved merge context.
//
// This is the form-template counterpart of `assemble.ts`, and the two share everything about what a
// document MEANS while sharing nothing about how one is written. The dictionary decides what a key
// resolves to; `format.ts` decides how a value renders; the absence model decides what a hole looks
// like and whether it stops the assembly. Only the last step differs — a word-processing merge rewrites
// runs in an OOXML package, and this one hands a name-to-value map to the PDF engine.
//
// THE ABSENCE MODEL IS UNCHANGED, and it is unchanged deliberately rather than by coincidence: a
// declared `fail` fails the assembly naming the key, a declared `blank` leaves the box empty, and
// everything else prints the same visible marker a Word template would — `[CLIENT ADDRESS]` inside the
// box, where whoever proofreads the draft cannot miss it. A firm that has two templates for the same
// letter, one Word and one PDF, must not find that they disagree about what a missing value looks like.
//
// Where a form CANNOT carry a marker, the absence is still recorded and still reported; it is only the
// rendering that differs. A tick box has nowhere to print `[SPOUSE]`, so an unanswerable box is left
// unticked and the absence says so in words — reported to the caller, counted, and stored on the
// provenance row exactly as every other absence is.

// ---------------------------------------------------------------------------------------------
// The finish — an owner decision, held open as a typed parameter
// ---------------------------------------------------------------------------------------------

// WHAT A FILLED FORM IS WHEN IT IS FILED.
//
// `interactive` keeps the AcroForm: the values are set, the boxes still exist, and whoever receives the
// document can correct a typo or complete a box the firm left for them.
//
// `flattened` bakes every appearance into page content and drops the form: nothing can be edited, which
// is what a signature wants — and nothing can be corrected either, which is what a form still being
// completed does not.
//
// Both are defensible and the choice is the firm owner's, not this package's, so it is an EXPLICIT
// REQUIRED PARAMETER at the seam rather than a boolean with a default buried in a call. When the
// decision is made it is answered in one place — the constant the assembly job passes — or widened to a
// per-template column, and either change is a line rather than an excavation. Until then the caller
// passes the non-destructive one: a flattened form cannot be un-flattened, and a document that can
// still be corrected is the safer thing to have filed while the question is open.
export type FormFillFinish = "interactive" | "flattened";

// ---------------------------------------------------------------------------------------------
// The engine seam
// ---------------------------------------------------------------------------------------------

// A value to write into one named AcroForm field. A string for a text, choice, or radio field; a
// boolean for a tick box — the two the engine distinguishes.
export type FormFillValue = string | boolean;

// Write values into a PDF form and return the result. Injected rather than imported, exactly as the
// reader and the scrub are: this package holds no WebAssembly and no PDF syntax. Returns undefined when
// the engine refused the document.
export type FormFiller = (
  bytes: Uint8Array,
  values: ReadonlyMap<string, FormFillValue>,
  finish: FormFillFinish,
) => Promise<Uint8Array | undefined>;

// ---------------------------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------------------------

export type FormFillFailureReason =
  | "unreadable-template"
  // The same code `assemble.ts` uses, and the same meaning: a key whose dictionary entry declares
  // `fail` could not be resolved. A caller classifies a failed assembly by this code without caring
  // which engine produced it.
  | "missing-required-field";

export type FormFillResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      // The KEYS that could not be resolved, never the values that could — the identical contract
      // `assemble.ts` returns, so the provenance row, the telemetry, and the poll response are written
      // once for both kinds of template.
      readonly absences: readonly AssemblyAbsence[];
      // How many boxes were written with a resolved value. The denominator the absences count against.
      readonly substitutions: number;
      readonly finish: FormFillFinish;
    }
  | {
      readonly ok: false;
      readonly reason: FormFillFailureReason;
      readonly detail: string;
      readonly keys: readonly string[];
    };

export interface FormFillOptions {
  // The catalogue every key is resolved against — the firm's, including its own `custom.<handle>`
  // bindings, not the platform's shipped list. Same input `assemble` takes, for the same reason: a
  // template bound in March to a field archived in June must fail in September naming the key.
  readonly dictionary?: readonly DictionaryEntry[];
  // See FormFillFinish. Required, so nothing can acquire a default by omission.
  readonly finish: FormFillFinish;
}

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

// One box, and what will be written into it. Produced before the engine is called at all, so the whole
// decision — value, marker, blank, or failure — is inspectable and testable without a PDF.
export interface FormFillPlanEntry {
  readonly fieldName: string;
  readonly key: string;
  readonly value: FormFillValue;
  // Whether the value came from the matter, rather than being a marker or an emptied box.
  readonly resolved: boolean;
}

export interface FormFillPlan {
  readonly entries: readonly FormFillPlanEntry[];
  readonly absences: readonly AssemblyAbsence[];
  // Keys whose dictionary entry declares `fail` and which nothing resolved. A non-empty set fails the
  // assembly.
  readonly missingRequiredKeys: readonly string[];
}

// What a resolved value becomes in a tick box. There is no rendering to fall back on: a box is answered
// or it is not, and only a boolean value answers one. A key of any other type bound to a tick box is a
// binding the firm made that the form cannot express, so it is a reported absence rather than a guess
// at truthiness — a text value of "no" ticking a box is precisely the silently-wrong document this
// subsystem exists to prevent.
function tickValueOf(value: MergeValue): boolean | undefined {
  return value.kind === "boolean" ? value.value : undefined;
}

// What a resolved value becomes in a choice or a radio group: the rendered text, but ONLY when the form
// will accept it as a state. The engine writes /V and the widget's selected state from this string, and
// a state the form has no appearance for renders as an unanswered box that carries an answer — visibly
// blank, invisibly filled. So a value outside the option set is a reported absence.
function choiceValueOf(rendered: string, site: ManifestFormFieldSite): string | undefined {
  if (site.options.length === 0) return rendered;
  return site.options.includes(rendered) ? rendered : undefined;
}

// Build the plan. Exported so the fill decision can be asserted without an engine — the values written,
// the boxes left empty, the markers, and the failures are all decided here.
export function planFormFill(
  manifest: FieldManifest,
  context: MergeContext,
  dictionary?: readonly DictionaryEntry[],
): FormFillPlan {
  const entries: FormFillPlanEntry[] = [];
  const absences = new Map<string, AssemblyAbsence>();
  const missingRequired = new Set<string>();

  const recordAbsence = (
    key: string,
    rendered: AssemblyAbsence["rendered"],
    reason?: string,
  ): void => {
    // ONE ENTRY PER KEY, however many boxes it fills — the rule `assemble.ts` follows, so one key can
    // never be reported two ways. Where the sites disagree the entry states the MORE VISIBLE of them:
    // a key that shows a marker in one box and leaves a tick box unanswered has a marker on the page,
    // and that is what whoever proofreads the draft will see. A reason, once any site supplies one, is
    // kept — and resolution's own reason outranks anything derived here, because it knows things this
    // pass cannot (that the matter has three opposing parties, say).
    const existing = absences.get(key);
    absences.set(key, {
      key,
      rendered: existing?.rendered === "placeholder" ? "placeholder" : rendered,
      reason: context.absenceReasons.get(key) ?? existing?.reason ?? reason ?? null,
    });
  };

  for (const field of manifest.fields) {
    const entry = lookupDictionaryEntry(field.key, dictionary);
    const value = context.values.get(field.key);

    for (const site of field.formFields ?? []) {
      // A site the engine will not write into cannot have been recorded as a binding, but the manifest
      // is stored data and a stored manifest outlives the pass that wrote it. Skipping is correct and
      // silent: the field is already on `unboundFormFields`, where the registration put it.
      if (!isFillableFormFieldKind(site.kind)) continue;

      if (entry === undefined) {
        // The dictionary shrank under a template registered against a wider one — the firm archived the
        // field. It cannot have resolved, so it is an absence rather than a substitution.
        recordAbsence(field.key, site.kind === "text" ? "placeholder" : "blank");
        if (site.kind === "text") {
          entries.push({
            fieldName: site.fieldName,
            key: field.key,
            value: absenceMarkerFor(field.key),
            resolved: false,
          });
        }
        continue;
      }

      const rendered =
        value === undefined
          ? undefined
          : formatMergeValue(value, entry.defaultFormat, { timeZone: context.timeZone });

      // What this box would hold if the value resolved AND the form can express it. Undefined means one
      // of those two is false, which is the single branch the absence model answers.
      let writable: FormFillValue | undefined;
      // Why the form could not express a value it does have. Null for an ordinary missing value, where
      // the marker (or the untouched box) says everything there is to say.
      let expressionReason: string | undefined;

      if (value !== undefined) {
        if (site.kind === "checkbox") {
          writable = tickValueOf(value);
          if (writable === undefined) {
            expressionReason = `this is a tick box, and ${field.key} holds a ${value.kind} rather than a yes or no, so nothing was ticked.`;
          }
        } else if (rendered === undefined) {
          expressionReason = renderingAbsenceReason(value, entry.defaultFormat);
        } else if (site.kind === "choice" || site.kind === "radio") {
          writable = choiceValueOf(rendered, site);
          if (writable === undefined) {
            expressionReason = `this box only accepts one of ${site.options.length} set answer${site.options.length === 1 ? "" : "s"}, and the matter's value is not one of them, so it was left unanswered.`;
          }
        } else {
          writable = rendered;
        }
      }

      if (writable !== undefined) {
        entries.push({
          fieldName: site.fieldName,
          key: field.key,
          value: writable,
          resolved: true,
        });
        continue;
      }

      // THE ABSENCE MODEL, unchanged. `fail` stops the assembly naming the key; `blank` empties the box;
      // everything else prints the marker where the form can hold one.
      if (entry.absence === "fail") {
        missingRequired.add(field.key);
        continue;
      }
      if (entry.absence === "blank") {
        recordAbsence(field.key, "blank", expressionReason);
        if (site.kind === "text") {
          entries.push({ fieldName: site.fieldName, key: field.key, value: "", resolved: false });
        }
        if (site.kind === "checkbox") {
          entries.push({
            fieldName: site.fieldName,
            key: field.key,
            value: false,
            resolved: false,
          });
        }
        continue;
      }

      if (site.kind === "text") {
        recordAbsence(field.key, "placeholder", expressionReason);
        entries.push({
          fieldName: site.fieldName,
          key: field.key,
          value: absenceMarkerFor(field.key, entry.label),
          resolved: false,
        });
        continue;
      }

      // A TICK BOX, A RADIO GROUP, AND A DROP-DOWN HAVE NOWHERE TO PRINT A MARKER, so the visible-marker
      // bias cannot apply and the absence is carried in words instead: the box is left unanswered and
      // the reason says which box and why. Ticking one to signal "we do not know" would answer the
      // form's question wrongly, which is worse than leaving it for a person.
      recordAbsence(
        field.key,
        "blank",
        expressionReason ??
          `"${site.fieldName}" is a ${site.kind === "checkbox" ? "tick box" : "set-answer box"} the matter has no value for, so it was left unanswered.`,
      );
      if (site.kind === "checkbox") {
        entries.push({ fieldName: site.fieldName, key: field.key, value: false, resolved: false });
      }
    }
  }

  return {
    entries,
    absences: [...absences.values()].sort((left, right) => left.key.localeCompare(right.key)),
    missingRequiredKeys: [...missingRequired].sort(),
  };
}

// ---------------------------------------------------------------------------------------------
// The fill
// ---------------------------------------------------------------------------------------------

export async function fillFormTemplate(
  templateBytes: Uint8Array,
  context: MergeContext,
  manifest: FieldManifest,
  fill: FormFiller,
  options: FormFillOptions,
): Promise<FormFillResult> {
  const plan = planFormFill(manifest, context, options.dictionary);

  // A REQUIRED FIELD STOPS THE JOB BEFORE THE ENGINE RUNS. Producing the document and then discarding
  // it would decrypt values, write appearances, and burn the engine's budget for bytes nothing files.
  if (plan.missingRequiredKeys.length > 0) {
    return {
      ok: false,
      reason: "missing-required-field",
      detail: `this template requires ${plan.missingRequiredKeys.join(", ")}, which the matter does not supply`,
      keys: plan.missingRequiredKeys,
    };
  }

  const values = new Map<string, FormFillValue>();
  for (const entry of plan.entries) values.set(entry.fieldName, entry.value);

  const filled = await fill(templateBytes, values, options.finish);
  if (filled === undefined) {
    return {
      ok: false,
      reason: "unreadable-template",
      detail: "the stored form could not be filled in",
      keys: [],
    };
  }

  return {
    ok: true,
    bytes: filled,
    absences: plan.absences,
    substitutions: plan.entries.filter((entry) => entry.resolved).length,
    finish: options.finish,
  };
}
