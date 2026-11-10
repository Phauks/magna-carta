---
category: Added
audience: public
---

**A task's watchers and the members of an assigned team are told.** Two new outbox topics, `tasks.task.watchedChange` and `tasks.firmTask.watchedChange`, split by whether the task is on a matter, reach the watchers named in the payload through the `named-members` audience. They are raised when a watcher is added and when a task is completed, reopened, moved to another status, given different assignees or has its due date moved, never to the actor. Assigning a team now raises the assignment topic for each live member who did not already have the work. `packages/tasks/src/watcher-notices.ts` is the one place both audiences are worked out.

## Public

**Watchers and teams now hear about their tasks.** Watching a task now works like being copied on a letter. You are told when you are added, and again when the task is marked complete or reopened, changes status, is given to different people or has its due date moved. Assigning a task to a team tells everybody on that team.
