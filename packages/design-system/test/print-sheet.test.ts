/*
 * The printed sheet's two guarantees, asserted rather than promised.
 *
 * ONE: the firm's internal text never reaches a client. The sheet is fed by a projection that
 * removes it and by a field selector that cannot name it, so this suite proves the removal is real
 * (the key is gone from the object, not merely blanked), that the selector refuses the key even
 * when untyped code forces it through, and that the memo text is nowhere in what the paper says,
 * before AND after somebody rewrites the memo. The compile-time half of the guarantee is asserted
 * by the `@ts-expect-error` lines: they fail the typecheck if a record still carrying internal text
 * ever becomes assignable to a sheet.
 *
 * TWO: the sheet shows a page and nothing of its own. Everything on the paper arrives as data, so
 * the component takes no snippet, no raw HTML and no caller-supplied formatter — there is no other
 * route by which excluded text could arrive, and no way for the sheet to reach the surface it
 * layers over. Those are properties of the source, so they are checked at the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INTERNAL_ONLY_FIELD_KEYS,
  clientFacingRecord,
  printSheetFields,
  type ClientFacingRecord,
  type PrintSheetFieldSpecification,
} from "../src/lib/components/print-sheet/client-facing-projection.ts";
import {
  PRINT_SHEET_EMPTY_HISTORY_TEXT,
  printSheetTextContent,
} from "../src/lib/components/print-sheet/print-sheet-text.ts";
import type {
  PrintSheetDocument,
  PrintSheetField,
} from "../src/lib/components/print-sheet/types.ts";

const COMPONENT_SOURCE_PATH = join(
  import.meta.dirname,
  "../src/lib/components/print-sheet/print-sheet.svelte",
);

/** A charge as a consumer holds one: client-facing text, internal text, and the figures. */
interface RecordedCharge {
  date: string;
  description: string;
  hours: string;
  hoursClockForm: string;
  amount: string;
  internalMemo: string;
}

type ChargeProjection = ClientFacingRecord<RecordedCharge>;

const CHARGE: RecordedCharge = {
  date: "3 August 2026",
  description: "Drafted the motion to compel and conferred with opposing counsel.",
  hours: "2.50",
  hoursClockForm: "2:30",
  amount: "$875.00",
  internalMemo: "Client disputes every invoice. Bill this one to the letter.",
};

const CHARGE_FIELDS: PrintSheetFieldSpecification<ChargeProjection>[] = [
  { key: "date", label: "Date" },
  { key: "hours", label: "Hours", secondaryKey: "hoursClockForm" },
  { key: "amount", label: "Amount" },
];

function sheetFor(charge: RecordedCharge): PrintSheetDocument {
  const projection = clientFacingRecord(charge);
  return {
    heading: "Time Entry",
    reference: "2026-0147.0042",
    subtitle: "Acme Holdings, commercial lease",
    sections: [
      {
        id: "facts",
        kind: "fields",
        title: "Details",
        fields: printSheetFields(projection, CHARGE_FIELDS),
      },
      { id: "description", kind: "text", title: "Description", text: projection.description },
      {
        id: "history",
        kind: "history",
        title: "History",
        events: [
          {
            id: "entered",
            action: "Entered as a draft",
            at: "2026-08-03T16:20:00.000Z",
            source: "Dana Okoye",
          },
        ],
      },
    ],
    footer: "Printed from Magna Carta.",
  };
}

/** The selector as untyped code reaches it: no key type, nothing stopping the caller asking. */
const selectFieldsUntyped = printSheetFields as unknown as (
  record: object,
  specifications: readonly { key: string; label: string; secondaryKey?: string }[],
) => PrintSheetField[];

function specifyChargeField(
  specification: PrintSheetFieldSpecification<RecordedCharge>,
): PrintSheetFieldSpecification<RecordedCharge> {
  return specification;
}

describe("the internal memo cannot reach a client-facing sheet", () => {
  it("names the fields that exist for the firm alone", () => {
    expect([...INTERNAL_ONLY_FIELD_KEYS]).toEqual(["internalMemo", "memo"]);
  });

  it("removes the key entirely rather than blanking it", () => {
    const projection = clientFacingRecord(CHARGE);
    expect(Object.hasOwn(projection, "internalMemo")).toBe(false);
    expect(Object.keys(projection)).not.toContain("internalMemo");
    // Everything else survives untouched: the projection removes, it does not rewrite.
    expect(projection.description).toBe(CHARGE.description);
    expect(projection.amount).toBe(CHARGE.amount);
  });

  it("removes every internal-only key, under either of its names", () => {
    const projection = clientFacingRecord({
      memo: "internal",
      internalMemo: "also internal",
      amount: "$1.00",
    });
    expect(Object.keys(projection)).toEqual(["amount"]);
  });

  it("refuses to select an internal-only field even when untyped code asks by name", () => {
    // The record here still carries its memo; the point is that even so, and even asked for it by
    // name, the selector states only the amount.
    const fields = selectFieldsUntyped(CHARGE, [
      { key: "internalMemo", label: "Memo" },
      { key: "memo", label: "Memo" },
      { key: "amount", label: "Amount" },
    ]);
    expect(fields).toEqual([{ label: "Amount", value: "$875.00" }]);
  });

  it("refuses an internal-only key in the secondary position too", () => {
    const fields = selectFieldsUntyped(CHARGE, [
      { key: "hours", label: "Hours", secondaryKey: "internalMemo" },
    ]);
    expect(fields).toEqual([{ label: "Hours", value: "2.50" }]);
  });

  it("does not compile when a record still carrying internal text is handed to a sheet", () => {
    // These must stay type errors. If one ever compiles, the guarantee is gone and the typecheck
    // fails here rather than a client reading the firm's notes about them.
    // @ts-expect-error the record still carries internalMemo, so it is not a client-facing record
    printSheetFields(CHARGE, []);
    // @ts-expect-error the same, under the other name for internal text
    printSheetFields({ memo: "internal", amount: "$1.00" }, []);
    // @ts-expect-error the memo is not a printable key, so no field selection may name it
    specifyChargeField({ key: "internalMemo", label: "Memo" });
    expect(printSheetFields(clientFacingRecord(CHARGE), CHARGE_FIELDS)).toHaveLength(3);
  });

  it("says nothing of the memo on the paper, before or after it is rewritten", () => {
    const said = printSheetTextContent(sheetFor(CHARGE)).join("\n");
    expect(said).not.toContain(CHARGE.internalMemo);
    expect(said).not.toContain("Memo");
    // What the sheet says is unchanged by the memo, so a rewrite cannot leak through a difference
    // either: the same paper, word for word.
    const rewritten: RecordedCharge = {
      ...CHARGE,
      internalMemo: "Second thoughts: the partner wants this written off.",
    };
    const saidAfter = printSheetTextContent(sheetFor(rewritten)).join("\n");
    expect(saidAfter).not.toContain(rewritten.internalMemo);
    expect(saidAfter).toBe(said);
  });
});

describe("the sheet renders data and nothing else", () => {
  const source = readFileSync(COMPONENT_SOURCE_PATH, "utf8");

  it("takes no snippet, so no caller can put markup on the paper", () => {
    expect(source).not.toContain("Snippet");
    expect(source).not.toContain("{@render");
  });

  it("renders no raw HTML", () => {
    expect(source).not.toContain("{@html");
  });

  it("formats its own instants, so no caller-supplied formatter can write on the paper", () => {
    expect(source).toContain("eventInstantText");
    expect(source).not.toContain("formatInstant");
  });
});

describe("the sheet layers above what opened it", () => {
  const source = readFileSync(COMPONENT_SOURCE_PATH, "utf8");

  it("composes the design system's dialog rather than a scrim of its own", () => {
    expect(source).toContain('from "../dialog/index.ts"');
    expect(source).toContain("<Dialog.Root");
    expect(source).not.toContain("position: fixed");
  });

  it("owns exactly one piece of state, its own open flag", () => {
    expect([...source.matchAll(/\$bindable\(/g)]).toHaveLength(1);
    expect(source).toContain("open = $bindable(false)");
  });

  it("is given no way to reach the surface underneath it", () => {
    // Nothing addresses another surface from here, and there is no callback through which a caller
    // could have the sheet close one, so the record window it opens over cannot be replaced by it.
    expect(source).not.toContain("record-window");
    expect(source).not.toContain("onClose");
    expect(source).not.toContain("onOpenChange");
  });
});

describe("what a sheet says", () => {
  it("states every fact once, in reading order", () => {
    expect(printSheetTextContent(sheetFor(CHARGE))).toEqual([
      "Time Entry",
      "2026-0147.0042",
      "Acme Holdings, commercial lease",
      "Details",
      "Date",
      "3 August 2026",
      "Hours",
      "2.50",
      "2:30",
      "Amount",
      "$875.00",
      "Description",
      CHARGE.description,
      "History",
      "Entered as a draft",
      expect.stringContaining("2026"),
      "Dana Okoye",
      "Printed from Magna Carta.",
    ]);
  });

  it("omits a fact that was never recorded rather than printing a labelled blank", () => {
    const projection = clientFacingRecord({ ...CHARGE, amount: "   " });
    expect(printSheetFields(projection, CHARGE_FIELDS).map((field) => field.label)).toEqual([
      "Date",
      "Hours",
    ]);
  });

  it("states a history with nothing in it honestly", () => {
    const sheet: PrintSheetDocument = {
      heading: "Time Entry",
      sections: [{ id: "history", kind: "history", title: "History", events: [] }],
    };
    expect(printSheetTextContent(sheet)).toEqual([
      "Time Entry",
      "History",
      PRINT_SHEET_EMPTY_HISTORY_TEXT,
    ]);
  });
});
