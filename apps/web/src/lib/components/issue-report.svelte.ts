/*
 * WHETHER THE ISSUE REPORTER IS OPEN, and what diagnosis it is carrying — held outside every
 * surface that opens it.
 *
 * Three surfaces reach for the same dialog (the profile menu, the command palette, the Build
 * Information panel) and each used to mount its own copy beside its own trigger. That works while
 * the trigger outlives the dialog. The Build Information panel is the case where it does not: its
 * report lives inside the chip's popover, so pressing Report an Issue rendered the dialog INSIDE
 * the popover it had just told to close — the popover's exit took the dialog down with it about a
 * second later, which read as the report opening and then refusing to stay open.
 *
 * A dialog cannot be a child of the thing that dismisses it. So the flag lives here, the shell
 * mounts the one dialog (app-shell.svelte), and anything that wants to file a report says so —
 * the same move build-panel.svelte.ts makes for the panel's own open flag, and for the same
 * reason: a surface that is closing cannot own state that has to survive the close.
 *
 * ONE DIALOG, ONE DRAFT. The copies also meant three drafts: a half-written report begun from the
 * palette was invisible from the profile menu, and reopening from the other door showed an empty
 * field. There is one draft now, which is what a person who typed it expects to find.
 */
class IssueReportState {
  #open = $state(false);
  #deployment = $state<string | null>(null);

  get isOpen(): boolean {
    return this.#open;
  }

  /** Bound by the shell's dialog, so a dismiss by Escape, Close or click-away flows back here. */
  set isOpen(next: boolean) {
    this.#open = next;
  }

  /**
   * What the deployment was doing, from a surface that knew — the Build Information panel's whole
   * diagnosis, or null from a door that has none. It outlives the close on purpose: the dialog
   * keeps an unfiled draft across an accidental dismiss, and a draft that came back without the
   * diagnosis it was written about would file a report missing the half nobody can retype.
   */
  get deployment(): string | null {
    return this.#deployment;
  }

  /** Open the reporter, carrying whatever the opening surface can say about the deployment. */
  open(deployment: string | null = null): void {
    this.#deployment = deployment;
    this.#open = true;
  }
}

export const issueReport = new IssueReportState();
