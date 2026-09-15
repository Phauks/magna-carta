# File Unlock & Password Recovery

Open a password-protected file when you have the password, or recover a password you have lost — for files you are authorized to access.

## What it does

Encrypted files ask for a password before they will open. This tool handles two situations:

- **Unlock** — you have the password. The tool removes the protection and gives you back an ordinary, openable copy of the file. Use this to save a permanent unprotected version, or to work with a file whose password you would otherwise have to type every time.
- **Recover** — you do not have the password. The tool searches for it by trying a large list of likely passwords and common variations. If it finds the password, it shows it to you and you can then unlock the file. If it does not find the password, it tells you plainly.

Both operations only ever run when you start them — nothing unlocks or searches on its own.

Your file is never stored. The tool works on it, returns the result, and keeps no copy in Magna Carta.

## Opening a locked PDF straight from the reader

If you open a password-protected PDF from a matter's Files page, the reader asks for the password right there instead of failing to open. Type it and the document opens normally — the password is checked in this browser and never sent anywhere. If it is wrong, the reader tells you and lets you try again.

If you do not have the password, the reader points you to this tool to start a recovery search — download the document first, since File Unlock & Password Recovery works on its own copy of a file rather than reaching into a matter for one.

## When to use it

- A client sends a password-protected PDF or Word document and you need a clean copy for the matter file.
- You protected a file yourself and no longer remember the password.
- You received an encrypted archive (`.zip`) and have the password on hand.

Only use it on files you are authorized to open. Each time you start a job you confirm that authorization.

## Supported file types

| Type                | Formats                   |
| ------------------- | ------------------------- |
| PDF documents       | `.pdf`                    |
| Compressed archives | `.zip`                    |
| Office documents    | `.docx`, `.xlsx`, `.pptx` |

More formats (7-Zip, older Office formats, RAR) are planned but not yet supported. If you upload a type that is not listed, the tool tells you clearly.

## Common tasks

**Unlock a file you have the password for**

1. Open **File Workbench** in the sidebar, under **Firm**, and open the **Unlock** tab.
2. Drop in the encrypted file, or use **Add Files**.
3. Confirm you are authorized to open it.
4. Enter the password and choose **Unlock**.
5. Download the unprotected copy. Your original file is unchanged.

**Recover a password you have lost**

1. Upload the encrypted file and confirm you are authorized to open it.
2. Choose **Recover password**. The search starts and shows its progress.
3. When it finishes, one of three things happens:
   - **Found** — the password is shown to you. Copy it, then use Unlock to open the file.
   - **Not found** — the search tried its full list without success. The file's password is not a common or predictable one.
   - **Needs more powerful hardware** — the file uses a modern, deliberately slow form of encryption that ordinary computers cannot search quickly. This kind of recovery needs specialized hardware, offered in a later version.

## Where the search runs

Starting a recovery search opens its own screen, addressed by that search rather than by the file you started it from. You can leave it, close the tab, and come back to the same link later — the search keeps running in the background either way, and this is also what lets you cancel it whenever you like.

## Tips and edge cases

- **A recovered password is shown once, to you.** For your security it is shown only to the person who started the recovery and is not recorded anywhere afterward. Copy it somewhere safe when you see it — after a while it is cleared, and another firm member cannot read it even with the job link.
- **Recovery is not guaranteed.** It works by trying likely passwords. A strong, random, or unusual password will not be found. A short or common one usually will.
- **Recovery can take time.** The search runs in the background; you can check its progress and cancel it at any time.
- **"Needs more powerful hardware" is not a failure.** It means the file is protected by strong modern encryption that this tool cannot attack on ordinary computers yet. Nothing is wrong with your file.
- **The file size limit applies.** Very large files are refused with a clear message.
- **The tool never opens a file you have not attested you may access**, and it needs the decryption permission — if you do not see the **Unlock** tab, ask your firm administrator.

## Related features

- **Metadata Inspector & Scrubber** — after unlocking a document, check and remove hidden information before sharing it.
- **File Workbench** — unlocking is the **Unlock** tab there, alongside every other thing the firm can do to a file.
