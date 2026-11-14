---
category: Added
audience: public
---

**A meeting's chat can share one of the matter's files.** `meeting_message.attached_file_id` (an additive per-firm migration) points a line at a file; `POST /api/v1/meetings/{meetingId}/messages` takes `attachedFileId`, accepted only for a live file on the meeting's own matter (anything else, or a meeting on a firm event, is a 404 `meeting-message-file-unavailable`), and every message read returns `attachedFile` (`{ id, name }`, or null once the line is taken back or the file deleted). An empty body with a file is recorded as the file's name. The guest projection blanks `attachedFile`. The room's chat panel gains a paperclip menu (Existing File through the matter document picker; Upload File through the file manager's upload into a "Meeting files" folder at the matter root, found or made by `apps/web/src/lib/meetings/chat-files.ts`) and draws a shared file as a link to its download route.

## Public

**Share a file in a meeting's chat.** In a meeting kept on a matter, the paperclip beside Send shares one of the matter's files, or uploads one from your computer into the matter's Meeting files folder and shares it. Everybody in the meeting can open it from the chat.
