import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import {
  type FeedObjectMetadata,
  feedObjectKey,
  feedObjectMetadata,
} from "./filter-construction.ts";

// The synthetic corpus the wall probes run over. Entirely fabricated — no firm data, no real matter or
// client names — and deterministic, so a failing probe replays byte-identically. The layout mirrors
// the derived feed exactly: three matters (two large, one single-document), every document under the
// feed key layout with the four metadata fields stamped at put time.
//
// Two properties make cross-matter leakage DETECTABLE rather than merely possible, and the fixture
// self-check tests assert both before any probe result is trusted:
// - every document carries a verbatim passage of tokens unique to it, so querying that passage ranks
//   that document as the single best unfiltered hit — the adversarial shape: the query is chosen so an
//   out-of-scope document is the best possible answer, and only the filter stands in the way;
// - a shared nonsense token is planted in a known subset of both large matters, so one query provably
//   surfaces documents from both matters when unfiltered.

export interface SyntheticDocument {
  readonly fileId: FileId;
  readonly version: number;
  readonly objectKey: string;
  readonly metadata: FeedObjectMetadata;
  readonly text: string;
  // The unique-token passage whose verbatim text is this document's adversarial query.
  readonly verbatimPassage: string;
}

export interface SyntheticCorpus {
  readonly matterA: MatterId;
  readonly matterB: MatterId;
  readonly matterC: MatterId;
  readonly documents: readonly SyntheticDocument[];
  readonly sharedNonsenseToken: string;
  documentsOfMatter(matter: MatterId): readonly SyntheticDocument[];
}

export const SYNTHETIC_MATTER_A = "matter_wallprobe0000000000000a" as MatterId;
export const SYNTHETIC_MATTER_B = "matter_wallprobe0000000000000b" as MatterId;
export const SYNTHETIC_MATTER_C = "matter_wallprobe0000000000000c" as MatterId;

// Nonsense by construction: not a word in any corpus, so its only occurrences are the planted ones.
export const SHARED_NONSENSE_TOKEN = "quolvarnixatherium";

// Filler vocabulary shared across every document, so unrelated documents score above zero on almost
// any query — which is what makes the threshold-zero, fifty-result probe demanding: the result list
// fills up, and only the filter decides with whose documents.
const FILLER_WORDS = [
  "agreement",
  "clause",
  "counsel",
  "deposition",
  "evidence",
  "filing",
  "hearing",
  "judgment",
  "motion",
  "notice",
  "party",
  "pleading",
  "record",
  "schedule",
  "settlement",
  "statute",
  "testimony",
  "witness",
];

// Deterministic 32-bit generator (mulberry32 construction) so the corpus is identical on every run.
function deterministicGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticFileId(matterTag: string, index: number): FileId {
  return `file_wallprobe${matterTag}${String(index).padStart(12, "0")}` as FileId;
}

interface MatterPlan {
  readonly matter: MatterId;
  readonly matterTag: string;
  readonly clientHandle: string;
  readonly documentCount: number;
}

export function generateSyntheticCorpus(
  options: { readonly documentsPerLargeMatter?: number } = {},
): SyntheticCorpus {
  const documentsPerLargeMatter = options.documentsPerLargeMatter ?? 1000;
  const nextRandom = deterministicGenerator(0x5eed_ca55);

  const plans: readonly MatterPlan[] = [
    {
      matter: SYNTHETIC_MATTER_A,
      matterTag: "a",
      clientHandle: "client_wallprobealpha",
      documentCount: documentsPerLargeMatter,
    },
    {
      matter: SYNTHETIC_MATTER_B,
      matterTag: "b",
      clientHandle: "client_wallprobebeta",
      documentCount: documentsPerLargeMatter,
    },
    {
      matter: SYNTHETIC_MATTER_C,
      matterTag: "c",
      clientHandle: "client_wallprobegamma",
      documentCount: 1,
    },
  ];

  const documents: SyntheticDocument[] = [];
  for (const plan of plans) {
    for (let index = 0; index < plan.documentCount; index += 1) {
      // Six tokens no other document contains, plus two words from the shared vocabulary. The unique
      // tokens make this document the single best unfiltered hit for its own passage; the shared
      // words give every other document a small nonzero score, so a threshold-zero query fills its
      // result list and scope is genuinely decided by the filter rather than by empty rankings.
      const passageTokens: string[] = [];
      for (let tokenIndex = 0; tokenIndex < 6; tokenIndex += 1) {
        passageTokens.push(`vx${plan.matterTag}${index}q${tokenIndex}z`);
      }
      const verbatimPassage = [...passageTokens, "agreement", "schedule"].join(" ");

      const fillerTokens: string[] = [];
      for (let wordIndex = 0; wordIndex < 40; wordIndex += 1) {
        const pick = Math.floor(nextRandom() * FILLER_WORDS.length);
        fillerTokens.push(FILLER_WORDS[pick] ?? "record");
      }

      // Plant the shared nonsense token in every tenth document of both large matters.
      const planted = plan.documentCount > 1 && index % 10 === 0 ? ` ${SHARED_NONSENSE_TOKEN}` : "";

      const fileId = syntheticFileId(plan.matterTag, index);
      const version = 1;
      documents.push({
        fileId,
        version,
        objectKey: feedObjectKey(plan.matter, fileId, version),
        metadata: feedObjectMetadata(plan.matter, plan.clientHandle),
        text: `${fillerTokens.join(" ")} ${verbatimPassage}${planted}`,
        verbatimPassage,
      });
    }
  }

  return {
    matterA: SYNTHETIC_MATTER_A,
    matterB: SYNTHETIC_MATTER_B,
    matterC: SYNTHETIC_MATTER_C,
    documents,
    sharedNonsenseToken: SHARED_NONSENSE_TOKEN,
    documentsOfMatter(matter: MatterId): readonly SyntheticDocument[] {
      return documents.filter((document) => document.metadata.matter === matter);
    },
  };
}
