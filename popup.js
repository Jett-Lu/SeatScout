
const api = typeof browser !== "undefined" ? browser : chrome;

async function bg(msg) {
  return await api.runtime.sendMessage(msg);
}

function setText(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
}

function showError(message) {
  const box = document.getElementById("formError");
  if (!message) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  box.hidden = false;
  box.textContent = message;
}

function fmtIso(iso) {
  if (!iso) return "Never";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch (e) {
    return iso;
  }
}

function switchTab(which) {
  const tabW = document.getElementById("tabWatches");
  const tabS = document.getElementById("tabSettings");
  const panelW = document.getElementById("panelWatches");
  const panelS = document.getElementById("panelSettings");

  const watchesActive = which === "watches";

  tabW.classList.toggle("tabActive", watchesActive);
  tabS.classList.toggle("tabActive", !watchesActive);

  tabW.setAttribute("aria-selected", watchesActive ? "true" : "false");
  tabS.setAttribute("aria-selected", watchesActive ? "false" : "true");

  panelW.hidden = !watchesActive;
  panelS.hidden = watchesActive;
}

function renderWatches(watches) {
  const list = document.getElementById("watchList");
  const empty = document.getElementById("emptyState");
  list.innerHTML = "";

  if (!watches || watches.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const w of watches) {
    const card = document.createElement("div");
    card.className = "watchCard";

    const top = document.createElement("div");
    top.className = "watchTop";

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "watchTitle";
    title.textContent = `${w.course} ${w.sectionDisp}`;

    const meta = document.createElement("div");
    meta.className = "watchMeta";
    const vaText = (w.va && w.va.trim().length > 0) ? `VA: ${w.va}` : "VA: (none)";
    meta.textContent = `Term: ${w.term} | ${vaText}\nLast open: ${w.lastOpen} | Last check: ${fmtIso(w.lastCheckedIso)}`;

    left.appendChild(title);
    left.appendChild(meta);

    const pill = document.createElement("div");
    pill.className = "pill " + (w.enabled ? "pillOn" : "pillOff");
    pill.textContent = w.enabled ? "Enabled" : "Disabled";

    top.appendChild(left);
    top.appendChild(pill);

    const actions = document.createElement("div");
    actions.className = "watchActions";

    const toggle = document.createElement("button");
    toggle.className = "btn btnSmall";
    toggle.type = "button";
    toggle.textContent = w.enabled ? "Disable" : "Enable";
    toggle.addEventListener("click", async () => {
      await bg({ type: "TOGGLE_WATCH", id: w.id });
      await refresh();
    });

    const remove = document.createElement("button");
    remove.className = "btn btnSmall";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await bg({ type: "REMOVE_WATCH", id: w.id });
      await refresh();
    });

    actions.appendChild(toggle);
    actions.appendChild(remove);

    card.appendChild(top);
    card.appendChild(actions);
    list.appendChild(card);
  }
}

function populateSections(sections) {
  const select = document.getElementById("sectionSelect");
  select.innerHTML = "";

  if (!sections || sections.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No sections found. Try VA or manual entry.";
    select.appendChild(opt);
    return;
  }

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Select a section";
  select.appendChild(opt0);

  for (const s of sections) {
    const opt = document.createElement("option");
    opt.value = s.section;
    opt.textContent = `${s.section} (open ${s.open}/${s.capacity})`;
    select.appendChild(opt);
  }
}

async function saveDraft() {
  const draft = {
    term: document.getElementById("term").value.trim(),
    course: document.getElementById("course").value.trim(),
    va: document.getElementById("va").value.trim(),
    sectionDisp: document.getElementById("sectionManual").value.trim()
  };
  await bg({ type: "SAVE_DRAFT", draft });
}

async function loadDraftAndSettings() {
  const state = await bg({ type: "GET_STATE" });

  if (state.draft) {
    document.getElementById("term").value = state.draft.term || "";
    document.getElementById("course").value = state.draft.course || "";
    document.getElementById("va").value = state.draft.va || "";
    document.getElementById("sectionManual").value = state.draft.sectionDisp || "";
  }

  const s = state.settings || {};
  document.getElementById("intervalMinutes").value = s.intervalMinutes ?? 1;
  document.getElementById("notifyOnIncreaseOnly").checked = !!s.notifyOnIncreaseOnly;
  document.getElementById("playSound").checked = !!s.playSound;
}

async function refresh() {
  const state = await bg({ type: "GET_STATE" });
  renderWatches(state.watches);
}

document.getElementById("tabWatches").addEventListener("click", () => switchTab("watches"));
document.getElementById("tabSettings").addEventListener("click", () => switchTab("settings"));

document.getElementById("watchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");

  const term = document.getElementById("term").value.trim();
  const course = document.getElementById("course").value.trim();
  const va = document.getElementById("va").value.trim();

  const sectionSelect = document.getElementById("sectionSelect").value.trim();
  const sectionManual = document.getElementById("sectionManual").value.trim();
  const sectionDisp = sectionSelect || sectionManual;

  if (!term || !course || !sectionDisp) {
    showError("Term, course code, and section are required.");
    return;
  }

  try {
    await bg({ type: "ADD_WATCH", watch: { term, course, va, sectionDisp } });
    setText("loadStatus", "Added.");
    await saveDraft();
    await refresh();
  } catch (err) {
    showError(String(err && err.message ? err.message : err));
  }
});

document.getElementById("loadSections").addEventListener("click", async () => {
  showError("");
  setText("loadStatus", "Loading sections...");

  const term = document.getElementById("term").value.trim();
  const course = document.getElementById("course").value.trim();
  const va = document.getElementById("va").value.trim();

  if (!term || !course) {
    setText("loadStatus", "Enter term and course first.");
    return;
  }

  try {
    const res = await bg({ type: "FETCH_SECTIONS", term, course, va });
    populateSections(res.sections || []);
    setText("loadStatus", `Loaded ${res.sections ? res.sections.length : 0} section(s).`);
    await saveDraft();
  } catch (err) {
    setText("loadStatus", "Failed to load sections.");
    showError(String(err && err.message ? err.message : err));
  }
});

document.getElementById("checkNow").addEventListener("click", async () => {
  setText("loadStatus", "Checking...");
  await bg({ type: "CHECK_NOW" });
  setText("loadStatus", "Checked.");
  await refresh();
});

document.getElementById("enableAll").addEventListener("click", async () => {
  await bg({ type: "TOGGLE_ALL", enable: true });
  await refresh();
});

document.getElementById("disableAll").addEventListener("click", async () => {
  await bg({ type: "TOGGLE_ALL", enable: false });
  await refresh();
});

document.getElementById("saveSettings").addEventListener("click", async () => {
  const intervalMinutes = Math.max(1, Number(document.getElementById("intervalMinutes").value) || 1);
  const notifyOnIncreaseOnly = document.getElementById("notifyOnIncreaseOnly").checked;
  const playSound = document.getElementById("playSound").checked;

  await bg({ type: "SET_SETTINGS", settings: { intervalMinutes, notifyOnIncreaseOnly, playSound } });
  setText("settingsStatus", "Saved.");
  setTimeout(() => setText("settingsStatus", ""), 1500);
});

document.getElementById("resetSettings").addEventListener("click", async () => {
  await bg({ type: "SET_SETTINGS", settings: { intervalMinutes: 1, notifyOnIncreaseOnly: true, playSound: true } });
  await loadDraftAndSettings();
  setText("settingsStatus", "Reset.");
  setTimeout(() => setText("settingsStatus", ""), 1500);
});

for (const id of ["term","course","va","sectionManual"]) {
  document.getElementById(id).addEventListener("input", () => { void saveDraft(); });
}

(async () => {
  switchTab("watches");
  await loadDraftAndSettings();
  await refresh();
})();
