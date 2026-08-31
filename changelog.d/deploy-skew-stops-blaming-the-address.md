---
category: Fixed
audience: public
---

**Deploy skew stops reading as "that address cannot be viewed".** The interface and the API ship
as separate Workers since this morning, so a freshly deployed page can meet an older API: the
viewer's new streaming route answered 404 there, and the problem guidance's default case blamed
the member's address for it — youtube.com, google, and 8.8.8.8 all "failed" identically. Three
fixes in the seam: a 404 from our own API now reads as "The service is mid-update" with refresh
guidance, never an input fault; `viewSafelyStaged` falls back to the non-streaming capture when
the streaming route is not deployed, so skew costs the narration, not the capture; and
`normalizeTarget` refuses a bare single label ("google") at the field with the inline hint — it
parses as a URL but names no public host, so it only bought a round trip to a refusal. Screen
side: the export menu's format rows carry the same file symbols the file manager uses for xlsx,
csv, and txt, and the viewer's Static/Live control joins into one segmented button whose halves
touch, active side filled.

## Public

**The viewer stops blaming your address during updates.** When the app is mid-update, a capture
now says so and suggests a refresh instead of claiming the address cannot be viewed — and in most
cases it simply completes the old way, without the progress narration. Typing a bare word like
"google" now tells you at the field to enter a full address. The download menu shows each format
with its file symbol, and the Static/Live switch reads as one control with the active side filled.
