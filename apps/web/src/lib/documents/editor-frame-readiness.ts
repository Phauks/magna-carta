/*
 * The handshake that tells this screen the browser editor is actually up.
 *
 * Launching a document is two waits, and only the first one is a request this app makes. The launch
 * call returns a URL and a token in a few hundred milliseconds; the second wait is the editor itself,
 * which is a container that starts on first address and serves one document. Treating the launch call
 * as the whole open is what leaves a member looking at a frame that is drawing nothing, with no way to
 * tell a cold start from a refusal.
 *
 * The editor speaks a small message protocol through the frame, and it is the only thing that can say
 * which of the two is happening. It posts `App_LoadingStatus` with `Frame_Ready` once its own script is
 * running, waits for the host to answer `Host_PostmessageReady`, and posts `App_LoadingStatus` with
 * `Document_Loaded` once the document is on screen. Every message is a JSON string, not an object.
 *
 * It only speaks at all when the host told it where to speak: the WOPI CheckFileInfo response carries
 * `PostMessageOrigin`, and the editing host sets it to the origin that launched the session
 * (apps/api-worker/src/editing/wopi-routes.ts). Silence therefore means something real — the frame was
 * refused, or the container never came up — which is why this screen states it rather than waiting on.
 */

/** What the editor has told us, as far as this screen cares. */
export type EditorSignal = "frame-ready" | "document-loaded";

/** The message the host sends once the editor reports its frame ready. */
export const HOST_READY_MESSAGE = JSON.stringify({ MessageId: "Host_PostmessageReady" });

/**
 * How long the editor has to report the document up before the screen says it did not.
 *
 * The container is a multi-gigabyte image that starts on first address, so the first open of a document
 * nobody has touched is genuinely slow and a short budget would call a working editor broken. Ninety
 * seconds is past that cold start and well short of the point where a member has already reloaded. The
 * waiting region says the wait is long before this elapses; this is only the point at which waiting
 * stops being the honest answer.
 */
export const EDITOR_READY_BUDGET_MILLISECONDS = 90_000;

interface LoadingStatusMessage {
  MessageId?: unknown;
  Values?: { Status?: unknown } | null;
}

/**
 * What an incoming frame message means, or null when it is not one of ours. The caller has already
 * established that the message came from the editor's origin — this reads only the message.
 *
 * Anything unparseable is null rather than an error: the editor sends messages this screen has no use
 * for, and a page can receive messages from things that are not the editor at all.
 */
export function editorSignalOf(data: unknown): EditorSignal | null {
  if (typeof data !== "string") return null;
  let message: LoadingStatusMessage;
  try {
    message = JSON.parse(data) as LoadingStatusMessage;
  } catch {
    return null;
  }
  if (message?.MessageId !== "App_LoadingStatus") return null;
  const status = message.Values?.Status;
  if (status === "Frame_Ready") return "frame-ready";
  if (status === "Document_Loaded") return "document-loaded";
  return null;
}
