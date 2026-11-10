import {
  mlsCommitFrame,
  mlsKeyPackageFrame,
  mlsProposalFrame,
  mlsWelcomeFrame,
  type MeetingClientFrame,
} from "@magna-carta/meeting-protocol/frames";
import { refuseAndRecord } from "./room-diagnostics.ts";
import {
  attachmentOf,
  connectedAttendanceIds,
  trySend,
  type MeetingSocketAttachment,
  type RoomContext,
} from "./room-state.ts";

// THE ENCRYPTED MEETING'S GROUP, AS THE ROOM SEES IT — the delivery service for an MLS group
// (RFC 9420) whose every message it carries and none of which it can read.
//
// WHAT THE ROOM DOES. MLS needs its handshake messages delivered in one order, and a Durable Object
// handles one event at a time, so it already is a sequencer. It relays key packages to the group,
// accepts the FIRST commit made from the epoch it holds and refuses the rest `stale-epoch`, sends each
// accepted commit to the group as it stood (the committer's own socket included, which is the
// committer's acknowledgement), sends the welcome to the stays it admits, and relays proposals. It
// founds a group by telling the first stay that asks for one to make it.
//
// WHAT THE ROOM KNOWS, AND WHY THAT IS ENOUGH. The epoch it last sequenced, and which stays the
// committers have said are in the group — the routing facts a commit carries in the clear. It does
// not know the group's keys, cannot forge a commit (every one is signed by a member) and cannot add
// anybody (a key package is signed by the stay it names, and the committer checks the name against
// the sender the room reported). The worst a dishonest room can do here is withhold, which is a
// person who cannot join, never a person who can listen.
//
// WHAT IS STORED, AND FOR HOW LONG. One key for the group (epoch and members), and one key per stay
// waiting to be admitted holding its key package — public by construction, a few hundred bytes — so
// that a committer who takes over, or a newcomer who becomes the committer, still has every request
// to act on. A pending key package goes when its stay is admitted or leaves; the group goes when the
// last of its members has; everything goes when the meeting ends, with the rest of the room.

const GROUP_KEY = "mls-group";
const KEY_PACKAGE_PREFIX = "mls-key-package:";

/** The group as the room holds it: the epoch a commit must be made from, and who is in it. */
interface StoredGroup {
  readonly epoch: number;
  readonly members: readonly string[];
}

async function readGroup(room: RoomContext): Promise<StoredGroup | undefined> {
  return await room.ctx.storage.get<StoredGroup>(GROUP_KEY);
}

async function putGroup(room: RoomContext, group: StoredGroup): Promise<void> {
  await room.ctx.storage.put<StoredGroup>(GROUP_KEY, group);
}

/** Every key package waiting to be admitted, by the stay that sent it. */
async function pendingKeyPackages(room: RoomContext): Promise<Map<string, string>> {
  const listed = await room.ctx.storage.list<string>({ prefix: KEY_PACKAGE_PREFIX });
  const pending = new Map<string, string>();
  for (const [key, keyPackage] of listed) {
    pending.set(key.slice(KEY_PACKAGE_PREFIX.length), keyPackage);
  }
  return pending;
}

/**
 * One frame to every welcomed socket whose stay is in `stays`, in ONE pass over the sockets.
 *
 * The group's frames are never a room-wide broadcast: a socket the group has not admitted cannot
 * read them, and the lobby must not learn that a commit happened.
 */
function sendToStays(
  room: RoomContext,
  stays: ReadonlySet<string>,
  payload: string,
  except?: WebSocket,
): void {
  for (const socket of room.ctx.getWebSockets()) {
    if (socket === except) continue;
    const attachment = attachmentOf(socket);
    if (attachment?.welcomed !== true) continue;
    if (stays.has(attachment.attendanceId)) trySend(socket, payload);
  }
}

/**
 * A STAY ASKED TO BE IN THE GROUP. Founds the group when there is none, and otherwise keeps the key
 * package until the stay is admitted and relays it to the group.
 *
 * A GROUP NOBODY CONNECTED IS IN IS A GROUP NOBODY CAN ADD TO, so it is replaced: every member's
 * browser has gone, and with it every copy of the group's state. The sender founds a new one.
 */
async function receiveKeyPackage(
  room: RoomContext,
  socket: WebSocket,
  sender: string,
  keyPackage: string,
): Promise<void> {
  let group = await readGroup(room);
  if (group !== undefined) {
    const connected = connectedAttendanceIds(room);
    const anybodyHolding = group.members.some(
      (member) => member !== sender && connected.has(member),
    );
    if (!anybodyHolding) group = undefined;
  }

  if (group === undefined) {
    await found(room, sender);
    return;
  }

  await room.ctx.storage.put(`${KEY_PACKAGE_PREFIX}${sender}`, keyPackage);
  sendToStays(room, new Set(group.members), mlsKeyPackageFrame(sender, keyPackage), socket);
}

/**
 * THIS STAY FOUNDS THE GROUP, at epoch zero with itself alone in it: told by a welcome that carries
 * none, and handed every request already waiting, because the founder of a group of one is its
 * committer.
 */
async function found(room: RoomContext, founder: string): Promise<void> {
  await putGroup(room, { epoch: 0, members: [founder] });
  await room.ctx.storage.delete(`${KEY_PACKAGE_PREFIX}${founder}`);
  for (const socket of room.ctx.getWebSockets()) {
    const attachment = attachmentOf(socket);
    if (attachment?.welcomed !== true || attachment.attendanceId !== founder) continue;
    trySend(socket, mlsWelcomeFrame(0, null));
    await sendPendingTo(room, socket, founder);
  }
}

/** Every waiting key package but the receiver's own, to one socket. */
async function sendPendingTo(
  room: RoomContext,
  socket: WebSocket,
  receiver: string,
): Promise<void> {
  const connected = connectedAttendanceIds(room);
  for (const [stay, keyPackage] of await pendingKeyPackages(room)) {
    if (stay === receiver || !connected.has(stay)) continue;
    trySend(socket, mlsKeyPackageFrame(stay, keyPackage));
  }
}

/**
 * A COMMIT. The first made from the epoch the room holds is accepted and every other refused
 * `stale-epoch`; an accepted one goes to the group as it stood, and its welcome to the stays it
 * admits.
 */
async function receiveCommit(
  room: RoomContext,
  socket: WebSocket,
  attachment: MeetingSocketAttachment,
  frame: Extract<MeetingClientFrame, { type: "mls-commit" }>,
): Promise<void> {
  const sender = attachment.attendanceId;
  const group = await readGroup(room);
  if (group === undefined || !group.members.includes(sender)) {
    await refuseAndRecord(room, socket, attachment, sender, "not-in-group", "mls-commit");
    return;
  }
  if (frame.epoch !== group.epoch) {
    await refuseAndRecord(room, socket, attachment, sender, "stale-epoch", "mls-commit");
    return;
  }
  // A welcome exactly when somebody is added. Either half without the other is a browser bug, and
  // sequencing it would advance every member's epoch with nobody able to join at the new one.
  if (frame.added.length > 0 !== (frame.welcome !== undefined)) {
    await refuseAndRecord(room, socket, attachment, sender, "malformed-frame", "mls-commit");
    return;
  }

  const removed = new Set(frame.removed);
  const added = new Set(frame.added);
  const before = new Set(group.members);
  const members = [
    ...group.members.filter((member) => !removed.has(member)),
    ...frame.added.filter((stay) => !before.has(stay) || removed.has(stay)),
  ];
  const epoch = group.epoch + 1;
  await putGroup(room, { epoch, members });
  if (added.size > 0) {
    await room.ctx.storage.delete([...added].map((stay) => `${KEY_PACKAGE_PREFIX}${stay}`));
  }

  // To the group as it stood, removed stays included — the commit is how they learn they are out —
  // and less anybody re-added under a new key package, whose old browser state is already gone.
  const toldOfCommit = new Set([...before].filter((member) => !added.has(member)));
  sendToStays(
    room,
    toldOfCommit,
    mlsCommitFrame(sender, frame.epoch, frame.commit, frame.added, frame.removed),
  );
  if (frame.welcome !== undefined) {
    sendToStays(room, added, mlsWelcomeFrame(epoch, frame.welcome));
    // A newcomer can come to hold the smallest leaf, which makes it the committer, so it is handed
    // the requests still waiting just as a founder is.
    for (const candidate of room.ctx.getWebSockets()) {
      const holder = attachmentOf(candidate);
      if (holder?.welcomed === true && added.has(holder.attendanceId)) {
        await sendPendingTo(room, candidate, holder.attendanceId);
      }
    }
  }
}

/** A PROPOSAL, relayed to the rest of the group when it was made at the epoch the room holds. */
async function receiveProposal(
  room: RoomContext,
  socket: WebSocket,
  attachment: MeetingSocketAttachment,
  frame: Extract<MeetingClientFrame, { type: "mls-proposal" }>,
): Promise<void> {
  const sender = attachment.attendanceId;
  const group = await readGroup(room);
  if (group === undefined || !group.members.includes(sender)) {
    await refuseAndRecord(room, socket, attachment, sender, "not-in-group", "mls-proposal");
    return;
  }
  if (frame.epoch !== group.epoch) {
    await refuseAndRecord(room, socket, attachment, sender, "stale-epoch", "mls-proposal");
    return;
  }
  sendToStays(
    room,
    new Set(group.members),
    mlsProposalFrame(sender, frame.epoch, frame.proposal),
    socket,
  );
}

/** The three group frames a browser sends, dispatched from room-frames.ts. */
export async function handleGroupFrame(
  room: RoomContext,
  socket: WebSocket,
  attachment: MeetingSocketAttachment,
  frame: Extract<MeetingClientFrame, { type: "mls-key-package" | "mls-commit" | "mls-proposal" }>,
): Promise<void> {
  switch (frame.type) {
    case "mls-key-package":
      await receiveKeyPackage(room, socket, attachment.attendanceId, frame.keyPackage);
      return;
    case "mls-commit":
      await receiveCommit(room, socket, attachment, frame);
      return;
    case "mls-proposal":
      await receiveProposal(room, socket, attachment, frame);
      return;
  }
}

/**
 * A STAY LEFT THE ROOM. Its waiting key package goes, since nobody should admit a browser that has
 * closed. Its place in the group stays until the committer's next commit removes it — the room cannot
 * remove anybody from a group it cannot write to.
 *
 * WHEN THE LAST MEMBER LEAVES, the group goes with them, and somebody still waiting founds the next
 * one: otherwise everybody left in the room would hold a key package nobody could ever act on.
 */
export async function groupParticipantGone(room: RoomContext, attendanceId: string): Promise<void> {
  await room.ctx.storage.delete(`${KEY_PACKAGE_PREFIX}${attendanceId}`);
  const group = await readGroup(room);
  if (group === undefined) return;
  const connected = connectedAttendanceIds(room);
  const anybodyLeft = group.members.some(
    (member) => member !== attendanceId && connected.has(member),
  );
  if (anybodyLeft) return;
  await room.ctx.storage.delete(GROUP_KEY);
  for (const stay of (await pendingKeyPackages(room)).keys()) {
    if (stay !== attendanceId && connected.has(stay)) {
      await found(room, stay);
      return;
    }
  }
}
