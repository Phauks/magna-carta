#!/usr/bin/env sh
# Regenerates the AUTHORITATIVE visual-regression baselines inside the pinned Playwright
# container — the only rendering environment whose output may be committed (see ./README.md,
# "Baseline discipline"). Requires Docker.
#
# The container tag is derived from the installed @playwright/test version so the browser build
# matches the test runner exactly. Caveat: the in-container `pnpm install` rewrites node_modules
# with Linux binaries — re-run `vp install` on the host afterwards.
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_directory=$(CDPATH= cd -- "$script_directory/.." && pwd)
repository_root=$(CDPATH= cd -- "$script_directory/../../.." && pwd)

playwright_version=$(cd "$package_directory" && node -p "require('@playwright/test/package.json').version")
container_image="mcr.microsoft.com/playwright:v${playwright_version}-noble"

echo "Generating baselines in ${container_image} (mounting ${repository_root})"
docker run --rm \
  -v "${repository_root}:/work" \
  -w /work \
  "${container_image}" \
  bash -lc "corepack enable && pnpm install --frozen-lockfile && pnpm --filter @magna-carta/design-system run storybook-build && pnpm --filter @magna-carta/design-system run visual-regression-update"

echo
echo "Baselines rewritten in packages/design-system/visual-regression/baselines/."
echo "Review the diffs, commit them, then re-run 'vp install' on the host (the container"
echo "install rewrote node_modules with Linux binaries)."
