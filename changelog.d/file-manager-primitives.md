---
category: Added
---

**FileIcon and Breadcrumb — design-system primitives for the file manager.** FileIcon maps a file's content type and/or name to a Lucide glyph (PDF, Word, Excel, PowerPoint, image, video, audio, archive, text, code, email, plus open/closed folder variants and an unknown fallback), sized by its recipe rather than a prop, and decorative by default so the file name beside it carries the label. Breadcrumb renders a folder path as a navigation landmark with an `aria-current` leaf, collapsing the middle of a deep path behind an ellipsis affordance that reveals the full trail in place — the current folder is always kept readable, never truncated. Both ship a Storybook catalog entry with named-step behaviour tests and join the visual-regression matrix.
