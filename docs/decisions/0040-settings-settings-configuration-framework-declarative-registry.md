---
number: 40
slug: settings-settings-configuration-framework-declarative-registry
status: Accepted
date:
area: Settings
---

**Settings & configuration framework — a declarative registry that generates the UI.** Each setting declared once (key, type, **scope**, default, **view/edit role**, validation, audited/effective-dated); the Settings page is **generated from the registry** — no bespoke per-setting pages (same data-driven discipline as the format registry and design tokens). **Scope resolution:** entity override → user → location → firm → system (per-setting opt-in), mirroring rate resolution. **Access by RBAC role**, enforced **server-side in the firm-scoped DAL**, not UI-only. **Storage** per the tenancy model (control-plane user prefs / `member` row / per-firm D1); Settings is a **surface over data the subsystems already own** (trust profiles, rate cards, numbering, locations, plugin credentials, diagnostics), never a copy. Categories shown per access; financial/security/firm settings audited + effective-dated. Rejected: bespoke per-setting pages (unscalable, drift-prone).
