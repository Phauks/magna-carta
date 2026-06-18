# Tools — double-click launchers for common tasks

Owner-facing launchers for the things you open most. Every script works from any checkout of the repo (paths are relative to this folder), opens its own terminal window, and stays open so you can read the output.

| Launcher                | What it does                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-coverage-map.cmd` | Opens the government-records **coverage map / verifier** in your browser. Toggle the layer (property → assessor/recorder/GIS sub-toggle, business, licensing); click a state to list its links, then **Open / Preview / mark ✓·✗** each and **Export** the verifications. Runs a small local server so the in-page **Rebuild data** button can regenerate from the live registry. Ctrl+C to stop. |

Terminal equivalents:

```
pnpm --filter @magna-carta/government-links coverage:serve  # serve the map + enable the Rebuild button
pnpm --filter @magna-carta/government-links coverage        # regenerate the data + open the static map
pnpm --filter @magna-carta/government-links coverage:data   # regenerate the data only
```

The map reads a generated snapshot (`packages/government-links/mockups/coverage-data.js`). Served via the launcher, the **Rebuild data** button (top-right of the toggles) regenerates it from the registry on demand; opened as a bare file the button is hidden. The US county shapes load from a CDN, so the map needs an internet connection.
