/*
 * THE WORDS FOR A WORKSPACE BEING BUILT — one home, beside the screen that shows them.
 *
 * The bootstrap reports the wait as facts about the firm's own record (a bucket exists, a key is
 * minted, the firm is active) and about this account's place in it; this module turns those facts
 * into the sequence a person reads. The split is the same one the database-health panel keeps: the
 * API carries states, the browser decides sentences, and the mapping is testable without a DOM.
 *
 * WHY A SEQUENCE AND NOT A SPINNER. "Please wait" is a request, not information — it cannot
 * distinguish a build three seconds in from one that has been going for two minutes, and it gives
 * somebody watching it nothing to tell support. Naming the steps costs nothing at runtime (the
 * facts are already read to answer "is it ready yet") and turns the wait into something a person
 * can follow.
 *
 * AND NOT A PROGRESS BAR. The steps are of wildly unequal length — allocating a bucket and minting a
 * key are seconds; the queue sweep between them is not — so a bar drawn at a fraction would be a
 * claim about how far along the work is, which is the one thing this screen does not know. A step
 * either has happened or has not, and that is what is shown.
 *
 * THE LAST STEP IS NOT PART OF THE BUILD REPORT, and cannot be. The member record is written into
 * the FIRM's own database by a queued message that only exists once the firm is active — by which
 * point the account belongs to a firm and the bootstrap has stopped reporting a build at all. So it
 * is carried separately, and it is the step that matters most to whoever is waiting: until it lands,
 * every screen in the workspace refuses.
 *
 * TWO WAITS SHARE THAT LAST STEP, and only one of them is a build. Somebody founding a firm watches
 * all five; somebody redeeming an invitation into a firm that has existed for years waits on the
 * fifth alone, and showing them four ticks against work nobody did today would be filler. So the
 * sequence is asked for by KIND, and the wording of the shared step names neither an owner nor an
 * invitee — it is the same act either way.
 */
import type { ProgressStep } from "@magna-carta/design-system/progress-steps";

/** The build's own marks, exactly as GET /api/v1/me reports them. */
export interface FirmBuildFacts {
  firmRecord: boolean;
  fileStorage: boolean;
  encryptionKey: boolean;
  activated: boolean;
  stalled: boolean;
}

/**
 * Everything a waiting screen knows: the build, plus the one step that outlives it. `memberRecord`
 * is this account's standing in the firm — false while the mirror is still landing — and
 * `memberRecordStalled` is that mirror having been given up on, which waiting will not fix.
 */
export interface FirmBuildReading extends FirmBuildFacts {
  memberRecord: boolean;
  memberRecordStalled: boolean;
}

/**
 * Which wait this is. `founding` makes the firm and then admits its owner; `joining` admits somebody
 * to a firm that already exists, so only the last step is theirs to wait on.
 */
export type JoinKind = "founding" | "joining";

/** Nothing has been reported yet — the reading a screen opens with before its first poll answers. */
export const FIRM_BUILD_UNREPORTED: FirmBuildReading = {
  firmRecord: false,
  fileStorage: false,
  encryptionKey: false,
  activated: false,
  stalled: false,
  memberRecord: false,
  memberRecordStalled: false,
};

/**
 * The reading for somebody whose firm is already active — every build step is done by construction,
 * because activation is the last of them and commits as one batch. Only this account's place in the
 * firm is still an open question, and the bootstrap's membership state answers it.
 */
export function firmBuiltReading(membership: {
  memberRecord: boolean;
  memberRecordStalled?: boolean;
}): FirmBuildReading {
  return {
    firmRecord: true,
    fileStorage: true,
    encryptionKey: true,
    activated: true,
    stalled: false,
    memberRecord: membership.memberRecord,
    memberRecordStalled: membership.memberRecordStalled ?? false,
  };
}

/*
 * The five steps, in the order the platform performs them. Each label says what is being made for
 * THIS firm rather than what the platform is doing to itself — "Setting up your document storage",
 * not "Creating an R2 bucket". A person waiting on a workspace is owed the first; the second is a
 * fact about our infrastructure that happens to be true at the same moment.
 *
 * The fifth is deliberately neutral about what the person becomes. It is the same write either way —
 * a member record in the firm's own database — and a founder reading "as its owner" would be
 * accurate at the cost of a second sentence for everybody else who waits on the same step.
 */
const BUILD_STEP_LABELS = [
  "Creating your firm's record",
  "Setting up your firm's document storage",
  "Generating your firm's encryption key",
  "Opening your firm's workspace",
] as const;

const MEMBER_STEP_LABEL = "Adding you to the firm";

/**
 * What a stopped step reads as. The steps component shows this INSTEAD of the step's own label, so
 * the sentence has to carry the label itself — otherwise the sequence says a step stopped and no
 * longer says which one, which is precisely the fact somebody has to give support. It also says what
 * to do, because there is nothing the person themselves can retry: the work is a committed row that
 * has run out of attempts.
 */
export function stalledStepFailure(label: string): string {
  return `${label} stopped and won't retry. Your firm is safe; support can restart it.`;
}

/** Whether the wait is over — the workspace exists and this account can actually use it. */
export function firmBuildComplete(reading: FirmBuildReading): boolean {
  return reading.activated && reading.memberRecord;
}

/** Whether the wait has stopped rather than merely being slow, at whichever step it stopped on. */
export function firmBuildStalled(reading: FirmBuildReading): boolean {
  return reading.stalled || reading.memberRecordStalled;
}

/**
 * The sequence, as the steps component renders it. The first step that has not happened is the one
 * in flight; everything after it is still to come, and knowing what is still to come is the whole
 * reason to render a sequence instead of a spinner.
 *
 * A stopped step is marked failed rather than dropped: the work reached it and stopped there, which
 * is exactly what the reader needs to be able to say to somebody.
 */
export function firmBuildSteps(
  reading: FirmBuildReading,
  kind: JoinKind = "founding",
): ProgressStep[] {
  const sequence: { label: string; done: boolean; stalled: boolean }[] =
    kind === "joining"
      ? []
      : [
          { label: BUILD_STEP_LABELS[0], done: reading.firmRecord, stalled: reading.stalled },
          { label: BUILD_STEP_LABELS[1], done: reading.fileStorage, stalled: reading.stalled },
          { label: BUILD_STEP_LABELS[2], done: reading.encryptionKey, stalled: reading.stalled },
          { label: BUILD_STEP_LABELS[3], done: reading.activated, stalled: reading.stalled },
        ];
  sequence.push({
    label: MEMBER_STEP_LABEL,
    done: reading.memberRecord,
    stalled: reading.memberRecordStalled,
  });

  let reached = false;
  return sequence.map(({ label, done, stalled }): ProgressStep => {
    if (done) return { label, status: "done" };
    // Only the FIRST outstanding step is the one in flight; the rest have not been reached.
    if (reached) return { label, status: "pending" };
    reached = true;
    return stalled
      ? { label, status: "failed", failure: stalledStepFailure(label) }
      : { label, status: "active" };
  });
}
