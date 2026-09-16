/*
 * The rules of the container gate, and why each one exists. The runner is index.mjs; every decision
 * here is a pure function over (path, source) so it can be unit-tested without a repository.
 *
 * WHY THIS EXISTS. Eleven container workspaces run the untrusted-byte side of this platform —
 * conversion, OCR, search indexing, archive bundling, password recovery, and the malware scan that
 * holds the one deliberately-consented C/C++ dependency in the tree. A container image is the only
 * place here where a base image, a package index and a downloaded artefact all become part of what
 * runs against privileged client documents, and until this file there was no gate on any of it.
 *
 * WHAT THIS GATES, and what it deliberately leaves to review, measured against the tree as it
 * stands rather than against a generic hardening checklist:
 *
 *   GATED HARD — the tree passes these today and a regression is a build failure:
 *     * base-image-tag       Every external base carries an explicit tag or digest, and `latest`
 *                            is refused. One named allowance (below), printed on every run.
 *     * add-from-url         `ADD http://…` fetches over the network with no checksum and silently
 *                            unpacks archives. Use RUN + curl with a pinned SHA-256, as the
 *                            LibreOffice and OCR images already do.
 *     * certificate-verification  Nothing may switch TLS verification off in a build step.
 *     * secret-in-layer      No ENV or ARG may carry a credential value. A layer is world-readable
 *                            to anyone who can pull the image, and `docker history` prints ARGs.
 *
 *   RATCHETED — the tree does NOT pass these today, so they are recorded as a named, reasoned
 *   backlog that cannot grow. A new image must satisfy the rule or add itself to the table with a
 *   reason, which is a deliberate act a reviewer sees:
 *     * base-image-digest    No base in this tree is digest-pinned; all five distinct external
 *                            bases are tag-pinned. TAG_ONLY_BASES holds those five.
 *     * runtime-user         One runtime image of eleven declares a non-root USER (libreoffice).
 *                            ROOT_RUNTIME_STAGES holds the rest with what each would take.
 *
 *   LEFT TO REVIEW, on purpose:
 *     * Whether an installed package is the right one, and whether a pinned SHA-256 is the SHA-256
 *       of the thing the author meant. Text matching cannot tell.
 *     * Capability, seccomp, read-only-root-filesystem and resource limits. Those are set by the
 *       Cloudflare Containers configuration that launches the image, not by the Dockerfile, so a
 *       Dockerfile scan would be looking in the wrong file.
 *     * Image size, layer count and build caching. Real concerns, not security ones.
 *     * Anything a RUN step does. A shell script fetched and executed inside RUN is beyond text
 *       matching, and pretending otherwise is worse than saying so.
 *
 * A RUNTIME IMAGE IS DERIVED, NOT LISTED. The user rule applies to a final stage that declares
 * ENTRYPOINT, CMD or EXPOSE — that is what makes an image something that runs. The four
 * wasm.Dockerfile export stages under crates/ (`FROM scratch AS export`, no entrypoint: the build
 * output is copied out, nothing executes) and the scan image's build-time check Dockerfile fall
 * out of scope by that test rather than by an allowlist, so a new export target needs no entry.
 *
 * Run: `pnpm run lint:containers`. Pure text over tracked Dockerfiles; no install, no build, no
 * Docker daemon.
 */

/* ---------------------------------------------------------------------------------------------
 * The two ratchet tables. Both are printed on every run: a standing exemption nobody sees is an
 * exemption that stops being read as one.
 * ------------------------------------------------------------------------------------------- */

/**
 * Bases that may be tag-pinned rather than digest-pinned, keyed by the exact reference. Keyed by
 * IMAGE, not by file, because the risk is a property of the image: a new container reusing one of
 * these inherits the recorded reasoning, while a new base image has to be digest-pinned or argued
 * for here. Empty-valued entries are not accepted — the reason is the point of the table.
 */
export const TAG_ONLY_BASES = new Map([
  [
    "rust:1-bookworm",
    "The official Rust build image, used only in build stages whose output is a single binary " +
      "copied into a slim runtime. The floating 1-x tag is what keeps the toolchain patched " +
      "without a pull request per release; the binary it produces is what ships, not the image",
  ],
  [
    "rust:1-trixie",
    "The same build image on the newer glibc, required by the scan and OCR images because the " +
      "prebuilt onnxruntime they link references glibc 2.38 symbols",
  ],
  [
    "debian:bookworm-slim",
    "The runtime base for the Rust service images. Floating within a Debian stable release is how " +
      "a rebuild picks up that release's security updates; pinning the digest would freeze them " +
      "until someone remembered to move the pin",
  ],
  [
    "debian:trixie-slim",
    "The same runtime base on the newer Debian release, paired with the rust:1-trixie build stage",
  ],
  [
    "collabora/code:latest",
    "The vendor's Collabora Online image. The Dockerfile says in its own header that `latest` is " +
      "the scaffold default and the deploy pins a tested digest; it is listed here so the choice " +
      "stays visible rather than quietly permitted, and it is the ONLY `latest` this gate allows",
  ],
]);

/**
 * Runtime images whose final stage runs as root, with what it would take to change that. Measured,
 * not assumed: one image of eleven (libreoffice) declares a non-root USER today. This table is the
 * review backlog, and the gate fails on any runtime image that is neither non-root nor listed
 * here — so the count can shrink and never grow.
 */
export const ROOT_RUNTIME_STAGES = new Map([
  [
    "containers/collabora/Dockerfile",
    "The vendor image supplies its own entrypoint, which generates coolwsd.xml from the ENV above " +
      "and execs coolwsd; coolwsd manages its own privilege model. Changing the user is a change " +
      "to the vendor's startup contract, not a one-line addition",
  ],
  [
    "containers/scan/Dockerfile",
    "entrypoint.sh rewrites /etc/clamav/clamd.conf at boot (TCP listener, scan limits, the " +
      "fail-closed AlertExceedsMax directive) before starting clamd, and clamd drops to the " +
      "clamav user itself. Dropping privileges earlier means baking that configuration at build " +
      "time first. This is also the one image that runs a C/C++ engine, so it is the entry here " +
      "most worth closing",
  ],
  [
    "containers/bundle/Dockerfile",
    "Not reviewed. A single static Rust binary spooling to ephemeral disk — a system user and a " +
      "USER line would be a small change nobody has made",
  ],
  [
    "containers/discovery/Dockerfile",
    "Not reviewed. Same shape as the bundle image: one static Rust binary, no privileged operation",
  ],
  [
    "containers/file-repair/Dockerfile",
    "Not reviewed. Same shape as the bundle image: one static Rust binary, no privileged operation",
  ],
  [
    "containers/ocr/Dockerfile",
    "Not reviewed. A Rust binary plus the baked model files, which are read-only at run time",
  ],
  [
    "containers/raster/Dockerfile",
    "Not reviewed. Same shape as the bundle image: one static Rust binary, no privileged operation",
  ],
  [
    "containers/recovery/Dockerfile",
    "Not reviewed. A Rust binary plus the baked wordlist and rule files, read-only at run time",
  ],
  [
    "containers/search/Dockerfile",
    "Not reviewed. A Rust binary writing Tantivy segments to /scratch, which is created in the " +
      "image and would need to be chowned to the new user",
  ],
  [
    "containers/scan/Dockerfile.validate-prefilter",
    "A local diagnostic image built on top of the scan image to exercise the prefilter; it is " +
      "never deployed and inherits the scan image's user",
  ],
]);

/* ---------------------------------------------------------------------------------------------
 * Which files are checked.
 * ------------------------------------------------------------------------------------------- */

/**
 * `Dockerfile`, `Dockerfile.<variant>` and `<name>.Dockerfile` are all builder inputs here — the
 * scan workspace uses the second shape for its two build-time check images, and every crate's
 * wasm build uses the third. `.dockerignore` and the build shell script are not Dockerfiles.
 */
export function isDockerfile(file) {
  const name = file.split("/").pop() ?? "";
  return name === "Dockerfile" || name.startsWith("Dockerfile.") || name.endsWith(".Dockerfile");
}

/* ---------------------------------------------------------------------------------------------
 * Parsing. A Dockerfile is line-oriented with backslash continuations; every instruction keeps the
 * line number it STARTED on, so a finding points where a person would look.
 * ------------------------------------------------------------------------------------------- */

/**
 * Parse a Dockerfile into instructions: { line, keyword, argument }. Comments and blank lines are
 * dropped, continuations are folded onto the starting line, and the keyword is upper-cased.
 * Parser directives (`# syntax=…`) are comments and are dropped with them.
 */
export function parseInstructions(source) {
  const lines = source.split("\n");
  const instructions = [];
  let buffer = null;
  for (const [index, raw] of lines.entries()) {
    const text = raw.replace(/\r$/, "");
    if (buffer === null && /^[ \t]*(#|$)/.test(text)) continue;
    const continues = /\\[ \t]*$/.test(text);
    const body = text.replace(/\\[ \t]*$/, "");
    if (buffer === null) {
      buffer = { line: index + 1, text: body };
    } else {
      // A comment line inside a continuation is skipped by the builder, matching Docker.
      if (!/^[ \t]*#/.test(text)) buffer.text = `${buffer.text.trimEnd()} ${body.trim()}`;
    }
    if (continues) continue;
    const match = /^[ \t]*([A-Za-z]+)[ \t]+([\s\S]*)$/.exec(buffer.text);
    if (match) {
      instructions.push({
        line: buffer.line,
        keyword: match[1].toUpperCase(),
        argument: match[2].trim(),
      });
    }
    buffer = null;
  }
  return instructions;
}

/** The stages a Dockerfile declares, in order, each with the instructions that follow its FROM. */
export function parseStages(source) {
  const instructions = parseInstructions(source);
  const stages = [];
  for (const instruction of instructions) {
    if (instruction.keyword === "FROM") {
      const argument = instruction.argument.replace(/--platform=\S+\s*/gi, "").trim();
      const [reference, , alias] = argument.split(/\s+/);
      stages.push({
        line: instruction.line,
        reference,
        alias: alias?.toLowerCase(),
        instructions: [],
      });
      continue;
    }
    if (stages.length > 0) stages.at(-1).instructions.push(instruction);
  }
  return stages;
}

/** True when a FROM names an earlier stage in the same file rather than a registry image. */
function isInternalStage(reference, earlier) {
  return earlier.some((stage) => stage.alias === reference.toLowerCase());
}

/**
 * An image this repository builds itself has no upstream digest to pin, so it is out of scope for
 * the pinning rules. Derived from the name rather than listed, so a new local image needs no entry.
 */
function isLocallyBuiltImage(reference) {
  return reference.startsWith("magna-carta-");
}

/**
 * A stage that runs. ENTRYPOINT, CMD or EXPOSE is what distinguishes an image something launches
 * from a build stage whose artefacts are copied out — which is why the wasm export targets and the
 * build-time check image need no allowlist entry to fall out of the user rule.
 */
export function isRuntimeStage(stage) {
  if (stage.reference.toLowerCase() === "scratch") return false;
  return stage.instructions.some((instruction) =>
    ["ENTRYPOINT", "CMD", "EXPOSE"].includes(instruction.keyword),
  );
}

/* ---------------------------------------------------------------------------------------------
 * The rules.
 * ------------------------------------------------------------------------------------------- */

export function findBaseImageProblems(file, source) {
  const found = [];
  const stages = parseStages(source);
  for (const [index, stage] of stages.entries()) {
    const earlier = stages.slice(0, index);
    const { reference } = stage;
    if (!reference) continue;
    if (reference.toLowerCase() === "scratch") continue;
    if (isInternalStage(reference, earlier)) continue;
    if (reference.startsWith("$")) continue;
    if (reference.includes("@sha256:")) continue;
    if (isLocallyBuiltImage(reference)) continue;

    const tag = reference.includes(":") ? reference.slice(reference.lastIndexOf(":") + 1) : null;
    if (tag === null) {
      found.push({
        rule: "base-image-tag",
        file,
        line: stage.line,
        detail: `\`FROM ${reference}\` names no tag, so it resolves to whatever \`latest\` is on build day`,
        fix:
          "Give the base an explicit tag (`debian:bookworm-slim`) or, better, a digest " +
          "(`debian@sha256:…`). An unpinned base means two builds of the same commit are not the " +
          "same image.",
      });
      continue;
    }
    if (tag === "latest" && !TAG_ONLY_BASES.has(reference)) {
      found.push({
        rule: "base-image-tag",
        file,
        line: stage.line,
        detail: `\`FROM ${reference}\` is pinned to \`latest\``,
        fix:
          "Pin a version tag, or a digest. If a rolling tag is genuinely the intent, add the " +
          "reference to TAG_ONLY_BASES in tooling/lint-containers/rules.mjs with the reason — " +
          "which is a deliberate act a reviewer sees, unlike the word `latest`.",
      });
      continue;
    }
    if (!TAG_ONLY_BASES.has(reference)) {
      found.push({
        rule: "base-image-digest",
        file,
        line: stage.line,
        detail: `\`FROM ${reference}\` is a new base image, pinned by tag rather than by digest`,
        fix:
          "Pin it by digest (`docker buildx imagetools inspect <ref>` prints one), or — if a " +
          "floating tag is the deliberate choice, as it is for the Debian and Rust bases here — " +
          "add the reference to TAG_ONLY_BASES in tooling/lint-containers/rules.mjs with the " +
          "reason it floats.",
      });
    }
  }
  return found;
}

export function findAddFromUrl(file, source) {
  const found = [];
  for (const instruction of parseInstructions(source)) {
    if (instruction.keyword !== "ADD") continue;
    if (!/(?:^|\s)(?:--\S+\s+)*(?:https?:\/\/|git@|github\.com[:/])/i.test(instruction.argument)) {
      continue;
    }
    found.push({
      rule: "add-from-url",
      file,
      line: instruction.line,
      detail: "`ADD` is fetching over the network",
      fix:
        "ADD from a URL has no checksum and unpacks archives silently — whatever the host serves " +
        'on build day becomes part of the image. Use `RUN curl -fsSL -o … && echo "<sha256>  …" ' +
        "| sha256sum -c -` instead; containers/libreoffice/Dockerfile and containers/ocr/" +
        "Dockerfile both do exactly that, with the digest as a build argument.",
    });
  }
  return found;
}

/*
 * Ways to tell a client not to check the certificate it was given. Each is matched as a whole flag
 * or assignment so that prose in a comment cannot trip it — comments are dropped by the parser in
 * any case, but the patterns are written to stand on their own.
 */
const VERIFICATION_DISABLED = [
  [/(?:^|\s)curl\b[^\n]*(?:\s--insecure\b|\s-[A-Za-z]*k(?:\s|$))/, "curl is told not to verify"],
  [/--no-check-certificate\b/, "wget is told not to verify"],
  [/GIT_SSL_NO_VERIFY\s*=\s*(?:1|true|yes)/i, "git certificate verification is switched off"],
  [/http\.sslVerify\s+false/i, "git certificate verification is switched off"],
  [/NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/, "the Node TLS trust check is switched off"],
  [/PYTHONHTTPSVERIFY\s*=\s*["']?0/, "the Python HTTPS trust check is switched off"],
  [/npm\s+config\s+set\s+strict-ssl\s+false/i, "the npm trust check is switched off"],
  [/pip\b[^\n]*--trusted-host\b/, "pip is told to trust a host without verifying it"],
  [/--allow-unauthenticated\b/, "apt is told to accept unsigned packages"],
  [/apt-get[^\n]*--force-yes\b/, "apt is told to proceed past a verification failure"],
];

export function findDisabledVerification(file, source) {
  const found = [];
  for (const instruction of parseInstructions(source)) {
    for (const [pattern, what] of VERIFICATION_DISABLED) {
      if (!pattern.test(instruction.argument)) continue;
      found.push({
        rule: "certificate-verification",
        file,
        line: instruction.line,
        detail: `${what} in a ${instruction.keyword} step`,
        fix:
          "Install the certificate authority bundle (`ca-certificates`) and let the check run, or " +
          "add the specific root the host uses. Switching verification off in an image build " +
          "means every future rebuild will accept whatever answers the request.",
      });
      break;
    }
  }
  return found;
}

/*
 * A credential baked into a layer. ENV survives into the running container and into every pulled
 * copy of the image; ARG is printed by `docker history`. Both are gated on a secret-shaped NAME
 * with a non-empty, non-placeholder value, which is what keeps the collabora image's deliberately
 * EMPTY `--o:admin_console.password=` (the admin console switched off) out of the findings.
 */
const SECRET_NAME =
  /(?:^|_)(?:PASSWORD|PASSWD|SECRET|TOKEN|APIKEY|API_KEY|PASSPHRASE|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY)S?$/i;
const INLINE_SECRET =
  /\b(?:password|passwd|secret|token|api[_-]?key|passphrase)\s*=\s*(?!["']?\s*(?:$|["']))([^\s"']{6,})/i;

const PLACEHOLDER_VALUE =
  /placeholder|example|changeme|change-me|dummy|sample|local-dev|development|fake|todo|\$\{|^\$[A-Za-z_]|^<|redacted/i;

export function findSecretInLayer(file, source) {
  const found = [];
  for (const instruction of parseInstructions(source)) {
    if (instruction.keyword !== "ENV" && instruction.keyword !== "ARG") continue;
    // ENV supports several assignments in one instruction, and the legacy `ENV NAME value` form.
    for (const assignment of instruction.argument.matchAll(
      /([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S*)/g,
    )) {
      const [, name, rawValue] = assignment;
      const value = rawValue.replace(/^["']|["']$/g, "");
      if (value === "" || PLACEHOLDER_VALUE.test(value)) continue;
      if (SECRET_NAME.test(name)) {
        found.push({
          rule: "secret-in-layer",
          file,
          line: instruction.line,
          detail: `${instruction.keyword} ${name} carries a value (${value.length} characters)`,
          fix:
            "A layer is readable by anyone who can pull the image, and `docker history` prints " +
            "every ARG. Pass the credential at run time through the container's configuration, or " +
            "for a build-time-only value use a BuildKit secret mount " +
            "(`RUN --mount=type=secret,id=<name>`), which never becomes a layer.",
        });
        continue;
      }
      const inline = INLINE_SECRET.exec(value);
      if (inline && !PLACEHOLDER_VALUE.test(inline[1])) {
        found.push({
          rule: "secret-in-layer",
          file,
          line: instruction.line,
          detail: `${instruction.keyword} ${name} embeds a credential assignment in its value`,
          fix:
            "The value of this variable sets a password or token inline, which bakes it into the " +
            "layer. Pass it at run time instead, or leave the assignment empty the way the " +
            "Collabora image leaves its admin console credentials empty to switch the console off.",
        });
      }
    }
  }
  return found;
}

export function findRootRuntimeStage(file, source) {
  const stages = parseStages(source);
  const final = stages.at(-1);
  if (!final || !isRuntimeStage(final)) return [];
  const users = final.instructions.filter((instruction) => instruction.keyword === "USER");
  const last = users.at(-1);
  const isRoot =
    last === undefined || /^(root|0)(:|$)/i.test(last.argument.replace(/^["']|["']$/g, ""));
  if (!isRoot) return [];
  if (ROOT_RUNTIME_STAGES.has(file)) return [];
  return [
    {
      rule: "runtime-user",
      file,
      line: last?.line ?? final.line,
      detail: "the final stage runs as root",
      fix:
        "Create a system user and switch to it before the entrypoint — containers/libreoffice/" +
        "Dockerfile is the worked example (`useradd --system … convert`, chown the two writable " +
        "directories, then `USER convert`). If this image genuinely cannot drop privileges, add " +
        "it to ROOT_RUNTIME_STAGES in tooling/lint-containers/rules.mjs with what it would take; " +
        "that table is a backlog that may shrink and never grow.",
    },
  ];
}

export const RULES = [
  findBaseImageProblems,
  findAddFromUrl,
  findDisabledVerification,
  findSecretInLayer,
  findRootRuntimeStage,
];

export function check(file, source) {
  const found = [];
  for (const rule of RULES) found.push(...rule(file, source));
  return found;
}

/* ---------------------------------------------------------------------------------------------
 * Self-test samples. Each is a whole miniature Dockerfile, judged under the path given, so the
 * table reads as the set of things this gate claims to do.
 * ------------------------------------------------------------------------------------------- */

const RUNTIME = 'EXPOSE 8080\nENTRYPOINT ["/usr/local/bin/service"]\n';

export const SELF_TEST = [
  {
    label: "a base with no tag at all",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian\nUSER service\n${RUNTIME}`,
    rule: "base-image-tag",
  },
  {
    label: "a new base pinned to latest",
    file: "containers/new-thing/Dockerfile",
    source: `FROM alpine:latest\nUSER service\n${RUNTIME}`,
    rule: "base-image-tag",
  },
  {
    label: "the one allowed latest, which is in the table with its reason",
    file: "containers/collabora/Dockerfile",
    source: "FROM collabora/code:latest\nEXPOSE 9980\n",
    rule: null,
  },
  {
    label: "a new base pinned by tag rather than digest",
    file: "containers/new-thing/Dockerfile",
    source: `FROM alpine:3.21\nUSER service\n${RUNTIME}`,
    rule: "base-image-digest",
  },
  {
    label: "a new base pinned by digest",
    file: "containers/new-thing/Dockerfile",
    source: `FROM alpine@sha256:${"a1b2c3d4".repeat(8)}\nUSER service\n${RUNTIME}`,
    rule: null,
  },
  {
    label: "a base already in the tag-only table",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nUSER service\n${RUNTIME}`,
    rule: null,
  },
  {
    label: "a multi-stage build referring to its own earlier stage",
    file: "containers/new-thing/Dockerfile",
    source: `FROM rust:1-bookworm AS build\nRUN cargo build --release\nFROM build\nUSER service\n${RUNTIME}`,
    rule: null,
  },
  {
    label: "an export stage is not a runtime image, so the user rule does not reach it",
    file: "crates/pdf-core/wasm.Dockerfile",
    source:
      "FROM rust:1-bookworm AS build\nRUN cargo build\nFROM scratch AS export\nCOPY --from=build /out /\n",
    rule: null,
  },
  {
    label: "a runtime image that never drops privileges",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\n${RUNTIME}`,
    rule: "runtime-user",
  },
  {
    label: "a runtime image that switches back to root at the end",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nUSER service\nUSER root\n${RUNTIME}`,
    rule: "runtime-user",
  },
  {
    label: "a runtime image already in the root backlog",
    file: "containers/raster/Dockerfile",
    source: `FROM debian:bookworm-slim\n${RUNTIME}`,
    rule: null,
  },
  {
    label: "fetching a release archive with ADD",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nADD https://example.test/tool.tar.gz /tmp/\nUSER service\n${RUNTIME}`,
    rule: "add-from-url",
  },
  {
    label: "copying a local file with ADD is not a finding",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nADD ./entrypoint.sh /usr/local/bin/\nUSER service\n${RUNTIME}`,
    rule: null,
  },
  {
    label: "curl told not to verify",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nRUN curl -fsSLk -o /tmp/x https://example.test/x\nUSER service\n${RUNTIME}`,
    rule: "certificate-verification",
  },
  {
    label: "curl verifying normally, across a continuation",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nRUN set -eux; \\\n    curl -fsSL --retry 5 -o /tmp/x https://example.test/x\nUSER service\n${RUNTIME}`,
    rule: null,
  },
  {
    label: "the Node trust check switched off",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nENV NODE_TLS_REJECT_UNAUTHORIZED=0\nUSER service\n${RUNTIME}`,
    rule: "certificate-verification",
  },
  {
    label: "a token baked into an environment variable",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nENV UPSTREAM_API_TOKEN=Qz7bR2mK9tLxW4nHs6Yc\nUSER service\n${RUNTIME}`,
    rule: "secret-in-layer",
  },
  {
    label: "a password passed as a build argument",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nARG REGISTRY_PASSWORD=hunter2hunter2hunter2\nUSER service\n${RUNTIME}`,
    rule: "secret-in-layer",
  },
  {
    label: "an empty admin console password, which is how the console is switched off",
    file: "containers/collabora/Dockerfile",
    source:
      'FROM collabora/code:latest\nENV extra_params="--o:admin_console.username= --o:admin_console.password="\nEXPOSE 9980\n',
    rule: null,
  },
  {
    label: "a credential assignment embedded in a longer value",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nENV extra_params="--db-host=localhost --db-password=Qz7bR2mK9tLxW4nH"\nUSER service\n${RUNTIME}`,
    rule: "secret-in-layer",
  },
  {
    label: "a build argument holding a pinned digest is not a credential",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nARG LIBREOFFICE_SHA256=7f4d7b2e36921eec5122c655249a24cc88935ee357e8261fd3bccd15aa1f7b9f\nUSER service\n${RUNTIME}`,
    rule: null,
  },
  {
    label: "a path-valued environment variable is not a credential",
    file: "containers/new-thing/Dockerfile",
    source: `FROM debian:bookworm-slim\nENV YARA_RULES_PATH=/etc/scan/yara-rules.bin\nUSER service\n${RUNTIME}`,
    rule: null,
  },
];
