---
category: Fixed
audience: public
---

**Your own speaking mark in a meeting opened in its own tab.** A meeting tab opened by a press in another tab has had no press of its own, so the browser started the speaking meter's `AudioContext` suspended, warned "The AudioContext was not allowed to start", and the meter read silence. `createBrowserAudioLevelMeter` now waits for the page's first press when `navigator.userActivation.hasBeenActive` is false, and the recording chime's device is likewise made only from a press.

## Public

In a meeting opened in its own tab, the mark that shows you are speaking now lights after your first click in the meeting, and the browser no longer warns that sound was not allowed to start.
