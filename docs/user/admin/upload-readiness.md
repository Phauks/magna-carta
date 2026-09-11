# Checking that uploads can reach the firm's storage

When a file is uploaded, it goes from your browser straight to the firm's storage — not through the rest of Magna Carta. That is what makes large uploads fast, and it is also why, when storage refuses the file, the upload can only tell you that storage did not answer: the refusal never passed through anything that could read it.

The check asks the server to look from its side, where it can see what your browser cannot.

## Who sees it

Anyone who can change the firm's file-safety settings — by default, the Owner/Admin role. Everyone else sees, in the same place, what the last check found.

## Running the check

1. Click the **version chip** at the top right of the screen (the small build identifier).
2. In the **Database** section, the **File storage** line shows the verdict. The check runs on its own each time an administrator opens the panel, with the other things the panel reads.
3. Press **Upload readiness report** to open the full report. **Check Again** runs it once more; **Copy Report** puts the whole report on your clipboard, ready to paste into a message.

The check takes a few seconds. It looks at six things, in the order an upload depends on them:

| Line                               | What it means                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| Storage bucket recorded            | The firm's record names the place its files are kept.                            |
| Storage bucket exists              | That place exists.                                                               |
| Scanning is told of new files      | Every new file is handed to the malware scan.                                    |
| Temporary artifacts expire         | Download bundles and converted copies are cleared out on their own.              |
| This site may write to storage     | Storage accepts uploads from the address you use Magna Carta at.                 |
| The storage credential is honoured | The credential Magna Carta signs uploads with is accepted by the firm's storage. |

## Reading the report

Each line carries one of four marks:

- **Holds** — it was checked and is right.
- **Applied** — it is a setting Magna Carta owns, and the check put it in place. It may or may not have been wrong before; either way it is right now.
- **Failed** — it is not in place. The line says what was found and what to do about it.
- **Not applicable** — this installation does not need it, and the check did not pretend to look.

Read the report top down. **The first line that fails is the cause**; a line under it may only be a consequence, and once the cause is put right, run the check again.

## What the check puts right on its own

The three settings in the middle of the list — scanning, expiry, and permission to write from this site — belong to Magna Carta, so the check re-applies them every time it runs. If an upload failed because one of them was missing, opening the panel is the fix.

## What it can only name

Two things the check cannot put right, because they are decisions made when Magna Carta was set up:

- **A storage bucket that does not exist.** The firm was set up by an installation that was not able to create one. The report says so; setting up the firm again under a correctly configured installation is the remedy, and the check will not create a bucket on its own.
- **A credential storage does not honour.** The report names the credential and how it needs to be issued. Whoever administers the installation puts it right.

In both cases the report's wording is what to pass on — **Copy Report** is there for exactly that.

## Nothing about your files is read

The check looks at the firm's storage settings and at whether a credential is accepted. It does not open, list, or change any of the firm's documents, and it records only that the check was run, by whom, and which lines failed.
