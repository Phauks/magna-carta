---
category: Added
---

Docker-free wasm dev build (`vp run rust-wasm-build-dev`) — builds the pdf-core, decryption-core, and email-core WebAssembly artefacts with the host Rust toolchain + wasm-pack instead of the pinned Docker images, for dev environments that cannot pull the base image (e.g. a cloud session whose egress policy blocks Docker Hub / ghcr blob pulls). It refuses under CI: the canonical `rust-wasm-build` (Docker) stays authoritative for anything shipped, since the host rustc may emit different wasm bytes than the pinned image.
