import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerCallerLookupRoutes } from "./caller-lookup.ts";
import { registerCommunicationsRoutes } from "./communications.ts";
import { registerMeetingsRoutes } from "./meetings.ts";
import { registerMeetingByCodeRoutes } from "./meeting-by-code.ts";
import { registerMeetingChatRoutes } from "./meeting-chat.ts";
import { registerMeetingPersonalRoomRoutes } from "./meeting-personal-rooms.ts";
import { registerMeetingHostingRoutes } from "./meeting-hosting.ts";
import { registerMeetingInspectRoutes } from "./meeting-inspect.ts";
import { registerMeetingLobbyRoutes } from "./meeting-lobby.ts";
import { registerMeetingPollRoutes } from "./meeting-polls.ts";
import { registerMeetingQuestionRoutes } from "./meeting-questions.ts";
import { registerMeetingGuestRoutes } from "./meetings-guest.ts";
import { registerMeetingGuestByAddressRoutes } from "./meeting-guest-by-address.ts";
import { registerMeetingSettingsRoutes } from "./meeting-settings.ts";
import { registerMeetingSummaryRoutes } from "./meeting-summary.ts";
import { emailAdapterForEnv } from "../../../auth-instance.ts";

// The call and text log, and the shipping surface the carrier plugin mounts through this module's file.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/http/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountCommunications(
  app: AppRouter,
  chokepoint: Chokepoint,
  deps: DomainDeps = {},
): void {
  const domain = createDomainApp();
  // Who is on the other end of a number, asked as one is typed into a call record. Ahead of the log's
  // own routes so its literal paths are matched before the record-id pattern beside them.
  registerCallerLookupRoutes(domain, chokepoint);
  registerCommunicationsRoutes(domain, chokepoint);
  // Meetings — the room a member opens on a calendar event, who was in it, and when each of them
  // arrived and left. Beside the call and text log because it is the same question about a
  // different channel: what contact happened, recorded as identifiers and instants. The media is
  // routed between browsers and never reaches this platform; these routes are the record plus the
  // upgrade into the signaling room.
  // A member's personal room — a standing link that opens an ordinary meeting on an ordinary event.
  // Ahead of the meeting routes so its literal paths (`/meetings/personal-room`, `/meetings/rooms/…`)
  // are matched before the meeting-id pattern beside them.
  registerMeetingPersonalRoomRoutes(domain, chokepoint);
  // A meeting by its nine-digit address, ahead of the meeting-id pattern for the same reason.
  registerMeetingByCodeRoutes(domain, chokepoint);
  registerMeetingsRoutes(domain, chokepoint);
  // The meeting's chat, which is the subsystem's one piece of stored content: kept on the record
  // like a filed message rather than discarded with the room, so what was said in a meeting on a
  // matter is on the file. Registered beside the room because it is the same meeting read through
  // the same gate.
  registerMeetingChatRoutes(domain, chokepoint);
  // A meeting's polls and its question queue — content the meeting produced, kept on the record on
  // the chat's own terms: every act is a route with an audit row, and the room relays a copy after
  // the commit.
  registerMeetingPollRoutes(domain, chokepoint);
  registerMeetingQuestionRoutes(domain, chokepoint);
  // A recorded meeting's summary — a reasoning model's characterization of its transcript, kept as
  // rows beside the record it summarizes — read, written again, and its action items made into tasks
  // through the task subsystem's own create path.
  registerMeetingSummaryRoutes(domain, chokepoint);
  // The firm's meeting settings: whether its meetings may be recorded, captioned and summarized, and
  // how many people one recording hears at once. The only writer of those switches, which the
  // recording start route, the recorder and the summary consumer read.
  registerMeetingSettingsRoutes(domain, chokepoint);
  // Who is running a meeting, and the acts that need somebody's name against them afterwards —
  // removing a participant, shutting the door, handing the room over. A file of its own because
  // authority over a meeting is a grant on the meeting rather than a capability of a seat, and the
  // acts that leave nothing behind (mute, spotlight) are frames on the signaling socket instead.
  registerMeetingHostingRoutes(domain, chokepoint);
  // The meeting's door — whether arrivals wait, who is at it, and a host's decision about each of
  // them. One lobby per meeting and never one per firm: a firm holds several meetings at once, so a
  // firm-level door would queue the people arriving at a deposition behind the people arriving at a
  // staff briefing. Its own file because it is its own resource, and the one read in this family
  // that the room may not see.
  registerMeetingLobbyRoutes(domain, chokepoint);
  // A meeting's GUESTS — somebody from outside the firm on a signed, expiring link for one Directory
  // entity. The host's four routes mint, list, rotate and withdraw links on the ordinary member path;
  // the guest's six ride the chokepoint's guest lane, which admits a signed credential rather than a
  // session and never stashes a user id, so nothing a guest calls can reach a member handler. The
  // mail goes through the same outbound port every other transactional message does.
  registerMeetingGuestByAddressRoutes(
    domain,
    chokepoint,
    deps.meetingGuestMail ?? emailAdapterForEnv,
  );
  registerMeetingGuestRoutes(domain, chokepoint, deps.meetingGuestMail ?? emailAdapterForEnv);
  // The operator's read into one live room, behind the platform-operator guard rather than the
  // firm door every other meeting route goes through: a meeting holds no rows and deletes its own
  // state as it goes, so from outside it there is nothing to look at when one goes wrong.
  registerMeetingInspectRoutes(domain, chokepoint);
  app.route("/", domain);
}
