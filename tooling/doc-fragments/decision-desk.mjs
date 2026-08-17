// docs/decisions-open.html — every question the program is waiting on an owner to answer, as one
// page, with somewhere to write the answer. Rendered from the same `areas` structure docs/now.md and
// docs/now.html are rendered from. Pure: no filesystem, no clock, no network. The impure runner is
// build-register.mjs and the fitness function is tooling/lint-roadmap.mjs.
//
// This page exists because the questions were already recorded and were not reachable. A node's
// `awaiting-owner` line is written where the work stopped, one line inside one area file, and the
// register lists them in a section a reader arrives at after several screens of counts. Neither is
// somewhere a person sits down to decide things. Answering is also a different posture from reading:
// it wants the questions gathered, sorted by what they cost, and a box to write in.
//
// WHY THE ANSWERS COME BACK BY COPY. The page cannot send anything anywhere — it is a static file
// with no network of any kind, which is the property that lets it be read from a repository, from a
// published copy, or from a laptop with no connection, and be the same page. So it composes the
// answers into one block and hands it over, in the format renderAnswerBlock writes below. Pasting
// that block back is what returns the decisions. A page that posted them somewhere would need a
// somewhere, and every candidate is a service that has to exist, be paid for, be authenticated, and
// be trusted with the substance of unannounced decisions about a legal platform.
//
// Everything derived from the ledger comes from `areas`; nothing about a question is typed in twice.
// The vocabulary shared with the other two renderings — the statuses, the split between questions
// holding a build and questions changing something that runs, the reach of a capability, the
// boundary sentence — is imported from roadmap.mjs for the reason register-artifact.mjs imports it:
// two renderings of one ledger that each keep their own copy will disagree, and the disagreement
// cannot be settled because neither is the more authoritative one.
//
// No generation timestamp, for the same reason the other two carry none: the output is a byte-exact
// function of the ledger so a diff gate can hold it, and a clock would break that every day.

import { STYLESHEET, escapeHtml, renderInlineMarkup } from "./register-artifact.mjs";
import { AWAITING_BOUNDARY, STATUSES_WITH_NOTHING_BUILT, allNodes, reachOf } from "./roadmap.mjs";

const STATUS_LABEL = {
  shipped: "Shipped",
  partial: "Partial",
  "in-build": "In build",
  designed: "Designed",
  planned: "Planned",
  researching: "Researching",
  "not-started": "Not started",
  deferred: "Deferred",
  cut: "Cut",
};

const STATUS_TONE = {
  shipped: "done",
  partial: "part",
  "in-build": "live",
  designed: "plan",
  planned: "plan",
  researching: "plan",
  "not-started": "todo",
  deferred: "park",
  cut: "park",
};

// The answer to "is there working code behind this question", which is the first thing a reader
// wants after the question itself and the thing `status` alone cannot say. reachOf is roadmap.mjs's,
// so this page and the register can never label the same node two ways.
const REACH_PRESENTATION = {
  "not-built": {
    label: "Not built",
    tone: "todo",
    detail: "No code exists behind this yet. The answer decides what gets written.",
  },
  "awaiting-screen": {
    label: "Built · no screen yet",
    tone: "part",
    detail: "The capability works. Nobody can reach it, because its interface is not built.",
  },
  screen: {
    label: "Built · in use",
    tone: "done",
    detail: "This runs and a person can open it today. Changing it changes something live.",
  },
  internal: {
    label: "Built · no screen by nature",
    tone: "live",
    detail: "This runs underneath the product and will never have a screen of its own.",
  },
  built: {
    label: "Built · reach not classified",
    tone: "live",
    detail: "Code exists. Whether anybody can reach it has not been recorded yet.",
  },
  parked: {
    label: "Parked",
    tone: "park",
    detail: "Set aside by an earlier decision. The answer decides whether it comes back.",
  },
};

// The four answers that cover most of these questions, offered as one press so a decision that is
// simply "yes" does not cost a paragraph. Each writes its word into the box, which stays editable —
// the button is a shortcut for typing, never a separate kind of answer the format has to carry.
const QUICK_ANSWERS = [
  { key: "yes", label: "Yes / approve" },
  { key: "no", label: "No / decline" },
  { key: "defer", label: "Not yet — park it" },
  { key: "discuss", label: "Let us talk it through" },
];

export function renderDecisionDesk(areas) {
  const nodes = allNodes(areas);
  const open = nodes.filter((node) => node.awaitingOwner !== null);
  const blocking = open.filter((node) => STATUSES_WITH_NOTHING_BUILT.has(node.status));
  const changing = open.filter((node) => !STATUSES_WITH_NOTHING_BUILT.has(node.status));

  const document = [
    "<title>Magna Carta Decision Desk</title>",
    `<style>\n${STYLESHEET}\n${DESK_STYLESHEET}\n</style>`,
    "",
    '<div class="wrap">',
    renderHeader(open, blocking, changing),
    "",
    renderControls(areas, open),
    "",
    renderGroup(
      "blocking",
      "Nothing is built behind these",
      "An answer here decides what gets written next. Until one lands, the work has no shape to" +
        " take — so these are the questions that cost time by staying open.",
      blocking,
    ),
    "",
    renderGroup(
      "changing",
      "These change something that already runs",
      "Code exists behind every one of these. Nobody is blocked waiting, and an answer changes" +
        " something that is already built — so they are the ones worth taking slowly.",
      changing,
    ),
    "",
    renderOutbox(),
    "",
    FOOTER,
    "</div>",
    `<script>\n${DESK_SCRIPT}\n</script>`,
  ].join("\n");
  return `${document}\n`;
}

// --- the head of the page -----------------------------------------------------------------------

function renderHeader(open, blocking, changing) {
  const cards = [
    { value: open.length, label: "Open questions", detail: "Every one is on this page.", tone: "" },
    {
      value: blocking.length,
      label: "Holding a build",
      detail: "Nothing is written behind these.",
      tone: "n",
    },
    {
      value: changing.length,
      label: "Changing something live",
      detail: "Code already exists behind these.",
      tone: "y",
    },
    {
      value: '<span data-answered-count="">0</span>',
      label: "Answered here",
      detail: "Saved in this browser until you copy them out.",
      tone: "g",
    },
  ];

  return `<header style="display:flex;flex-direction:column;gap:13px">
  <p class="eyebrow">Magna Carta &middot; decisions</p>
  <h1>${open.length} questions the build is waiting on you to answer</h1>
  <p class="lede">Every one of these was recorded where the work stopped, by whoever stopped. They
  are gathered here with the answer boxes, sorted by what leaving them open actually costs. Write
  as much or as little as you want; a sentence is usually enough, and &ldquo;not yet&rdquo; is an
  answer that unblocks a decision about sequencing even when it does not decide the question.</p>
  <p class="lede">Your answers save in this browser as you type, so you can leave and come back.
  Nothing leaves this page on its own &mdash; when you are done, <strong>Copy the answers</strong>
  at the bottom and paste them into the conversation, and they get applied from there.</p>
  <div class="band" style="margin-top:8px">
${cards.map(renderCard).join("\n")}
  </div>
  <p style="color:var(--soft);font-size:13.5px;max-width:66ch">${renderInlineMarkup(AWAITING_BOUNDARY)}</p>
</header>`;
}

function renderCard({ value, label, detail, tone }) {
  return `    <div class="k ${tone}"><span>${label}</span><b>${value}</b><em>${detail}</em></div>`;
}

// --- the controls -------------------------------------------------------------------------------

function renderControls(areas, open) {
  const present = new Set(open.map((node) => node.area));
  const options = areas
    .filter((area) => present.has(area.name))
    .map(
      (area) =>
        `<option value="${escapeHtml(area.name)}">${escapeHtml(area.title)} (${
          open.filter((node) => node.area === area.name).length
        })</option>`,
    )
    .join("");

  return `<section class="controls" aria-label="Filters">
  <label class="field"><span>Area</span>
    <select data-filter-area=""><option value="">All areas</option>${options}</select></label>
  <label class="toggle"><input type="checkbox" data-filter-unanswered="">
    <span>Only what I have not answered</span></label>
  <p class="count" data-visible-count="" role="status"></p>
</section>`;
}

// --- the questions ------------------------------------------------------------------------------

function renderGroup(key, heading, lede, nodes) {
  if (nodes.length === 0) {
    return `<section class="group" data-group="${key}">
  <h2>${heading}</h2>
  <p class="lede">Nothing is waiting under this heading.</p>
</section>`;
  }
  return `<section class="group" data-group="${key}">
  <h2>${heading} <span class="ac">${nodes.length}</span></h2>
  <p class="lede">${lede}</p>
  <div class="cards">
${nodes.map(renderQuestion).join("\n")}
  </div>
</section>`;
}

function renderQuestion(node) {
  const reach = REACH_PRESENTATION[reachOf(node)];
  const chips = [
    `<span class="chip ${STATUS_TONE[node.status]}">${STATUS_LABEL[node.status]}</span>`,
    `<span class="chip ${reach.tone}">${reach.label}</span>`,
  ].join("");

  const quick = QUICK_ANSWERS.map(
    (answer) =>
      `<button type="button" class="quick" data-quick="${answer.key}">${answer.label}</button>`,
  ).join("");

  // The name is carried in a data attribute as well as in the heading: the answer block names each
  // decision by node id and by name, and reading the name back out of the heading would break the
  // moment the heading gains a chip or a link.
  return `    <article class="card" data-node="${escapeHtml(node.id)}" data-name="${escapeHtml(node.name)}" data-area="${escapeHtml(node.area)}">
      <div class="chips">${chips}<code>${escapeHtml(node.id)}</code></div>
      <h3>${renderInlineMarkup(node.name)}</h3>
      <p class="q">${renderInlineMarkup(node.awaitingOwner)}</p>
      <p class="reach">${reach.detail}</p>
      <p class="scope">${renderInlineMarkup(node.scope)}</p>
      <div class="quicks">${quick}</div>
      <label class="answer"><span>Your answer</span>
        <textarea rows="3" data-answer="" placeholder="A sentence is usually enough."></textarea></label>
      <p class="saved" data-saved="" aria-live="polite"></p>
    </article>`;
}

// --- the way the answers get out -----------------------------------------------------------------

// Where the answers are read back from. A repository issue is the one destination that already
// exists, is already private to the same people, is already watched, and costs nothing to add — and
// the page reaches it without a network call, by handing the browser a link with the answers written
// into it. That is also its limit: a URL is not a file, and a long enough set of answers will not fit
// in one. The button says so when that happens rather than opening a silently truncated issue.
const ISSUE_URL = "https://github.com/phauks/magna-carta/issues/new";

function renderOutbox() {
  return `<section class="outbox" id="outbox">
  <h2>Sending the answers back</h2>
  <p class="lede">This page has no network of any kind &mdash; that is what lets it be read from a
  repository, from a published link, or from a laptop with no connection, and be the same page. So
  it hands the answers over two ways instead. <strong>Copy</strong> puts them on the clipboard for
  you to paste into the conversation. <strong>Open an issue</strong> writes them into a new
  repository issue for you, which lands them without a conversation being open at all &mdash; the
  browser does the sending, not this page. Either way the block names each decision by its own
  identifier, which is what lets every answer reach the right capability without anybody matching
  them up by hand.</p>
  <div class="actions">
    <button type="button" class="primary" data-copy="">Copy the answers</button>
    <button type="button" data-issue="">Open an issue with them</button>
    <button type="button" data-download="">Download as a file</button>
    <button type="button" class="quiet" data-clear="">Clear everything</button>
    <p class="count" data-answered-line="" role="status"></p>
  </div>
  <pre class="preview" data-preview="" aria-label="What will be copied"></pre>
</section>`;
}

const FOOTER =
  "<footer>Rendered from <code>roadmap.d/</code> &mdash; the same source <code>docs/now.md</code>" +
  " and <code>docs/now.html</code> are built from, so a question cannot be open in one of them and" +
  " settled in another. A question leaves this page when its node's <code>awaiting-owner</code>" +
  " line does.</footer>";

// --- the fixed parts ------------------------------------------------------------------------------

const DESK_STYLESHEET = `.controls{display:flex;flex-wrap:wrap;align-items:end;gap:18px 26px;
  padding:16px 18px;background:var(--raised);border:1px solid var(--rule);border-radius:3px}
.field{display:flex;flex-direction:column;gap:6px}
.field span{font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:var(--faint);font-weight:650}
.field select{font:inherit;color:var(--ink);background:var(--paper);border:1px solid var(--rule);
  border-radius:2px;padding:7px 10px;min-width:230px}
.toggle{display:flex;align-items:center;gap:9px;font-size:14px;color:var(--soft);padding-bottom:7px}
.toggle input{width:16px;height:16px;accent-color:var(--accent)}
.count{margin-left:auto;font-size:13px;color:var(--faint)}
.group{display:flex;flex-direction:column;gap:14px}
.group h2 .ac{font-family:system-ui,sans-serif;font-size:12px;font-weight:650;letter-spacing:.08em;
  color:var(--faint);border:1px solid var(--rule);border-radius:2px;padding:3px 7px}
.cards{display:flex;flex-direction:column;gap:2px;background:var(--rule);
  border:1px solid var(--rule);border-radius:3px;overflow:hidden}
.card{background:var(--raised);padding:22px 22px 20px;display:flex;flex-direction:column;gap:11px}
.card[hidden]{display:none}
.card.done{background:var(--done-b)}
.chips{display:flex;flex-wrap:wrap;align-items:center;gap:7px}
.chips code{font-size:11.5px;color:var(--faint);margin-left:auto}
.chip{font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:650;
  border-radius:2px;padding:3px 8px;white-space:nowrap}
.chip.done{color:var(--done);background:var(--done-b)}
.chip.part{color:var(--part);background:var(--part-b)}
.chip.live{color:var(--live);background:var(--live-b)}
.chip.plan{color:var(--plan);background:var(--plan-b)}
.chip.todo{color:var(--todo);background:var(--todo-b)}
.chip.park{color:var(--park);background:var(--park-b)}
.card .q{font-size:15.5px;line-height:1.5;max-width:76ch}
.card .reach{font-size:13px;color:var(--soft);max-width:76ch}
.card .scope{font-size:13px;color:var(--faint);max-width:76ch;border-left:2px solid var(--hair);padding-left:11px}
.quicks{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}
.quick{font:inherit;font-size:13px;color:var(--soft);background:var(--paper);cursor:pointer;
  border:1px solid var(--rule);border-radius:2px;padding:5px 11px}
.quick:hover{color:var(--ink);border-color:var(--faint)}
.answer{display:flex;flex-direction:column;gap:6px}
.answer span{font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:var(--faint);font-weight:650}
.answer textarea{font:inherit;color:var(--ink);background:var(--paper);border:1px solid var(--rule);
  border-radius:2px;padding:10px 12px;resize:vertical;min-height:66px;width:100%}
.answer textarea:focus-visible,.field select:focus-visible,button:focus-visible{
  outline:2px solid var(--accent);outline-offset:1px}
.saved{font-size:12px;color:var(--done);min-height:16px}
.outbox{display:flex;flex-direction:column;gap:14px;padding:24px;
  background:var(--raised);border:1px solid var(--rule);border-radius:3px}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.actions button{font:inherit;font-size:14px;cursor:pointer;border-radius:2px;padding:9px 16px;
  border:1px solid var(--rule);background:var(--paper);color:var(--ink)}
.actions button:hover{border-color:var(--faint)}
.actions .primary{background:var(--accent);border-color:var(--accent);color:#FFF;font-weight:600}
.actions .primary:hover{filter:brightness(1.08)}
.actions .quiet{color:var(--soft)}
.preview{margin:0;padding:16px;background:var(--paper);border:1px solid var(--hair);border-radius:2px;
  font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--soft);
  white-space:pre-wrap;overflow-x:auto;max-height:340px;overflow-y:auto}
footer{color:var(--faint);font-size:13px;border-top:1px solid var(--hair);padding-top:18px;max-width:76ch}
@media (max-width:640px){.chips code{margin-left:0;width:100%}.count{margin-left:0}}`;

// Written as one string rather than assembled, because it is the page's behaviour and not a fact
// about the ledger — the same reason the stylesheet and the section ledes are fixed strings here.
// Answers persist in localStorage under one key so that closing the tab mid-way is not a loss; they
// are never sent anywhere, which is stated on the page rather than left to be assumed.
const DESK_SCRIPT = `(() => {
  const STORE = "magna-carta-decisions";
  const cards = [...document.querySelectorAll(".card")];
  const preview = document.querySelector("[data-preview]");
  const answeredCount = document.querySelector("[data-answered-count]");
  const answeredLine = document.querySelector("[data-answered-line]");
  const visibleCount = document.querySelector("[data-visible-count]");
  const areaFilter = document.querySelector("[data-filter-area]");
  const unansweredOnly = document.querySelector("[data-filter-unanswered]");

  const read = () => {
    try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; }
  };
  const write = (state) => {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ }
  };

  let state = read();

  const answersInOrder = () => cards
    .map((card) => ({ card, text: (state[card.dataset.node] || "").trim() }))
    .filter((entry) => entry.text !== "");

  const block = () => {
    const answered = answersInOrder();
    if (answered.length === 0) return "";
    const lines = [
      "# Magna Carta — owner decisions",
      "",
      answered.length + " of " + cards.length + " open questions answered.",
      "",
    ];
    for (const { card, text } of answered) {
      lines.push("## " + card.dataset.node + " — " + card.dataset.name, "", text, "");
    }
    return lines.join("\\n").trimEnd() + "\\n";
  };

  const refresh = () => {
    const answered = answersInOrder().length;
    answeredCount.textContent = String(answered);
    answeredLine.textContent = answered === 0
      ? "Nothing to copy yet."
      : answered + " of " + cards.length + " answered.";
    preview.textContent = block() || "Your answers will appear here as you write them.";
    for (const card of cards) {
      card.classList.toggle("done", (state[card.dataset.node] || "").trim() !== "");
    }
    applyFilters();
  };

  const applyFilters = () => {
    const area = areaFilter.value;
    const hideAnswered = unansweredOnly.checked;
    let shown = 0;
    for (const card of cards) {
      const answered = (state[card.dataset.node] || "").trim() !== "";
      const hide = (area !== "" && card.dataset.area !== area) || (hideAnswered && answered);
      card.hidden = hide;
      if (!hide) shown += 1;
    }
    visibleCount.textContent = shown === cards.length
      ? "Showing all " + cards.length + " questions."
      : "Showing " + shown + " of " + cards.length + " questions.";
  };

  for (const card of cards) {
    const box = card.querySelector("[data-answer]");
    const saved = card.querySelector("[data-saved]");
    box.value = state[card.dataset.node] || "";
    let timer = null;
    box.addEventListener("input", () => {
      state[card.dataset.node] = box.value;
      write(state);
      saved.textContent = box.value.trim() === "" ? "" : "Saved in this browser.";
      clearTimeout(timer);
      timer = setTimeout(refresh, 220);
    });
    for (const quick of card.querySelectorAll("[data-quick]")) {
      quick.addEventListener("click", () => {
        const phrase = {
          yes: "Yes.",
          no: "No.",
          defer: "Not yet — park this.",
          discuss: "Let us talk this one through before deciding.",
        }[quick.dataset.quick];
        box.value = box.value.trim() === "" ? phrase : box.value.trim() + " " + phrase;
        box.dispatchEvent(new Event("input"));
        box.focus();
      });
    }
  }

  areaFilter.addEventListener("change", applyFilters);
  unansweredOnly.addEventListener("change", applyFilters);

  document.querySelector("[data-copy]").addEventListener("click", async (event) => {
    const text = block();
    if (text === "") { answeredLine.textContent = "Write an answer first."; return; }
    try {
      await navigator.clipboard.writeText(text);
      event.target.textContent = "Copied";
      setTimeout(() => { event.target.textContent = "Copy the answers"; }, 1800);
    } catch {
      // Clipboard access is refused in plenty of ordinary situations — an insecure origin, a
      // browser that wants a permission first. Selecting the block is a real fallback, not an
      // apology: the reader can still press the usual copy shortcut and get the same text.
      const range = document.createRange();
      range.selectNodeContents(preview);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      answeredLine.textContent = "Selected below — press your copy shortcut.";
    }
  });

  document.querySelector("[data-issue]").addEventListener("click", () => {
    const text = block();
    if (text === "") { answeredLine.textContent = "Write an answer first."; return; }
    const answered = answersInOrder().length;
    const url = "${ISSUE_URL}?title=" + encodeURIComponent("Owner decisions: " + answered + " answered")
      + "&body=" + encodeURIComponent(text);
    // Browsers and servers both cap a URL, and the cap is not one number. Refusing past a
    // conservative length is the honest move: a truncated issue would look complete and would be
    // missing whichever answers happened to sort last.
    if (url.length > 7000) {
      answeredLine.textContent =
        "Too many answers to fit in a link — use Copy or Download, or send them in batches.";
      return;
    }
    window.open(url, "_blank", "noopener");
  });

  document.querySelector("[data-download]").addEventListener("click", () => {
    const text = block();
    if (text === "") { answeredLine.textContent = "Write an answer first."; return; }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    link.download = "magna-carta-decisions.md";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  document.querySelector("[data-clear]").addEventListener("click", () => {
    if (answersInOrder().length === 0) return;
    if (!confirm("Clear every answer on this page? This cannot be undone.")) return;
    state = {};
    write(state);
    for (const card of cards) {
      card.querySelector("[data-answer]").value = "";
      card.querySelector("[data-saved]").textContent = "";
    }
    refresh();
  });

  refresh();
})();`;
