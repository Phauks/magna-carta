import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditBackNavigation,
  backLinkDestinations,
  candidateFiles,
  discoverRoutes,
  handRolledBackLinks,
  screensUnderAScreen,
  stringConstants,
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
    readDirectory,
    readFile,
    exists,
  });
}

/** A page carrying a back link to `destination`, written the way a route file writes one. */
function pageWithBackLink(destination) {
  return [
    '<script lang="ts">',
    '  import BackLink from "$lib/navigation/back-link.svelte";',
    "</script>",
    "",
    `<nav aria-label="Back"><BackLink href="${destination}" label="Somewhere" /></nav>`,
  ].join("\n");
}

const PLAIN_PAGE = `<script lang="ts">\n</script>\n\n<h1>A screen</h1>`;

/** A repository holding `routes`, plus the one component every route file imports. */
function repositoryWith(routes) {
  return { apps: { web: { src: { routes, lib: { navigation: { "back-link.svelte": "" } } } } } };
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
});

describe("the affordance itself", () => {
  it("fails a screen entered from another that offers no way back", () => {
    const result = audit(
      repositoryWith({
        "(app)": {
          directory: { "+page.svelte": PLAIN_PAGE, "[id]": { "+page.svelte": PLAIN_PAGE } },
        },
      }),
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("/directory/[id]");
    expect(result.failures[0]).toContain("/directory");
    expect(result.failures[0]).toContain("$lib/navigation/back-link.svelte");
  });

  it("accepts a back link in the page", () => {
    const result = audit(
      repositoryWith({
        "(app)": {
          directory: {
            "+page.svelte": PLAIN_PAGE,
            "[id]": { "+page.svelte": pageWithBackLink("/directory") },
          },
        },
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.covered).toEqual(["/directory/[id]"]);
  });

  it("accepts a back link paid for once by a layout above", () => {
    const result = audit(
      repositoryWith({
        "(app)": {
          tools: {
            "+page.svelte": PLAIN_PAGE,
            "+layout.svelte": pageWithBackLink("/tools"),
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
              navigation: { "back-link.svelte": "" },
              matters: { "matter-header.svelte": pageWithBackLink("/matters") },
            },
          },
        },
      },
    });
    expect(result.failures).toEqual([]);
    expect(result.covered).toEqual(["/matters/[id]/overview"]);
  });

  it("refuses a way back that leads somewhere the reader did not come from", () => {
    const result = audit(
      repositoryWith({
        "(app)": {
          directory: {
            "+page.svelte": PLAIN_PAGE,
            "[id]": { "+page.svelte": pageWithBackLink("/home") },
          },
        },
      }),
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("does not lead to /directory");
    expect(result.failures[0]).toContain("/home");
  });

  it("accepts an href it cannot read only where the parent path carries a parameter", () => {
    const dynamicParent = repositoryWith({
      "(app)": {
        matters: {
          "[id]": {
            "+page.svelte": PLAIN_PAGE,
            files: {
              "+page.svelte":
                '<script lang="ts">\n  import BackLink from "$lib/navigation/back-link.svelte";\n</script>\n<BackLink href={matterHref} label="The matter" />',
            },
          },
        },
      },
    });
    expect(audit(dynamicParent).failures).toEqual([]);

    const staticParent = repositoryWith({
      "(app)": {
        directory: {
          "+page.svelte": PLAIN_PAGE,
          "[id]": {
            "+page.svelte":
              '<script lang="ts">\n  import BackLink from "$lib/navigation/back-link.svelte";\n</script>\n<BackLink href={somewhere} label="Directory" />',
          },
        },
      },
    });
    expect(audit(staticParent).failures[0]).toContain("an expression this scan cannot read");
  });

  it("resolves the destination through a const beside the markup", () => {
    const source = `<script lang="ts">
  import BackLink from "$lib/navigation/back-link.svelte";
  const MATTERS_HREF = "/matters";
</script>
<BackLink href={MATTERS_HREF} label="Matters" display="arrow-only" />`;
    expect(stringConstants(source).get("MATTERS_HREF")).toBe("/matters");
    expect(backLinkDestinations(source)).toEqual(["/matters"]);
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

describe("the one component", () => {
  it("names a header that hand-rolls the affordance instead of composing BackLink", () => {
    const handRolled = `<script lang="ts">
  import EyebrowLink from "@magna-carta/design-system/eyebrow-link";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
</script>
<EyebrowLink href="/matters" aria-label="Back to Matters"><ArrowLeft /></EyebrowLink>`;
    const composed = pageWithBackLink("/matters");
    const readFile = (file) => (file === "hand-rolled.svelte" ? handRolled : composed);
    expect(handRolledBackLinks(["hand-rolled.svelte", "composed.svelte"], { readFile })).toEqual([
      "hand-rolled.svelte",
    ]);
  });
});

describe("the real route tree", () => {
  const repositoryRoot = path.join(import.meta.dirname, "..", "..");
  const webSource = path.join(repositoryRoot, "apps", "web", "src");
  const result = auditBackNavigation({
    routesRoot: path.join(webSource, "routes"),
    webSource,
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
