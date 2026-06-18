# Changelog fragments

Add one file per notable change here instead of editing `../CHANGELOG.md`. Filename: a short
kebab-case slug. Contents: frontmatter `category:` (Added · Changed · Deprecated · Removed ·
Fixed · Security) then the entry text. After merge to `main`, `vp run changelog-build` folds
fragments into `[Unreleased]` and removes them.
