/*
 * WHETHER THE ABOUT WINDOW IS OPEN — held outside every surface that opens it, for the reason
 * issue-report.svelte.ts gives: the doors into it (the profile menu's Websites submenu, the command
 * palette) close as they open it, and a dialog parented to a closing surface goes down with it. The
 * shell mounts the one window (app-shell.svelte); a door only says "open".
 */
class AboutWindowState {
  #open = $state(false);

  get isOpen(): boolean {
    return this.#open;
  }

  /** Bound by the shell's dialog, so a dismiss by Escape, Close or click-away flows back here. */
  set isOpen(next: boolean) {
    this.#open = next;
  }

  open(): void {
    this.#open = true;
  }
}

export const aboutWindow = new AboutWindowState();
