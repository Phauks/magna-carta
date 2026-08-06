import { CustodyValidationError } from "./validation.ts";

// THE WILL-DEPOSIT DUTY CATALOG: jurisdiction-keyed reference data about what a law says a holder of
// a will must do, and when.
//
// THE CONTRACT IS REFUSE RATHER THAN GUESS. An unencoded jurisdiction raises
// `custody-jurisdiction-not-encoded`; it never falls back to a baseline, never resolves to the most
// common answer, and never returns an empty list that a caller would read as "nothing applies". That
// is deliberately a different refusal from `custody-jurisdiction-not-recorded`, which means nobody
// told us WHICH law to look up: the first is fixed by research and verification, the second by
// recording a fact about the firm. Conflating them is how a firm comes to read silence as freedom.
//
// A SUB-JURISDICTION THAT IS NOT ENCODED REFUSES EVEN WHEN ITS PARENT IS. Some duties are county- or
// district-scoped, and resolving an unencoded county to its state's entries alone would answer "the
// county requires nothing" — a fact nobody checked. So a key below an encoded parent refuses on its
// own terms, naming the parent as encoded, and the caller either resolves the parent deliberately or
// gets the county researched.
//
// WHAT THIS CATALOG CARRIES IS WHAT THE STATUTE SAYS, VERBATIM, WITH ITS CITATION — never an
// interpretation of it and never advice about it. Where the sources leave a question open, it stays
// open: nothing here decides whether "knowledge of the death" reaches constructive knowledge, or what
// counts as the "reasonable cause" that answers a liability claim. Those are questions for a lawyer,
// and a field that quietly answered one would be practising law in a table.
//
// A deadline is computed ONLY from a date a person recorded (see custodyWillDeliveryDueDate). Nothing
// here reads a clock, infers a date of death, or derives a trigger from anything the register stores
// today — the register records no date of death, so the computation is a seam a caller supplies.

// How a duty's due date is arrived at. Only `daysAfterTrigger` yields a computable date; the other
// three exist so a duty that genuinely has no fixed interval is representable as itself rather than
// being flattened into a number nobody can support.
export const CUSTODY_WILL_DEADLINE_BASES = [
  "daysAfterTrigger",
  "setByCourtOrder",
  "concurrentWithFiling",
  "noStatutoryDeadline",
] as const;
export type CustodyWillDeadlineBasis = (typeof CUSTODY_WILL_DEADLINE_BASES)[number];

export interface CustodyWillDuty {
  // A stable key for the duty, so a surface can label it without matching on prose.
  readonly key: string;
  readonly summary: string;
  // What starts the clock, in the statute's own terms. Nevada's is knowledge of the death rather than
  // the death, and the difference is the whole of the duty for a firm that has not been told.
  readonly trigger: string;
  readonly dutyHolder: string;
  readonly deadlineBasis: CustodyWillDeadlineBasis;
  readonly deadlineDays: number | null;
  // Every target that discharges the duty. More than one means the law wrote "or", and choosing
  // between them is the firm's call, not the platform's.
  readonly deliveryTargets: readonly string[];
  // What the law says follows from not doing it. Recorded as stated; nothing here scores or ranks it.
  readonly consequenceOfNeglect: string | null;
  // Consequences of performing the duty that a firm would want to know before choosing a target.
  readonly sideEffects: readonly string[];
  readonly citation: string;
  // The operative text, quoted exactly. This is the field a surface shows, because a firm can check a
  // quotation against the published statute and cannot check a paraphrase against anything.
  readonly statutoryText: string;
  readonly sourceUrl: string;
  readonly verifiedOn: string;
}

// A capability the jurisdiction either provides or does not. A verified negative is a fact worth
// encoding: without it, "no entry" and "no such procedure" look identical, and uniform-act language
// that a state never enacted circulates widely enough that a firm can easily believe the wrong one.
//
// THE QUESTION AND THE ANSWER ARE TWO FIELDS, and the answer is a sentence rather than a boolean
// beside a description. A single `summary` describing the procedure ("depositing a will with a court
// during the testator's lifetime") reads as an offer wherever a surface renders a list of these, with
// the negation living only in a sibling flag nobody rendered — which is exactly how the never-enacted
// uniform-act language this entry exists to refute gets believed. Split, there is no rendering that
// shows the procedure without showing whether it exists.
export interface CustodyWillCapability {
  readonly key: string;
  // What was asked, phrased as a question.
  readonly question: string;
  // The verified answer, phrased to stand alone with no other field beside it.
  readonly answer: string;
  readonly available: boolean;
  readonly basis: string;
  readonly verifiedOn: string;
}

export interface CustodyWillJurisdictionEntry {
  readonly jurisdictionKey: string;
  readonly name: string;
  readonly parentJurisdictionKey: string | null;
  readonly duties: readonly CustodyWillDuty[];
  readonly capabilities: readonly CustodyWillCapability[];
  // The publisher's compilation stamp on every source read for this entry. When it advances, the
  // entry needs re-verification against the primary text before it is trusted again.
  readonly compiledThrough: string;
}

const NEVADA_SOURCE = "https://www.leg.state.nv.us/NRS/NRS-136.html";
const VERIFIED_ON = "2026-08-05";

// NEVADA — the first encoded jurisdiction. Every duty below is quoted from the Nevada Revised
// Statutes as published by the Nevada Legislature, and every quotation was read from the primary
// source rather than a summary of it.
//
// TWO THINGS ARE DELIBERATELY ABSENT AND ARE NOT OVERSIGHTS.
//
// The electronic-will qualified-custodian scheme (NRS 133.300–133.340) is not encoded. Serving as a
// qualified custodian is an opt-in role a firm executes a written statement to take on, it carries
// standing storage and production duties, and it drags probate venue toward the custodian's own
// office. That is a decision a firm makes, not a feature a register acquires by holding a will.
//
// The professional-conduct backdrop (NRPC 1.15, 1.16(d), Supreme Court Rule 78) is not encoded as a
// duty here. Those rules are real and binding on Nevada lawyers, but none of them is a will-delivery
// deadline, and putting a five-year records rule in a deadline catalog would make it read as one.
const NEVADA: CustodyWillJurisdictionEntry = {
  jurisdictionKey: "US-NV",
  name: "Nevada",
  parentJurisdictionKey: null,
  compiledThrough: "2025 regular session",
  duties: [
    {
      key: "delivery-of-will-after-death",
      summary: "Deliver the will within 30 days of learning the testator has died.",
      trigger:
        "knowledge of the death of the person who executed the will — knowledge, not the death itself",
      dutyHolder:
        'any person having possession of the will; the statute writes "any person" and states no professional qualifier and no exception for a firm holding under a custody agreement',
      deadlineBasis: "daysAfterTrigger",
      deadlineDays: 30,
      deliveryTargets: [
        "the clerk of the district court which has jurisdiction of the case",
        "the personal representative named in the will",
      ],
      consequenceOfNeglect:
        "Every person who neglects to perform any of the duties required in subsections 1 and 2 without reasonable cause is liable to every person interested in the will for the damages the interested person may sustain by reason of the neglect.",
      sideEffects: [
        "A will delivered to the clerk becomes part of the clerk's permanent record whether or not a petition for probate is filed.",
        "A will that is part of that permanent record becomes a court record open to inspection unless it is sealed under Part VII of the Nevada Supreme Court Rules.",
      ],
      citation: "NRS 136.050(1), (3), (4), (5)",
      statutoryText:
        "Any person having possession of a will shall, within 30 days after knowledge of the death of the person who executed the will, deliver it to the clerk of the district court which has jurisdiction of the case or to the personal representative named in the will.",
      sourceUrl: NEVADA_SOURCE,
      verifiedOn: VERIFIED_ON,
    },
    {
      key: "presentation-by-named-personal-representative",
      summary:
        "A person named as personal representative who holds the will presents it to the clerk within 30 days.",
      trigger:
        "the death of the testator, or knowledge of being named personal representative — the statute states both and does not say which controls when both have occurred",
      dutyHolder: "the person named as personal representative in the will, if in possession of it",
      deadlineBasis: "daysAfterTrigger",
      deadlineDays: 30,
      deliveryTargets: ["the clerk of the court"],
      consequenceOfNeglect:
        "Every person who neglects to perform any of the duties required in subsections 1 and 2 without reasonable cause is liable to every person interested in the will for the damages the interested person may sustain by reason of the neglect.",
      sideEffects: [],
      citation: "NRS 136.050(2), (3)",
      statutoryText:
        "Any person named as personal representative in a will shall, within 30 days after the death of the testator, or within 30 days after knowledge of being named, present the will, if in possession of it, to the clerk of the court.",
      sourceUrl: NEVADA_SOURCE,
      verifiedOn: VERIFIED_ON,
    },
    {
      key: "production-under-court-order",
      summary: "Produce the will at the time the court's order names.",
      trigger: "service of a court order to produce the will",
      dutyHolder: "the person having possession of the will",
      // Not an interval, and deliberately not flattened into one: the statute says the time is named
      // in the order. A catalog that guessed a number here would be inventing a deadline the court
      // supplies.
      deadlineBasis: "setByCourtOrder",
      deadlineDays: null,
      deliveryTargets: ["the court, at the time named in the order"],
      consequenceOfNeglect:
        "Any person having the possession of a will who neglects or refuses to produce it in obedience to such an order may, by warrant from the court, be committed to the county jail, and be kept in close confinement until the person produces the will.",
      sideEffects: [],
      citation: "NRS 136.060(1), (2)",
      statutoryText:
        "If it is alleged in any petition that the will of a decedent is in the possession of a third person, and the court is satisfied that the allegation is correct, an order must be issued and served upon the person having possession of the will, requiring that person to produce it at a time to be named in the order.",
      sourceUrl: NEVADA_SOURCE,
      verifiedOn: VERIFIED_ON,
    },
  ],
  capabilities: [
    {
      key: "lifetime-deposit-with-a-court",
      question:
        "Can a will be deposited with a court for safekeeping during the testator's lifetime?",
      answer:
        "No. Nevada provides no procedure for depositing a will with a court for safekeeping during the testator's lifetime.",
      available: false,
      // Stated affirmatively, because the honest basis for a negative is the exhaustiveness of the
      // search rather than a citation. Encoded at all because uniform-act deposit language that
      // Nevada never enacted circulates in search results as though it were Nevada law.
      basis:
        "No Nevada statute or court rule provides for it. Every chapter of NRS Title 12 was searched, along with NRS chapters 246 and 247 and the statewide, Eighth Judicial District, and Second Judicial District court rules; the only matches were the international-will declaration of an intended location at NRS 133A.070(3) and the certificate form at NRS 133A.080, neither of which creates a depository.",
      verifiedOn: VERIFIED_ON,
    },
  ],
};

// The original-will lodging duty is a LOCAL COURT RULE, not a statute, so it is keyed BELOW the state
// rather than at it. Nevada has eleven judicial districts; two were verified, and encoding their rule
// statewide would assert something about the other nine that nobody checked. That is exactly the
// fabrication the refuse-rather-than-guess contract exists to prevent, so the other nine refuse.
function lodgingDuty(
  citation: string,
  filingOffice: string,
  statutoryText: string,
  sourceUrl: string,
): CustodyWillDuty {
  return {
    key: "lodging-the-original-with-a-probate-petition",
    summary:
      "Lodge the original will with the petition for probate, unless it is already lodged with the court.",
    trigger: "filing a petition for probate of a will or codicil",
    dutyHolder: "the petitioner",
    deadlineBasis: "concurrentWithFiling",
    deadlineDays: null,
    deliveryTargets: [filingOffice],
    consequenceOfNeglect: null,
    sideEffects: [
      "A holographic instrument must be accompanied by a typewritten copy.",
      "Copies of any documents offered for probate must be attached to the petition for the probate commissioner.",
      "A will already delivered to the clerk under the 30-day duty is by then part of the clerk's permanent record and is not lodged again.",
    ],
    citation,
    statutoryText,
    sourceUrl,
    verifiedOn: VERIFIED_ON,
  };
}

const NEVADA_EIGHTH_DISTRICT: CustodyWillJurisdictionEntry = {
  jurisdictionKey: "US-NV-08",
  name: "Nevada — Eighth Judicial District (Clark County)",
  parentJurisdictionKey: "US-NV",
  compiledThrough: "2025 regular session",
  duties: [
    lodgingDuty(
      "EDCR 4.40(a)–(b)",
      "the clerk of the court",
      "When a petition for probate of a will and/or a codicil is filed and the original of the instrument being offered for probate is not already lodged with the clerk of the court, it must be lodged concurrently with the filing of the petition. If the instrument is holographic, a typewritten copy of the instrument must also accompany the petition.",
      "https://www.leg.state.nv.us/CourtRules/EighthDCR.html",
    ),
  ],
  capabilities: [],
};

const NEVADA_SECOND_DISTRICT: CustodyWillJurisdictionEntry = {
  jurisdictionKey: "US-NV-02",
  name: "Nevada — Second Judicial District (Washoe County)",
  parentJurisdictionKey: "US-NV",
  compiledThrough: "2025 regular session",
  duties: [
    lodgingDuty(
      "Second Judicial District Court Rule 57.7(1)–(2)",
      "the filing office",
      "When a petition for probate of will and/or codicil is filed and the original of the document being offered for probate is not already filed with the filing office, it must be filed concurrently with the petition. If the will is holographic, a typewritten copy of the document must also accompany the petition.",
      "https://www.leg.state.nv.us/CourtRules/SecondDCR.html",
    ),
  ],
  capabilities: [],
};

const CATALOG: readonly CustodyWillJurisdictionEntry[] = [
  NEVADA,
  NEVADA_EIGHTH_DISTRICT,
  NEVADA_SECOND_DISTRICT,
];

const BY_KEY = new Map(CATALOG.map((entry) => [entry.jurisdictionKey, entry]));

export const ENCODED_CUSTODY_WILL_JURISDICTION_KEYS: readonly string[] = CATALOG.map(
  (entry) => entry.jurisdictionKey,
);

// A jurisdiction nobody recorded is a different problem from a jurisdiction nobody researched, and
// the two are surfaced as different refusals so a firm knows which of the two it has.
//
// The key is NORMALIZED before it is looked up — trimmed, uppercased, and with underscores read as
// the hyphens they were meant to be. `us-nv` and `US_NV` are the same jurisdiction as `US-NV`, and
// answering a typo with "no verified duties are encoded for us-nv" tells a firm that nobody has
// researched Nevada, which is false and is precisely the confusion this catalog's two distinct
// refusals exist to prevent. Case and separator are shape, not identity.
export function requireCustodyJurisdiction(jurisdictionKey: string | null | undefined): string {
  if (jurisdictionKey === null || jurisdictionKey === undefined || jurisdictionKey.trim() === "") {
    throw new CustodyValidationError(
      "custody-jurisdiction-not-recorded",
      "no jurisdiction was recorded, so there is nothing to look the will-deposit duties up against",
    );
  }
  return normalizeCustodyJurisdictionKey(jurisdictionKey);
}

export function normalizeCustodyJurisdictionKey(jurisdictionKey: string): string {
  return jurisdictionKey.trim().toUpperCase().replaceAll("_", "-");
}

export interface ResolvedCustodyWillDuties {
  readonly jurisdictionKey: string;
  readonly name: string;
  // The entry's own duties first, then each ancestor's — the county rule and the statute it sits
  // under, in the order a person reads them.
  readonly duties: readonly CustodyWillDuty[];
  readonly capabilities: readonly CustodyWillCapability[];
  // Keys encoded BELOW the one resolved. Returned so a state-level answer cannot be mistaken for the
  // whole picture where a county rule exists and was not asked for.
  readonly encodedSubJurisdictionKeys: readonly string[];
  readonly compiledThrough: string;
}

// The nearest encoded jurisdiction ABOVE a key, or null when no ancestor is encoded either. Naming
// one is never a fallback — the refusal stands whatever this returns — it only tells the caller which
// question does have a verified answer.
function nearestEncodedAncestorOf(key: string): string | null {
  let candidate = key;
  while (candidate.includes("-")) {
    candidate = candidate.slice(0, candidate.lastIndexOf("-"));
    if (BY_KEY.has(candidate)) return candidate;
  }
  return null;
}

export function resolveCustodyWillDuties(
  jurisdictionKey: string | null | undefined,
): ResolvedCustodyWillDuties {
  const key = requireCustodyJurisdiction(jurisdictionKey);
  const entry = BY_KEY.get(key);
  if (entry === undefined) {
    // The ancestor probe walks the hyphen segments ALL the way up rather than trying the immediate
    // parent alone: `US-NV-08-CLARK` sits two levels below the encoded state, and stopping at one
    // level would drop the "the wider jurisdiction IS encoded" half of the refusal — which is the
    // half that tells a firm the answer exists at a level it can ask about.
    const encodedAncestorKey = nearestEncodedAncestorOf(key);
    throw new CustodyValidationError(
      "custody-jurisdiction-not-encoded",
      encodedAncestorKey !== null
        ? `no verified will-deposit duties are encoded for ${key}. ${encodedAncestorKey} is encoded, but a duty at ${key} would be local to it and none has been verified — resolving ${encodedAncestorKey} instead answers only what the wider jurisdiction requires`
        : `no verified will-deposit duties are encoded for ${key}: they are researched and verified against the primary text one jurisdiction at a time, and there is no baseline to fall back to`,
    );
  }
  const duties = [...entry.duties];
  const capabilities = [...entry.capabilities];
  let ancestorKey = entry.parentJurisdictionKey;
  const seen = new Set<string>([entry.jurisdictionKey]);
  while (ancestorKey !== null && !seen.has(ancestorKey)) {
    seen.add(ancestorKey);
    const ancestor = BY_KEY.get(ancestorKey);
    if (ancestor === undefined) break;
    duties.push(...ancestor.duties);
    capabilities.push(...ancestor.capabilities);
    ancestorKey = ancestor.parentJurisdictionKey;
  }
  return {
    jurisdictionKey: entry.jurisdictionKey,
    name: entry.name,
    duties,
    capabilities,
    encodedSubJurisdictionKeys: CATALOG.filter(
      (candidate) => candidate.parentJurisdictionKey === entry.jurisdictionKey,
    ).map((candidate) => candidate.jurisdictionKey),
    compiledThrough: entry.compiledThrough,
  };
}

// The due date a duty produces from a date a PERSON recorded.
//
// NULL MEANS ONE THING HERE: this duty has no computable interval. A court-set date and a date due
// concurrently with a filing are not derivable from anything this function is given, so they are
// null; a trigger date the function cannot read is a REFUSAL, not a null. Those two are fixed
// differently — one by asking the court, one by correcting the date somebody typed — and this module
// is the one that says out loud that two refusals fixed differently must never be conflated. Reading
// "no deadline applies" out of a typo, in a function whose output is a statutory deadline, is the
// worst version of that mistake.
//
// The trigger date must be a bare civil date and must be a date that exists. `Date.UTC` rolls over
// silently, so 2026-02-31 would otherwise yield a due date computed from the 2nd of March; and a
// longer string like `2026-08-05T23:00:00-07:00` names the 5th only in UTC, so accepting its leading
// date would answer about a different day from the one the caller meant.
//
// The register records no date of death and no date on which the firm learned of one, so nothing
// calls this with stored data yet: the duty is surfaced, the arithmetic is here, and the date it
// needs arrives when the register learns how to record it. That gap is honest rather than incidental
// — Nevada's clock starts at KNOWLEDGE of the death, and no case law was found construing whether
// that reaches constructive knowledge, so a date inferred from anything other than an explicit
// recorded fact would be this catalog answering a question a lawyer has to.
export function custodyWillDeliveryDueDate(
  duty: CustodyWillDuty,
  triggerDate: string,
): string | null {
  if (duty.deadlineBasis !== "daysAfterTrigger" || duty.deadlineDays === null) return null;
  const start = civilDateAsUtcOrRefuse(triggerDate);
  const due = new Date(start + duty.deadlineDays * 86_400_000);
  return due.toISOString().slice(0, 10);
}

const BARE_CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function civilDateAsUtcOrRefuse(triggerDate: string): number {
  const parsed = BARE_CIVIL_DATE.exec(triggerDate);
  if (parsed === null) {
    throw new CustodyValidationError(
      "custody-invalid-trigger-date",
      `a will-duty trigger date is a civil date of the form YYYY-MM-DD, and this is not one: ${triggerDate}`,
    );
  }
  const [, year, month, day] = parsed as unknown as [string, string, string, string];
  const asUtc = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const roundTrip = new Date(asUtc);
  // The pattern alone accepts 2026-02-31; a round trip through the calendar catches the rollover.
  if (
    roundTrip.getUTCFullYear() !== Number(year) ||
    roundTrip.getUTCMonth() !== Number(month) - 1 ||
    roundTrip.getUTCDate() !== Number(day)
  ) {
    throw new CustodyValidationError(
      "custody-invalid-trigger-date",
      `a will-duty trigger date must be a date on the calendar, and this is not one: ${triggerDate}`,
    );
  }
  return asUtc;
}
