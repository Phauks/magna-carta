import { describe, expect, it } from "vitest";
import type {
  WithElementRef,
  WithoutChild,
  WithoutChildren,
  WithoutChildrenOrChild,
} from "../src/lib/internal/types.ts";

/*
 * Compile-time proofs in the house negative-proof style (see packages/identifiers
 * test/brand-types.ts): each @ts-expect-error line FAILS the typecheck gate
 * (`vp check`) if the helper stops stripping/adding what it claims to. Unlike
 * brand-types.ts this file also executes under vitest, so every proof is an
 * object-literal assignment (excess-property / value-type check) — runtime-safe by
 * construction. Each proof stays on ONE line: @ts-expect-error only suppresses the
 * line directly below it.
 */

type Props = { label: string; children?: string; child?: string };
type ButtonProps = WithElementRef<{ label: string }, HTMLButtonElement>;

// --- WithoutChild strips `child` (and only `child`) ---

// @ts-expect-error - `child` must be rejected once WithoutChild has stripped it
export const childStripped: WithoutChild<Props> = { label: "a", child: "x" };

// POSITIVE control: `children` survives WithoutChild.
export const childrenSurvive: WithoutChild<Props> = { label: "a", children: "x" };

// --- WithoutChildren strips `children` (and only `children`) ---

// @ts-expect-error - `children` must be rejected once WithoutChildren has stripped it
export const childrenStripped: WithoutChildren<Props> = { label: "a", children: "x" };

// POSITIVE control: `child` survives WithoutChildren.
export const childSurvives: WithoutChildren<Props> = { label: "a", child: "x" };

// --- WithoutChildrenOrChild strips both ---

// @ts-expect-error - `child` must be rejected by WithoutChildrenOrChild
export const strippedChild: WithoutChildrenOrChild<Props> = { label: "a", child: "x" };

// @ts-expect-error - `children` must be rejected by WithoutChildrenOrChild
export const strippedChildren: WithoutChildrenOrChild<Props> = { label: "a", children: "x" };

// POSITIVE control: the remaining props still typecheck.
export const remainderSurvives: WithoutChildrenOrChild<Props> = { label: "a" };

// --- WithElementRef adds a bindable `ref` slot typed to the element ---

// POSITIVE controls: `ref` accepts the element type and null, and may be omitted entirely.
export const refNull: ButtonProps = { label: "a", ref: null };
export const refOmitted: ButtonProps = { label: "a" };

// @ts-expect-error - `ref` must be HTMLButtonElement | null, never an arbitrary string
export const refWrongType: ButtonProps = { label: "a", ref: "not-an-element" };

// @ts-expect-error - a div must not satisfy a ref slot typed to HTMLButtonElement
export const refWrongElement: ButtonProps = { label: "a", ref: {} as HTMLDivElement };

describe("wrapper type helpers", () => {
  it("WithElementRef leaves runtime values untouched (the ref slot is purely additive)", () => {
    expect(refNull.ref).toBeNull();
    expect(refNull.label).toBe("a");
    expect("ref" in refOmitted).toBe(false);
  });

  it("Without* helpers are type-level only (the surviving props reach runtime intact)", () => {
    expect(childrenSurvive.children).toBe("x");
    expect(childSurvives.child).toBe("x");
    expect(remainderSurvives.label).toBe("a");
  });
});
