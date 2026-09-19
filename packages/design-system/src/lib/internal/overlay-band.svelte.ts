/*
 * A band of controls that holds at most one open overlay.
 *
 * The top bar is a strip of icon controls a few pixels apart, and nearly every one of them opens a
 * panel over the work canvas: the build report, the notifications, the two transfer registers, the
 * account menu. Two of those panels open at once cover each other and the screen the member was
 * reading, and nobody asked for the first one to stay — pressing the second control is how a person
 * says they are done with the first. WHICH panel is open is therefore a fact about the BAND rather
 * than about any one control, and the band is where it is kept.
 *
 * WHY THE OVERLAYS CANNOT SETTLE IT AMONG THEMSELVES. Bits closes an open panel when a press lands
 * outside it, but only for the layer it holds responsible, and that is the last dismissible layer to
 * have opened. A hover label is one of those layers, and every control in this band names itself on
 * hover — so a press on the neighbour while its label is showing makes the LABEL the responsible
 * layer, and the panel underneath is never asked to close. That is why the fault was intermittent
 * rather than constant: it turned on whether the hover label had appeared yet, which turns on how
 * long the pointer rested on the way. The band does not arbitrate by pointer at all. A member
 * reports that it is open, and whatever the band was holding closes.
 *
 * WHAT IT DOES NOT CHANGE. Every deliberate route stays Bits': a press on a control toggles its own
 * panel, the keyboard opens and walks it, Escape closes it, a press outside closes it. This adds one
 * rule and no gestures. It is plain state rather than runes — nothing renders from it, and every
 * read happens inside the effect that reports a change.
 *
 * A PANEL'S OWN CONTENTS ARE NOT IN THE BAND. A member re-declares the band as none for everything
 * it renders, so a menu raised inside a tray cannot shut the tray it was raised from.
 */
import { getContext, setContext } from "svelte";

const OVERLAY_BAND_KEY = Symbol("mc-overlay-band");

/** What the band needs of an overlay: the overlay's own way of shutting itself. */
export interface OverlayBandMember {
  /** Close this overlay now, by the same route Escape would. */
  close(): void;
}

/** The one open overlay a band of controls is allowed, and the handover between members. */
export class OverlayBand {
  #openMember: OverlayBandMember | null = null;

  /** Whichever member the band holds open, or null while it holds none. */
  get openMember(): OverlayBandMember | null {
    return this.#openMember;
  }

  /** A member reports that it is open. Whatever the band was holding closes, at once. */
  opened(member: OverlayBandMember): void {
    if (this.#openMember === member) return;
    const previous = this.#openMember;
    // Handed on BEFORE the close, so the departing member's own report of its change finds the band
    // already holding the newcomer and does not clear the newcomer back out again.
    this.#openMember = member;
    previous?.close();
  }

  /** A member reports that it is closed, by whichever route closed it. */
  closed(member: OverlayBandMember): void {
    if (this.#openMember === member) this.#openMember = null;
  }
}

/** Declare that everything rendered inside this component shares one open overlay. */
export function setOverlayBand(band: OverlayBand | null): void {
  setContext(OVERLAY_BAND_KEY, band);
}

/** The band an overlay stands in, or null where there is none — which is most of the application. */
export function getOverlayBand(): OverlayBand | null {
  return getContext<OverlayBand | null | undefined>(OVERLAY_BAND_KEY) ?? null;
}

/**
 * Join the band this overlay stands in, for as long as it is mounted.
 *
 * Called by a floating root during its own initialization. A root standing in no band does nothing
 * at all, which is why every popover and menu in the product can call it unconditionally.
 *
 * @param isOpen Whether this overlay is open right now, read reactively.
 * @param close How this overlay shuts itself when the band hands its place to somebody else.
 */
export function joinOverlayBand(isOpen: () => boolean, close: () => void): void {
  const band = getOverlayBand();
  if (band === null) return;
  setOverlayBand(null);
  const member: OverlayBandMember = { close };
  $effect(() => {
    if (isOpen()) band.opened(member);
    else band.closed(member);
  });
  $effect(() => () => band.closed(member));
}
