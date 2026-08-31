/*
 * Back, forward and up — all three, because a file manager without them is a file manager somebody
 * has to close and reopen to get out of. Pure, so the awkward cases (going back to a folder that
 * has since been deleted, forward after a new navigation, up from the root) are testable without a
 * DOM.
 *
 * A new navigation clears the forward stack, which is what every browser and every file manager
 * does: the branch you left is not somewhere "forward" leads any more.
 */

/** Where the surface is standing: a view, and within the browse view a folder. */
export interface NavigationPlace {
  readonly view: string;
  readonly folderId: string | null;
}

export function samePlace(left: NavigationPlace, right: NavigationPlace): boolean {
  return left.view === right.view && left.folderId === right.folderId;
}

export class NavigationHistory {
  private backward: NavigationPlace[];
  private forward: NavigationPlace[] = [];
  private here: NavigationPlace;

  constructor(start: NavigationPlace) {
    this.here = start;
    this.backward = [];
  }

  get place(): NavigationPlace {
    return this.here;
  }

  get canGoBack(): boolean {
    return this.backward.length > 0;
  }

  get canGoForward(): boolean {
    return this.forward.length > 0;
  }

  /** Where Back would land, so the control can say what pressing it will do. */
  get backTarget(): NavigationPlace | null {
    return this.backward.at(-1) ?? null;
  }

  get forwardTarget(): NavigationPlace | null {
    return this.forward.at(-1) ?? null;
  }

  /** Go somewhere new. Navigating to where you already are is not a navigation. */
  go(next: NavigationPlace): NavigationPlace {
    if (samePlace(next, this.here)) return this.here;
    this.backward.push(this.here);
    this.forward = [];
    this.here = next;
    return this.here;
  }

  back(): NavigationPlace {
    const previous = this.backward.pop();
    if (previous === undefined) return this.here;
    this.forward.push(this.here);
    this.here = previous;
    return this.here;
  }

  goForward(): NavigationPlace {
    const next = this.forward.pop();
    if (next === undefined) return this.here;
    this.backward.push(this.here);
    this.here = next;
    return this.here;
  }

  /**
   * Drop any remembered place that names a folder no longer on the matter. A deleted folder must
   * not sit in the Back stack waiting to strand a reader in a place that does not exist.
   */
  forget(missingFolderIds: ReadonlySet<string>): void {
    const survives = (place: NavigationPlace): boolean =>
      place.folderId === null || !missingFolderIds.has(place.folderId);
    this.backward = this.backward.filter(survives);
    this.forward = this.forward.filter(survives);
  }
}
