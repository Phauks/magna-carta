# File and folder sharing — design

**Status:** built (2026-11-20). **Area:** Client portal, Documents. **Owner rulings:** 2026-11-20,
below.

## What it is

The firm chooses who outside the firm can see a matter's files and folders and what each person can
do. Recipients are Directory people: the client, opposing counsel, experts, co-counsel. This is the
grant half of the client portal; the portal (sign-in, the recipient's screens) is its own work and
reads these records through `@magna-carta/sharing`.

## Owner rulings, 2026-11-20

- Share one file, a folder, or many at once; make it easy to see what is and is not shared; share
  with people other than the client; give each share its own permissions.
- **No Share window.** "Understanding file structure is important when sharing": sharing is done
  inside the File Manager, where the folders stay in view. The three mockups (a Share window, a
  Sharing tab, a review by person) were replaced by a build in the real File Manager components.
- Shared files and folders carry a shared mark. Keep a **Shared With** column in the list. Show
  sharing in the right-hand panel. Provide one place to review it all together.

## The model

| Fact     | Values                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Scope    | `matter` (files in no folder, shown as Home), `folder` (files directly inside, live), `file` (optionally pinned to a version) |
| Role     | `viewer`, `commenter`, `editor`. Commenter is not offered until files have comments                                           |
| Download | separate yes/no, default yes                                                                                                  |
| Sign-in  | `link`, `emailCode`, `twoStep`, default `link`                                                                                |
| End date | optional civil date, read in `Etc/GMT+12`                                                                                     |
| Status   | `active` or `revoked`; revoked rows are kept                                                                                  |

A folder share does not reach subfolders: a folder inside a shared folder stays private until it is
shared itself. A person reached by several shares gets the strongest role, the strictest sign-in,
and download if any share allows it. A share stops opening, without a write, when its end date
passes, its sharer stops being an active member with `files:share`, the matter stops being visible,
or the recipient's Directory record is deleted or merged. Staff see those as **Ended** and **Needs a
new sharer**; changing the share makes the actor its sharer.

Permission `files:share` is seeded to Owner/Admin, Attorney and Paralegal.

## Routes

- `GET /api/v1/matters/{matterId}/shares`: every active share, with the person's name and dormant
  state.
- `POST /api/v1/matters/{matterId}/shares`: share items with people (upsert per person and target).
- `PATCH /api/v1/shares/{shareId}`: change role, download, sign-in or end date.
- `DELETE /api/v1/shares/{shareId}`: stop.

## The screens (all in the matter's File Manager)

- **Shared mark**: a people icon after a shared row's name and on a shared folder in the rail.
- **Shared With column**: beside Name; the names are the value (sort, filter, fit), initials drawn.
- **Sharing in the details panel**: a file's **Sharing** tab; a folder's sharing beneath its details.
  People with a direct share get a role menu and a "..." menu (Allow Download, Add/Change/Remove End
  Date, Stop Sharing); people reached through the folder are listed read-only under **Through**.
  **Add Person** picks from the Directory and shares as a Viewer.
- **Share** in the right-click menu opens that panel with the Directory search showing; over a
  selection it shares every selected item.
- **Sharing view** in the rail: the people with anything shared; for the selected person, the
  matter's folders and files as an outline with a role menu, "Viewer, through Pleadings", or
  **Share** on each row.

## Open owner questions (defaults in force)

1. An outside Editor's change saves as a new version waiting for staff acceptance, like an upload.
2. Commenter ships after file comments exist.
