---
category: Added
audience: internal
---

**Exhibits: the register, ordered sets with computed labels, and the freeze at issue.** A new `@magna-carta/exhibits` package and four per-firm tables (`matter_exhibit`, `exhibit_set`, `exhibit_set_member`, `exhibit_reference`) hold a matter's exhibits and the sets they are filed in. A draft member's label is a pure function of its position and the set's numbering (letters, numbers or roman numerals, a prefix, a starting point, and either form past Z), computed on read and never stored. Issuing a set is the only writer of the label column; triggers then refuse any change to an issued member's label, position, title or version, and refuse taking the set out of `issued`. After issue an exhibit can be withdrawn (its label is retired, never reused), corrected beside its as-issued values, or the set superseded or continued. Sixteen routes under `/api/v1/matters/{matterId}/exhibits`, `/exhibit-sets` and `/exhibit-scheme-presets`, gated by the new `exhibits:manage` and `exhibits:issue` permissions. No screen yet.
