---
category: Changed
audience: internal
---

**The firm calendar's rail of calendars moved onto `NavigationLayout`**, the design system's one shape for a screen with a navigational column on the left and content on the right.

It had drawn its own: a `<nav>` at `w-3xs` with a scroll region and a gutter of its own beside the grid — a sixth width and a sixth scroll treatment for the shape the owner ruled on 2026-09-11 is one component. Settings, Magnus, Tools and Reports were already on it; the calendar was the screen nobody had come back to.

`CalendarView` renders the layout where the rail stands — a firm-side scope with calendars to list — and keeps the plain full-height stack everywhere else, so a matter's calendar, a room's grid, Home's card and the record forms' day schedule are untouched. The screen's masthead is handed DOWN as a `header` snippet and drawn at the top of the content column: the layout takes the full height under the top bar and cancels the work canvas inset, so a masthead above the tag would sit above the whole canvas. The Magnus workspace already does this, for the same reason.

The rail's rows stay checkbox rows rather than becoming `NavigationLayout.Row`. The shared row renders its own anchor or button and lights the one the reader is standing on; every row here is a switch with a control already inside it, which cannot be nested in another. What the two columns share is the frame and the indent stagger — the folder heading its group at the column's cap-line, its calendars one step past it — which is precisely what "the layout imposes no structure on what the navigation holds" is for. A calendar's name now wraps rather than truncating, as every other navigation column's does.
