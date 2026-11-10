import { civilDateParts, isCivilDate } from "@magna-carta/civil-time/civil-date";
import { findCaliforniaCode } from "./california-codes.ts";
import { hasDifference, UNIFORM_FORMAT, type CitationFormat } from "./formats.ts";
import { abbreviateCaseName, findReporter, shortCaseName } from "./reporters.ts";
import type {
  CitationFieldName,
  CitationFields,
  CitationForm,
  CitationKind,
  CitationNotice,
  CitationRun,
  FormattedCitation,
} from "./types.ts";

/*
 * Formats a citation in a format and a form. Every rule applied is reported by number — Indigo Book
 * rule and table numbers for the uniform system, the court rule for a court's difference — so the
 * result can be checked rather than trusted. Missing required fields are reported, never invented:
 * the citation renders without them and `missing` says what to add.
 */
export function formatCitation(
  kind: CitationKind,
  fields: CitationFields,
  format: CitationFormat,
  form: CitationForm,
): FormattedCitation {
  const citation = new CitationBuilder(fields);
  if (format.base === "california") formatCalifornia(citation, kind, form);
  else formatUniform(citation, kind, form, format);
  return citation.finish();
}

class CitationBuilder {
  readonly runs: CitationRun[] = [];
  readonly rules = new Set<string>();
  readonly missing = new Set<CitationFieldName>();
  readonly notices: CitationNotice[] = [];

  constructor(readonly fields: CitationFields) {}

  /** A field's value, recording it as missing when a required field is absent. */
  need(name: CitationFieldName): string {
    const value = this.fields[name];
    if (value === undefined || value === "") {
      this.missing.add(name);
      return `[${name}]`;
    }
    return value;
  }

  has(name: CitationFieldName): boolean {
    const value = this.fields[name];
    return value !== undefined && value !== "";
  }

  text(text: string): this {
    return this.push(text, false);
  }

  italic(text: string): this {
    return this.push(text, true);
  }

  rule(...rules: string[]): this {
    for (const rule of rules) this.rules.add(rule);
    return this;
  }

  private push(text: string, italic: boolean): this {
    if (text === "") return this;
    const last = this.runs.at(-1);
    if (last !== undefined && last.italic === italic)
      this.runs[this.runs.length - 1] = { text: last.text + text, italic };
    else this.runs.push({ text, italic });
    return this;
  }

  finish(): FormattedCitation {
    // The placeholders keep the citation's shape readable while incomplete; they never reach a
    // complete citation, because a field with a value never produces one.
    return {
      runs: this.runs,
      plainText: this.runs.map((run) => run.text).join(""),
      rules: [...this.rules],
      missing: [...this.missing],
      notices: this.notices,
    };
  }
}

/* ------------------------------------------------------------------ dates */

/** Month abbreviations in citations (Indigo Book T17). */
const MONTHS = [
  "Jan.",
  "Feb.",
  "Mar.",
  "Apr.",
  "May",
  "June",
  "July",
  "Aug.",
  "Sept.",
  "Oct.",
  "Nov.",
  "Dec.",
];

/** "2024-03-01" as "Mar. 1, 2024"; any other text unchanged. */
export function citationDate(date: string): string {
  if (!isCivilDate(date)) return date;
  const { year, month, day } = civilDateParts(date);
  const monthName = MONTHS[month - 1];
  return monthName === undefined ? date : `${monthName} ${day}, ${year}`;
}

/* ------------------------------------------------------------------ uniform system */

function formatUniform(
  citation: CitationBuilder,
  kind: CitationKind,
  form: CitationForm,
  format: CitationFormat,
): void {
  switch (kind) {
    case "case":
      if (citation.fields.unpublished === "yes") uniformUnpublishedCase(citation, form, format);
      else uniformCase(citation, form);
      return;
    case "united-states-code":
      uniformSectioned(citation, form, `${citation.need("title")} U.S.C.`, "R16");
      return;
    case "code-of-federal-regulations":
      uniformRegulation(citation, form);
      return;
    case "federal-register":
      uniformFederalRegister(citation, form);
      return;
    case "public-law":
      uniformPublicLaw(citation, form);
      return;
    case "nevada-revised-statutes":
      if (hasDifference(format, "nevada-statute-form")) nevadaStatute(citation, form);
      else uniformSectioned(citation, form, "Nev. Rev. Stat.", "R17", "T3");
      return;
    case "california-code": {
      const code = findCaliforniaCode(citation.need("californiaCode"));
      uniformSectioned(citation, form, code?.uniform ?? "[code]", "R17", "T3");
      return;
    }
  }
}

function idForm(citation: CitationBuilder, pin: string | null, ...rules: string[]): void {
  citation.italic("Id.").rule("R6.2.2", ...rules);
  if (pin !== null) citation.text(` at ${pin}`);
  citation.text(".");
}

function uniformCase(citation: CitationBuilder, form: CitationForm): void {
  const pin = citation.has("pinCite") ? citation.need("pinCite") : null;
  if (form === "id") {
    idForm(citation, pin, "R15.3");
    return;
  }
  const volume = citation.need("volume");
  const reporterText = citation.need("reporter");
  if (form === "short") {
    citation.italic(shortCaseName(citation.need("caseName"))).rule("R15");
    citation.text(`, ${volume} ${reporterText} at ${citation.need("pinCite")}.`);
    return;
  }
  citation.italic(abbreviateCaseName(citation.need("caseName"))).rule("R11", "T11");
  citation.text(`, ${volume} ${reporterText} ${citation.need("firstPage")}`);
  if (pin !== null) citation.text(`, ${pin}`).rule("R5");
  const reporter = findReporter(reporterText);
  const court = reporter?.courtImplied == null ? `${citation.need("court")} ` : "";
  citation.text(` (${court}${citation.need("year")})`).rule("R12");
  if (citation.has("parenthetical"))
    citation.text(` (${citation.need("parenthetical")})`).rule("R10");
  citation.text(".");
}

/** Court abbreviations whose unpublished dispositions NRAP 36(c)(3) allows from a date onward. */
const NEVADA_CITABLE_FROM: ReadonlyMap<string, string> = new Map([
  ["Nev.", "2016-01-01"],
  ["Nev. Ct. App.", "2024-08-15"],
]);

function uniformUnpublishedCase(
  citation: CitationBuilder,
  form: CitationForm,
  format: CitationFormat,
): void {
  const nevada = hasDifference(format, "nevada-unpublished-dispositions");
  const pin = citation.has("pinCite") ? `*${citation.need("pinCite")}` : null;
  if (form === "id") {
    idForm(citation, pin, "R15.3");
    return;
  }
  if (form === "short") {
    citation.italic(shortCaseName(citation.need("caseName"))).rule("R15");
    const reference = citation.has("databaseCitation")
      ? citation.need("databaseCitation")
      : `No. ${citation.need("docketNumber")}`;
    citation.text(`, ${reference}${pin === null ? "" : `, at ${pin}`}.`);
    return;
  }
  citation.italic(abbreviateCaseName(citation.need("caseName"))).rule("R11", "T11");
  citation.text(`, No. ${citation.need("docketNumber")}`);
  if (citation.has("databaseCitation")) citation.text(`, ${citation.need("databaseCitation")}`);
  else if (nevada) {
    citation.notices.push({
      severity: "suggestion",
      message: "Add the electronic database citation if one is available.",
      rule: "NRAP 36(c)(3)",
    });
  }
  if (pin !== null) citation.text(`, at ${pin}`);
  const court = citation.need("court");
  const decided = citation.need("dateDecided");
  citation.text(` (${court} ${citationDate(decided)})`).rule("R12");
  if (nevada) {
    citation.text(" (unpublished disposition)").rule("NRAP 36(c)(3)");
    const citableFrom = NEVADA_CITABLE_FROM.get(court);
    if (citableFrom !== undefined && isCivilDate(decided) && decided < citableFrom) {
      citation.notices.push({
        severity: "error",
        message: `Unpublished dispositions of this court may be cited only from ${citationDate(citableFrom)}.`,
        rule: "NRAP 36(c)(3)",
      });
    }
  }
  if (citation.has("parenthetical"))
    citation.text(` (${citation.need("parenthetical")})`).rule("R10");
  citation.text(".");
}

/** "42 U.S.C. § 1983 (2018).", "Nev. Rev. Stat. § 11.190 (2025)." and their short and id. forms. */
function uniformSectioned(
  citation: CitationBuilder,
  form: CitationForm,
  code: string,
  ...rules: string[]
): void {
  const section = citation.need("section");
  citation.rule(...rules);
  if (form === "id") {
    citation.italic("Id.").rule("R6.2.2", "R22").text(` § ${section}.`);
    return;
  }
  citation.text(`${code} § ${section}`);
  if (form === "short") {
    citation.rule("R22").text(".");
    return;
  }
  if (citation.has("year")) citation.text(` (${citation.need("year")})`);
  citation.text(".");
}

function uniformRegulation(citation: CitationBuilder, form: CitationForm): void {
  const title = citation.need("title");
  const location = citation.has("section")
    ? `§ ${citation.need("section")}`
    : `pt. ${citation.need("part")}`;
  citation.rule("R19");
  if (form === "id") {
    citation.italic("Id.").rule("R6.2.2", "R22").text(` ${location}.`);
    return;
  }
  citation.text(`${title} C.F.R. ${location}`);
  if (form === "full" && citation.has("year")) citation.text(` (${citation.need("year")})`);
  if (form === "short") citation.rule("R22");
  citation.text(".");
}

function uniformFederalRegister(citation: CitationBuilder, form: CitationForm): void {
  const pin = citation.has("pinCite") ? citation.need("pinCite") : null;
  citation.rule("R19");
  if (form === "id") {
    idForm(citation, pin, "R22");
    return;
  }
  const volume = citation.need("volume");
  if (form === "short") {
    citation.text(`${volume} Fed. Reg. at ${pin ?? citation.need("page")}.`).rule("R22");
    return;
  }
  citation.text(`${volume} Fed. Reg. ${citation.need("page")}`);
  if (pin !== null) citation.text(`, ${pin}`);
  citation.text(` (${citationDate(citation.need("date"))}).`).rule("T17");
}

function uniformPublicLaw(citation: CitationBuilder, form: CitationForm): void {
  citation.rule("R21");
  if (form === "id") {
    idForm(citation, null, "R22");
    return;
  }
  citation.text(`Pub. L. No. ${citation.need("congress")}-${citation.need("lawNumber")}`);
  if (form === "full") {
    if (citation.has("statutesAtLargeVolume") && citation.has("statutesAtLargePage")) {
      citation.text(
        `, ${citation.need("statutesAtLargeVolume")} Stat. ${citation.need("statutesAtLargePage")}`,
      );
    }
    if (citation.has("year")) citation.text(` (${citation.need("year")})`);
  }
  citation.text(".");
}

function nevadaStatute(citation: CitationBuilder, form: CitationForm): void {
  const section = citation.need("section");
  citation.rule("Nevada State Courts format");
  if (form === "id") {
    citation.italic("Id.").rule("R6.2.2").text(".");
    return;
  }
  citation.text(`NRS ${section}.`);
}

/* ------------------------------------------------------------------ California Style Manual */

/*
 * The California Style Manual sets a citation in parentheses inside the sentence, puts the year
 * after the case name, writes "at p." for a pin cite in later references, and gives explanatory
 * notes in brackets. Code sections split subdivisions out: "§ 337, subd. (a)".
 */
function formatCalifornia(citation: CitationBuilder, kind: CitationKind, form: CitationForm): void {
  citation.rule("California Style Manual");
  citation.text("(");
  if (kind === "case") californiaCase(citation, form);
  else if (form === "id") citation.italic("Id.").text(".");
  else if (kind === "california-code") {
    const code = findCaliforniaCode(citation.need("californiaCode"));
    citation.text(
      `${code?.californiaStyle ?? "[code]"}, ${californiaSection(citation.need("section"))}.`,
    );
  } else {
    const uniform = new CitationBuilder({ ...citation.fields, year: undefined });
    formatUniform(uniform, kind, form === "full" ? "full" : "short", UNIFORM_FORMAT);
    const result = uniform.finish();
    for (const run of result.runs) {
      if (run.italic) citation.italic(run.text);
      else citation.text(run.text);
    }
    for (const missing of result.missing) citation.missing.add(missing);
  }
  citation.text(")");
}

function californiaSection(section: string): string {
  const parts = /^([\d.]+)((?:\([\w]+\))+)$/.exec(section);
  if (parts === null) return `§ ${section}`;
  return `§ ${parts[1]}, subd. ${parts[2]}`;
}

function californiaCase(citation: CitationBuilder, form: CitationForm): void {
  const pin = citation.has("pinCite") ? citation.need("pinCite") : null;
  if (form === "id") {
    citation.italic("Id.");
    if (pin !== null) citation.text(` at p. ${pin}`);
    citation.text(".");
    return;
  }
  const volume = citation.need("volume");
  const reporterText = citation.need("reporter");
  if (form === "short") {
    citation
      .italic(shortCaseName(citation.need("caseName")))
      .text(", ")
      .italic("supra")
      .text(", ");
    citation.text(`${volume} ${reporterText} at p. ${citation.need("pinCite")}.`);
    return;
  }
  citation.italic(citation.need("caseName").replace(/\s+vs?\.?\s+/i, " v. "));
  const reporter = findReporter(reporterText);
  const court =
    reporter?.courtImplied == null && citation.has("court") ? `${citation.need("court")} ` : "";
  citation.text(
    ` (${court}${citation.need("year")}) ${volume} ${reporterText} ${citation.need("firstPage")}`,
  );
  if (pin !== null) citation.text(`, ${pin}`);
  if (citation.has("parenthetical")) citation.text(` [${citation.need("parenthetical")}]`);
  citation.text(".");
}
