---
category: Fixed
---

The merge-field catalog contract declares the engine's `assets` group. The engine's group registry
gained the heading when the asset classes landed; the contract's mirror of it did not. The two
registries are pinned to each other member for member and in the same order precisely so that drift
is a failing test rather than a picker that quietly files every asset field under a heading it does
not recognize.
