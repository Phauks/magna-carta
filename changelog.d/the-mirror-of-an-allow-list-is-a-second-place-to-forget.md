---
category: Fixed
audience: internal
---

**The `uploads.matches` audit exemption reaches the second list that needed it, and the live-served conformance sweep goes green.** The route asks whether the firm already holds a file's bytes before they are sent — a read wearing a POST's clothes — and it correctly declares `audited: false`. The rule holding every mutating method to `x-mc-audited: true` is asserted twice, though: once over the document built in-process, and once over the document the worker actually serves, each consulting its own copy of the non-mutating allow-list. Only the first copy was given the entry, so the emitted-document sweep in the end-to-end suite stayed red after the conformance register was fixed.

A mirrored allow-list is a second place to forget, and the comment on the copy says it mirrors the other without anything checking that it does. The entry is added with the same reasoning the route carries; making the two lists one declaration, so the next exemption cannot land in half of them, is the repair this asks for rather than performs.
