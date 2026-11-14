<script lang="ts">
  /*
   * A check's results, reviewable where they are shown: the cards and their filters, the result's
   * own window, and the answer dialog, as one piece.
   *
   * ONE PIECE, TWO SCREENS. The check's own report and a matter's Conflicts section both show the
   * results of a check and both let a reviewer answer them. They hold the same three parts and the
   * same wiring between them (a card opens the window, a review state picked on a card opens the
   * dialog on that state, an answer re-reads), so the wiring lives here once instead of twice.
   *
   * THE SCREEN OWNS THE READ. This piece never fetches the check: it is handed the results and tells
   * the screen when an answer was written, and the screen reads again however it reads.
   */
  import { untrack } from "svelte";
  import CheckResults from "./check-results.svelte";
  import DispositionDialog from "./disposition-dialog.svelte";
  import HitWindow from "./hit-window.svelte";
  import type { DispositionKind, HitDetail } from "./conflicts-api.ts";
  import { readDirectoryEntity } from "$lib/directory/directory-api.ts";
  import { directoryEntityName } from "$lib/directory/entity-presentation.ts";

  let {
    hits,
    checkInstant,
    matterId,
    mayReview,
    reviewRefusal,
    memberNames,
    memberText,
    signedInName,
    permissions,
    entityNames = $bindable(new Map<string, string>()),
    onRecorded,
  }: {
    /** The results of the run on screen. */
    hits: readonly HitDetail[];
    /** When the check that surfaced them ran. */
    checkInstant: string;
    /** The matter the check is filed on, so a waiver's confirmation can be picked from its files. */
    matterId: string | null;
    /** Whether the signed-in member may record an answer, and why not where they may not. */
    mayReview: boolean;
    reviewRefusal: string;
    /** The firm's roster by account handle, so a reviewer is a person. */
    memberNames: ReadonlyMap<string, string>;
    /** A member's name for a card, from their account handle. */
    memberText: (userId: string) => string;
    /** The signed-in member, as their name reads on an answer. */
    signedInName: string | null;
    permissions: readonly string[] | null;
    /**
     * Names learned for waivers' consenting parties, kept for the visit. Bound out, because the
     * check's printed report names them too.
     */
    entityNames?: ReadonlyMap<string, string>;
    /** An answer was written. The screen reads the check again. */
    onRecorded: () => void;
  } = $props();

  let openHit = $state<HitDetail | null>(null);
  let windowOpen = $state(false);
  let dialogOpen = $state(false);
  let dialogKind = $state<DispositionKind>("cleared");
  let unnameable = $state<ReadonlySet<string>>(new Set());

  // The open result is a copy of a row the screen has just read again; re-point it at the fresh one
  // so an answer recorded a moment ago shows in the window that is holding it.
  $effect(() => {
    const fresh = hits;
    const held = untrack(() => openHit);
    if (held !== null) openHit = fresh.find((hit) => hit.id === held.id) ?? null;
  });

  const reviewerName = $derived(
    openHit === null || openHit.disposition === null
      ? null
      : (memberNames.get(openHit.disposition.reviewerUserId) ?? null),
  );
  const openConsentingPartyName = $derived.by((): string | null => {
    const consentingPartyId = openHit?.disposition?.waiver?.givenByEntityId ?? null;
    return consentingPartyId === null ? null : (entityNames.get(consentingPartyId) ?? null);
  });

  /** One read, for a waiver's consenting party. What it learns is kept for the rest of the visit. */
  async function nameEntity(entityId: string): Promise<void> {
    if (entityNames.has(entityId) || unnameable.has(entityId)) return;
    const outcome = await readDirectoryEntity(fetch, entityId);
    if (outcome.kind !== "ok") {
      unnameable = new Set([...unnameable, entityId]);
      return;
    }
    entityNames = new Map([...entityNames, [entityId, directoryEntityName(outcome.value)]]);
  }

  function openOne(hit: HitDetail): void {
    openHit = hit;
    windowOpen = true;
    // Only the CONSENTING party still needs a read: a waiver names the entity that consented, which
    // is often not the entity that matched. The matched party came with the hit.
    const consentingPartyId = hit.disposition?.waiver?.givenByEntityId ?? null;
    if (consentingPartyId !== null) void nameEntity(consentingPartyId);
  }

  /** A review state picked from a result's card: the answer dialog opens on it. */
  function review(hit: HitDetail, kind: DispositionKind): void {
    openHit = hit;
    dialogKind = kind;
    dialogOpen = true;
  }
</script>

<CheckResults
  {hits}
  {mayReview}
  {reviewRefusal}
  memberName={memberText}
  onOpen={openOne}
  onReview={review}
/>

<HitWindow
  bind:open={windowOpen}
  hit={openHit}
  consentingPartyName={openConsentingPartyName}
  {reviewerName}
  {checkInstant}
  onAnswer={() => {
    dialogKind = "cleared";
    dialogOpen = true;
  }}
/>

<DispositionDialog
  bind:open={dialogOpen}
  hit={openHit}
  partyName={openHit?.party?.displayName ?? null}
  {matterId}
  reviewerName={signedInName}
  {permissions}
  initialKind={dialogKind}
  {onRecorded}
/>
