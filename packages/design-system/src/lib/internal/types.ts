/*
 * Wrapper prop-type helpers for the styled layer over Bits UI.
 *
 * Bits UI v2 already exports these exact helpers from its root entry (verified
 * against bits-ui 2.18.1, dist/shared/index.d.ts), so we RE-EXPORT them rather than
 * redefine — a single definition keeps our wrapper props structurally identical to
 * what Bits components expect, with no drift. If a future Bits release drops one,
 * define it locally here with the same shape:
 *
 *   WithElementRef<T, U = HTMLElement>  adds the bindable `ref?: U | null` slot
 *   WithoutChildren<T>                  strips `children` (the wrapper renders its own)
 *   WithoutChild<T>                     strips Bits' `child` delegation snippet
 *   WithoutChildrenOrChild<T>           strips both
 */
export type {
  WithElementRef,
  WithoutChild,
  WithoutChildren,
  WithoutChildrenOrChild,
} from "bits-ui";
