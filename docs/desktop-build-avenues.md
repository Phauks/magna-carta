# Desktop build avenues

A running list of concrete build opportunities that are **only feasible, or materially better, on the Tauri desktop shell** — captured as they surface during web development so they are not lost, and picked up when the desktop build begins (after the web MVP; see the white paper, _Delivery model_).

**This list does not weaken the parity rule.** Web/desktop parity is enforced: no *feature* is desktop-exclusive, and the desktop runs the identical bundle + API (white paper, _Delivery model_ → "Web/desktop parity"). Two kinds of entry belong here, and neither breaks that:

- **Parity-preserving accelerations** — the work has a *complete web path*; desktop only makes it faster, local, or offline (the "Desktop enhancements" table in the white paper: bulk ingest, on-device OCR, local Tantivy, native filesystem, etc.). New ones discovered mid-build go here first, then graduate into that table.
- **Environmental readouts** — a piece of *information* about the machine that the browser sandbox cannot see, shown as a small extra fact, never gating a feature. The speed test works identically on both platforms; desktop can simply *also* display something web cannot know. This is the same category as the "direct local scanner access" asymmetry the white paper already calls out — an informational/trigger difference, not a feature gap.

Each entry: what, why it is desktop-only (with the evidence), how the desktop would do it, and the web behaviour (which must remain honest — show nothing rather than guess).

---

## Network Speed Test — physical connection medium (Wi‑Fi / Ethernet / cellular)

**What.** In the Network Speed Test's "Your connection" panel, state the physical medium the machine is on (Wi‑Fi, Ethernet, cellular) alongside the existing IP-version / server / network / IP rows.

**Why it is desktop-only.** A desktop **web** browser does not expose the medium. Verified 2026-07-10 by driving a real Chrome: `navigator.connection` is present but its `type` property is `undefined` — it is not even on the object's prototype (only `effectiveType`, `downlink`, `rtt`, `saveData` are). The Network Information API's `type` (which returns `wifi`/`ethernet`/`cellular`/…) is implemented only on Chromium for **Android/ChromeOS**; desktop browsers deliberately withhold the physical medium for privacy. No reliable web fallback exists — WebRTC local-IP enumeration, the user-agent, and latency/jitter heuristics cannot determine the medium either. So the web tool shows **nothing** about the medium (it does not guess, and `effectiveType`'s "4g-class" throughput bucket is not the medium and would mislead on a wired line).

**How the desktop would do it.** Tauri's Rust layer can read the active network interface from the OS (e.g. a Rust crate over the platform network APIs — `netdev`/`if-addrs`-class, or the OS interface type directly) and hand the medium to the same "Your connection" panel via a command, with the web build simply omitting the row.

**Category.** Environmental readout (no web path; the speed test itself is fully at parity).
