---
category: Added
audience: internal
---

**`pnpm run lint:control-characters` now also rejects a raw U+FFFD.** The replacement character is
written `\uFFFD` or not at all.

It rides the existing scan rather than a new one, because the argument is the same one that scan was
already making: a character whose raw form a reader cannot recognise makes source that reads as one
thing and means another. U+FFFD is what a decoder emits for bytes it could **not** read, so a literal
one is indistinguishable from a file that was itself mangled in transit — nobody can tell a deliberate
one from damage. It has a second reason of its own: inside a `u`-flagged regular expression that is
actually used, it hangs the linter with no error and no file named.

The two findings are reported apart. The remedy is identical and the reasoning is not, and a reader
handed the wrong reason for their finding argues with the rule instead of fixing the line.

The scan's self-test gains the new cases, including the code points either side of U+FFFD — a botched
comparison that swallowed the whole range would otherwise pass as a tightened rule. It found a real
offender on its first run: a changelog entry that meant to quote the escape and contained the character
instead, written by someone who had spent that morning on this exact problem. Which is the argument.
