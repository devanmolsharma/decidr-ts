import { Client, OpenAIBackend } from "./decidr.bundle.js";
import { EXAMPLES } from "./examples.js";
import { buildScaleRow } from "./scale-example.js";
import { runNaiveBaseline } from "./naive-baseline.js";

const nav = document.getElementById("nav");
const main = document.getElementById("main");
const keyInput = document.getElementById("api-key");
const keyStatus = document.getElementById("key-status");

let activeId = EXAMPLES[0].id;

function getKey() {
  return keyInput.value.trim();
}

// One shared OpenAIBackend per API key value, reused across every example
// run in this tab. OpenAIBackend auto-detects (once per instance) whether
// its provider accepts the reasoning_effort field it tries first -- a
// fresh instance per click would repeat that one-time detection (a
// wasted rejected request) on every single decision instead of once for
// the whole session.
let sharedBackend = null;
let sharedBackendKey = null;
function getSharedBackend() {
  const key = getKey();
  if (!sharedBackend || sharedBackendKey !== key) {
    sharedBackend = new OpenAIBackend({ apiKey: key, allowBrowser: true });
    sharedBackendKey = key;
  }
  return sharedBackend;
}

function setKeyStatus(state) {
  if (state === "ok") {
    keyStatus.textContent = "key works";
    keyStatus.className = "mt-1.5 text-[11px] text-accent";
  } else if (state === "bad") {
    keyStatus.textContent = "key or request failed";
    keyStatus.className = "mt-1.5 text-[11px] text-danger";
  } else {
    keyStatus.textContent = "";
    keyStatus.className = "mt-1.5 text-[11px]";
  }
}

keyInput.addEventListener("input", () => setKeyStatus(null));

function renderNav() {
  nav.innerHTML = "";
  for (const ex of EXAMPLES) {
    const btn = document.createElement("button");
    btn.className =
      "text-left rounded-lg px-2.5 py-2.5 cursor-pointer text-[13px] border " +
      (ex.id === activeId ? "bg-panel2 border-border" : "bg-transparent border-transparent hover:bg-panel2");
    const badge =
      ex.kind === "race"
        ? `<span class="inline-block text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded ml-1.5 bg-accent/15 text-accent">live race</span>`
        : ex.kind === "scale"
          ? `<span class="inline-block text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded ml-1.5 bg-accent2/15 text-accent2">150 options</span>`
          : "";
    btn.innerHTML = `
      <span class="font-semibold">${ex.title}</span>${badge}
      <span class="block text-[11px] text-dim mt-0.5 leading-snug">${ex.tagline}</span>
    `;
    btn.addEventListener("click", () => {
      activeId = ex.id;
      renderNav();
      renderExample(ex);
    });
    nav.appendChild(btn);
  }
}

function fmtPct(p) {
  return (p * 100).toFixed(p < 0.001 ? 4 : 2) + "%";
}

function panel(titleHtml, bodyHtml) {
  const div = document.createElement("div");
  div.className = "bg-panel border border-border rounded-xl p-5 mb-5";
  div.innerHTML = `<h3 class="m-0 mb-3 text-[13px] uppercase tracking-wide text-dim">${titleHtml}</h3>${bodyHtml}`;
  return div;
}

function renderBars(probabilities, choice, container) {
  container.innerHTML = "";
  const sorted = [...probabilities.entries()].sort((a, b) => b[1] - a[1]);
  for (const [id, p] of sorted) {
    const isWinner = id === choice;
    const row = document.createElement("div");
    row.className = "grid grid-cols-[160px_1fr_70px] items-center gap-2.5 text-[13px]";
    row.innerHTML = `
      <div class="font-mono truncate ${isWinner ? "text-accent font-bold" : "text-dim"}">${id}</div>
      <div class="h-5 bg-panel2 border border-border rounded-md overflow-hidden">
        <div class="bar-fill h-full w-0 rounded-md ${isWinner ? "bg-gradient-to-r from-accent to-emerald-400" : "bg-gradient-to-r from-accent2 to-accent"}"></div>
      </div>
      <div class="text-right font-mono text-dim">${fmtPct(p)}</div>
    `;
    container.appendChild(row);
    requestAnimationFrame(() => {
      row.querySelector(".bar-fill").style.width = `${Math.max(p * 100, 0.5)}%`;
    });
  }
}

function tagListHtml(unscored, eliminated, stoppedEarly = []) {
  if (!unscored.length && !eliminated.length && !stoppedEarly.length) return "";
  const parts = [];
  for (const id of unscored) {
    parts.push(`<span class="text-[11px] px-2 py-0.5 rounded-full bg-panel2 border border-warn/30 text-warn">unscored: ${id}</span>`);
  }
  for (const id of stoppedEarly) {
    parts.push(`<span class="text-[11px] px-2 py-0.5 rounded-full bg-panel2 border border-accent2/30 text-accent2">stopped early: ${id}</span>`);
  }
  for (const id of eliminated) {
    parts.push(`<span class="text-[11px] px-2 py-0.5 rounded-full bg-panel2 border border-border text-dim">eliminated: ${id}</span>`);
  }
  return `<div class="flex gap-1.5 flex-wrap mt-2">${parts.join("")}</div>`;
}

function previewRowHtml(row) {
  const stateText = Array.isArray(row.state)
    ? row.state.filter((b) => b.type === "text").map((b) => b.text).join(" ")
    : typeof row.state === "string"
      ? row.state
      : JSON.stringify(row.state);
  const img = row.imagePreview ? `<img src="${row.imagePreview}" class="max-w-[240px] rounded-lg block mt-2.5" />` : "";
  return `<div class="text-[13px] leading-relaxed bg-panel2 rounded-lg p-3 whitespace-pre-wrap font-mono">state: ${stateText}\n\nquestion: ${row.question}\n\noptions: ${row.options.map((o) => o.id).join(", ")}</div>${img}`;
}

function runButton(label) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.className =
    "bg-gradient-to-br from-accent to-accent2 text-bg border-none rounded-lg px-5 py-3 font-bold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  return btn;
}

function spinnerHtml(label) {
  return `<div class="mt-3.5 flex items-center gap-2 text-sm"><span class="spinner inline-block w-3 h-3 border-2 border-border border-t-accent rounded-full"></span> ${label}</div>`;
}

function errorBoxHtml(message) {
  return `<div class="text-danger text-[13px] bg-danger/10 border border-danger/30 rounded-lg p-3 mt-3.5">${message}</div>`;
}

function renderExample(ex) {
  main.innerHTML = "";
  const header = document.createElement("div");
  header.innerHTML = `<h2 class="m-0 mb-1 text-[22px] font-bold">${ex.title}</h2><p class="m-0 mb-5 text-dim text-sm">${ex.tagline}</p>`;
  main.appendChild(header);

  if (ex.kind === "row") renderRowExample(ex);
  else if (ex.kind === "race") renderRaceExample(ex);
  else if (ex.kind === "scale") renderScaleExample(ex);

  const footer = document.createElement("footer");
  footer.className = "mt-10 text-[11px] text-dim";
  footer.innerHTML = `Every number on this page comes from a real API call your browser just made. See <a href="https://github.com/devanmolsharma/decidr-ts" class="text-accent2 hover:underline">decidr-ts on GitHub</a>.`;
  main.appendChild(footer);
}

function renderRowExample(ex) {
  main.appendChild(panel("Row", previewRowHtml(ex.row)));

  if (ex.row.board) {
    const boardDiv = document.createElement("div");
    boardDiv.className = "grid grid-cols-3 gap-1";
    for (const boardRow of ex.row.board) {
      for (const cell of boardRow) {
        const cellDiv = document.createElement("div");
        const colorClass = cell === "X" ? "text-accent2" : cell === "O" ? "text-warn" : "";
        cellDiv.className = `w-11 h-11 bg-panel2 border border-border rounded-md flex items-center justify-center text-xl font-bold ${colorClass}`;
        cellDiv.dataset.cell = "1";
        cellDiv.textContent = cell === "." ? "" : cell;
        boardDiv.appendChild(cellDiv);
      }
    }
    const boardPanel = panel("Board", "");
    boardPanel.appendChild(boardDiv);
    main.appendChild(boardPanel);
  }

  const runPanel = panel("Run", `<div class="run-slot"></div><div class="result"></div>`);
  main.appendChild(runPanel);
  const runBtn = runButton("Run this decision");
  runPanel.querySelector(".run-slot").appendChild(runBtn);
  const resultEl = runPanel.querySelector(".result");

  runBtn.addEventListener("click", async () => {
    const key = getKey();
    if (!key) {
      resultEl.innerHTML = errorBoxHtml("Enter an OpenAI API key in the sidebar first.");
      return;
    }
    runBtn.disabled = true;
    resultEl.innerHTML = spinnerHtml("running...");

    try {
      const client = new Client("gpt-4o-mini", {
        backend: getSharedBackend(),
        exhaustive: ex.row.exhaustive ?? true,
      });
      const start = performance.now();
      const decision = await client.decide(ex.row);
      const latencyMs = performance.now() - start;
      setKeyStatus("ok");

      resultEl.innerHTML = `<div class="flex flex-col gap-2.5 bars"></div><div class="flex gap-4 flex-wrap text-xs text-dim mt-3.5 meta"></div>`;
      renderBars(decision.probabilities, decision.choice, resultEl.querySelector(".bars"));
      resultEl.querySelector(".meta").innerHTML = `
        <span>latency: <b class="text-slate-100 font-mono">${latencyMs.toFixed(0)}ms</b></span>
        <span>choice: <b class="text-slate-100 font-mono">${decision.choice}</b></span>
        <span>confidence: <b class="text-slate-100 font-mono">${fmtPct(decision.probabilities.get(decision.choice) ?? 0)}</b></span>
        ${ex.row.correctId ? `<span>${decision.choice === ex.row.correctId ? "correct!" : "wrong -- correct is " + ex.row.correctId}</span>` : ""}
      `;
      resultEl.insertAdjacentHTML("beforeend", tagListHtml(decision.unscored, decision.eliminated, decision.stoppedEarly));

      if (ex.row.board) {
        const cells = document.querySelectorAll("[data-cell]");
        for (const cellEl of cells) cellEl.classList.remove("outline", "outline-2", "outline-danger", "outline-accent");
        const match = decision.choice.match(/^cell_(\d)_(\d)$/);
        if (match) {
          const [, r, c] = match;
          const idx = Number(r) * 3 + Number(c);
          const isCorrect = decision.choice === ex.row.correctId;
          cells[idx]?.classList.add("outline", "outline-2", isCorrect ? "outline-accent" : "outline-danger");
        }
      }
    } catch (e) {
      setKeyStatus("bad");
      resultEl.innerHTML = errorBoxHtml((e && e.message) || String(e));
    } finally {
      runBtn.disabled = false;
    }
  });
}

function renderRaceExample(ex) {
  main.appendChild(panel("Row", previewRowHtml(ex.row)));

  const runPanel = panel(
    "Run",
    `
    <div class="run-slot"></div>
    <div class="flex flex-col gap-4 mt-4 lanes">
      <div class="lane bg-panel2 border border-border rounded-lg p-3.5" data-lane="decidr">
        <div class="flex justify-between text-xs uppercase tracking-wide text-dim mb-2">
          <span>decidr (single forward pass)</span><span class="clock font-mono text-accent">--</span>
        </div>
        <div class="lane-body font-mono text-[13px] min-h-[24px] whitespace-pre-wrap text-accent">waiting to start...</div>
      </div>
      <div class="lane bg-panel2 border border-border rounded-lg p-3.5" data-lane="naive">
        <div class="flex justify-between text-xs uppercase tracking-wide text-dim mb-2">
          <span>normal chat call (generate + parse)</span><span class="clock font-mono text-accent">--</span>
        </div>
        <div class="lane-body font-mono text-[13px] min-h-[24px] whitespace-pre-wrap">waiting to start...</div>
      </div>
    </div>
    <div class="result"></div>
  `,
  );
  main.appendChild(runPanel);

  const runBtn = runButton("Start the race");
  runPanel.querySelector(".run-slot").appendChild(runBtn);
  const decidrLane = runPanel.querySelector('[data-lane="decidr"]');
  const naiveLane = runPanel.querySelector('[data-lane="naive"]');
  const resultEl = runPanel.querySelector(".result");

  runBtn.addEventListener("click", async () => {
    const key = getKey();
    if (!key) {
      resultEl.innerHTML = errorBoxHtml("Enter an OpenAI API key in the sidebar first.");
      return;
    }
    runBtn.disabled = true;
    resultEl.innerHTML = "";
    for (const lane of [decidrLane, naiveLane]) {
      lane.classList.remove("border-accent");
      lane.querySelector(".clock").textContent = "--";
    }
    decidrLane.querySelector(".lane-body").textContent = "thinking...";
    naiveLane.querySelector(".lane-body").textContent = "";

    const raceStart = performance.now();
    const clockInterval = setInterval(() => {
      const elapsed = ((performance.now() - raceStart) / 1000).toFixed(1);
      if (!decidrLane.classList.contains("border-accent")) decidrLane.querySelector(".clock").textContent = `${elapsed}s`;
      if (!naiveLane.classList.contains("border-accent")) naiveLane.querySelector(".clock").textContent = `${elapsed}s`;
    }, 50);

    const decidrPromise = (async () => {
      const client = new Client("gpt-4o-mini", { backend: getSharedBackend() });
      const decision = await client.decide(ex.row);
      const elapsed = performance.now() - raceStart;
      decidrLane.classList.add("border-accent");
      decidrLane.querySelector(".clock").textContent = `${(elapsed / 1000).toFixed(2)}s`;
      decidrLane.querySelector(".lane-body").textContent = `${decision.choice}  (${fmtPct(decision.probabilities.get(decision.choice) ?? 0)} confidence)`;
      return elapsed;
    })();

    const naivePromise = (async () => {
      const { fullText, parsedId } = await runNaiveBaseline(key, "gpt-4o-mini", ex.row, (partial) => {
        naiveLane.querySelector(".lane-body").textContent = partial;
      });
      const elapsed = performance.now() - raceStart;
      naiveLane.classList.add("border-accent");
      naiveLane.querySelector(".clock").textContent = `${(elapsed / 1000).toFixed(2)}s`;
      naiveLane.querySelector(".lane-body").textContent = fullText + `\n\n[parsed: ${parsedId ?? "FAILED TO PARSE"}]`;
      return elapsed;
    })();

    try {
      const [decidrMs, naiveMs] = await Promise.all([decidrPromise, naivePromise]);
      clearInterval(clockInterval);
      const speedup = (naiveMs / decidrMs).toFixed(1);
      resultEl.innerHTML = `<div class="flex gap-4 flex-wrap text-xs text-dim mt-3.5">decidr was <b class="text-accent font-mono ml-1">${speedup}x faster</b>&nbsp;for this decision (${decidrMs.toFixed(0)}ms vs ${naiveMs.toFixed(0)}ms)</div>`;
      setKeyStatus("ok");
    } catch (e) {
      clearInterval(clockInterval);
      setKeyStatus("bad");
      resultEl.innerHTML = errorBoxHtml((e && e.message) || String(e));
    } finally {
      runBtn.disabled = false;
    }
  });
}

function renderScaleExample() {
  const row = buildScaleRow();

  main.appendChild(
    panel(
      "Row",
      previewRowHtml(row) +
        `<div class="flex gap-4 flex-wrap text-xs text-dim mt-3.5"><span><b class="text-slate-100 font-mono">${row.options.length}</b> real options across <b class="text-slate-100 font-mono">${new Set(row.options.map((o) => o.id.split("_")[0])).size}</b> departments</span></div>`,
    ),
  );

  const runPanel = panel("Run", `<div class="run-slot"></div><div class="result"></div>`);
  main.appendChild(runPanel);
  const runBtn = runButton("Route this among 150 options");
  runPanel.querySelector(".run-slot").appendChild(runBtn);
  const resultEl = runPanel.querySelector(".result");

  runBtn.addEventListener("click", async () => {
    const key = getKey();
    if (!key) {
      resultEl.innerHTML = errorBoxHtml("Enter an OpenAI API key in the sidebar first.");
      return;
    }
    runBtn.disabled = true;
    resultEl.innerHTML = spinnerHtml("resolving through the hierarchy...");

    let requestCount = 0;
    const countingBackend = new OpenAIBackend({ apiKey: key, allowBrowser: true });
    const originalChat = countingBackend.chat.bind(countingBackend);
    countingBackend.chat = (...args) => {
      requestCount++;
      return originalChat(...args);
    };

    try {
      const client = new Client("gpt-4o-mini", { backend: countingBackend, exhaustive: row.exhaustive });
      const start = performance.now();
      const decision = await client.decide(row);
      const latencyMs = performance.now() - start;
      setKeyStatus("ok");

      const stat = (n, label) => `
        <div class="bg-panel2 border border-border rounded-lg p-2.5">
          <div class="text-xl font-bold font-mono text-accent">${n}</div>
          <div class="text-[11px] text-dim">${label}</div>
        </div>`;

      resultEl.innerHTML = `
        <div class="grid gap-2 mt-2.5" style="grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))">
          ${stat(row.options.length, "total options")}
          ${stat(requestCount, "requests made")}
          ${stat(latencyMs.toFixed(0) + "ms", "total latency")}
          ${stat(decision.probabilities.size, "options scored")}
        </div>
        <div class="flex gap-4 flex-wrap text-xs text-dim mt-3.5">
          <span>choice: <b class="text-slate-100 font-mono">${decision.choice}</b></span>
          <span>confidence: <b class="text-slate-100 font-mono">${fmtPct(decision.probabilities.get(decision.choice) ?? 0)}</b></span>
          ${row.correctPrefix ? `<span>${decision.choice.startsWith(row.correctPrefix) ? "in the expected department!" : "outside the expected department"}</span>` : ""}
        </div>
        <div class="flex flex-col gap-2.5 mt-3.5 bars"></div>
      `;
      renderBars(decision.probabilities, decision.choice, resultEl.querySelector(".bars"));
    } catch (e) {
      setKeyStatus("bad");
      resultEl.innerHTML = errorBoxHtml((e && e.message) || String(e));
    } finally {
      runBtn.disabled = false;
    }
  });
}

renderNav();
renderExample(EXAMPLES[0]);
