/*
 * The platform's presence inside the editor: the buttons it puts on the editor's own bar, and the
 * messages the two exchange about them.
 *
 * The editor is the whole screen, so anything a member does on the platform from inside a document
 * is a control the editor draws for us. The editor's message protocol lets a host insert a button
 * into its shortcuts bar (`Insert_Button`) and hear the click (`Clicked_Button`), route the editor's
 * own Close through the host (`Disable_Default_UIAction` on `UI_Close`, which then arrives as a
 * message instead of closing the document), and ask for a save and be told when it finished
 * (`Action_Save` with `Notify`, answered by `Action_Save_Resp`). Every message is a JSON STRING,
 * and every one this module reads has already been checked for origin by the caller.
 *
 * The icon travels as a data: URL. The editor's page allows images from itself and from data:
 * and nothing else, so a URL on the app origin would be refused and render as a broken image.
 * The icon is the Lucide arrow-left, the mark the product uses for a way back.
 */

/** The id the editor gives the back-to-matter button, and the id its click comes back under. */
export const BACK_TO_MATTER_BUTTON_ID = "mc-back-to-matter";

/**
 * How long a save asked for on the way out is given before the screen leaves anyway. The editor
 * saves on its own when the last view closes, so this wait is a courtesy to a member who wants to
 * see the save land, not the thing that protects their work.
 */
export const LEAVE_SAVE_BUDGET_MILLISECONDS = 3000;

/** The Lucide arrow-left mark, as the editor can load it: a data: URL, black on nothing. */
export const BACK_ICON_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>',
  );

export interface EditorButton {
  readonly id: string;
  /** The word under the icon. Short: the bar is the editor's, and it is already full. */
  readonly label: string;
  /** The hover text, a sentence in the house voice. */
  readonly hint: string;
  readonly imgurl: string;
}

/**
 * The back-to-matter button: the arrow, then the matter's number as its word, since the number is
 * how a member knows a matter at a glance and the bar has room for one short word. A matter
 * without a number yet (a consultation, an intake) is named "Matter"; the hover text carries the
 * title either way.
 */
export function backToMatterButton(matter: {
  readonly title: string;
  readonly number?: string | null;
}): EditorButton {
  return {
    id: BACK_TO_MATTER_BUTTON_ID,
    label: matter.number ?? "Matter",
    hint: `Back to ${matter.title}`,
    imgurl: BACK_ICON_DATA_URL,
  };
}

function message(messageId: string, values?: Record<string, unknown>): string {
  return JSON.stringify({ MessageId: messageId, SendTime: Date.now(), Values: values ?? {} });
}

/** Asks the editor to put a button on its bar. Sent once the document is showing. */
export function insertButtonMessage(button: EditorButton): string {
  return message("Insert_Button", {
    id: button.id,
    imgurl: button.imgurl,
    hint: button.hint,
    label: button.label,
    mobile: true,
    tablet: true,
  });
}

/**
 * Tells the editor that its own Close is the host's to handle: from then on the editor posts
 * `UI_Close` instead of closing the document, and the screen leaves the way the button does.
 */
export function routeCloseThroughHostMessage(): string {
  return message("Disable_Default_UIAction", { action: "UI_Close", disable: true });
}

/**
 * Asks for a save before leaving, and to be told when it is done. Unmodified documents are not
 * saved again, and the edit is not terminated: the editor decides what to do with the view when the
 * socket drops, and this screen is about to drop it.
 */
export function saveBeforeLeavingMessage(): string {
  return message("Action_Save", {
    Notify: true,
    DontSaveIfUnmodified: true,
    DontTerminateEdit: true,
  });
}

/**
 * Turns the showing of tracked changes off, once the document is up. Under the firm's policy every
 * document records its changes (the host keeps the recording control out of reach), and a page a
 * member types on should look the way it always did: the marks are there, and the editor's own
 * Review tab shows them to anybody who asks. `Send_UNO_Command` carries the editor's command with
 * its argument in the editor's typed form.
 */
export function hideTrackedChangesMessage(): string {
  return message("Send_UNO_Command", {
    Command: ".uno:ShowTrackedChanges",
    Args: { ShowTrackedChanges: { type: "boolean", value: false } },
  });
}

/** What the editor told the host that this screen acts on. */
export type HostSignal =
  | { readonly kind: "button-clicked"; readonly id: string }
  | { readonly kind: "close-requested" }
  | { readonly kind: "save-responded"; readonly success: boolean }
  | { readonly kind: "modified"; readonly modified: boolean };

interface HostMessage {
  MessageId?: unknown;
  Values?: Record<string, unknown> | null;
}

/**
 * What an incoming frame message means to the controls, or null when it is not one of theirs. The
 * caller has already established the message came from the editor's origin; this reads only the
 * message, and anything unparseable is null rather than an error, because the editor sends much
 * this screen has no use for.
 */
export function hostSignalOf(data: unknown): HostSignal | null {
  if (typeof data !== "string") return null;
  let parsed: HostMessage;
  try {
    parsed = JSON.parse(data) as HostMessage;
  } catch {
    return null;
  }
  const values = parsed?.Values ?? {};
  switch (parsed?.MessageId) {
    case "Clicked_Button": {
      const id = values.Id;
      return typeof id === "string" ? { kind: "button-clicked", id } : null;
    }
    case "UI_Close":
      return { kind: "close-requested" };
    case "Action_Save_Resp":
      return { kind: "save-responded", success: values.success === true };
    case "Doc_ModifiedStatus":
      return { kind: "modified", modified: values.Modified === true };
    default:
      return null;
  }
}
