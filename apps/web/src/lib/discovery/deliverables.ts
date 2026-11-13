/*
 * THE DELIVERABLE REGISTRY — every record the corpus produces for somebody outside the firm.
 *
 * A manifest, an exception report, a privilege log, a production volume and its load files are one
 * kind of object wearing four names: produced from the corpus at a stated instant, written once,
 * never edited, and handed over in whatever forms the receiving side can open. Declaring them
 * together is what keeps that true — the alternative is four screens that each decide separately
 * whether their artifact can be regenerated, and one of them getting it wrong.
 *
 * WHAT IS PRODUCED AT LOAD COMPLETION IS NOT NEGOTIABLE AFTERWARDS. The manifest describes what
 * ARRIVED, which does not change; a re-processing writes a new processing record and leaves the
 * manifest alone. So there is no "regenerate" verb here and there is not going to be one, and a
 * surface built on this registry cannot offer one by accident.
 *
 * SCOPE IS DECLARED, AND IT DECIDES WHERE THE ARTIFACT RENDERS. A load's two records belong to that
 * load — written at its completion, reconciling its declaration against what arrived — so they
 * render on the load. A review-set-scoped deliverable renders on the review set. Nothing in this
 * file names a screen: the surface asks the registry what is scoped where, which is why the first
 * review-set-scoped deliverable can arrive without a screen being redesigned around it.
 *
 * ONLY REAL THINGS. Two are built and reachable today. The rest are declared at stage `soon` with
 * what each waits on, so the shape of the finished record set is visible before the record set is
 * full — and a firm can see that a privilege log is a thing this platform intends to produce rather
 * than a thing nobody thought about.
 */
import type { MaturityStage } from "@magna-carta/design-system/maturity";

/** Which form of an artifact to hand over. */
export type DeliverableFormat = "json" | "text";

/** What a deliverable is produced from, and therefore where it renders. */
export type DeliverableScope = "load" | "review-set";

interface DeliverableBase {
  readonly id: string;
  readonly label: string;
  /** One line, in the words a firm would use to the other side: what this record says. */
  readonly states: string;
  readonly scope: DeliverableScope;
}

/** A record the platform writes today. */
export interface BuiltDeliverable extends DeliverableBase {
  readonly stage: Exclude<MaturityStage, "soon">;
  /** The forms it exists in, in the order they are offered. */
  readonly formats: readonly { readonly format: DeliverableFormat; readonly label: string }[];
  /**
   * The path that hands it over, given the identifier of whatever it is scoped to. The registry
   * knows the address so a surface never assembles one, which is what stops two screens
   * disagreeing about the artifact they are offering.
   */
  readonly href: (scopeId: string, format: DeliverableFormat) => string;
}

/** A record the design named and nobody writes yet. */
export interface SoonDeliverable extends DeliverableBase {
  readonly stage: "soon";
  /** What it waits on, as a noun phrase the disabled control completes into a sentence. */
  readonly waitsOn: string;
}

export type Deliverable = BuiltDeliverable | SoonDeliverable;

export function deliverableIsBuilt(deliverable: Deliverable): deliverable is BuiltDeliverable {
  return deliverable.stage !== "soon";
}

const BOTH_FORMS: readonly { format: DeliverableFormat; label: string }[] = [
  // The printable form leads: it is the one a person opens, and the one a firm attaches to a letter.
  { format: "text", label: "Printable" },
  { format: "json", label: "Machine-readable" },
];

export const DELIVERABLES: readonly Deliverable[] = [
  {
    id: "load-manifest",
    label: "Load manifest",
    states: "What arrived on this load, and what it was drawn from.",
    scope: "load",
    stage: "alpha",
    formats: BOTH_FORMS,
    href: (loadId, format) => `/api/v1/loads/${loadId}/artifacts/manifest?format=${format}`,
  },
  {
    id: "exception-report",
    label: "Exception report",
    states: "Every document on this load that couldn't be read, with the reason for each.",
    scope: "load",
    stage: "alpha",
    formats: BOTH_FORMS,
    href: (loadId, format) => `/api/v1/loads/${loadId}/artifacts/exception-report?format=${format}`,
  },
  {
    id: "privilege-log",
    label: "Privilege log",
    states:
      "Every document withheld or redacted for privilege, with the basis for each, taken from how it was coded.",
    scope: "review-set",
    stage: "soon",
    waitsOn: "privilege review",
  },
  {
    id: "production-manifest",
    label: "Production manifest",
    states: "What was produced in a volume, with a hash for every artifact in it.",
    scope: "review-set",
    stage: "soon",
    waitsOn: "the production workflow",
  },
  {
    id: "load-files",
    label: "Load files",
    states:
      "The load files the receiving party's review tool needs, including the Custodian of Record and any fields the protocol requires.",
    scope: "review-set",
    stage: "soon",
    waitsOn: "the production workflow",
  },
];

/** The deliverables scoped to one thing, in declaration order. */
export function deliverablesScopedTo(scope: DeliverableScope): readonly Deliverable[] {
  return DELIVERABLES.filter((deliverable) => deliverable.scope === scope);
}

/*
 * Checked at module load: a deliverable that renders disabled and says nothing about why is a dead
 * control, and one that claims to be built with no form to hand over is a button that downloads
 * nothing. Both are failures before anything is drawn rather than after somebody presses.
 */
const seenIds = new Set<string>();
for (const deliverable of DELIVERABLES) {
  if (seenIds.has(deliverable.id)) {
    throw new Error(`Two deliverables declare the id "${deliverable.id}".`);
  }
  seenIds.add(deliverable.id);
  if (deliverableIsBuilt(deliverable)) {
    if (deliverable.formats.length === 0) {
      throw new Error(`The "${deliverable.id}" deliverable is built and offers no form to read.`);
    }
  } else if (deliverable.waitsOn.trim() === "") {
    throw new Error(
      `The "${deliverable.id}" deliverable is not produced and says nothing about why. Declare ` +
        "`waitsOn`: the disabled control carries that line.",
    );
  }
}
