// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("$app/navigation", () => ({ goto: vi.fn(() => Promise.resolve()) }));

const { goto } = await import("$app/navigation");
const { meetingTabName, openMeetingTab, reserveMeetingTab } =
  await import("../src/lib/meetings/meeting-tab.ts");

function fakeTab() {
  return {
    name: "",
    closed: false,
    location: { href: "about:blank" },
    focus: vi.fn(),
    close: vi.fn(),
  };
}

describe("a meeting's own tab", () => {
  it("opens a known meeting under the meeting's name, so a second press finds the same tab", () => {
    const tab = fakeTab();
    const open = vi.fn(() => tab as unknown as Window);
    openMeetingTab("meeting_1", "482917305", open);
    // The nine digits, never the meeting's long reference.
    expect(open).toHaveBeenCalledWith("/meeting/482-917-305", meetingTabName("meeting_1"));
    expect(tab.focus).toHaveBeenCalled();
  });

  it("points a reserved tab at the room once the write answers", () => {
    const tab = fakeTab();
    const reserved = reserveMeetingTab(() => tab as unknown as Window);
    reserved.open("meeting_2", "100200300");
    expect(tab.name).toBe(meetingTabName("meeting_2"));
    expect(tab.location.href.endsWith("/meeting/100-200-300")).toBe(true);
  });

  it("gives a reserved tab back when the write is refused", () => {
    const tab = fakeTab();
    reserveMeetingTab(() => tab as unknown as Window).cancel();
    expect(tab.close).toHaveBeenCalled();
  });

  it("opens the room in this tab when the browser blocks a new one", () => {
    openMeetingTab("meeting_3", "300300300", () => null);
    expect(goto).toHaveBeenCalledWith("/meeting/300-300-300");
    // A meeting with no code falls back to its long reference rather than going nowhere.
    reserveMeetingTab(() => null).open("meeting_4", null);
    expect(goto).toHaveBeenCalledWith("/meetings/meeting_4");
  });
});
