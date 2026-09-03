import type { MatterId } from "@magna-carta/identifiers/types";
import type {
  CloseAdvisory,
  CloseAdvisoryContext,
  CloseAdvisoryNotice,
} from "@magna-carta/matters/close-advisories";
import { countOpenMatterTasks } from "./task-statements.ts";

// The matter-close notice. Open tasks SURFACE at a close and never, under any condition, block one.
//
// An advisory rather than a precondition, and the reasoning is written into
// packages/matters/src/close-advisories.ts as the case this hook exists for: one boolean away from
// each other, a subsystem that only meant to inform starts blocking closes on a Friday afternoon,
// and the firm learns to route around the close screen.
//
// The contrast that decides it is trust, which DOES block: a closed matter holding somebody else's
// money is how funds become unclaimed, and the firm that closed it has to answer for them. An open
// task is a reminder somebody wrote three months ago. A matter that cannot close because of one is a
// close screen the firm defeats by cancelling tasks nobody read — which would destroy exactly the
// signal this notice exists to give.
export const OPEN_TASKS_ON_MATTER = "open-tasks-on-matter";

// THE TASKS ARE NOT TOUCHED. Not cancelled, not completed, not deleted, and not swept. A closed
// matter is archived-but-additive, and a close that mutated a dozen unrelated rows would contradict
// that. Open tasks stay open and stay on the matter; what happens is that they drop out of the
// default "my tasks" read, which filters to matters that are not closed — a FILTER, not a state
// change, so reopening the matter brings them back with no backfill.
async function notice(context: CloseAdvisoryContext): Promise<readonly CloseAdvisoryNotice[]> {
  const open = await countOpenMatterTasks(context.database, context.matterId as MatterId);
  if (open === 0) return [];
  // The count only — no titles. A task title is free text on a matter, and closing a matter needs no
  // task permission, so a notice that listed them would put work product on a response whose reader
  // was never checked for it. Somebody entitled to the detail reads the matter's task list, which is
  // where the permission is checked.
  return [
    {
      code: OPEN_TASKS_ON_MATTER,
      message:
        open === 1
          ? "1 task on this matter is still open. Closing the matter leaves it exactly as it is — nothing is cancelled or completed — but it drops off the day-to-day task list until the matter is reopened."
          : `${String(open)} tasks on this matter are still open. Closing the matter leaves them exactly as they are — nothing is cancelled or completed — but they drop off the day-to-day task list until the matter is reopened.`,
    },
  ];
}

// What the composition root registers against the matter shell's close-advisory hook.
export const matterTasksCloseAdvisory: CloseAdvisory = { notice };
