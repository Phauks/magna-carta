---
category: Added
audience: public
---

**Task comments.** Two per-firm tables, `matter_task_comment` and `matter_task_comment_mention` (migration `20261110T083142_task-comments`), hold a flat thread per task and the members each comment names. `packages/tasks/src/comment-service.ts` adds, rewords and removes a comment (author only), refuses to name anybody who is not an active member able to see the task, and writes audit rows that carry no words. Four outbox topics (`tasks.task.commented`, `tasks.firmTask.commented`, `tasks.task.commentMentioned`, `tasks.firmTask.commentMentioned`) tell the people assigned and watching, and separately the people named, never the author and never one person twice. Routes: `GET`/`POST /api/v1/tasks/{taskId}/comments`, `PUT`/`DELETE /api/v1/task-comments/{commentId}`. The task window opens on a new Comments tab.

## Public

**Comments on tasks.** A task's window now has a **Comments** tab for talking about the work. Type **@** to name a colleague and they are told; the people assigned to the task and watching it are told too. You can change or delete your own comments.
