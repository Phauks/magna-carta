# Tools — double-click launchers for common tasks

Owner-facing launchers for the things you open most. Every script works from any checkout of the repo (paths are relative to this folder), opens its own terminal window, and stays open so you can read the output.

| Launcher                | What it does                                                                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-coverage-map.cmd` | Regenerates the government-records **coverage map** from the live registry and opens it in your browser — property / business / licensing coverage, deep-link vs search-only shading; click any region to open its real search page. |

Terminal equivalents:

```
pnpm --filter @magna-carta/government-links coverage        # regenerate the map data + open the map
pnpm --filter @magna-carta/government-links coverage:data   # regenerate the map data only
```

The map reads a generated snapshot (`packages/government-links/mockups/coverage-data.js`); the launcher regenerates it from the registry each time, so it is always current. The US county shapes load from a CDN, so opening the map needs an internet connection.
