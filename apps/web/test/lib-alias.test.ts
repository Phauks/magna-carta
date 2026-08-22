import { describe, expect, it } from "vitest";

/*
 * `$lib` is SvelteKit's alias. This project's vitest config deliberately omits SvelteKit's plugin
 * (a plain node pool, no dev server), so nothing resolves the alias unless the config declares it —
 * and when it does not, every module under test that imports `$lib/...` dies at load with
 * ERR_MODULE_NOT_FOUND rather than failing an assertion. That is a whole-file failure with a
 * message about modules, which reads like a dependency problem rather than a config one.
 *
 * Thirty-six modules in src/lib import through the alias and only one test reached one of them, so
 * the hole sat open until that single suite was written. This test imports THROUGH the alias, so
 * the hole cannot reopen quietly: if the alias goes, this file fails first and says why.
 */
describe("the $lib alias", () => {
  it("resolves at test time, not only for the type-checker", async () => {
    const module_ = await import("$lib/api/request.ts");
    expect(typeof module_.requestJson).toBe("function");
  });
});
