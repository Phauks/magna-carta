import { describe, expect, it } from "vitest";
import { detectConfidentialitySignals } from "../src/confidentiality-detector.ts";

function signals(title: string, body: string): string[] {
  return detectConfidentialitySignals({ title, body }).findings.map((finding) => finding.signal);
}

describe("the format-only confidentiality detector", () => {
  it("hides a post carrying a case caption", () => {
    const verdict = detectConfidentialitySignals({
      title: "Trust reversal question",
      body: "On Henderson v. Whitmore the reversal posted to the wrong ledger.",
    });
    expect(verdict.shouldHide).toBe(true);
    expect(verdict.findings.map((finding) => finding.signal)).toContain("case_caption");
  });

  it("catches the English versus abbreviation too", () => {
    expect(signals("x", "Filed under Reynolds vs Carter last week.")).toContain("case_caption");
  });

  it("hides a post carrying a docket-shaped number", () => {
    expect(signals("Docket import", "The import dropped 1:24-cv-00123 entirely.")).toContain(
      "matter_or_docket_number",
    );
    expect(signals("Numbering", "Our scheme produces 2024-PR-01187 and it sorts wrong.")).toContain(
      "matter_or_docket_number",
    );
    expect(signals("Labelled", "Case No. 2024-1234 will not open.")).toContain(
      "matter_or_docket_number",
    );
  });

  it("does not read a version number or a statute section as a docket number", () => {
    expect(signals("Versions", "This broke in 3.52 and again in 3.53.")).not.toContain(
      "matter_or_docket_number",
    );
    expect(signals("Counts", "The report shows 148592 rows, which cannot be right.")).not.toContain(
      "matter_or_docket_number",
    );
  });

  it("hides a post carrying an email address, but not the platform's own capture address", () => {
    expect(signals("Contact", "Send it to marilyn.veitch@brackenlaw.com please.")).toContain(
      "email_address",
    );
    expect(
      signals("Capture", "Does forwarding to capture@in.magnacarta.esq keep the headers?"),
    ).not.toContain("email_address");
  });

  it("hides a post carrying a telephone number", () => {
    expect(signals("Call", "The client asked us to ring (775) 555-0142 first.")).toContain(
      "phone_number",
    );
    expect(signals("International", "Their London office is +44 20 7946 0958.")).toContain(
      "phone_number",
    );
  });

  it("hides a currency figure sitting beside a name, and lets an unattached figure through", () => {
    expect(signals("Ledger", "We disbursed $12,400.00 to Kowalczyk on Tuesday.")).toContain(
      "currency_beside_proper_noun",
    );
    expect(
      signals(
        "Invoice total column alignment",
        "The total column shows $1,234.00 right-aligned and it should not.",
      ),
    ).not.toContain("currency_beside_proper_noun");
  });

  it("errs toward hiding when a figure sits near a capitalised word it does not recognise", () => {
    // Stated as a test rather than left as a surprise: the detector reads shape and nothing else,
    // so a surname it has never seen and a product term it has never seen look identical to it.
    // The false positive costs a member a wait; the false negative it is avoiding is permanent.
    expect(signals("x", "We refunded $80.00 through Stripeling last week.")).toContain(
      "currency_beside_proper_noun",
    );
  });

  it("leaves an ordinary product question alone", () => {
    const verdict = detectConfidentialitySignals({
      title: "Bulk editing custom fields on closed matters",
      body:
        "Is there a way to change a picklist option on several hundred closed matters at once " +
        "without reopening each one? The bulk edit panel seems to skip anything closed.",
    });
    expect(verdict.shouldHide).toBe(false);
    expect(verdict.findings).toEqual([]);
  });

  it("reports where a finding is, and never what it matched", () => {
    const verdict = detectConfidentialitySignals({
      title: "x",
      body: "Contact hallam.pryce@example.org about it.",
    });
    const [finding] = verdict.findings;
    expect(finding).toBeDefined();
    expect(finding?.index).toBeTypeOf("number");
    // A finding travels into a moderation record and into telemetry. The matched text is the one
    // thing that must not be copied around, so there is no field for it.
    expect(Object.keys(finding ?? {}).sort()).toEqual(["index", "signal"]);
  });

  it("scans the title as well as the body, and treats them as one text", () => {
    expect(signals("Ferris v. Ashgrove billing", "How do contingency splits work?")).toContain(
      "case_caption",
    );
  });

  it("behaves identically whatever category it is told about", () => {
    const input = { title: "Ledger", body: "We disbursed $12,400.00 to Kowalczyk on Tuesday." };
    const withoutCategory = detectConfidentialitySignals(input);
    const withCategory = detectConfidentialitySignals({
      ...input,
      category: "accessibility",
    });
    // Every category on this board is a product area, so none of them is a safer place to relax the
    // detector. A per-category rule would put the loosest one somewhere a balance could land.
    expect(withCategory).toEqual(withoutCategory);
  });

  it("is pure — the same input gives the same verdict", () => {
    const input = { title: "Docket", body: "1:24-cv-00123 imported twice." };
    expect(detectConfidentialitySignals(input)).toEqual(detectConfidentialitySignals(input));
  });
});
