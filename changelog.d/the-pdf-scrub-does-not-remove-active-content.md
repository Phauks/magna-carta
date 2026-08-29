---
category: Changed
audience: internal
---

`docs/specs/2026-08-25-pdf-active-content-analysis.md` — the PDF scrub removes metadata, attachments, XFA and prior field values, and removes none of `/Names/JavaScript`, `/OpenAction` or `/AA`. Verified against `main`; `generate.rs::split` drops them only as page-subsetting fallout, not as protection.

It matters most on the fillable-PDF template path, where a firm registers a form obtained elsewhere and the platform fills and sends the result under that firm's name. The scan heuristics do detect active content — and the standing never-block ruling means a flag admits it anyway. That ruling is right for a file in someone's own matter and cannot serve as the control for an input the platform executes over on a recipient's behalf, which is the real tension here rather than an oversight in either position.

Three postures set out with costs; the recommendation is strip unconditionally on every path where the PDF is a record, and the existing macro-strip consent gate's shape at template registration, where a script can be legitimate and a person is present to say why. Nothing built — the posture is an owner call.
