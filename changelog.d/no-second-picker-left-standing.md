---
category: Changed
audience: internal
---

**The conflicts check, the waiver disposition and the cost record pick people through the one
picker.** `subject-party-picker.svelte` and `cost-payee-picker.svelte` are deleted; the check runner
uses `EntityPicker` in multiple mode, the disposition dialog and the cost record window in single
mode, all over `directoryPickerSearch`. A source scan (`apps/web/test/entity-picker-gate.test.ts`)
refuses any other caller of `searchDirectory` outside `$lib/directory`, naming the one standing copy
— the custodian's `owner-picker.svelte` — with the reason it stands: the custodian-refinements
stream rewrites that file and its dialog, and folds it when it lands. The allowance fails the scan
the day the copy is gone.
