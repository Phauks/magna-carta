---
category: Changed
audience: internal
---

**The navigation column's row is one design-system part, and the catalogue column has its own home.** `NavigationLayout` gained a `Row` export (`packages/design-system/src/lib/components/navigation-layout/navigation-layout-row.svelte`, recipe `mc-navigation-layout-row`): the control-height rounded row, the quiet hover tint, and the lit row's selected fill with the gilt start-edge bar drawn as an inset box-shadow. Three places had written that treatment out by hand — the settings layout, the catalogue column Tools and Reports share, and the inline `style` strings in both — with the file manager's folder tree already foreseen as the fourth. All three now compose the part, and `apps/web/test/{settings,tools,reports}-navigation.test.ts` each fail if a row grows a class list or an inline style of its own again.

Two judgments moved into the part. The element follows from `href` and nothing else: a string is an anchor, omitting it is a button, and `null` is an entry designed with nowhere to go yet, which stands unlinked and quiet with its Soon mark rather than dressed as a disabled control — the same spelling `CatalogueEntry.href` already used. And a name wraps rather than truncating: the control height is a `min-block-size` and the recipe carries no `white-space` or `text-overflow`, because a row reading "Property Listin… Soon" has stopped naming the thing, which is a navigation row's one job. The layout still imposes no structure on what the navigation holds; taking the row is a choice.

`catalogue-navigation.{svelte,ts}` moved from `apps/web/src/lib/tools/` to `apps/web/src/lib/catalogue/`. It serves Tools and Reports equally, so Reports had been importing a column out of the Tools directory; the catalogue framework's third view now sits beside its list and tiles views, and `apps/web/src/lib/catalogue/CLAUDE.md` says so.
