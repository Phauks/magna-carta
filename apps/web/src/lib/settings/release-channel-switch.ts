/*
 * The Beta Access switch's two rules, pure so a node test can pin them: what the switch READS,
 * and what a press ASKS.
 *
 * The switch is bound to the session's channel through a getter/setter pair rather than driven
 * one-way. The design system's Switch owns a copy of `checked` when nothing binds it, so a press
 * flipped the copy, the page opened the consent dialog, and cancelling never put the copy back —
 * the switch showed on while the firm was still on the released build. With the getter here the
 * switch always re-reads the channel, and with the setter here a press only ever asks: the
 * channel moves when the server has agreed and the session has been re-read, and not before.
 */
import type { ReleaseChannel } from "./release-channel-api.ts";

/** The plate heading over the one row. "Beta Branch", by the owner's ruling of 2026-09-11. */
export const BETA_BRANCH_PLATE_HEADING = "Beta Branch";

/** What the switch reads: on only while the firm is actually on beta. Null (unread) reads off. */
export function releaseChannelSwitchChecked(channel: ReleaseChannel | null): boolean {
  return channel === "beta";
}

/**
 * What a press asks for. Joining asks first (the consent dialog), because the server refuses beta
 * without an acknowledgement; leaving asks nothing, because the server asks nothing to go back.
 * Neither moves the switch: the channel does, once the server has agreed.
 */
export function releaseChannelSwitchRequest(next: boolean): "ask-consent" | "leave" {
  return next ? "ask-consent" : "leave";
}
