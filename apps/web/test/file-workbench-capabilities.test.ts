/*
 * Fitness checks for the workbench's capability registry — the guarantees that make adding a
 * capability one module and one array entry, and the two rulings that must not be quietly undone.
 *
 * The first ruling is that a FLAGGED FILE STILL GETS EVERYTHING. A file somebody does not trust is
 * exactly what this workbench is for, and taking its readings away is what would leave them
 * guessing. Nothing here may consult the scan verdict, so the test proves that no capability's
 * behaviour changes with it.
 *
 * The second is that the OVERVIEW IS CONTRIBUTED, not hand-written: a capability added to the
 * registry has to appear in the summary without the Overview being edited.
 */
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@magna-carta/access-control/registry";
import { statusEntry } from "@magna-carta/design-system/status-register";
import {
  CAPABILITIES,
  ARRIVAL_CAPABILITIES,
  capabilityById,
  permittedCapabilities,
  summaryRowsFor,
} from "../src/lib/tools/file-workbench/capabilities.ts";
import { overviewCapability } from "../src/lib/tools/file-workbench/overview.ts";
import { APPLIES, type CapabilityModule } from "../src/lib/tools/file-workbench/capability.ts";
import { identifyFromPrefix } from "../src/lib/tools/file-workbench/identify.ts";
import {
  FILE_TYPE_CAPABILITY,
  MALWARE_SCAN_CAPABILITY,
  scanVerdictOf,
  type ScanVerdict,
  type WorkbenchFile,
} from "../src/lib/tools/file-workbench/workbench-file.ts";

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

function fileNamed(name: string, prefix: Uint8Array, verdict?: ScanVerdict): WorkbenchFile {
  return {
    id: `test-${name}`,
    name,
    sizeBytes: prefix.byteLength,
    declaredMediaType: "",
    receivedAt: new Date("2026-08-31T12:00:00Z"),
    preview: { kind: "none", reason: "a fixture draws nothing" },
    outcomes: {
      [FILE_TYPE_CAPABILITY]: {
        kind: "result",
        value: identifyFromPrefix(prefix, name),
      },
      ...(verdict === undefined
        ? {}
        : { [MALWARE_SCAN_CAPABILITY]: { kind: "result" as const, value: { verdict } } }),
    },
  };
}

const PDF = fileNamed("Deposition.pdf", ascii("%PDF-1.7\n"));
const IMAGE = fileNamed(
  "scan_0184.png",
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
);
const EMAIL = fileNamed("Re Deadline.eml", ascii("Return-Path: <a@example.test>\r\n"));

describe("the registry itself", () => {
  it("gives every capability a unique id", () => {
    const ids = CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gates every capability on a permission the access-control registry declares", () => {
    for (const capability of [overviewCapability, ...CAPABILITIES]) {
      expect(PERMISSIONS, `${capability.id} is gated on an unregistered permission`).toContain(
        capability.permission,
      );
    }
  });

  it("makes a capability with no panel of its own name what it waits on", () => {
    for (const capability of CAPABILITIES.filter((entry) => entry.panel === undefined)) {
      expect(capability.awaiting, `${capability.id} renders the pending treatment`).toBeTruthy();
      expect(
        capability.pendingAction.length,
        `${capability.id} needs its control's words`,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps the Overview out of the registry, so its panel can read it", () => {
    expect(CAPABILITIES.map((capability) => capability.id)).not.toContain(overviewCapability.id);
  });

  it("finds a capability by the id the address carries, and nothing else", () => {
    expect(capabilityById("convert")?.label).toBe("Convert");
    expect(capabilityById("not-a-capability")).toBeNull();
    expect(capabilityById(null)).toBeNull();
  });

  it("runs nothing on arrival that writes a file, costs money, or discloses content", () => {
    for (const capability of ARRIVAL_CAPABILITIES) {
      expect(capability.scope, `${capability.id} runs unasked, so it acts on one file`).toBe(
        "single",
      );
    }
    // Conversion, repair, recognition, unlocking and AI text all wait to be asked.
    expect(ARRIVAL_CAPABILITIES.map((capability) => capability.id)).not.toContain("ai-text");
    expect(ARRIVAL_CAPABILITIES.map((capability) => capability.id)).not.toContain("convert");
  });

  it("acts on the whole selection for conversion, which is why bulk works", () => {
    expect(capabilityById("convert")?.scope).toBe("selection");
  });
});

describe("a flagged file still gets the full treatment", () => {
  const verdicts: ScanVerdict[] = ["clean", "flagged", "unscanned"];

  it("gives the same answer for every capability whatever the scan concluded", () => {
    for (const capability of CAPABILITIES) {
      const answers = verdicts.map((verdict) =>
        JSON.stringify(
          capability.applies(fileNamed("Deposition.pdf", ascii("%PDF-1.7\n"), verdict)),
        ),
      );
      expect(
        new Set(answers).size,
        `${capability.id} changes behaviour with the scan verdict`,
      ).toBe(1);
    }
  });

  it("summarizes a flagged file as fully as a clean one", () => {
    const flagged = fileNamed("Deposition.pdf", ascii("%PDF-1.7\n"), "flagged");
    const clean = fileNamed("Deposition.pdf", ascii("%PDF-1.7\n"), "clean");
    expect(scanVerdictOf(flagged)).toBe("flagged");
    expect(summaryRowsFor(flagged).length).toBe(summaryRowsFor(clean).length);
  });

  it("still reports the verdict, which is a fact about the file rather than a gate", () => {
    const flagged = fileNamed("Deposition.pdf", ascii("%PDF-1.7\n"), "flagged");
    const safety = summaryRowsFor(flagged).find((row) => row.label === "Safety");
    // Read from the register rather than spelled out here: the word and the tone a flagged file
    // wears are the design system's to decide, and a copy of them in a test is a second register.
    const expected = statusEntry("error");
    expect(safety?.value).toBe(expected.label);
    expect(safety?.tone).toBe(expected.tone);
  });
});

describe("the Overview is contributed by the capabilities, not written by hand", () => {
  it("picks up a capability that was never mentioned in the Overview", () => {
    const invented: CapabilityModule = {
      id: "invented",
      label: "Invented",
      icon: overviewCapability.icon,
      permission: overviewCapability.permission,
      stage: "soon",
      timing: "on-arrival",
      scope: "single",
      description: "A capability the Overview has never heard of.",
      awaiting: "nothing real",
      applies: () => APPLIES,
      summary: () => ({ label: "Invented", value: "and summarized" }),
      pendingAction: "Invent Something",
    };
    const rows = summaryRowsFor(PDF, [...CAPABILITIES, invented]);
    expect(rows.map((row) => row.label)).toContain("Invented");
  });

  it("leaves out a capability that has nothing to do with this file", () => {
    // Email applies only to a message, so a PDF's summary must not carry an empty email row.
    expect(summaryRowsFor(PDF).map((row) => row.label)).not.toContain("Email");
  });

  it("contributes no row rather than an empty one where a capability knows nothing yet", () => {
    for (const row of summaryRowsFor(IMAGE)) {
      expect(row.value.length, `${row.label} contributed a blank value`).toBeGreaterThan(0);
    }
  });
});

describe("what applies to which file", () => {
  it("offers text recognition on a scan and not on a message", () => {
    expect(capabilityById("text-recognition")?.applies(IMAGE).applies).toBe(true);
    expect(capabilityById("text-recognition")?.applies(EMAIL).applies).toBe(false);
  });

  it("sends an image to text recognition before AI text, rather than silently chaining them", () => {
    const answer = capabilityById("ai-text")?.applies(IMAGE);
    expect(answer?.applies).toBe(false);
    expect(answer?.applies === false && answer.reason).toContain("Text Recognition");
  });

  it("offers unlocking only where a password could be in the way", () => {
    expect(capabilityById("unlock")?.applies(PDF).applies).toBe(true);
    expect(capabilityById("unlock")?.applies(IMAGE).applies).toBe(false);
  });

  it("offers repair on anything, because damage is what a person arrives unsure about", () => {
    for (const file of [PDF, IMAGE, EMAIL]) {
      expect(capabilityById("repair")?.applies(file).applies).toBe(true);
    }
  });
});

describe("permissions hide in place", () => {
  it("drops what the member does not hold and reorders nothing", () => {
    const held = new Set(
      CAPABILITIES.filter((capability) => capability.id !== "unlock").map(
        (capability) => capability.permission,
      ),
    );
    const visible = permittedCapabilities(held).map((capability) => capability.id);
    expect(visible).not.toContain("unlock");
    expect(visible).toEqual(
      CAPABILITIES.filter((capability) => capability.id !== "unlock").map(
        (capability) => capability.id,
      ),
    );
  });
});
