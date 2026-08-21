// The version-cut policy for in-app editing. A deliberate version is cut on an explicit Save and when
// the last editor leaves (session close); autosaves and a co-author joining never cut. Autosaves only
// refresh the mutable `current` working object (it is crash-safe in R2), and a join simply adds a
// co-editor to the live session — neither is a deliberate save point. Keeping this a pure decision
// lets the session coordinator stay declarative about when commitEditedVersion runs.

export type VersionCutEvent =
  | { readonly type: "save"; readonly isAutosave: boolean }
  | { readonly type: "participant-joined" }
  | { readonly type: "participant-left"; readonly remainingParticipants: number };

export function shouldCutVersion(event: VersionCutEvent): boolean {
  switch (event.type) {
    case "save":
      return !event.isAutosave;
    case "participant-left":
      return event.remainingParticipants === 0;
    case "participant-joined":
      return false;
  }
}
