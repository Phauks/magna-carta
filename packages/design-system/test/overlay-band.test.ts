import { describe, expect, it } from "vitest";
import { OverlayBand, type OverlayBandMember } from "../src/lib/internal/overlay-band.svelte.ts";

/*
 * The top bar's one-open-panel rule, pinned at the band.
 *
 * The rendered behaviour — a real press on a real trigger, the portaled panels, Bits' own
 * outside-press dismissal — belongs in a browser. What is asserted here is the arbitration the band
 * exists for: that opening one panel closes whichever other the band was holding, that the close it
 * asks for is the overlay's own, that a member reporting its own close does not clear out the one
 * that just took its place, and that a member which has gone away takes nothing with it.
 */

interface Panel extends OverlayBandMember {
  readonly open: boolean;
  /** What a press, a key or a hover does: the overlay opens itself and reports it. */
  openIt(): void;
  /** What Escape, a selection or a press outside does. */
  closeElsewhere(): void;
}

function panel(band: OverlayBand): Panel {
  let open = false;
  const member: Panel = {
    get open() {
      return open;
    },
    close() {
      if (!open) return;
      open = false;
      // The root's effect reports every change of `open` back, whichever route made it.
      band.closed(member);
    },
    openIt() {
      open = true;
      band.opened(member);
    },
    closeElsewhere() {
      open = false;
      band.closed(member);
    },
  };
  return member;
}

describe("one open overlay in a band", () => {
  it("closes the panel the band was holding when another opens", () => {
    const band = new OverlayBand();
    const downloads = panel(band);
    const uploads = panel(band);

    downloads.openIt();
    expect(downloads.open).toBe(true);

    uploads.openIt();
    expect(downloads.open).toBe(false);
    expect(uploads.open).toBe(true);
    expect(band.openMember).toBe(uploads);
  });

  it("keeps the newcomer when the panel it displaced reports its own close", () => {
    const band = new OverlayBand();
    const downloads = panel(band);
    const account = panel(band);

    downloads.openIt();
    account.openIt();

    // `close()` above calls back into the band, which is the whole hazard: the departing panel must
    // not clear the place the newcomer has already taken.
    expect(band.openMember).toBe(account);
    expect(account.open).toBe(true);
  });

  it("leaves a panel that reports itself open twice exactly where it was", () => {
    const band = new OverlayBand();
    const uploads = panel(band);

    uploads.openIt();
    uploads.openIt();

    expect(uploads.open).toBe(true);
    expect(band.openMember).toBe(uploads);
  });

  it("holds nobody once the open panel closes by a route of its own", () => {
    const band = new OverlayBand();
    const notifications = panel(band);

    notifications.openIt();
    notifications.closeElsewhere();

    expect(band.openMember).toBeNull();
  });

  it("ignores a closed panel reporting a close it did not make", () => {
    const band = new OverlayBand();
    const build = panel(band);
    const uploads = panel(band);

    uploads.openIt();
    build.closeElsewhere();

    expect(band.openMember).toBe(uploads);
    expect(uploads.open).toBe(true);
  });

  it("opens nothing on its own: a band with no member holds none", () => {
    const band = new OverlayBand();
    expect(band.openMember).toBeNull();
  });
});
