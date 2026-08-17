import { beforeAll, describe, expect, it } from "vitest";
import { absenceMarkerFor } from "../src/assemble.ts";
import type { DictionaryEntry } from "../src/dictionary.ts";
import { fillFormTemplate, planFormFill } from "../src/fill-form.ts";
import { prepareFormTemplateVersion } from "../src/pdf-form.ts";
import type { FieldManifest, MergeContext } from "../src/types.ts";
import {
  contextOf,
  engineFiller,
  engineReader,
  engineScrub,
  entry,
  filledValues,
  hasInteractiveForm,
  intakeFormBytes,
  startEngine,
  text,
  yesNo,
} from "./support/form-fixture.ts";

// Filling a registered form template. Two halves, deliberately separated:
//
//   `planFormFill` decides, with no engine involved at all — which box gets which value, which absence
//   shows a marker, which one leaves a box empty, and which one fails the assembly. That is the half
//   where correctness lives, and it is asserted directly rather than inferred from a PDF.
//
//   `fillFormTemplate` hands the plan to the real engine, and the assertions there are about the OUTPUT
//   BYTES: the values are in the document, and the finish is what was asked for.

const DICTIONARY: readonly DictionaryEntry[] = [
  // Required on the pleading caption: an assembly that cannot name the client fails rather than files.
  entry("client.displayName", "text", "fail"),
  entry("matter.number", "text", "placeholder"),
  // An optional detail: a blank is right, and a marker in its place would be noise on every letter.
  entry("client.middleName", "text", "blank"),
  entry("client.county", "text", "placeholder"),
  entry("client.feeWaiver", "boolean", "placeholder", "yesNo"),
];

const MAPPINGS = [
  { fieldName: "Client_Name", mergeKey: "client.displayName" },
  { fieldName: "Client_Name_Verification", mergeKey: "client.displayName" },
  { fieldName: "matter.number", mergeKey: "matter.number" },
  { fieldName: "Petitioner_Address", mergeKey: "client.middleName" },
  { fieldName: "Filing_County", mergeKey: "client.county" },
  { fieldName: "Fee_Waiver_Requested", mergeKey: "client.feeWaiver" },
];

let templateBytes: Uint8Array;
let manifest: FieldManifest;

async function fill(context: MergeContext, finish: "interactive" | "flattened" = "interactive") {
  return fillFormTemplate(templateBytes, context, manifest, engineFiller, {
    dictionary: DICTIONARY,
    finish,
  });
}

function plan(context: MergeContext) {
  return planFormFill(manifest, context, DICTIONARY);
}

const WHOLE_MATTER = (): MergeContext =>
  contextOf({
    "client.displayName": text("Rowan Ashcroft"),
    "matter.number": text("2026-0042"),
    "client.middleName": text("Iris"),
    "client.county": text("Washoe"),
    "client.feeWaiver": yesNo(true),
  });

describe("filling a form template", () => {
  beforeAll(async () => {
    await startEngine();
    const prepared = await prepareFormTemplateVersion(
      intakeFormBytes(),
      engineReader,
      engineScrub,
      { dictionary: DICTIONARY, confirmMappings: MAPPINGS },
    );
    if (!prepared.ok) throw new Error(`fixture would not register: ${prepared.detail}`);
    templateBytes = prepared.preparation.bytes;
    manifest = prepared.preparation.manifest;
  });

  it("writes every resolved value into the box it was confirmed against", async () => {
    const result = await fill(WHOLE_MATTER());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const values = await filledValues(result.bytes);
    expect(values.get("Client_Name")).toBe("Rowan Ashcroft");
    // Two boxes, one merge field: the caption and the verification page both fill in.
    expect(values.get("Client_Name_Verification")).toBe("Rowan Ashcroft");
    expect(values.get("matter.number")).toBe("2026-0042");
    expect(values.get("Petitioner_Address")).toBe("Iris");
    expect(values.get("Filing_County")).toBe("Washoe");
    expect(values.get("Fee_Waiver_Requested")).toBe(true);
    expect(result.absences).toEqual([]);
    expect(result.substitutions).toBe(6);
  });

  it("leaves the boxes nobody bound untouched", async () => {
    const result = await fill(WHOLE_MATTER());
    if (!result.ok) throw new Error(result.detail);
    const values = await filledValues(result.bytes);
    // `Previously_Entered` was cleared by the scrub and is bound to nothing, so it stays empty rather
    // than acquiring a value from a neighbouring field.
    expect(values.get("Previously_Entered") ?? null).toBeNull();
    expect(values.get("Unstated_Box") ?? null).toBeNull();
  });

  it("prints the same visible marker a Word template would, in the box", async () => {
    const context = contextOf({ "client.displayName": text("Rowan Ashcroft") });
    const result = await fill(context);
    if (!result.ok) throw new Error(result.detail);
    const values = await filledValues(result.bytes);
    expect(values.get("matter.number")).toBe(absenceMarkerFor("matter.number", "matter.number"));
    expect(result.absences.map((absence) => absence.key)).toContain("matter.number");
    expect(result.absences.find((absence) => absence.key === "matter.number")?.rendered).toBe(
      "placeholder",
    );
  });

  it("empties a box whose merge field declares a blank, and records the absence anyway", () => {
    const outcome = plan(contextOf({ "client.displayName": text("Rowan Ashcroft") }));
    const address = outcome.entries.find((item) => item.fieldName === "Petitioner_Address");
    expect(address?.value).toBe("");
    expect(address?.resolved).toBe(false);
    expect(outcome.absences.find((absence) => absence.key === "client.middleName")?.rendered).toBe(
      "blank",
    );
  });

  it("FAILS the assembly when a merge field declaring `fail` cannot be resolved", async () => {
    const result = await fill(contextOf({ "matter.number": text("2026-0042") }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-required-field");
    expect(result.keys).toEqual(["client.displayName"]);
  });

  it("leaves a tick box unticked, with a reason, rather than guessing at a non-boolean value", () => {
    const outcome = plan(
      contextOf({
        "client.displayName": text("Rowan Ashcroft"),
        // A text value bound to a tick box. Ticking it because the string is non-empty is precisely the
        // silently-wrong document the absence model exists to prevent.
        "client.feeWaiver": text("no"),
      }),
    );
    const box = outcome.entries.find((item) => item.fieldName === "Fee_Waiver_Requested");
    expect(box?.value).toBe(false);
    expect(box?.resolved).toBe(false);
    const absence = outcome.absences.find((item) => item.key === "client.feeWaiver");
    expect(absence?.rendered).toBe("blank");
    expect(absence?.reason).toMatch(/tick box/);
  });

  it("refuses a drop-down answer the form will not accept, rather than writing an invisible one", () => {
    const outcome = plan(
      contextOf({
        "client.displayName": text("Rowan Ashcroft"),
        // The fixture's county box accepts Clark, Washoe, or Elko. Writing "Lyon" would set a state the
        // form has no appearance for: an empty-looking box that carries an answer.
        "client.county": text("Lyon"),
      }),
    );
    expect(outcome.entries.some((item) => item.fieldName === "Filing_County")).toBe(false);
    const absence = outcome.absences.find((item) => item.key === "client.county");
    expect(absence?.reason).toMatch(/set answer/);
  });

  it("reports one absence per key, stating the more visible of two disagreeing boxes", () => {
    // `client.displayName` fills two text boxes, so both agree. The case worth pinning is a key whose
    // sites disagree: whichever order the manifest lists them in, an entry that shows a marker on the
    // page must not be reported as a silent blank because a tick box was visited second.
    const outcome = planFormFill(
      {
        ...manifest,
        fields: [
          {
            key: "client.county",
            format: null,
            occurrences: 2,
            parts: ["page 1", "page 2"],
            forms: ["acroForm"],
            formFields: [
              // A text box first, then a tick box — the marker has to survive the second visit.
              {
                fieldName: "Client_Name",
                kind: "text",
                page: 0,
                required: false,
                options: [],
              },
              {
                fieldName: "Fee_Waiver_Requested",
                kind: "checkbox",
                page: 0,
                required: false,
                options: [],
              },
            ],
          },
        ],
      },
      contextOf({}),
      DICTIONARY,
    );
    expect(outcome.absences).toHaveLength(1);
    expect(outcome.absences[0]?.key).toBe("client.county");
    expect(outcome.absences[0]?.rendered).toBe("placeholder");
    // And the reason the tick box supplied is kept rather than discarded with its entry.
    expect(outcome.absences[0]?.reason).toMatch(/tick box/);
  });

  it("carries resolution's own absence reason through unchanged", () => {
    const context: MergeContext = {
      ...contextOf({ "client.displayName": text("Rowan Ashcroft") }),
      absenceReasons: new Map([["matter.number", "this matter has not been numbered yet."]]),
    };
    const outcome = plan(context);
    expect(outcome.absences.find((item) => item.key === "matter.number")?.reason).toBe(
      "this matter has not been numbered yet.",
    );
  });

  it("files an interactive form by default, and a flattened one only when asked", async () => {
    const interactive = await fill(WHOLE_MATTER(), "interactive");
    if (!interactive.ok) throw new Error(interactive.detail);
    expect(interactive.finish).toBe("interactive");
    // The boxes are still there, so a recipient can correct a typo or complete what the firm left them.
    expect(await hasInteractiveForm(interactive.bytes)).toBe(true);

    const flattened = await fill(WHOLE_MATTER(), "flattened");
    if (!flattened.ok) throw new Error(flattened.detail);
    expect(flattened.finish).toBe("flattened");
    expect(await hasInteractiveForm(flattened.bytes)).toBe(false);
  });

  it("reports the engine's refusal rather than filing something", async () => {
    const result = await fillFormTemplate(
      templateBytes,
      WHOLE_MATTER(),
      manifest,
      async () => undefined,
      { dictionary: DICTIONARY, finish: "interactive" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unreadable-template");
  });

  it("does not call the engine at all when a required field is missing", async () => {
    let called = false;
    const result = await fillFormTemplate(
      templateBytes,
      contextOf({}),
      manifest,
      async (bytes) => {
        called = true;
        return bytes;
      },
      { dictionary: DICTIONARY, finish: "interactive" },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
