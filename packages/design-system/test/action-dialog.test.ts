import { describe, expect, it } from "vitest";
import {
  DISMISS_LABEL,
  LEAVE_LABEL,
  traitsOf,
  widthClass,
} from "../src/lib/components/action-dialog/action-dialog-model.ts";
import type {
  ActionDialogKind,
  ActionDialogWidth,
} from "../src/lib/components/action-dialog/types.ts";
import { CloseGuard } from "../src/lib/internal/close-guard.svelte.ts";

/*
 * ActionDialog's package-local contract.
 *
 * What is rendered belongs to the stories, which run in a real browser with axe. What is asserted
 * here is the part a rendered panel cannot show as clearly: the table of what each kind of ask
 * implies, and the guard every exit runs through. Both are the whole reason the shell exists — the
 * thirty-odd panels it replaces each answered these for themselves, and disagreed — so they are
 * pinned directly rather than inferred from a screenshot of one panel that happens to agree today.
 */

const EVERY_KIND: readonly ActionDialogKind[] = ["form", "confirm", "destructive", "reading"];
const EVERY_WIDTH: readonly ActionDialogWidth[] = ["narrow", "default", "wide", "record"];

describe("what a kind of ask implies", () => {
  it("renders a form as a dialog and a question as an alert dialog", () => {
    expect(traitsOf("form").primitive).toBe("dialog");
    expect(traitsOf("confirm").primitive).toBe("alert-dialog");
    expect(traitsOf("destructive").primitive).toBe("alert-dialog");
  });

  it("walks away with one word, whatever is being asked", () => {
    // The owner's ruling, and it is a constant rather than a per-kind field so that no kind can
    // drift back to a word of its own. The split it settled was thirteen "Cancel" to five "Close".
    expect(DISMISS_LABEL).toBe("Cancel");
    // And a panel that asked for nothing leaves through the record window's own reading word.
    expect(LEAVE_LABEL).toBe("Close");
  });

  it("gives a question no incidental dismiss — no corner control, no press outside", () => {
    for (const kind of ["confirm", "destructive"] as const) {
      expect(traitsOf(kind).showsCornerDismiss).toBe(false);
      expect(traitsOf(kind).dismissOnPressOutside).toBe(false);
    }
  });

  it("lets a form be put down, because something begun can be resumed", () => {
    expect(traitsOf("form").showsCornerDismiss).toBe(true);
    expect(traitsOf("form").dismissOnPressOutside).toBe(true);
  });

  it("colours the commit destructively only where it takes something away", () => {
    expect(traitsOf("form").commitVariant).toBe("primary");
    expect(traitsOf("confirm").commitVariant).toBe("primary");
    expect(traitsOf("destructive").commitVariant).toBe("destructive");
  });

  it("gives a reading panel no commit at all, by type and by trait", () => {
    // A panel that shows a thing asks for nothing. Its bar ends at the way out, and any step it
    // offers is seated in its body beside the fact the step changes — the matter's status window
    // is the case, and it refused a footer commit on purpose before this kind existed.
    expect(traitsOf("reading").commitVariant).toBeNull();
    expect(traitsOf("reading").primitive).toBe("dialog");
    expect(traitsOf("reading").showsCornerDismiss).toBe(true);
    expect(traitsOf("reading").dismissOnPressOutside).toBe(true);
  });

  it("offers to fill the screen only where there is something to gain from the room", () => {
    expect(traitsOf("form").expandable).toBe(true);
    expect(traitsOf("reading").expandable).toBe(true);
    expect(traitsOf("confirm").expandable).toBe(false);
    expect(traitsOf("destructive").expandable).toBe(false);
  });

  it("answers every kind, so a new one cannot be added without deciding what it implies", () => {
    for (const kind of EVERY_KIND) expect(traitsOf(kind)).toBeDefined();
  });
});

describe("how wide a panel opens", () => {
  it("gives every width a max-width utility, never a bare class", () => {
    for (const width of EVERY_WIDTH) expect(widthClass(width)).toMatch(/^max-w-/);
  });

  it("opens a creating panel at the width the record's own window opens at", () => {
    // A panel that creates a thing and the window that thing later opens in are the same size, so
    // the second does not read as a different place.
    expect(widthClass("record")).toBe("max-w-record-window");
  });

  it("gives the four widths four distinct answers", () => {
    expect(new Set(EVERY_WIDTH.map((width) => widthClass(width))).size).toBe(EVERY_WIDTH.length);
  });

  it("opens at the record width whenever there is a context pane, whatever was asked for", () => {
    // Two panes have bases of their own; a frame narrower than both squeezes each into something
    // neither was designed for. The shell decides it rather than letting a caller find out by eye.
    for (const width of EVERY_WIDTH) {
      expect(widthClass(width, { withContext: true })).toBe("max-w-record-window");
    }
  });
});

describe("the guard every exit runs through", () => {
  it("lets a gesture straight through when there is nothing to lose", () => {
    const guard = new CloseGuard(() => false);
    expect(guard.request("closeSurface")).toBe(true);
    expect(guard.asking).toBe(false);
  });

  it("holds the gesture and raises the question when there is", () => {
    const guard = new CloseGuard(() => true);
    expect(guard.request("closeSurface")).toBe(false);
    expect(guard.asking).toBe(true);
    expect(guard.pending).toBe("closeSurface");
  });

  it("hands the held gesture back when the reader discards, so the caller can carry it out", () => {
    const guard = new CloseGuard(() => true);
    guard.request("leaveEditing");
    expect(guard.release()).toBe("leaveEditing");
    expect(guard.asking).toBe(false);
  });

  it("abandons the gesture when the reader keeps working — it is not deferred", () => {
    const guard = new CloseGuard(() => true);
    guard.request("closeSurface");
    guard.dismiss();
    expect(guard.asking).toBe(false);
    expect(guard.release()).toBeNull();
  });

  it("reads the predicate at the moment of the gesture rather than holding it", () => {
    // A panel goes dirty and clean again while it is open. A guard that cached the answer at
    // construction would ask about work the reader has already saved, and — far worse — would let
    // a dirty panel close without asking because it was clean when it opened.
    let dirty = false;
    const guard = new CloseGuard(() => dirty);
    expect(guard.request("closeSurface")).toBe(true);
    dirty = true;
    expect(guard.request("closeSurface")).toBe(false);
    dirty = false;
    guard.dismiss();
    expect(guard.request("closeSurface")).toBe(true);
  });

  it("distinguishes the two gestures, because they resume differently", () => {
    const guard = new CloseGuard(() => true);
    guard.request("closeSurface");
    expect(guard.release()).toBe("closeSurface");
    guard.request("leaveEditing");
    expect(guard.release()).toBe("leaveEditing");
  });
});
