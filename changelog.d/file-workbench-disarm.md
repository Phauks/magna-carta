---
category: Added
audience: public
---

**The File Workbench's Malware Scan tab disarms files.** `apps/web/src/lib/tools/file-workbench/panels/malware-scan-panel.svelte` runs `@magna-carta/disarm` in the browser as the tab opens and lists what the engine removed (named in `disarm-reading.ts`), then offers the disarmed copy to save or to put on the bench. The scan verdict sits above it with the scan control in its pending state, since scanning still needs the server's scanner. The capability is now served (`awaiting: null`). The web and community builds and the `rust-wasm-build` composite now build the disarm WebAssembly.

## Public

**Take everything that can act out of a file before you open it.** On the File Workbench's **Malware Scan** tab, a PDF, Office document, RTF document or picture now shows everything in it that runs, opens or fetches on its own: scripts and macros, actions that run on opening, embedded objects and files, controls, and links fetched without asking. **Save a Disarmed Copy** gives you the file with all of that removed and the text, formatting, pictures and web links kept. A Word file with macros comes back as a plain Word file. The original is never changed, and it all happens in your browser.
