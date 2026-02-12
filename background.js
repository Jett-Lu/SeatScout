/* SeatScout background script (Manifest V2)
   Goals:
   - Robust fetch + parsing for MyTimetable class-data
   - Jittered scheduling (avoid synchronized polling)
   - Per-watch exponential backoff on failures
   - Notification debouncing
   - Minimal diagnostics surfaced to popup via GET_STATE
*/

const api = typeof browser !== "undefined" ? browser : chrome;

const STORAGE_KEY = "seatScoutStateV1";
const ALARM_NAME = "SEATSCOUT_TICK";
const DEFAULT_SETTINGS = {
  intervalMinutes: 1,
  notifyOnIncreaseOnly: true,
  playSound: true
};

let runLock = false;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizeSection(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

async function loadState() {
  const obj = await api.storage.local.get(STORAGE_KEY);
  const state = obj[STORAGE_KEY] || {};
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  state.watches = Array.isArray(state.watches) ? state.watches : [];
  state.draft = state.draft || {};
  state.diagnostics = state.diagnostics || {};
  return state;
}

async function saveState(state) {
  await api.storage.local.set({ [STORAGE_KEY]: state });
}

function newId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function buildClassDataUrl({ term, course, va }) {
  const url = new URL("https://mytimetable.mcmaster.ca/api/class-data");
  url.searchParams.set("term", String(term));
  url.searchParams.set("course", String(course));
  if (va && String(va).trim().length > 0) url.searchParams.set("va", String(va).trim());
  return url.toString();
}

/* Parser tries multiple shapes. We only need:
   - section display string
   - open seats (integer)
   - capacity (integer, optional)
*/
function extractSections(payload) {
  const candidates = [];

  const pushCandidate = (section, open, capacity) => {
    const sec = String(section || "").trim();
    if (!sec) return;
    const o = Number(open);
    const c = Number(capacity);
    candidates.push({
      section: sec,
      open: Number.isFinite(o) ? o : 0,
      capacity: Number.isFinite(c) ? c : 0
    });
  };

  const tryItem = (it) => {
    if (!it || typeof it !== "object") return;

    const section =
      it.section ||
      it.sectionDisp ||
      it.sectionDisplay ||
      it.sectionText ||
      it.section_code ||
      it.classSection ||
      it.activity ||
      it.activityCode ||
      it.text;

    const open =
      it.open ||
      it.openSeats ||
      it.avail ||
      it.available ||
      it.seatsAvailable ||
      it.remaining ||
      it.capacityRemaining ||
      it.seats_open;

    const capacity =
      it.capacity ||
      it.cap ||
      it.total ||
      it.classCapacity ||
      it.seatsTotal ||
      it.seats_total;

    if (section) pushCandidate(section, open, capacity);

    if (it.activity && typeof it.activity === "object") tryItem(it.activity);
    if (it.availability && typeof it.availability === "object") tryItem(it.availability);
  };

  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const it of node) walk(it);
      return;
    }
    if (typeof node !== "object") return;

    if (Array.isArray(node.data)) walk(node.data);
    if (Array.isArray(node.classes)) walk(node.classes);
    if (Array.isArray(node.classData)) walk(node.classData);
    if (Array.isArray(node.activities)) walk(node.activities);
    if (Array.isArray(node.sections)) walk(node.sections);
    if (Array.isArray(node.results)) walk(node.results);

    tryItem(node);

    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) walk(v);
    }
  };

  walk(payload);

  const byKey = new Map();
  for (const c of candidates) {
    const key = normalizeSection(c.section);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, c);
      continue;
    }
    byKey.set(key, {
      section: prev.section.length >= c.section.length ? prev.section : c.section,
      open: Math.max(prev.open, c.open),
      capacity: Math.max(prev.capacity, c.capacity)
    });
  }

  return Array.from(byKey.values()).sort((a, b) => a.section.localeCompare(b.section));
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {
      json = null;
    }
    return { ok: res.ok, status: res.status, latencyMs, json };
  } finally {
    clearTimeout(t);
  }
}

function backoffMs(failureCount) {
  const base = 15 * 1000;
  const cap = 30 * 60 * 1000;
  const exp = Math.min(10, Math.max(0, failureCount));
  const raw = base * Math.pow(2, exp);
  const jitter = randInt(70, 130) / 100;
  return Math.min(cap, Math.floor(raw * jitter));
}

async function scheduleNextTick(state) {
  const intervalMs = Math.max(1, Number(state.settings.intervalMinutes) || 1) * 60 * 1000;
  const jitterMs = randInt(0, 15000);
  const when = Date.now() + intervalMs + jitterMs;

  await api.alarms.clear(ALARM_NAME);
  api.alarms.create(ALARM_NAME, { when });
}

function shouldSkipWatch(w) {
  if (!w.enabled) return true;
  if (w.nextAllowedCheckIso) {
    const t = Date.parse(w.nextAllowedCheckIso);
    if (Number.isFinite(t) && Date.now() < t) return true;
  }
  return false;
}

async function notifyOpen(watch, openNow, capacity) {
  const title = "Seat opened";
  const message = `${watch.course} ${watch.sectionDisp}\nOpen: ${openNow}${capacity ? `/${capacity}` : ""}`;

  const id = `seats_${watch.id}_${Date.now()}`;

  await api.notifications.create(id, {
    type: "basic",
    iconUrl: api.runtime.getURL("icon.png"),
    title,
    message
  });

  try {
    const st = await loadState();
    if (st.settings.playSound) {
      const audio = new Audio(api.runtime.getURL("ring.mp3"));
      audio.volume = 0.9;
      void audio.play();
    }
  } catch (e) {
    // ignore
  }
}

async function checkOneWatch(state, watch) {
  const url = buildClassDataUrl({ term: watch.term, course: watch.course, va: watch.va });

  const res = await fetchJsonWithTimeout(url, 12000);

  state.diagnostics.lastHttpStatus = res.status;
  state.diagnostics.lastLatencyMs = res.latencyMs;
  state.diagnostics.lastFetchIso = nowIso();

  if (!res.ok || !res.json) {
    watch.failureCount = (watch.failureCount || 0) + 1;
    watch.lastCheckedIso = nowIso();
    watch.lastError = !res.ok ? `HTTP ${res.status}` : "Failed to parse JSON";
    watch.nextAllowedCheckIso = new Date(Date.now() + backoffMs(watch.failureCount)).toISOString();
    state.diagnostics.lastError = `Fetch error for ${watch.course} ${watch.sectionDisp}: ${watch.lastError}`;
    return;
  }

  const sections = extractSections(res.json);
  const targetKey = normalizeSection(watch.sectionDisp);

  let match = sections.find((s) => normalizeSection(s.section) === targetKey);
  if (!match) {
    match = sections.find((s) => normalizeSection(s.section).includes(targetKey) || targetKey.includes(normalizeSection(s.section)));
  }

  if (!match) {
    watch.failureCount = (watch.failureCount || 0) + 1;
    watch.lastCheckedIso = nowIso();
    watch.lastError = "Section not found in API response";
    watch.nextAllowedCheckIso = new Date(Date.now() + backoffMs(watch.failureCount)).toISOString();
    state.diagnostics.lastError = `Parse error for ${watch.course} ${watch.sectionDisp}: section not found`;
    return;
  }

  const openNow = Math.max(0, Number(match.open) || 0);
  const capNow = Math.max(0, Number(match.capacity) || 0);

  const lastOpen = Number.isFinite(Number(watch.lastOpen)) ? Number(watch.lastOpen) : 0;
  const lastNotifiedOpen = Number.isFinite(Number(watch.lastNotifiedOpen)) ? Number(watch.lastNotifiedOpen) : 0;

  watch.lastCheckedIso = nowIso();
  watch.lastError = "";
  watch.failureCount = 0;
  watch.nextAllowedCheckIso = "";

  watch.lastOpen = openNow;

  const increased = openNow > lastOpen;
  const becameAvailable = lastOpen <= 0 && openNow > 0;

  const notifyIncreaseOnly = !!state.settings.notifyOnIncreaseOnly;
  const alreadyNotifiedThisCount = openNow <= lastNotifiedOpen;

  const shouldNotify =
    (notifyIncreaseOnly ? increased : (increased || becameAvailable)) &&
    openNow > 0 &&
    !alreadyNotifiedThisCount;

  if (shouldNotify) {
    await notifyOpen(watch, openNow, capNow);
    watch.lastNotifiedOpen = openNow;
  }
}

async function runCheckCycle() {
  if (runLock) return;
  runLock = true;

  const state = await loadState();
  const start = Date.now();

  state.diagnostics.lastRunStartIso = nowIso();
  state.diagnostics.lastError = "";

  try {
    const enabledWatches = state.watches.filter((w) => !shouldSkipWatch(w));

    for (let i = 0; i < enabledWatches.length; i++) {
      await checkOneWatch(state, enabledWatches[i]);
      if (i < enabledWatches.length - 1) await sleep(randInt(150, 450));
    }
  } catch (e) {
    state.diagnostics.lastError = String(e && e.message ? e.message : e);
  } finally {
    state.diagnostics.lastRunEndIso = nowIso();
    state.diagnostics.lastRunMs = Date.now() - start;
    await saveState(state);
    await scheduleNextTick(state);
    runLock = false;
  }
}

async function addWatch(state, watch) {
  const w = {
    id: newId(),
    term: String(watch.term || "").trim(),
    course: String(watch.course || "").trim().toUpperCase(),
    va: String(watch.va || "").trim(),
    sectionDisp: String(watch.sectionDisp || "").trim(),
    enabled: true,
    lastOpen: 0,
    lastNotifiedOpen: 0,
    lastCheckedIso: "",
    failureCount: 0,
    nextAllowedCheckIso: "",
    lastError: ""
  };

  const key = `${w.term}::${w.course}::${w.va}::${normalizeSection(w.sectionDisp)}`;
  const existing = state.watches.find((x) => `${x.term}::${x.course}::${x.va}::${normalizeSection(x.sectionDisp)}` === key);
  if (existing) throw new Error("That watch already exists.");

  state.watches.push(w);
  await saveState(state);
  await scheduleNextTick(state);
  return w;
}

async function fetchSections(term, course, va) {
  const url = buildClassDataUrl({ term, course, va });
  const res = await fetchJsonWithTimeout(url, 12000);

  if (!res.ok || !res.json) {
    throw new Error(!res.ok ? `HTTP ${res.status}` : "Failed to parse JSON");
  }
  return extractSections(res.json);
}

api.runtime.onMessage.addListener((msg) => {
  return (async () => {
    const state = await loadState();

    switch (msg && msg.type) {
      case "GET_STATE":
        return {
          watches: state.watches,
          settings: state.settings,
          draft: state.draft,
          diagnostics: state.diagnostics
        };

      case "SAVE_DRAFT":
        state.draft = msg.draft || {};
        await saveState(state);
        return { ok: true };

      case "SET_SETTINGS":
        state.settings = { ...DEFAULT_SETTINGS, ...(msg.settings || {}) };
        await saveState(state);
        await scheduleNextTick(state);
        return { ok: true };

      case "ADD_WATCH": {
        const w = await addWatch(state, msg.watch || {});
        return { ok: true, watch: w };
      }

      case "REMOVE_WATCH":
        state.watches = state.watches.filter((w) => w.id !== msg.id);
        await saveState(state);
        return { ok: true };

      case "TOGGLE_WATCH": {
        const w = state.watches.find((x) => x.id === msg.id);
        if (w) w.enabled = !w.enabled;
        await saveState(state);
        return { ok: true };
      }

      case "TOGGLE_ALL": {
        const enable = !!msg.enable;
        for (const w of state.watches) w.enabled = enable;
        await saveState(state);
        return { ok: true };
      }

      case "FETCH_SECTIONS": {
        const sections = await fetchSections(msg.term, msg.course, msg.va);
        return { sections };
      }

      case "CHECK_NOW":
        void runCheckCycle();
        return { ok: true };

      default:
        return { ok: false, error: "Unknown message type" };
    }
  })();
});

api.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== ALARM_NAME) return;
  void runCheckCycle();
});

api.runtime.onInstalled?.addListener(() => {
  void (async () => {
    const state = await loadState();
    await saveState(state);
    await scheduleNextTick(state);
  })();
});

void (async () => {
  const state = await loadState();
  await saveState(state);
  await scheduleNextTick(state);
})();
