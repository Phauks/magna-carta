import { CALIFORNIA_CODES, findCaliforniaCode } from "./california-codes.ts";
import { findReporter } from "./reporters.ts";
import type { CitationFields, Recognition } from "./types.ts";

/*
 * Reads a pasted link or a rough citation into a kind and fields — "the manner best available":
 * a link that carries its own address (a code section, a regulation) is read whole with no network
 * call; a case link or citation is read as far as its text goes and asks a provider for the rest
 * through `lookup`; a Westlaw or Lexis link is only named, because nothing in its address is the
 * citation. Returns null when nothing is recognized, so the interface can offer "Enter by hand".
 *
 * Pure and synchronous. Fetching is the Worker's job, through the lookup the result names.
 */
export function recognize(input: string): Recognition | null {
  const text = input.trim();
  if (text === "") return null;
  const url = parseUrl(text);
  return url === null ? recognizeText(text) : recognizeUrl(url);
}

function parseUrl(text: string): URL | null {
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

const hostIs = (url: URL, domain: string): boolean =>
  url.hostname === domain || url.hostname.endsWith(`.${domain}`);

function recognizeUrl(url: URL): Recognition | null {
  const path = decodeURIComponent(url.pathname);

  if (hostIs(url, "westlaw.com")) {
    return {
      kind: null,
      source: "westlaw",
      fields: {},
      lookup: { provider: "westlaw", identifier: url.href },
    };
  }
  if (hostIs(url, "lexis.com") || hostIs(url, "lexisnexis.com")) {
    return {
      kind: null,
      source: "lexis",
      fields: {},
      lookup: { provider: "lexis", identifier: url.href },
    };
  }

  if (hostIs(url, "courtlistener.com")) {
    const opinion = /\/opinion\/(\d+)\/([a-z0-9-]+)?/i.exec(path);
    if (opinion === null) return null;
    const [, identifier = "", slug] = opinion;
    const fields: CitationFields = {};
    // The address slug is the case name lower-cased and hyphenated; a lookup replaces it with the
    // name as reported, so it is only ever a first reading.
    if (slug !== undefined) fields.caseName = caseNameFromSlug(slug);
    return {
      kind: "case",
      source: "courtlistener",
      fields,
      lookup: { provider: "courtlistener", identifier },
    };
  }

  if (hostIs(url, "govinfo.gov")) {
    const code = /\/link\/uscode\/(\d+[A-Za-z]?)\/([\w.-]+)/.exec(path);
    if (code !== null) {
      return statute("united-states-code", "govinfo", { title: code[1], section: code[2] });
    }
    const regulation = /\/link\/cfr\/(\d+)\/(\d+)/.exec(path);
    if (regulation !== null) {
      const sectionNumber = url.searchParams.get("sectionnum");
      const fields: CitationFields = { title: regulation[1], part: regulation[2] };
      if (sectionNumber !== null) fields.section = `${regulation[2]}.${sectionNumber}`;
      return statute("code-of-federal-regulations", "govinfo", fields);
    }
    const register = /\/link\/fr\/(\d+)\/(\d+)/.exec(path);
    if (register !== null) {
      return statute("federal-register", "govinfo", { volume: register[1], page: register[2] });
    }
    const publicLaw = /\/link\/plaw\/(\d+)\/public\/(\d+)/.exec(path);
    if (publicLaw !== null) {
      return statute("public-law", "govinfo", { congress: publicLaw[1], lawNumber: publicLaw[2] });
    }
    return null;
  }

  if (hostIs(url, "law.cornell.edu")) {
    const code = /\/uscode\/text\/(\d+[A-Za-z]?)\/([\w.-]+)/.exec(path);
    if (code !== null) {
      return statute("united-states-code", "cornell-legal-information-institute", {
        title: code[1],
        section: code[2],
      });
    }
    const regulation = /\/cfr\/text\/(\d+)\/(part-)?([\d.]+)/.exec(path);
    if (regulation !== null) {
      const [, title, isPart, number = ""] = regulation;
      const fields: CitationFields =
        isPart === undefined
          ? { title, section: number, part: number.split(".")[0] }
          : { title, part: number };
      return statute("code-of-federal-regulations", "cornell-legal-information-institute", fields);
    }
    return null;
  }

  if (hostIs(url, "ecfr.gov")) {
    const title = /\/title-(\d+)/.exec(path)?.[1];
    if (title === undefined) return null;
    const section = /\/section-([\d.]+)/.exec(path)?.[1];
    const part = /\/part-(\d+)/.exec(path)?.[1] ?? section?.split(".")[0];
    const fields: CitationFields = { title };
    if (part !== undefined) fields.part = part;
    if (section !== undefined) fields.section = section;
    return statute("code-of-federal-regulations", "electronic-code-of-federal-regulations", fields);
  }

  if (hostIs(url, "leg.state.nv.us")) {
    // Section anchors read "#NRS011Sec190": chapter 011, section 190, cited as NRS 11.190.
    const anchor = /NRS(\d+[A-Z]?)Sec(\d+[A-Z]?)/i.exec(url.hash);
    const chapter = anchor?.[1] ?? /NRS-(\d+[A-Z]?)\.html/i.exec(path)?.[1];
    if (chapter === undefined) return null;
    const chapterNumber = chapter.replace(/^0+(?=\d)/, "");
    const fields: CitationFields =
      anchor?.[2] === undefined ? {} : { section: `${chapterNumber}.${anchor[2]}` };
    return statute("nevada-revised-statutes", "nevada-legislature", fields);
  }

  if (hostIs(url, "leginfo.legislature.ca.gov")) {
    const code = findCaliforniaCode(url.searchParams.get("lawCode") ?? "");
    const section = url.searchParams.get("sectionNum")?.replace(/\.$/, "");
    if (code === null) return null;
    const fields: CitationFields = { californiaCode: code.lawCode };
    if (section !== undefined && section !== "") fields.section = section;
    return statute("california-code", "california-legislative-information", fields);
  }

  return null;
}

function statute(
  kind: NonNullable<Recognition["kind"]>,
  source: Recognition["source"],
  fields: CitationFields,
): Recognition {
  return { kind, source, fields, lookup: null };
}

const LOWER_CASE_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "the", "to"]);

function caseNameFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter((word) => word !== "")
    .map((word, index) => {
      if (word === "v") return "v.";
      if (index > 0 && LOWER_CASE_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/* ------------------------------------------------------------------ rough citation text */

const SECTION_SIGN = String.raw`(?:§+|sec(?:tion|\.)?)?`;

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`).replace(/\s+/g, String.raw`\s*`);
}

function recognizeText(text: string): Recognition | null {
  const publicLaw =
    /^pub(?:lic)?\.?\s*l(?:aw)?\.?\s*(?:no\.?\s*)?(\d+)\s*[-–]\s*(\d+)(?:,\s*(\d+)\s*stat\.?\s*(\d+))?/i.exec(
      text,
    );
  if (publicLaw !== null) {
    const fields: CitationFields = { congress: publicLaw[1], lawNumber: publicLaw[2] };
    if (publicLaw[3] !== undefined && publicLaw[4] !== undefined) {
      fields.statutesAtLargeVolume = publicLaw[3];
      fields.statutesAtLargePage = publicLaw[4];
    }
    return statute("public-law", "citation-text", fields);
  }

  const register = /^(\d+)\s*fed\.?\s*reg\.?\s*(\d[\d,]*)/i.exec(text);
  if (register !== null) {
    return statute("federal-register", "citation-text", {
      volume: register[1],
      page: register[2]?.replace(/,/g, ""),
    });
  }

  const code = new RegExp(
    String.raw`^(\d+[a-z]?)\s*u\.?\s*s\.?\s*c\.?\s*(?:a\.?\s*)?${SECTION_SIGN}\s*([\w.-]+(?:\([\w]+\))*)`,
    "i",
  ).exec(text);
  if (code !== null)
    return statute("united-states-code", "citation-text", { title: code[1], section: code[2] });

  const regulation = new RegExp(
    String.raw`^(\d+)\s*c\.?\s*f\.?\s*r\.?\s*(?:${SECTION_SIGN}|part|pt\.?)\s*(\d+)(?:\.(\d+[\w()]*))?`,
    "i",
  ).exec(text);
  if (regulation !== null) {
    const fields: CitationFields = { title: regulation[1], part: regulation[2] };
    if (regulation[3] !== undefined) fields.section = `${regulation[2]}.${regulation[3]}`;
    return statute("code-of-federal-regulations", "citation-text", fields);
  }

  const nevada = new RegExp(
    String.raw`^(?:nrs|nev\.?\s*rev\.?\s*stat\.?)\s*${SECTION_SIGN}\s*(\d+[a-z]?\.\d+[a-z]?(?:\([\w]+\))*)`,
    "i",
  ).exec(text);
  if (nevada !== null) {
    const section = nevada[1] ?? "";
    const subsections = section.indexOf("(");
    // Chapter and section letters are capitals ("NRS 78A.010"); subsection letters are not.
    const normalized =
      subsections === -1
        ? section.toUpperCase()
        : section.slice(0, subsections).toUpperCase() + section.slice(subsections);
    return statute("nevada-revised-statutes", "citation-text", { section: normalized });
  }

  for (const californiaCode of CALIFORNIA_CODES) {
    const names = [
      californiaCode.uniform,
      californiaCode.californiaStyle,
      californiaCode.name,
      `Cal. ${californiaCode.name}`,
    ]
      .map(escapeForPattern)
      .join("|");
    const pattern = new RegExp(
      String.raw`^(?:${names}|${californiaCode.lawCode})\.?,?\s*${SECTION_SIGN}\s*(\d+(?:\.\d+)?(?:\([\w]+\))*)`,
      "i",
    );
    const match = pattern.exec(text);
    if (match !== null) {
      return statute("california-code", "citation-text", {
        californiaCode: californiaCode.lawCode,
        section: match[1],
      });
    }
  }

  return recognizeCase(text);
}

/*
 * "347 us 483", "Brown v. Board of Education, 347 U.S. 483, 495 (1954)", "123 F.3d 456 (9th Cir.
 * 1997)". The reporter must be one the table knows, which is what keeps "12 Main St 4" from reading
 * as a citation.
 */
const CASE_PATTERN =
  /^(?:(.+?),\s+)?(\d+)\s+(.+?)\s+(\d+)(?:,\s*(\d+(?:\s*[-–]\s*\d+)?))?(?:\s*\(\s*(.*?)\s*(\d{4})\s*\))?\.?$/;

function recognizeCase(text: string): Recognition | null {
  const match = CASE_PATTERN.exec(text);
  if (match === null) return null;
  const [, caseName, volume, reporterText = "", firstPage, pinCite, court, year] = match;
  const reporter = findReporter(reporterText);
  if (reporter === null) return null;
  const fields: CitationFields = { volume, reporter: reporter.abbreviation, firstPage };
  if (caseName !== undefined) fields.caseName = caseName.trim();
  if (pinCite !== undefined) fields.pinCite = pinCite.replace(/\s/g, "");
  if (court !== undefined && court !== "") fields.court = court;
  if (year !== undefined) fields.year = year;
  return {
    kind: "case",
    source: "citation-text",
    fields,
    lookup: {
      provider: "courtlistener",
      identifier: `${volume} ${reporter.abbreviation} ${firstPage}`,
    },
  };
}
