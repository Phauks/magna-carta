/*
 * Who is told when a task moves, beyond the person who moved it.
 *
 * Two audiences, read at the write so the outbox row names the people as they stood then:
 *
 * - a task's WATCHERS, copied on its progress the way a CC line is copied on a letter, and
 * - the MEMBERS OF A TEAM a task is assigned to, who are each told the work is theirs, because a
 *   team cannot open a notification and a team assignment that tells nobody is one nobody acts on.
 *
 * The actor is never told about their own act, in either audience.
 */
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import type { MatterId, MatterTaskId, TaskTeamId, UserId } from "@magna-carta/identifiers/types";
import {
  watchedChangeTopicFor,
  type WatchedTaskChange,
  type WatchedTaskChangePayload,
} from "./notifications.ts";
import { readTaskTeamMembers, readTaskWatchers } from "./organisation-statements.ts";

export interface WatchedTaskFacts {
  readonly id: MatterTaskId;
  readonly matter_id: MatterId | null;
  readonly priority: string;
}

/**
 * One outbox message naming every watcher but the actor, or none when nobody else is watching.
 * `watcherUserIds` is passed where the caller already holds the list (a create, a watcher change);
 * otherwise the task's watchers are read.
 */
export async function watcherNotice(
  database: SqlDatabase,
  task: WatchedTaskFacts,
  change: WatchedTaskChange,
  actorUserId: UserId,
  watcherUserIds?: readonly UserId[],
): Promise<OutboxMessage[]> {
  const watchers =
    watcherUserIds ?? (await readTaskWatchers(database, [task.id])).map((row) => row.user_id);
  return watcherNoticeFor(task, change, actorUserId, watchers);
}

/** The same message from a list the caller has already settled. */
export function watcherNoticeFor(
  task: WatchedTaskFacts,
  change: WatchedTaskChange,
  actorUserId: UserId,
  watcherUserIds: readonly UserId[],
): OutboxMessage[] {
  const told = [...new Set(watcherUserIds)].filter((userId) => userId !== actorUserId);
  if (told.length === 0) return [];
  const payload: WatchedTaskChangePayload = {
    taskId: task.id,
    matterId: task.matter_id,
    watcherUserIds: told,
    changedByUserId: actorUserId,
    change,
    priority: task.priority,
  };
  return [{ topic: watchedChangeTopicFor(task.matter_id), payload: { ...payload } }];
}

/** The live members of the given teams, each once, in the order the teams were given. */
export async function membersOfTeams(
  database: SqlDatabase,
  teamIds: readonly TaskTeamId[],
): Promise<UserId[]> {
  if (teamIds.length === 0) return [];
  const wanted = new Set(teamIds);
  const members = (await readTaskTeamMembers(database)).filter((row) => wanted.has(row.team_id));
  const ordered = teamIds.flatMap((teamId) =>
    members.filter((row) => row.team_id === teamId).map((row) => row.user_id),
  );
  return [...new Set(ordered)];
}
