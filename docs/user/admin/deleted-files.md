# Deleted files

When somebody deletes a file in a matter, it is not destroyed. It moves to that matter's **Deleted
Files** list, which is its Trash, and anyone who can see the matter can bring it back. This page is
where your firm decides how long a file waits there and what happens to it after.

## What your firm starts with

**30 days in Trash, then archive storage.** Thirty days is the shortest window offered because
archive storage is billed for at least thirty days, so a file deleted and restored inside the
window never pays for it.

## Changing it

Open **Settings**, and under **Documents** choose **Deleted Files**. There are two settings:

- **Keep in Trash For**: 30, 60, 90 or 180 days, or 1 year.
- **Then**: **Move to archive storage**, which costs about a third less to keep and a little to read
  back, or **Keep in standard storage**.

Choose, then **Save** at the bottom of the page and confirm. Only the Owner and Admin roles can
change them: they carry the `matters:manageRetention` permission, the same one as
[File retention](file-retention.md). Everybody else sees the firm's answer on the same page.

## What it does and does not do

- **Each deleted file says when it leaves Trash.** The **Leaves Trash** column on a matter's
  Deleted Files list shows the date. After it, the column says **Archived**, or **Out of Trash** if
  your firm keeps deleted files in standard storage.
- **An archived file can still be restored**, the same way as one in Trash. It comes back exactly as
  it was.
- **The move happens once a day**, overnight, so a file can read **Archived** for up to a day before
  its storage actually changes.
- **Nothing is destroyed.** Neither setting deletes a file. Destroying deleted files on a schedule is
  not available yet.
- **It is recorded.** Every change to the setting is written to the firm's audit trail, with who
  made it and when.
