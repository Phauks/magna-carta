---
category: Added
audience: public
---

**Exhibit list and package.** The Exhibits screen makes a set's exhibit list as a PDF (`exhibitListDocument` and `exhibitCoverDocument` in `packages/exhibits/src/list-document.ts`, on the house-document framework) and a compiled package: the list, then a cover sheet and the exhibit's pages for each active member, merged and Bates-stamped in a Web Worker (`apps/web/src/lib/exhibits/exhibit-package.worker.ts`). The package takes one range from the matter's Bates register with purpose `exhibitPackage` and records the saved file against it. Members that are not PDFs are left out and named. The PDF Editor's side panels (Bates, Watermark, Secure, Redact, Forms, Signature) were sized off the spacing scale at four times their intended width and pushed the page off screen; they now use the container widths. Bates, Watermark and Secure show the form alone on a phone, and the tool tabs wrap on narrow screens.

## Public

Exhibit sets can now be printed. **Exhibit List** saves the set's list as a PDF, and **Package** saves one PDF of the list, a cover sheet for each exhibit and the exhibits themselves, with Bates numbers on every page that carry on from the last number used on the matter. The PDF Editor's Bates, Watermark and Secure tabs also show the page beside the settings again, and fit on a phone.
