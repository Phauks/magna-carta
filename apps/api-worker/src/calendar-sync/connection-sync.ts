import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../bindings.ts";
import type { ProviderNotice } from "@magna-carta/calendar/sync-port";
import { readNotices, type WatchState } from "./change-watch.ts";
import { runConnectionPass, type ConnectionIdentity } from "./connection-pass.ts";

// ONE CONNECTED CALENDAR ACCOUNT, AND THE ONE PLACE ITS PASSES RUN.
//
// Keyed `${firmId}:${connectionId}`. A pass writes to a member's calendar and to the link rows
// that say what is there; two passes at once for one account could each see no copy of an event
// and each make one. An object runs one thing at a time, so giving every account its own makes
// that unrepresentable, and lets one account wait on its provider without holding up another.
//
// The object holds no event, no title and no token. It stores who it is for, how many times in a
// row the provider could not be reached, and the provider's change watch with the secret that
// proves a notice is the provider's. Everything else is read from the firm's database at the
// start of each pass, which is what lets a pass be asked for by anything, any number of times.
//
// A request does not run a pass. It sets an alarm a few seconds out, and a request that arrives
// while one is already set changes nothing: a member saving six events in a minute, or a firm
// changing a limit that touches forty accounts, costs each account one pass.

// Long enough to gather a burst of edits into one pass, short enough that a member who saves an
// event and turns to their calendar finds it there.
const SETTLE_MS = 5_000;
// A notice from the provider is one person's one change in their own calendar, and they are
// looking at the other calendar to see it arrive. Long enough to fold the two or three notices a
// single drag produces into one pass.
const NOTICE_SETTLE_MS = 1_000;
// A pass that stopped at its step limit has more to send and no reason to wait.
const CONTINUE_MS = 1_000;
// The pass that runs when nothing asked for one. It catches whatever no trigger covers: an event
// that entered the window by the passing of time, a matter assignment that changed, a request that
// was lost.
const SAFETY_MS = 6 * 60 * 60 * 1000;
// An unreachable provider is asked again after five minutes, then ten, doubling to two hours.
const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_CEILING_MS = 2 * 60 * 60 * 1000;

export function retryDelayMs(failuresInARow: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failuresInARow - 1), RETRY_CEILING_MS);
}

export class ConnectionSync extends DurableObject<Bindings> {
  async requestPass(identity: ConnectionIdentity): Promise<void> {
    await this.ctx.storage.put("identity", identity);
    await this.ask(SETTLE_MS);
  }

  // The provider says something in this account's calendar changed, or says something about the
  // watch itself. Believed only when it carries the watch's secret; anything else changes nothing
  // and is answered the same way, so the address tells a stranger nothing.
  async providerNotice(notices: readonly ProviderNotice[]): Promise<void> {
    const watch = await this.ctx.storage.get<WatchState>("watch");
    if (watch === undefined) return;
    const read = readNotices(watch, notices);
    if (read === null) return;
    if (read.watch !== watch) await this.ctx.storage.put("watch", read.watch);
    await this.ask(NOTICE_SETTLE_MS);
  }

  // A pass is wanted within `withinMs`. The mark is what a pass already running reads when it
  // finishes: an alarm set while one runs would be replaced by the alarm that pass sets on its
  // way out, and the request would wait for the safety pass.
  private async ask(withinMs: number): Promise<void> {
    await this.ctx.storage.put("asked", withinMs);
    const due = Date.now() + withinMs;
    const armed = await this.ctx.storage.getAlarm();
    if (armed === null || armed > due) await this.ctx.storage.setAlarm(due);
  }

  override async alarm(): Promise<void> {
    const identity = await this.ctx.storage.get<ConnectionIdentity>("identity");
    if (identity === undefined) return;
    // A pass that throws (the firm's database refusing, a key that will not unwrap) is treated as
    // a provider that could not be reached: counted, and tried again later. Left to throw, the
    // runtime would retry the alarm a handful of times and then stop, and the account would sit
    // idle until something happened to ask for a pass.
    await this.ctx.storage.delete("asked");
    const watch = (await this.ctx.storage.get<WatchState>("watch")) ?? null;
    const outcome = await runConnectionPass(this.env, identity, {}, watch).catch(
      () => ({ kind: "unavailable", watch }) as const,
    );
    if (outcome.kind === "settled" || outcome.kind === "more" || outcome.kind === "unavailable") {
      if (outcome.watch === null) await this.ctx.storage.delete("watch");
      else if (outcome.watch !== watch) await this.ctx.storage.put("watch", outcome.watch);
    }
    // Something asked for a pass while this one ran. It may have read the firm's database before
    // that change was written, so it runs again instead of waiting for the safety pass.
    const askedWhileRunning = await this.ctx.storage.get<number>("asked");
    switch (outcome.kind) {
      case "gone":
        // The member disconnected. Nothing of theirs is left here.
        await this.ctx.storage.deleteAll();
        return;
      case "dormant":
      case "sign-in-again":
        // Nothing runs until something changes, and whatever changes it asks for a pass.
        await this.ctx.storage.delete("failures");
        return;
      case "unavailable": {
        const failures = ((await this.ctx.storage.get<number>("failures")) ?? 0) + 1;
        await this.ctx.storage.put("failures", failures);
        await this.ctx.storage.setAlarm(Date.now() + retryDelayMs(failures));
        return;
      }
      case "more":
        await this.ctx.storage.delete("failures");
        await this.ctx.storage.setAlarm(Date.now() + CONTINUE_MS);
        return;
      case "settled":
        await this.ctx.storage.delete("failures");
        await this.ctx.storage.setAlarm(Date.now() + (askedWhileRunning ?? SAFETY_MS));
        return;
    }
  }
}
