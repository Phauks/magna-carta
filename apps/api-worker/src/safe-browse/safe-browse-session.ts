/*
 * One live browsing session, belonging to one member.
 *
 * WHAT IT HOLDS, AND WHAT IT DELIBERATELY DOES NOT. It holds the remote browser's session id and
 * where that browser was left — a few dozen bytes. It does NOT hold the browser handle, because a
 * handle cannot survive the object being evicted and a session id can; reconnecting to the id is
 * what the platform probe measured, and it is what makes this object cheap enough to keep one per
 * member.
 *
 * It also holds no browsing history. A member walking a suspect link through its steps is doing
 * security hygiene, not building a record, and a per-member log of the dubious addresses they
 * visited is a liability rather than a feature. The object's whole state is replaced on every
 * navigation.
 *
 * ADDRESSED `${firmId}:${userId}`, firm-namespaced for the same reason the live timer is: a session
 * named by user id alone could be reached from another firm by a caller who knew the id. The firm
 * comes from the chokepoint's resolved session, never from anything the request carries.
 *
 * THE ALARM IS THE COST CONTROL. A held browser is billed for the time it is held, so a session
 * nobody is watching is money leaving for nothing. The alarm closes the remote browser and clears
 * the record; it is re-armed on every navigation, so an active member keeps their session and an
 * absent one does not.
 */
import { DurableObject } from "cloudflare:workers";
import puppeteer from "@cloudflare/puppeteer";
import type { BrowserWorker } from "@cloudflare/puppeteer";
import type { LiveSessionRecord } from "@magna-carta/safe-browse";

const RECORD_KEY = "session";

// How long a session survives with nobody navigating it. Short on purpose: the member is reading a
// screenshot, and the browser on the other end is idle the whole time they read. The service's own
// keep-alive tops out at ten minutes and is the ceiling this sits under, not a target.
export const LIVE_SESSION_IDLE_MILLISECONDS = 3 * 60 * 1000;

export class SafeBrowseSession extends DurableObject<{ BROWSER: unknown }> {
  /** What browser this member has, if any. */
  async read(): Promise<LiveSessionRecord | null> {
    return (await this.ctx.storage.get<LiveSessionRecord>(RECORD_KEY)) ?? null;
  }

  /** Record the browser this member is now using, and restart the idle countdown. */
  async write(record: LiveSessionRecord): Promise<void> {
    await this.ctx.storage.put(RECORD_KEY, record);
    await this.ctx.storage.setAlarm(Date.now() + LIVE_SESSION_IDLE_MILLISECONDS);
  }

  /**
   * End the session: close the remote browser and forget it. Safe to call when there is nothing to
   * close, because the member's "close" and the alarm both arrive here and either may be first.
   */
  async end(): Promise<void> {
    const record = await this.read();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    if (record === null) return;
    try {
      const browser = await puppeteer.connect(this.env.BROWSER as BrowserWorker, record.sessionId);
      await browser.close();
    } catch {
      // The service reaps idle sessions itself, so a browser that has already gone is the expected
      // case rather than a fault. Either way the record is cleared above — a close that threw must
      // not leave a member pinned to a browser that no longer exists.
    }
  }

  // The member stopped navigating. Close their browser rather than billing for one nobody is using.
  override async alarm(): Promise<void> {
    await this.end();
  }
}
