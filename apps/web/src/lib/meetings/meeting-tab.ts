/*
 * A meeting opens in a TAB OF ITS OWN, outside the application's shell (the room page answers
 * `shell: "none"`), so the meeting can have the whole window while the member keeps working in the
 * tab they came from.
 *
 * ONE TAB PER MEETING. The tab is named for the meeting, so pressing Join again on a meeting that is
 * already open brings that tab forward rather than opening a second stay in the same room.
 *
 * THE TAB IS OPENED INSIDE THE PRESS. A browser lets a page open a window only while a press is in
 * progress, and Start and My Room only learn the meeting's address after a write. So those reserve
 * a blank tab on the press and point it at the room once the write answers, or close it if the
 * write is refused. Where the browser blocks the tab anyway, the room opens in this tab instead,
 * which is how it opened before.
 */
import { goto } from "$app/navigation";
import { reserveBeside } from "$lib/navigation/open-beside.ts";

/**
 * The room's address: its nine digits, /meeting/482-917-305, which is what every Join and Start
 * opens. The meeting's long reference (/meetings/<id>) is only the fallback for a meeting that has
 * no code, which no meeting written since the codes were introduced lacks.
 */
export function meetingRoomAddress(meetingId: string, joinCode: string | null = null): string {
  return joinCode === null
    ? `/meetings/${encodeURIComponent(meetingId)}`
    : meetingCodeAddress(joinCode);
}

/**
 * The meeting's own address, by its nine digits in three groups: /meeting/482-917-305. It is what a
 * member copies and sends, and what Join and Start open.
 */
export function meetingCodeAddress(joinCode: string): string {
  return `/meeting/${formatMeetingCode(joinCode)}`;
}

/** Nine digits as they are read aloud: 482-917-305. */
export function formatMeetingCode(joinCode: string): string {
  return /^\d{9}$/.test(joinCode)
    ? `${joinCode.slice(0, 3)}-${joinCode.slice(3, 6)}-${joinCode.slice(6)}`
    : joinCode;
}

/** The nine digits in an address or a typed code, with the dashes and spaces taken out. */
export function parseMeetingCode(typed: string): string | undefined {
  const digits = typed.replaceAll(/[\s-]/g, "");
  return /^\d{9}$/.test(digits) ? digits : undefined;
}

/** The name a meeting's tab is opened under, so a second press finds the first tab. */
export function meetingTabName(meetingId: string): string {
  return `meeting-${meetingId}`;
}

type WindowOpener = (url: string, target: string) => Window | null;

function opener(): WindowOpener | null {
  return typeof window === "undefined" || typeof window.open !== "function"
    ? null
    : (url, target) => window.open(url, target);
}

/** Open a meeting whose address is known now. Call it inside the press. */
export function openMeetingTab(
  meetingId: string,
  joinCode: string | null,
  open: WindowOpener | null = opener(),
): void {
  const address = meetingRoomAddress(meetingId, joinCode);
  const tab = open?.(address, meetingTabName(meetingId)) ?? null;
  if (tab === null) void goto(address);
  else tab.focus();
}

/** A tab reserved on a press for a meeting whose address a write has not answered yet. */
export interface ReservedMeetingTab {
  /** Point the tab at the room, or open the room here if no tab could be reserved. */
  open(meetingId: string, joinCode: string | null): void;
  /** The write was refused: give the tab back. */
  cancel(): void;
}

/** Reserve the tab. Call it inside the press, before anything is awaited. */
export function reserveMeetingTab(
  reserve: (() => Window | null) | null = typeof window === "undefined"
    ? null
    : () => reserveBeside("session"),
): ReservedMeetingTab {
  const tab = reserve?.() ?? null;
  return {
    open(meetingId, joinCode) {
      const address = meetingRoomAddress(meetingId, joinCode);
      if (tab === null || tab.closed) {
        void goto(address);
        return;
      }
      tab.name = meetingTabName(meetingId);
      tab.location.href = new URL(address, window.location.href).href;
      tab.focus();
    },
    cancel() {
      tab?.close();
    },
  };
}

/** Close the meeting's tab on the way out. A tab no page opened stays open; the caller moves on. */
export function closeMeetingTab(): void {
  if (typeof window !== "undefined" && window.opener !== null) window.close();
}
