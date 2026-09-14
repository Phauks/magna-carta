---
category: Added
audience: internal
---

**One layout for a screen with a navigational column beside its content — `NavigationLayout` in
the design system.**

Settings drew a two-column canvas by hand (a nav at the popover measure plus its gutters, inside a
negative-margin full-height row with its own scrollbar) and Magnus drew the same shape a second way
(a rail at an off-token container width, a different scroll treatment). The owner's ruling is that
this is one shape, so it is now one component: `@magna-carta/design-system/navigation-layout`
provides the `<nav>` landmark with a required accessible name, two token-derived widths (`standard`
— the settings measure — and `narrow`, which lands on the global sidebar's width), two independent
scroll regions wearing the house scrollbar with a reserved gutter so nothing shifts when a scrollbar
arrives, and the canvas geometry (the full height under the top bar, the work canvas's inset
cancelled) that consumers stopped needing to repeat. What the navigation holds is the consumer's
snippet — grouped section links, a control over rows, a grouped list of tools — so the component
imposes no list structure and takes no `items` prop. Below the `lg` viewport the navigation stacks
above the content and the layout scrolls as one. Settings and Magnus adopt it in their own rounds;
Tools and Reports can take the same shape as list-left, chosen-thing-right.
