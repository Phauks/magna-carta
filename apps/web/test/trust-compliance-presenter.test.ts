/*
 * The pack's presenter arranges and formats; it never computes. Over the sample pack: every ledger
 * entry and every journal entry reaches a row, the balances printed are the pack's own, the stamp is
 * the response's sentence, and the presentation renders through the export document's renderers.
 */
import { describe, expect, it } from "vitest";
import { renderCsvExport } from "$lib/export/render-csv.ts";
import { renderTextExport } from "$lib/export/render-text.ts";
import { exportCellText } from "$lib/export/tabular-export.ts";
import { reportExportDocument, type ReportCell } from "$lib/reports/report-presentation.ts";
import {
  SAMPLE_MATTER_ONE_ID,
  sampleTrustCompliancePack,
} from "$lib/reports/trust-compliance-fixture.ts";
import {
  IDENTITY_CAPTIONS,
  presentTrustCompliancePack,
} from "$lib/reports/trust-compliance-presenter.ts";

const pack = sampleTrustCompliancePack();
const presentation = presentTrustCompliancePack(pack, IDENTITY_CAPTIONS);
const section = (id: string) => {
  const found = presentation.sections.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no section ${id}`);
  return found;
};
const rowText = (row: readonly ReportCell[]) => row.map(exportCellText);

describe("the trust-compliance presenter", () => {
  it("titles the report and carries the response's own stamp", () => {
    expect(presentation.title).toBe("Trust Compliance Report");
    expect(presentation.subtitle).toBe(pack.cover.trustAccountName);
    expect(presentation.stamp).toBe(pack.cover.reproducibilityStatement);
    expect(presentation.reproducible).toBe(true);
    expect(presentation.completeness).toEqual({ scope: "complete" });
  });

  it("puts every ledger entry on a row, between the balances the pack carried", () => {
    const ledgers = section("client-ledgers");
    const entryCount = pack.clientLedgers
      .flatMap((client) => client.matters)
      .reduce((sum, matter) => sum + matter.entries.length, 0);
    const matterCount = pack.clientLedgers.flatMap((client) => client.matters).length;
    // One row per entry, plus a brought-forward and a carried-forward row per matter ledger.
    expect(ledgers.rows).toHaveLength(entryCount + matterCount * 2);
    const first = rowText(ledgers.rows[0]!);
    expect(first[1]).toBe(SAMPLE_MATTER_ONE_ID);
    expect(first[3]).toBe("Balance brought forward");
    expect(first[7]).toBe("$5,000.00");
    const matterOne = pack.clientLedgers[0]!.matters[0]!;
    const carried = rowText(ledgers.rows[matterOne.entries.length + 1]!);
    expect(carried[3]).toBe("Balance carried forward");
    expect(carried[7]).toBe("$9,500.00");
    // A running balance is printed as served, never recomputed here.
    const secondEntry = ledgers.rows[2]!;
    expect(exportCellText(secondEntry[7]!)).toBe("$9,500.00");
    expect(secondEntry[7]).toEqual({ text: "$9,500.00", number: 9500 });
  });

  it("keys the journal on the ledger entry with the pack's own running bank balance", () => {
    const journal = section("journal");
    expect(journal.rows).toHaveLength(pack.journal.entries.length + 2);
    expect(rowText(journal.rows[0]!)[7]).toBe("$5,000.00");
    expect(rowText(journal.rows[journal.rows.length - 1]!)[7]).toBe("$12,500.00");
    const disbursement = rowText(journal.rows[2]!);
    expect(disbursement[2]).toBe("Disbursement");
    expect(disbursement[6]).toBe("-$3,000.00");
    expect(disbursement[8]).toBe(pack.journal.entries[1]!.authorizedBy);
  });

  it("prints the attestation and the live proof side by side, and names no difference where there is none", () => {
    const reconciliations = section("reconciliations");
    expect(reconciliations.rows).toHaveLength(1);
    const row = rowText(reconciliations.rows[0]!);
    expect(row[2]).toBe("Closed");
    expect(row[5]).toBe("$12,500.00");
    expect(row[10]).toBe("$12,500.00");
    expect(row[9]).toBe("Yes");
    expect(row[15]).toBe("");
    expect(reconciliations.note).toBe(pack.proofAtProductionNote);
  });

  it("omits the cushion section on an account without the carve-out", () => {
    expect(presentation.sections.some((candidate) => candidate.id === "cushion")).toBe(false);
  });

  it("labels the at-production blocks as unbounded by the knowledge instant", () => {
    for (const id of ["outstanding-items", "unmatched-lines", "stored-balance-checks"]) {
      expect(section(id).note).toContain("not bounded by the knowledge instant");
    }
    expect(section("holds").rows).toHaveLength(1);
  });

  it("names the matter and the member through the caption port", () => {
    const captioned = presentTrustCompliancePack(pack, {
      matter: (id) => `Matter ${id}`,
      client: (id) => `Client ${id}`,
      member: (id) => `Member ${id}`,
    });
    const ledgers = captioned.sections.find((candidate) => candidate.id === "client-ledgers")!;
    expect(rowText(ledgers.rows[0]!)[0]).toMatch(/^Client /);
    expect(rowText(ledgers.rows[0]!)[1]).toBe(`Matter ${SAMPLE_MATTER_ONE_ID}`);
  });

  it("renders through the export document's own renderers", () => {
    const exportDocument = reportExportDocument(presentation, new Date("2026-08-01T12:00:00Z"));
    expect(exportDocument.title).toBe(`Trust Compliance Report - ${pack.cover.trustAccountName}`);
    expect(exportDocument.sections.map((candidate) => candidate.title)).toEqual(
      presentation.sections.map((candidate) => candidate.title),
    );
    const text = renderTextExport(exportDocument);
    // The text renderer sets section titles in capitals.
    expect(text).toContain("RECEIPTS AND DISBURSEMENTS JOURNAL");
    expect(text).toContain(pack.cover.reproducibilityStatement.slice(0, 40));
    const csv = renderCsvExport(exportDocument);
    expect(csv).toContain("Balance carried forward");
  });
});
