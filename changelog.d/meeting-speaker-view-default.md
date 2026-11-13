---
category: Changed
audience: public
---

**The meeting room opens in speaker view and draws every picture at the camera's shape.** `MeetingClient.speakerView` now starts true and survives a rejoin; the room and guest pages seed it from `meeting-view-preference.svelte.ts` (layout and mirror, per browser). `meeting-layout.ts` picks the gallery's column count that draws the largest 16:9 tile for the measured space, and speaker view puts the others in a strip along the top. A speaking tile carries an accent outline and an audio-lines mark; a shared screen is shown whole (`object-contain`). The room header's Share menu copies the firm link and, for a host, opens Guests; Effects gains a Mirror My Video switch that flips only the local preview.

## Public

**Meetings open in speaker view, with the gallery one press away.** Your choice is remembered in this browser. Pictures keep the camera's wide shape, so two people on a laptop sit side by side, and whoever is talking gets a clear ring and a speaking mark beside their name. A Share button in the meeting copies its link for people at the firm and lets a host invite guests. Effects has a new Mirror My Video switch, on by default: it flips only your own preview, and everybody else still sees you the right way round.
