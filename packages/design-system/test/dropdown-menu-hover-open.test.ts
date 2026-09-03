import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOVER_CLOSE_DELAY_MS,
  HOVER_OPEN_DELAY_MS,
  HoverOpenController,
} from "../src/lib/components/dropdown-menu/hover-open.ts";

/*
 * DropdownMenu's hover activation, pinned at the controller.
 *
 * The rendered behaviour — a real pointer over a real trigger, the portaled panel, Bits' own focus
 * moves — belongs to the DropdownMenu stories, which run in a browser. What is asserted here is the
 * timing and the arbitration, which a browser story can only sample: that a pointer passing through
 * opens nothing, that a menu the pointer opened follows the pointer and one a press opened does
 * not, that hover never steals focus, and that two hover menus cannot be open at once.
 */

interface Menu {
  readonly controller: HoverOpenController;
  readonly open: boolean;
  /** What Bits does on a press, a key, or a tap: opens the menu itself and reports the change. */
  openDeliberately(): void;
  /** What Bits does on a selection, Escape, or a press outside. */
  closeElsewhere(): void;
}

function menu(enabled = true): Menu {
  let open = false;
  const controller = new HoverOpenController({
    enabled: () => enabled,
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
      // Root's effect reports every change of `open` back, whichever route made it.
      controller.openChanged(next);
    },
  });
  return {
    controller,
    get open() {
      return open;
    },
    openDeliberately() {
      open = true;
      controller.openChanged(true);
    },
    closeElsewhere() {
      open = false;
      controller.openChanged(false);
    },
  };
}

interface FakePointerEvent {
  pointerType: string;
  button: number;
  defaultPrevented: boolean;
  preventDefault(): void;
}

function pointer(overrides: Partial<FakePointerEvent> = {}): PointerEvent & FakePointerEvent {
  const event: FakePointerEvent = {
    pointerType: "mouse",
    button: 0,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...overrides,
  };
  return event as PointerEvent & FakePointerEvent;
}

function focusEvent(): Event & { defaultPrevented: boolean } {
  return pointer() as unknown as Event & { defaultPrevented: boolean };
}

/** A stand-in for the panel element: which document it is in, and what it contains. */
function panel(containsActiveElement: boolean): HTMLElement {
  return {
    ownerDocument: { activeElement: {} },
    contains: () => containsActiveElement,
  } as unknown as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("opening by hover", () => {
  it("opens once the pointer has rested on the trigger for the wait", () => {
    const money = menu();
    money.controller.pointerEnter(pointer());
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS - 1);
    expect(money.open).toBe(false);
    vi.advanceTimersByTime(1);
    expect(money.open).toBe(true);
    expect(money.controller.openedByHover).toBe(true);
  });

  it("opens nothing for a pointer that crosses the trigger on its way elsewhere", () => {
    const money = menu();
    money.controller.pointerEnter(pointer());
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS - 1);
    money.controller.pointerLeave(pointer());
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS * 4);
    expect(money.open).toBe(false);
  });

  it("ignores a touch, which reports a pointer it cannot hold there", () => {
    const money = menu();
    money.controller.pointerEnter(pointer({ pointerType: "touch" }));
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS * 4);
    expect(money.open).toBe(false);
  });

  it("does nothing for a menu that has hover activation turned off", () => {
    const clickOnly = menu(false);
    clickOnly.controller.pointerEnter(pointer());
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS * 4);
    expect(clickOnly.open).toBe(false);
  });

  it("yields to a deliberate open that lands during the wait, rather than opening twice", () => {
    const money = menu();
    money.controller.pointerEnter(pointer());
    money.openDeliberately();
    money.closeElsewhere();
    // The pending hover intent was cancelled by the press; the menu the reader just closed stays
    // closed rather than springing back open when the timer would have fired.
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS * 4);
    expect(money.open).toBe(false);
  });
});

describe("a hover-opened menu follows the pointer", () => {
  function hoverOpen(): Menu {
    const opened = menu();
    opened.controller.pointerEnter(pointer());
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS);
    expect(opened.open).toBe(true);
    return opened;
  }

  it("closes a linger after the pointer has left", () => {
    const money = hoverOpen();
    money.controller.pointerLeave(pointer());
    vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS - 1);
    expect(money.open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(money.open).toBe(false);
    expect(money.controller.openedByHover).toBe(false);
  });

  it("stays open when the pointer crosses from the trigger into the panel within the linger", () => {
    const money = hoverOpen();
    money.controller.pointerLeave(pointer());
    vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS - 1);
    money.controller.pointerEnter(pointer());
    vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS * 4);
    expect(money.open).toBe(true);
  });

  it("keeps a press on the trigger from toggling it shut", () => {
    const money = hoverOpen();
    const press = pointer();
    money.controller.triggerPointerDown(press);
    expect(press.defaultPrevented).toBe(true);
    expect(money.open).toBe(true);
  });

  it("closes at once when hover opens a neighbouring menu", () => {
    const money = hoverOpen();
    const record = menu();
    money.controller.pointerLeave(pointer());
    record.controller.pointerEnter(pointer());
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS);
    expect(record.open).toBe(true);
    expect(money.open).toBe(false);
  });

  it("has nothing left to close once a selection or Escape has closed it", () => {
    const money = hoverOpen();
    money.closeElsewhere();
    expect(money.controller.openedByHover).toBe(false);
    money.controller.pointerLeave(pointer());
    // Re-open deliberately inside the linger: the stale hover close must not fire on it.
    money.openDeliberately();
    vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS * 4);
    expect(money.open).toBe(true);
  });
});

describe("a menu opened deliberately is not hover's to close", () => {
  it("stays open when the pointer leaves", () => {
    const money = menu();
    money.openDeliberately();
    money.controller.pointerEnter(pointer());
    money.controller.pointerLeave(pointer());
    vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS * 4);
    expect(money.open).toBe(true);
  });

  it("lets a press on the trigger toggle it, as Bits always did", () => {
    const money = menu();
    money.openDeliberately();
    const press = pointer();
    money.controller.triggerPointerDown(press);
    expect(press.defaultPrevented).toBe(false);
  });
});

describe("focus", () => {
  it("stays where it was when hover opens the menu, and when that menu closes untouched", () => {
    const money = menu();
    money.controller.pointerEnter(pointer());
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS);
    const opening = focusEvent();
    money.controller.openAutoFocus(opening);
    expect(opening.defaultPrevented).toBe(true);
    const closing = focusEvent();
    money.controller.closeAutoFocus(closing, panel(false));
    expect(closing.defaultPrevented).toBe(true);
  });

  it("returns to the trigger on close once it has entered a hover-opened panel", () => {
    const money = menu();
    money.controller.pointerEnter(pointer());
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS);
    const closing = focusEvent();
    money.controller.closeAutoFocus(closing, panel(true));
    expect(closing.defaultPrevented).toBe(false);
  });

  it("moves into the panel and back as Bits decides when a press opened the menu", () => {
    const money = menu();
    money.openDeliberately();
    const opening = focusEvent();
    money.controller.openAutoFocus(opening);
    expect(opening.defaultPrevented).toBe(false);
    const closing = focusEvent();
    money.controller.closeAutoFocus(closing, panel(false));
    expect(closing.defaultPrevented).toBe(false);
  });
});
