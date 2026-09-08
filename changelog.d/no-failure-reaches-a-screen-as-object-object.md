---
category: Fixed
audience: internal
---

Three screens rendered a failure as `[object Object]`; none can now, and a fourth cannot be written.

The docket, the directory and a matter's time each interpolated the failure RECORD into an Alert. Svelte renders an object by stringifying it, so the reader got `[object Object]` where the sentence belonged — and the Error ID, the remedy and the retry went with it, which is the difference between a report somebody can act on and a screenshot of nothing. Each goes through the standard failure surface now.

`lint:failure-surface` gains a third banned idiom to match. It already refused a problem flattened to its sentence at the catch site and an Error ID smuggled into prose; it now refuses a failure record rendered as text. Unlike a surface that renders only part of a record — which the rule deliberately leaves alone, because it is a design question — this one is never a choice: there is no reading of `[object Object]` that was intended. The check keys on POSITION rather than formatting, because `failure={x}` and the `{x}` prop shorthand both sit inside a tag while text sits in element content, and all three shipped bugs had the record alone on its own line exactly as a prop shorthand does.

The database section of the diagnostics copy also puts one check per line. Dot-separating four short statuses was fine until a row started carrying its reason; a failing migration's fault runs to a couple of hundred characters, and joined to three other checks it made a wall a reader had to parse before they could see there were four checks at all.
