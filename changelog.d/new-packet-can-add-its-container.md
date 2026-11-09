---
category: Fixed
audience: public
---

**The New Packet form can add the container it needs.** Nothing in `apps/web` called `POST /api/v1/custody/locations`, so a firm that had never set up storage met an empty, disabled Container list, and since Container is required the packet could never be saved. The Custodian screens' refusal for "no open container" only fired when containers existed and were all closed, so the zero-container case slipped through to the dead form. The Container field is now a combobox over every open container's path (`container-picker.svelte`) whose add row opens a panel for Name, Kind and Inside; `container-draft.ts` decides the requests, creating an office's own root node first when a container goes into an office the tree has never met, since only a root may name a firm office. An empty tree opens the panel by itself, the "no open container" refusal is gone from both Custodian screens, the required fields come first, and the commit reads Save.

## Public

**You can save a packet even if your firm has never set up its storage.** The Container field on New Packet lists every open container by its full path, and you can type to narrow it. If the container you need is not there, type its name and choose Add: say what kind it is and what it sits inside, and it is ready to use. The first time your firm logs a packet, the form opens straight onto this. The form now asks for the name, who it is held for and the container first, and its button reads Save.
