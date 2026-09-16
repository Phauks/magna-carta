/*
 * The two transfer registers, and the words they share.
 *
 * Uploads and Downloads are the same idea pointed in opposite directions: a register of bytes this
 * member set moving, reachable from a top-bar tray and from a full surface behind it. Everything
 * that is true of both lives here, so the pair cannot drift into two vocabularies for one idea —
 * which is exactly what had happened: one tray said "Nothing uploading", the other "Nothing here
 * yet", and each followed it with a paragraph of its own explaining the mechanism.
 *
 * WHAT IS NOT SHARED, AND WHY. The two registers hold different KINDS of record, so their tables
 * are their own: a download is a document on the member's record that any format can be taken
 * from, and a finished upload is a file on a matter, which is downloaded as itself. Forcing one
 * table over both would mean a column that is blank for half the rows. The tray shell
 * (transfer-tray.svelte) is shared because the frame genuinely is one frame.
 */

/** The empty-state title for each register: two words, title case, no sentence under it. */
export const NO_UPLOADS = "No Uploads";
export const NO_DOWNLOADS = "No Downloads";

/** How many finished batches a browser remembers, and how many files it remembers per batch. */
export const UPLOAD_HISTORY_LIMIT = 50;
export const UPLOAD_HISTORY_FILE_LIMIT = 250;
