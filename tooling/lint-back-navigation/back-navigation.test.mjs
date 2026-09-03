import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditBackNavigation,
  backDestinations,
  BACK_TARGETS_SOURCE,
  candidateFiles,
  DESTINATIONS_SOURCE,
  destinationPaths,
  discoverRoutes,
  handRolledHeaders,
  screensUnderAScreen,
  spelledOutBackTargets,
} from "./back-navigation.mjs";

/*
 * The gate's own proof. Every assertion here is fed a route tree that is deliberately wrong, because
 * a governance scan that has only ever been run against a healthy repository is a scan nobody has
 * seen bite — and the failure mode of a broken one is a fast green, which is indistinguishable from
 * the good news it is meant to deliver.
 *
 * The trees are plain objects: a directory is an object, a file is a string of its source. They are
 * handed to the scan through its injected filesystem, so nothing here touches disk except the last
 * block, which runs the real scan over the real routes.
 */

const ROOT = path.join(path.sep, "repository");
const WEB_SOURCE = path.join(ROOT, "apps", "web", "src");
const ROUTES = path.join(WEB_SOURCE, "routes");

/** The registry as this scan reads it, kept small so a test states its own world. */
const DESTINATIONS = new Map([
  ["directory", "/directory"],
  ["matters", "/matters"],
  ["tools", "/tools"],
  ["home", "/home"],
]);
const SPELLED_OUT = new Map([["DEVELOPER_CONSOLE_BACK", "/developer-console"]]);

/** Walk a nested-object repository to the node at `file`, or undefined. */
function nodeAt(repository, file) {
  let node = repository;
  for (const segment of path.relative(ROOT, file).split(path.sep)) {
    if (segment === "") continue;
    if (typeof node !== "object" || node === null) return undefined;
    node = node[segment];
  }
  return node;
}

/** The injected filesystem, as arrow properties so a destructured reader carries no `this`. */
function filesystem(repository) {
  const readDirectory = (directory) => {
    const node = nodeAt(repository, directory);
    if (typeof node !== "object" || node === null) {
      throw new Error(`not a directory: ${directory}`);
    }
    return Object.entries(node).map(([name, child]) => ({
      name,
      isDirectory: () => typeof child === "object" && child !== null,
      isFile: () => typeof child === "string",
    }));
  };
  const readFile = (file) => {
    const node = nodeAt(repository, file);
    if (typeof node !== "string") throw new Error(`not a file: ${file}`);
    return node;
  };
  const exists = (file) => typeof nodeAt(repository, file) === "string";
  return { readDirectory, readFile, exists };
}

function audit(repository) {
  const { readDirectory, readFile, exists } = filesystem(repository);
  return auditBackNavigation({
    routesRoot: ROUTES,
    webSource: WEB_SOURCE,
    destinations: DESTINATIONS,
    spelledOut: SPELLED_OUT,
    readDirectory,
    readFile,
    exists,
  });
}

/** A page whose header names where it came from, written the way a route file writes one. */
function pageNaming(back) {
  const attribute = back.startsWith("{") ? `back=${back}` : `back="${back}"`;
  return [
    '<script lang="ts">',
    '  import ScreenHeader from "$lib/screen/screen-header.svelte";',
    "</script>",
    "",
    `<ScreenHeader title="A screen" ${attribute} />`,
  ].join("\n");
}

/** A page with a header that names nothing — a main screen's shape, on a screen that is not one. */
const HEADER_WITHOUT_BACK = [
  '<script lang="ts">',
  '  import ScreenHeader from "$lib/screen/screen-header.svelte";',
  "</script>",
  "",
  '<ScreenHeader title="A screen" />',
].join("\n");

const PLAIN_PAGE = `<script lang="ts">\n</script>\n\n<p>A screen</p>`;

/** A repository holding `routes`, plus the component every route file composes. */
function repositoryWith(routes) {
  return {
    apps: {
      web: {
        src: {
          routes,
          lib: { screen: { "screen-header.svelte": "<!-- the one header -->" } },
        },
      },
    },
  };
}

describe("which screens owe a way back", () => {
  it("route groups name no path segment", () => {
    const routes = discoverRoutes(ROUTES, {
      readDirectory: filesystem(
        repositoryWith({ "(app)": { matters: { "+page.svelte": PLAIN_PAGE } } }),
      ).readDirectory,
    });
    expect(routes.filter((route) => route.page).map((route) => route.segments)).toEqual([
      ["matters"],
    ]);
  });

  it("pairs a nested page with the nearest ancestor that renders a page", () => {
    const routes = discoverRoutes(ROUTES, {
      readDirectory: filesystem(
        repositoryWith({
          "(app)": {
            matters: {
              "+page.svelte": PLAIN_PAGE,
              "[id]": { overview: { "+page.svelte": PLAIN_PAGE } },
            },
          },
        }),
      ).readDirectory,
    });
    const pairs = screensUnderAScreen(routes);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].parent.segments).toEqual(["matters"]);
  });

  it("demands nothing of a screen whose ancestors render no page", () => {
    // /settings only redirects, so /settings/theme was never entered FROM a settings screen.
    const result = audit(
      repositoryWith({ "(app)": { settings: { theme: { "+page.svelte": PLAIN_PAGE } } } }),
    );
    expect(result.failures).toEqual([]);
    expect(result.covered).toEqual([]);
  });

  it("searches the page and every layout up to the parent screen, and no further", () => {
    const files = candidateFiles({
      route: { directory: path.join(ROUTES, "(app)", "tools", "whois-lookup"), segments: [] },
      parent: { directory: path.join(ROUTES, "(app)", "tools"), segments: [] },
    });
    expect(files.map((file) => path.relative(ROUTES, file).split(path.sep).join("/"))).toEqual([
      "(app)/tools/whois-lookup/+page.svelte",
      "(app)/tools/+layout.svelte",
    ]);
  });
});

describe("naming where a screen came from", () => {
  it("fails a screen whose header names nothing", () => {
    const result = audit(
      repositoryWith({
        "(app)": {
          directory: {
            "+page.svelte": PLAIN_PAGE,
            "[id]": { "+page.svelte": HEADER_WITHOUT_BACK },
          },
        },
      }),
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("/directory/[id]");
    expect(result.failures[0]).toContain("does not say so");
  });

  it("accepts a destination id naming the parent's own path", () => {
    const result = audit(
      repositoryWith({
        "(app)": {
          directory: {
            "+page.svelte": PLAIN_PAGE,
            "[id]": { "+page.svelte": pageNaming("directory") },
          },
        },
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.covered).toEqual(["/directory/[id]"]);
  });

  it("accepts an answer paid for once by a layout above", () => {
    const result = audit(
      repositoryWith({
        "(app)": {
          tools: {
            "+page.svelte": PLAIN_PAGE,
            "+layout.svelte": pageNaming("tools"),
            "whois-lookup": { "+page.svelte": PLAIN_PAGE },
          },
        },
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.covered).toEqual(["/tools/whois-lookup"]);
  });

  it("follows the components a header is built from", () => {
    const result = audit({
      apps: {
        web: {
          src: {
            routes: {
              "(app)": {
                matters: {
                  "+page.svelte": PLAIN_PAGE,
                  "[id]": {
                    "+layout.svelte":
                      '<script lang="ts">\n  import MatterHeader from "$lib/matters/matter-header.svelte";\n</script>\n<MatterHeader />',
                    overview: { "+page.svelte": PLAIN_PAGE },
                  },
                },
              },
            },
            lib: {
              screen: { "screen-header.svelte": "<!-- the one header -->" },
              matters: { "matter-header.svelte": pageNaming("matters") },
            },
          },
        },
      },
    });
    expect(result.failures).toEqual([]);
    expect(result.covered).toEqual(["/matters/[id]/overview"]);
  });

  it("never mistakes the shared header's own back link for a screen's answer", () => {
    /*
     * The regression this exists for: screen-header.svelte places the back link every screen's
     * answer flows through. A component walk that followed the import into it would find a back
     * link in every screen that has a title, and the whole gate would pass vacuously.
     */
    const result = audit({
      apps: {
        web: {
          src: {
            routes: {
              "(app)": {
                directory: {
                  "+page.svelte": PLAIN_PAGE,
                  "[id]": { "+page.svelte": HEADER_WITHOUT_BACK },
                },
              },
            },
            lib: {
              screen: {
                "screen-header.svelte":
                  '<script lang="ts">\n  import BackLink from "$lib/navigation/back-link.svelte";\n</script>\n<ScreenHeader back="directory" />',
              },
            },
          },
        },
      },
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("/directory/[id]");
  });

  it("refuses a destination that is not the screen above", () => {
    const result = audit(
      repositoryWith({
        "(app)": {
          directory: {
            "+page.svelte": PLAIN_PAGE,
            "[id]": { "+page.svelte": pageNaming("home") },
          },
        },
      }),
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("does not lead to /directory");
    expect(result.failures[0]).toContain("/home");
  });

  it("refuses a back target that resolves to no destination", () => {
    const result = audit(
      repositoryWith({
        "(app)": {
          directory: {
            "+page.svelte": PLAIN_PAGE,
            "[id]": { "+page.svelte": pageNaming("{SOME_OTHER_SCREEN}") },
          },
        },
      }),
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("resolves to no destination");
  });

  it("accepts a spelled-out back target for a screen outside the sidebar", () => {
    const result = audit({
      apps: {
        web: {
          src: {
            routes: {
              "developer-console": {
                "+page.svelte": PLAIN_PAGE,
                "table-states": { "+page.svelte": pageNaming("{DEVELOPER_CONSOLE_BACK}") },
              },
            },
            lib: { screen: { "screen-header.svelte": "<!-- the one header -->" } },
          },
        },
      },
    });
    expect(result.failures).toEqual([]);
    expect(result.covered).toEqual(["/developer-console/table-states"]);
  });

  it("reads a destination id out of a multi-line header call", () => {
    const source = [
      '<script lang="ts">',
      '  import ScreenHeader from "$lib/screen/screen-header.svelte";',
      "</script>",
      "<ScreenHeader",
      '  title="WHOIS Lookup"',
      '  back="tools"',
      '  class="mb-24"',
      ">",
      "</ScreenHeader>",
    ].join("\n");
    expect(
      backDestinations(source, { destinations: DESTINATIONS, spelledOut: SPELLED_OUT }),
    ).toEqual([{ named: "tools", to: "/tools" }]);
  });
});

describe("declining", () => {
  it("skips the signed-out subtrees, which carry their own step-back", () => {
    const result = audit(
      repositoryWith({
        login: { "+page.svelte": PLAIN_PAGE, "reset-password": { "+page.svelte": PLAIN_PAGE } },
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.excluded).toEqual(["/login/reset-password"]);
  });
});

describe("one header for every screen", () => {
  it("names a screen that assembles its own masthead, and one that hand-rolls a back link", () => {
    const sources = {
      "own-masthead.svelte": "<Masthead.Root><Masthead.Title>Hi</Masthead.Title></Masthead.Root>",
      "hand-rolled.svelte":
        '<script>\n  import EyebrowLink from "@magna-carta/design-system/eyebrow-link";\n  import ArrowLeft from "@lucide/svelte/icons/arrow-left";\n</script>\n<EyebrowLink href="/matters"><ArrowLeft /></EyebrowLink>',
      "composed.svelte": pageNaming("matters"),
      "the-header.svelte": "<Masthead.Root>the one header</Masthead.Root>",
    };
    const offenders = handRolledHeaders(Object.keys(sources), {
      readFile: (file) => sources[file],
      allow: new Set(["the-header.svelte"]),
    });
    expect(offenders.map((offender) => offender.file)).toEqual([
      "own-masthead.svelte",
      "hand-rolled.svelte",
    ]);
    expect(offenders[0].reason).toContain("Masthead.Root");
  });
});

describe("the real sources", () => {
  const repositoryRoot = path.join(import.meta.dirname, "..", "..");
  const destinations = destinationPaths(
    readFileSync(path.join(repositoryRoot, DESTINATIONS_SOURCE), "utf8"),
  );
  const spelledOut = spelledOutBackTargets(
    readFileSync(path.join(repositoryRoot, BACK_TARGETS_SOURCE), "utf8"),
  );
  const webSource = path.join(repositoryRoot, "apps", "web", "src");
  const result = auditBackNavigation({
    routesRoot: path.join(webSource, "routes"),
    webSource,
    destinations,
    spelledOut,
  });

  it("parses the sidebar registry into real paths", () => {
    expect(destinations.get("matters")).toBe("/matters");
    expect(destinations.get("directory")).toBe("/directory");
    expect(destinations.size).toBeGreaterThan(10);
  });

  it("parses the spelled-out back targets", () => {
    expect(spelledOut.get("DEVELOPER_CONSOLE_BACK")).toBe("/developer-console");
  });

  it("has a way back on every screen entered from another screen", () => {
    expect(result.failures).toEqual([]);
  });

  it("covers the detail screens this rule was written for", () => {
    expect(result.covered).toEqual(
      expect.arrayContaining([
        "/directory/[id]",
        "/conflicts/checks/[checkId]",
        "/conflicts/matters/[matterId]",
        "/matters/[id]/overview",
        "/tools/whois-lookup",
        "/developer-console/table-states",
      ]),
    );
  });
});
