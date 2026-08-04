#!/usr/bin/env bash
# Shared image-build shim for the container acceptance suites. Source it, then call `container_build`
# with exactly the arguments you would have passed to `docker build`.
#
# Why it exists: these images rebuild the same Rust dependency graph and bake the same signature and
# wordlist data on every run, and a plain `docker build` on a fresh CI runner starts from an empty layer
# store every time — the acceptance suites' wall-clock is dominated by rebuilding layers whose inputs
# have not moved in months. When CONTAINER_BUILD_CACHE is set (CI sets it), the build runs through
# buildx with an external layer cache, so an unchanged base/dependency layer is imported instead of
# recompiled. Unset — a developer's machine — it is a plain `docker build` against the local layer
# store, which already caches, so nothing about the local workflow changes.
#
# --load is required with the buildx container driver: the acceptance scripts `docker run` the tag they
# just built, and without it the result stays in the builder and never reaches the local image store.
#
# CONTAINER_BUILD_CACHE holds the cache flags themselves (e.g. the type=gha import/export pair) so this
# file never has to know which backend CI uses.

container_build() {
  if [ -n "${CONTAINER_BUILD_CACHE:-}" ]; then
    echo "container_build: buildx with an external layer cache"
    # Deliberate word-splitting: CONTAINER_BUILD_CACHE is a list of flags, not one argument.
    # shellcheck disable=SC2086
    docker buildx build --load ${CONTAINER_BUILD_CACHE} "$@"
  else
    docker build "$@"
  fi
}
