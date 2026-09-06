/*
 * The arithmetic of a modal panel's place on the screen, kept pure so it can be tested without a
 * browser and read without one: what the sweep (geometry.spec.ts) measures is a box and a viewport,
 * and everything it then says about them is decided here.
 */

/** A panel's box in viewport pixels, as getBoundingClientRect reports it. */
export interface PanelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** How far the panel sits from each edge of the viewport; zero means it touches. */
export interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function edgesOf(box: PanelBox, viewport: ViewportSize): Edges {
  return {
    left: box.x,
    top: box.y,
    right: viewport.width - box.x - box.width,
    bottom: viewport.height - box.y - box.height,
  };
}

/** Sub-pixel layout rounds; anything within this many pixels counts as exact. */
export const TOLERANCE = 1;

/**
 * What a WINDOWED panel must satisfy: the stage keeps the gutter on every side, so no edge may be
 * nearer than the gutter. A panel narrower or shorter than the stage sits further in, which is
 * fine; the rule is a floor, never a target.
 */
export function windowedViolations(edges: Edges, gutter: number): string[] {
  if (!(gutter > 0)) return [`the stage's gutter should be a positive length, not ${gutter}`];
  return (Object.entries(edges) as [keyof Edges, number][])
    .filter(([, distance]) => distance < gutter - TOLERANCE)
    .map(
      ([edge, distance]) =>
        `${edge} edge is ${distance}px from the screen; the gutter is ${gutter}px`,
    );
}

/** What an EXPANDED panel must satisfy: it is the screen, so every edge is touched. */
export function expandedViolations(edges: Edges): string[] {
  return (Object.entries(edges) as [keyof Edges, number][])
    .filter(([, distance]) => Math.abs(distance) > TOLERANCE)
    .map(
      ([edge, distance]) =>
        `${edge} edge is ${distance}px from the screen; expanded, it should touch`,
    );
}

const whole = (value: number): string => String(Math.round(value));

/** One line a reader can scan: `L32 T32 R32 B32`. */
export function formatEdges(edges: Edges): string {
  return `L${whole(edges.left)} T${whole(edges.top)} R${whole(edges.right)} B${whole(edges.bottom)}`;
}
