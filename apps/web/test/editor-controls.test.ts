import { describe, expect, it } from "vitest";
import {
  BACK_ICON_DATA_URL,
  BACK_TO_MATTER_BUTTON_ID,
  backToMatterButton,
  hostSignalOf,
  insertButtonMessage,
  routeCloseThroughHostMessage,
  saveBeforeLeavingMessage,
} from "../src/lib/documents/editor-controls.ts";

/*
 * The editor reads and writes JSON strings, and it is particular about the shape: a message it
 * cannot parse is silently dropped, and a button whose values are wrong is a button that never
 * appears. So what is held here is the shape, field by field, on both directions.
 */

const parse = (text: string): { MessageId: string; Values: Record<string, unknown> } =>
  JSON.parse(text) as { MessageId: string; Values: Record<string, unknown> };

describe("insertButtonMessage", () => {
  it("asks for the button with the fields the editor's shortcuts bar reads", () => {
    const sent = parse(insertButtonMessage(backToMatterButton("Acme v. Jones")));
    expect(sent.MessageId).toBe("Insert_Button");
    expect(sent.Values).toMatchObject({
      id: BACK_TO_MATTER_BUTTON_ID,
      label: "Matter",
      hint: "Back to Acme v. Jones",
      imgurl: BACK_ICON_DATA_URL,
      mobile: true,
      tablet: true,
    });
    // No unoCommand: with one set the editor would run it and never tell the host about the click.
    expect("unoCommand" in sent.Values).toBe(false);
  });

  it("carries the icon as a data: URL, which is the one image source the editor's page allows", () => {
    expect(BACK_ICON_DATA_URL.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(BACK_ICON_DATA_URL)).toContain("<svg");
  });
});

describe("the host's two other messages", () => {
  it("routes the editor's own Close through the host", () => {
    const sent = parse(routeCloseThroughHostMessage());
    expect(sent.MessageId).toBe("Disable_Default_UIAction");
    expect(sent.Values).toEqual({ action: "UI_Close", disable: true });
  });

  it("asks for a save that reports back, skips an unmodified document and keeps the edit open", () => {
    const sent = parse(saveBeforeLeavingMessage());
    expect(sent.MessageId).toBe("Action_Save");
    expect(sent.Values).toEqual({
      Notify: true,
      DontSaveIfUnmodified: true,
      DontTerminateEdit: true,
    });
  });
});

describe("hostSignalOf", () => {
  it("reads the click on a host button by its id", () => {
    expect(
      hostSignalOf(JSON.stringify({ MessageId: "Clicked_Button", Values: { Id: "mc-back-to-matter" } })),
    ).toEqual({ kind: "button-clicked", id: "mc-back-to-matter" });
  });

  it("reads the editor's Close, once it has been routed here", () => {
    expect(hostSignalOf(JSON.stringify({ MessageId: "UI_Close", Values: {} }))).toEqual({
      kind: "close-requested",
    });
  });

  it("reads the answer to a save, either way", () => {
    expect(
      hostSignalOf(JSON.stringify({ MessageId: "Action_Save_Resp", Values: { success: true } })),
    ).toEqual({ kind: "save-responded", success: true });
    expect(
      hostSignalOf(JSON.stringify({ MessageId: "Action_Save_Resp", Values: { success: false } })),
    ).toEqual({ kind: "save-responded", success: false });
  });

  it("reads whether the document has unsaved changes", () => {
    expect(
      hostSignalOf(JSON.stringify({ MessageId: "Doc_ModifiedStatus", Values: { Modified: true } })),
    ).toEqual({ kind: "modified", modified: true });
  });

  it("is null for anything else the editor sends, and for what is not a message at all", () => {
    expect(hostSignalOf(JSON.stringify({ MessageId: "App_LoadingStatus" }))).toBeNull();
    expect(hostSignalOf(JSON.stringify({ MessageId: "Clicked_Button", Values: {} }))).toBeNull();
    expect(hostSignalOf("not json")).toBeNull();
    expect(hostSignalOf({ MessageId: "UI_Close" })).toBeNull();
  });
});
