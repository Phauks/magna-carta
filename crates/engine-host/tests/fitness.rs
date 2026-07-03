//! Fitness: the harness sits BESIDE the engines, never below them. It must not
//! depend on any engine-logic crate — that would invert the layering and couple
//! unrelated engines through the harness.

const FORBIDDEN_DEPENDENCIES: &[&str] = &[
    "pdf-core",
    "decryption-core",
    "magna-carta-scan",
    "magna-carta-bundle",
    "magna-carta-raster",
];

#[test]
fn harness_depends_on_no_engine_logic_crate() {
    let manifest = include_str!("../Cargo.toml");
    for forbidden in FORBIDDEN_DEPENDENCIES {
        assert!(
            !manifest.contains(forbidden),
            "engine-host must not depend on the engine-logic crate `{forbidden}` — \
             the harness hosts engines, it never consumes them"
        );
    }
}
