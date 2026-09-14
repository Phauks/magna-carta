/*
 * WHETHER THE BUILD INFORMATION PANEL IS OPEN, held outside the chip that renders it.
 *
 * The chip owned its own `open` flag, which was right while pressing the chip was the only way in.
 * It is not any more: the command palette can reach it ($lib/developer/diagnostic-actions.ts), and a
 * palette item cannot reach into a component's local state. Threading a bindable prop from the shell
 * down through the header to the chip would work and would put a piece of this panel's state in
 * three files that have no other interest in it.
 *
 * So the flag lives here, beside the panel, and anything that wants to open it says so. The chip
 * still owns everything else — the reads, the fold state, the rendering — because those are nobody
 * else's business.
 *
 * ONE PANEL, ONE FLAG, ON PURPOSE. The chip renders on the signed-in shell and on the signed-out
 * auth frame, and only ever one of those is mounted at a time, so a single module-level flag cannot
 * put two panels on screen at once.
 */
class BuildPanelState {
  #open = $state(false);

  get isOpen(): boolean {
    return this.#open;
  }

  /** Bound by the chip's popover, so a dismiss by click-away or Escape flows back here. */
  set isOpen(next: boolean) {
    this.#open = next;
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }
}

export const buildPanel = new BuildPanelState();
