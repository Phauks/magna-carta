/*
 * THE PANEL REGISTRY — the reviewer's working edge, declared once as data.
 *
 * The reviewer is three regions: the queue it walks, the document in the middle, and this stack
 * beside it. Everything that will ever be added to the reviewer's right-hand side — coding, the
 * privilege claim, redactions, the near-duplicate cluster, the coding history — is one entry here
 * plus one component. Nothing about the shell changes for any of them, which is the property worth
 * having, because the panel list is where every remaining sub-slice of the review workflow lands.
 *
 * A PANEL DECLARES WHAT IT NEEDS TO BE HONEST ABOUT ITSELF: the permission the server will enforce
 * anyway (so the panel can say why it is empty rather than looking broken), whether it is read-only
 * once the review set stops taking material, and its maturity. A panel whose backend is not built
 * renders visible and disabled with what it waits on — the standing rule for a designed-but-unserved
 * capability, and the thing that lets this surface show the shape of a finished reviewer today.
 *
 * WHAT A PANEL NEVER DOES IS AUTHORIZE. The per-review-set access list decides who reaches the
 * corpus at all, composed into SQL ahead of every LIMIT, on the server, on every read. A panel's
 * `permission` is for the sentence it shows, never for the wall.
 */
import type { Component } from "svelte";
import type { MaturityStage } from "@magna-carta/design-system/maturity";
import FileText from "@lucide/svelte/icons/file-text";
import Files from "@lucide/svelte/icons/files";
import Copy from "@lucide/svelte/icons/copy";
import Tags from "@lucide/svelte/icons/tags";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import SquarePen from "@lucide/svelte/icons/square-pen";
import Layers from "@lucide/svelte/icons/layers";
import History from "@lucide/svelte/icons/history";
import { READ_DISCOVERY_PERMISSION } from "./discovery-api.ts";

interface ReviewPanelBase {
  readonly id: string;
  readonly label: string;
  readonly icon: Component;
  /** One line: what this panel answers about the document in front of you. */
  readonly answers: string;
  /** The permission the server enforces on this panel's reads and writes. */
  readonly permission: string;
}

/** A panel with something behind it. */
export interface BuiltReviewPanel extends ReviewPanelBase {
  readonly stage: Exclude<MaturityStage, "soon">;
  /**
   * Whether this panel WRITES. A writing panel goes read-only once the review set is locked or
   * closed, and says so; a reading one is unaffected, because everything already in a locked corpus
   * still reads. Declared rather than inferred, so a panel added later cannot forget it.
   */
  readonly writes: boolean;
  readonly component: Component<{ reviewSetId: string; documentId: string }>;
}

/** A panel the design named and nobody has built. */
export interface SoonReviewPanel extends ReviewPanelBase {
  readonly stage: "soon";
  /** What it waits on, as a noun phrase the disabled panel completes into a sentence. */
  readonly waitsOn: string;
}

export type ReviewPanel = BuiltReviewPanel | SoonReviewPanel;

export function panelIsBuilt(panel: ReviewPanel): panel is BuiltReviewPanel {
  return panel.stage !== "soon";
}

/**
 * Build the registry. The built panels' components are passed in rather than imported here, so this
 * module stays plain data that a test can read without mounting anything — the same reason the
 * report registry keeps its presenters at arm's length.
 */
export function reviewPanels(components: {
  readonly facts: Component<{ reviewSetId: string; documentId: string }>;
  readonly family: Component<{ reviewSetId: string; documentId: string }>;
  readonly occurrences: Component<{ reviewSetId: string; documentId: string }>;
}): readonly ReviewPanel[] {
  return [
    {
      id: "facts",
      label: "Facts",
      icon: FileText,
      answers: "What this document is, how it was read, and every reason it was not.",
      permission: READ_DISCOVERY_PERMISSION,
      stage: "alpha",
      writes: false,
      component: components.facts,
    },
    {
      id: "family",
      label: "Family",
      icon: Files,
      answers:
        "What arrived with it: an email and its attachments, or an archive and its contents.",
      permission: READ_DISCOVERY_PERMISSION,
      stage: "alpha",
      writes: false,
      component: components.family,
    },
    {
      id: "occurrences",
      label: "Other copies",
      icon: Copy,
      answers:
        "Every other copy of this document the review set holds, and which Custodian of Record " +
        "held each. This is the read behind a question asked under oath.",
      permission: READ_DISCOVERY_PERMISSION,
      stage: "alpha",
      writes: false,
      component: components.occurrences,
    },
    {
      id: "coding",
      label: "Coding",
      icon: Tags,
      answers: "How this document was coded, such as responsive, privileged or confidential.",
      permission: "discovery:review",
      stage: "soon",
      waitsOn: "the coding surface",
    },
    {
      id: "privilege",
      label: "Privilege",
      icon: ShieldAlert,
      answers: "The claim asserted over this document, and the basis for it.",
      permission: "discovery:review",
      stage: "soon",
      waitsOn: "privilege review",
    },
    {
      id: "redactions",
      label: "Redactions",
      icon: SquarePen,
      answers: "What is drawn over on this document, and why.",
      permission: "discovery:review",
      stage: "soon",
      waitsOn: "redaction in review",
    },
    {
      id: "near-duplicates",
      label: "Near-duplicates",
      icon: Layers,
      answers: "Documents that are nearly the same as this one. It shows them; it never hides one.",
      permission: READ_DISCOVERY_PERMISSION,
      stage: "soon",
      waitsOn: "clustering over the fingerprints every document already carries",
    },
    {
      id: "history",
      label: "History",
      icon: History,
      answers: "Every coding decision made on this document, by whom, and when.",
      permission: READ_DISCOVERY_PERMISSION,
      stage: "soon",
      waitsOn: "the coding surface",
    },
  ];
}

/**
 * Every declaration checked before anything renders. A soon panel with no dependency sentence is a
 * dead control a reader cannot interpret; two panels sharing an id is a stack that silently drops
 * one.
 */
export function assertReviewPanels(panels: readonly ReviewPanel[]): void {
  const seen = new Set<string>();
  for (const panel of panels) {
    if (seen.has(panel.id)) throw new Error(`Two review panels declare the id "${panel.id}".`);
    seen.add(panel.id);
    if (panel.permission.trim() === "") {
      throw new Error(
        `The "${panel.id}" panel names no permission, so it cannot say why it is empty.`,
      );
    }
    if (!panelIsBuilt(panel) && panel.waitsOn.trim() === "") {
      throw new Error(
        `The "${panel.id}" panel is not served and says nothing about why. Declare \`waitsOn\`: ` +
          "the disabled panel carries that line.",
      );
    }
  }
}
