# Settings conventions

**Status:** Active (framework defined; each subsystem registers its settings as it ships).

**Scope (single home for):** how settings are added and rendered — the declarative registry shape, scope resolution, access enforcement, and storage placement. The goal is that adding a setting is a **registry entry, not a new page**.

**Authoritative context:** the white paper's _Settings & configuration_ (the design). This file is the practitioner's how-to.

## The registry (one declaration per setting)

Each setting is declared once with: `key` · label/description · type · **scope** (which of: entity-override / user / location / firm / system it allows) · **default** · **access** (`viewRole`, `editRole`) · validation · `audited` · `effectiveDated`. The Settings UI is **generated** from these declarations — no bespoke per-setting screens.

## Scope & resolution

Resolve most-specific-wins: **entity override (matter/client) → user → location → firm default → system default.** A setting opts into only the scopes it needs.

## Access (RBAC)

Enforce `viewRole`/`editRole` **server-side in the firm-scoped DAL** — the generated UI hides/locks accordingly, but the DAL is the gate, never the UI alone. See [`security.md`](security.md).

## Storage (no duplication)

Per the tenancy model: identity-level user prefs in control-plane; per-user firm-scoped settings on the `member` row; firm business settings in per-firm D1. Settings **registers and renders data the subsystems already own** (trust profiles, rate cards, matter numbering, locations, plugin credentials, diagnostics) — it does not copy it.

## Discipline

Writes go through the DAL; financial/security/firm settings are **audited** and **effective-dated** where it matters (e.g. rates).
