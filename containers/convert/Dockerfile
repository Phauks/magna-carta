# The libvips conversion Container image: a native-libvips HTTP service running on linux/amd64.
# The service listens on port 8080 and exposes two endpoints:
#   POST /convert — accepts a source document body with x-source-format / x-target-format /
#                   x-recipe headers and returns the converted bytes with an appropriate Content-Type.
#   GET  /ready   — a fast, side-effect-free health probe (pingEndpoint) that keeps the container
#                   instance warm between conversions.
# This is a deploy-time build like containers/scan. The real implementation (libvips bindings,
# format negotiation, recipe application) is built when the conversion engine lands.

FROM debian:bookworm-slim
