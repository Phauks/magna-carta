/*
 * The status register's rules, which are the part of it that can be wrong silently.
 *
 * A register is only worth having if the things it promises are actually true of it: that a word
 * has ONE tone wherever it appears, that no surface is handed a way to strike or dim a withdrawn
 * record, that the explanation is a hover rather than a printed sentence, and that the calm chip
 * register is the only one on offer. None of those survive review indefinitely; all of them survive
 * a test.
 */
import { describe, expect, it } from "vitest";
import {
  STATUS_REGISTER,
  STATUS_VOCABULARIES,
  statusBadgeAttributes,
  statusEntry,
  statusMarkClasses,
  statusRepeatsHeading,
  statusVocabulary,
  type StatusKey,
} from "../src/lib/status-register/index.ts";

const KEYS = Object.keys(STATUS_REGISTER) as StatusKey[];
const EM_DASH = "—";

describe("the register covers every vocabulary the product speaks", () => {
  it("carries the work-in-progress chain", () => {
    expect(STATUS_VOCABULARIES.workflowChain).toEqual([
      "draft",
      "submitted",
      "approved",
      "billed",
      "void",
    ]);
  });

  it("carries an invoice's derived standing", () => {
    expect(STATUS_VOCABULARIES.invoiceStanding).toEqual([
      "draft",
      "unpaid",
      "partially-paid",
      "paid",
      "void",
    ]);
  });

  it("carries a charge read off the invoice it rides", () => {
    expect(STATUS_VOCABULARIES.chargeStanding).toEqual(["finalized", "paid", "credited"]);
  });

  it("carries the file manager's safety value set, and nothing else in that cell", () => {
    expect(statusVocabulary("safety").map((entry) => entry.label)).toEqual([
      "Error",
      "Warning",
      "Info",
      "Not scanned",
      "Clean",
    ]);
  });

  it("every vocabulary reads out of the one register, never its own copy", () => {
    for (const keys of Object.values(STATUS_VOCABULARIES)) {
      for (const key of keys) {
        expect(KEYS).toContain(key);
      }
    }
  });
});

describe("one word, one tone, wherever it appears", () => {
  it("gives Draft the same entry in the chain and in an invoice's standing", () => {
    expect(statusEntry("draft")).toBe(STATUS_REGISTER.draft);
    expect(STATUS_VOCABULARIES.workflowChain).toContain("draft");
    expect(STATUS_VOCABULARIES.invoiceStanding).toContain("draft");
  });

  it("gives Paid the same entry on an invoice and on a charge riding it", () => {
    expect(STATUS_VOCABULARIES.invoiceStanding).toContain("paid");
    expect(STATUS_VOCABULARIES.chargeStanding).toContain("paid");
    expect(statusEntry("paid").tone).toBe("success");
  });

  it("has no duplicate label, which is what a second entry for one word would look like", () => {
    const labels = KEYS.map((key) => statusEntry(key).label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("the calm register is the only one on offer", () => {
  it("uses only the pale-tint status tones, never a solid action chip", () => {
    const solid = ["primary", "secondary", "destructive", "outline"];
    for (const key of KEYS) {
      expect(solid).not.toContain(statusEntry(key).tone);
    }
  });
});

describe("a withdrawn record renders through the chip alone", () => {
  it("gives Void an ordinary chip, with no treatment of its own", () => {
    expect(statusEntry("void").presentation).toBe("chip");
    expect(statusEntry("void").tone).toBe("danger");
  });

  it("hands a surface no field it could strike or dim a row with", () => {
    for (const key of KEYS) {
      expect(Object.keys(statusEntry(key)).toSorted()).toEqual([
        "label",
        "meaning",
        "presentation",
        "tone",
      ]);
    }
  });
});

describe("the meaning rides the hover", () => {
  it("gives every word a meaning", () => {
    for (const key of KEYS) {
      expect(statusEntry(key).meaning.length).toBeGreaterThan(0);
    }
  });

  it("puts the meaning on the badge's title, and the label nowhere near an attribute", () => {
    const attributes = statusBadgeAttributes("partially-paid");
    expect(attributes).toEqual({
      variant: "info",
      title: statusEntry("partially-paid").meaning,
    });
    expect(Object.keys(attributes)).not.toContain("label");
  });
});

describe("the clean verdict is a mark, not a chip", () => {
  it("is the one status in the register that does not wear a badge", () => {
    const marks = KEYS.filter((key) => statusEntry(key).presentation === "mark");
    expect(marks).toEqual(["clean"]);
  });

  it("names one recipe class, so the glyph is dressed in exactly one place", () => {
    expect(statusMarkClasses()).toBe("mc-status-mark");
  });
});

describe("a record names itself once", () => {
  it("drops the chip where it would repeat the heading", () => {
    expect(statusRepeatsHeading("draft", "Draft Bill")).toBe(true);
    expect(statusRepeatsHeading("partially-paid", "Partially Paid Invoice")).toBe(true);
  });

  it("keeps the chip in every state where it adds a fact", () => {
    expect(statusRepeatsHeading("unpaid", "Invoice 2026-114")).toBe(false);
    expect(statusRepeatsHeading("paid", "Invoice 2026-114")).toBe(false);
    expect(statusRepeatsHeading("draft", "Invoice 2026-114")).toBe(false);
  });
});

describe("the copy follows the standing rules", () => {
  it("uses no em dashes in any rendered string", () => {
    for (const key of KEYS) {
      const entry = statusEntry(key);
      expect(entry.label).not.toContain(EM_DASH);
      expect(entry.meaning).not.toContain(EM_DASH);
    }
  });
});
