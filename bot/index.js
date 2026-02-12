require("dotenv").config();
console.log("Starting bot process...");

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;
const POLL_SECONDS = Math.max(30, Number(process.env.POLL_SECONDS || 60));

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN in .env");
  process.exit(1);
}

const DATA_FILE = "./data.json";

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { watches: [], backoff: {}, userPrefs: {} };
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function normalizeSection(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
}
function buildClassDataUrl({ term, course, va }) {
  const url = new URL("https://mytimetable.mcmaster.ca/api/class-data");
  url.searchParams.set("term", String(term));
  url.searchParams.set("course", String(course));
  if (va && String(va).trim().length > 0) url.searchParams.set("va", String(va).trim());
  return url.toString();
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: res.ok, status: res.status, json, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

function extractSections(payload) {
  const candidates = [];

  const push = (section, open, capacity) => {
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
    const section = it.section || it.sectionDisp || it.sectionDisplay || it.sectionText || it.classSection || it.activity || it.text;
    const open = it.open || it.openSeats || it.available || it.seatsAvailable || it.remaining;
    const capacity = it.capacity || it.cap || it.total || it.classCapacity || it.seatsTotal;

    if (section) push(section, open, capacity);
    if (it.activity && typeof it.activity === "object") tryItem(it.activity);
    if (it.availability && typeof it.availability === "object") tryItem(it.availability);
  };

  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
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
    if (!prev) byKey.set(key, c);
    else byKey.set(key, {
      section: prev.section.length >= c.section.length ? prev.section : c.section,
      open: Math.max(prev.open, c.open),
      capacity: Math.max(prev.capacity, c.capacity)
    });
  }

  return Array.from(byKey.values()).sort((a, b) => a.section.localeCompare(b.section));
}

function backoffMs(failureCount) {
  const base = 15_000;
  const cap = 30 * 60_000;
  const exp = Math.min(10, Math.max(0, failureCount));
  const raw = base * (2 ** exp);
  const jitter = randInt(70, 130) / 100;
  return Math.min(cap, Math.floor(raw * jitter));
}

function watchKey(w) {
  return `${w.userId}::${w.term}::${w.course}::${w.va || ""}::${normalizeSection(w.section)}`;
}
function groupKey(w) {
  return `${w.term}::${w.course}::${w.va || ""}`;
}

function getPrefs(data, userId) {
  data.userPrefs = data.userPrefs || {};
  if (!data.userPrefs[userId]) data.userPrefs[userId] = { notifyMode: "dm", channelId: "" };
  return data.userPrefs[userId];
}

async function sendNotice(client, userId, prefs, msg) {
  if (prefs.notifyMode === "channel" && prefs.channelId) {
    try {
      const ch = await client.channels.fetch(prefs.channelId);
      if (ch && ch.isTextBased()) {
        await ch.send(`<@${userId}> ${msg}`);
        return;
      }
    } catch {
      // fall through to DM
    }
  }

  const user = await client.users.fetch(userId);
  await user.send(msg);
}

async function pollOnce(client) {
  const data = loadData();
  const watches = data.watches || [];
  const backoff = data.backoff || {};
  const groups = new Map();

  for (const w of watches) {
    const bk = backoff[watchKey(w)];
    if (bk?.nextAllowedIso) {
      const t = Date.parse(bk.nextAllowedIso);
      if (Number.isFinite(t) && Date.now() < t) continue;
    }
    const gk = groupKey(w);
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(w);
  }

  for (const [gk, group] of groups.entries()) {
    const [term, course, va] = gk.split("::");
    const url = buildClassDataUrl({ term, course, va: va || "" });
    const res = await fetchJsonWithTimeout(url, 12_000);

    await new Promise((r) => setTimeout(r, randInt(150, 450)));

    if (!res.ok || !res.json) {
      for (const w of group) {
        const k = watchKey(w);
        const st = backoff[k] || { failureCount: 0 };
        st.failureCount += 1;
        st.lastError = !res.ok ? `HTTP ${res.status}` : "JSON parse failed";
        st.nextAllowedIso = new Date(Date.now() + backoffMs(st.failureCount)).toISOString();
        backoff[k] = st;
      }
      data.backoff = backoff;
      saveData(data);
      continue;
    }

    const sections = extractSections(res.json);

    for (const w of group) {
      const k = watchKey(w);
      const target = normalizeSection(w.section);

      let match = sections.find((s) => normalizeSection(s.section) === target);
      if (!match) match = sections.find((s) => normalizeSection(s.section).includes(target) || target.includes(normalizeSection(s.section)));

      if (!match) {
        const st = backoff[k] || { failureCount: 0 };
        st.failureCount += 1;
        st.lastError = "Section not found";
        st.nextAllowedIso = new Date(Date.now() + backoffMs(st.failureCount)).toISOString();
        backoff[k] = st;
        continue;
      }

      backoff[k] = { failureCount: 0, nextAllowedIso: "", lastError: "" };

      const openNow = Math.max(0, Number(match.open) || 0);
      const prevOpen = Number.isFinite(Number(w.lastOpen)) ? Number(w.lastOpen) : 0;
      const prevNotified = Number.isFinite(Number(w.lastNotifiedOpen)) ? Number(w.lastNotifiedOpen) : 0;

      w.lastCheckedIso = nowIso();
      w.lastOpen = openNow;

      const becameAvailable = prevOpen <= 0 && openNow > 0;
      const increased = openNow > prevOpen;
      const alreadyNotified = openNow <= prevNotified;

      if ((becameAvailable || increased) && openNow > 0 && !alreadyNotified) {
        const prefs = getPrefs(data, w.userId);
        const msg =
          `Seat opened: **${w.course} ${w.section}**\n` +
          `Term: ${w.term}${w.va ? ` | VA: ${w.va}` : ""}\n` +
          `Open seats: ${openNow}`;

        try {
          await sendNotice(client, w.userId, prefs, msg);
          w.lastNotifiedOpen = openNow;
        } catch {
          const st = backoff[k] || { failureCount: 0 };
          st.lastError = "Failed to notify user (DM blocked or channel perms?)";
          backoff[k] = st;
        }
      }
    }

    data.watches = watches;
    data.backoff = backoff;
    saveData(data);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Polling every ~${POLL_SECONDS}s`);

  const loop = async () => {
    try {
      await pollOnce(client);
    } catch (e) {
      console.error("Poll error:", e);
    } finally {
      const jitterMs = randInt(0, 10_000);
      setTimeout(loop, (POLL_SECONDS * 1000) + jitterMs);
    }
  };
  loop();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const data = loadData();

  if (interaction.commandName === "watch") {
    const term = interaction.options.getString("term", true).trim();
    const course = interaction.options.getString("course", true).trim().toUpperCase();
    const section = interaction.options.getString("section", true).trim();
    const va = (interaction.options.getString("va", false) || "").trim();

    const watch = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      userId: interaction.user.id,
      term, course, section, va,
      lastOpen: 0,
      lastNotifiedOpen: 0,
      lastCheckedIso: ""
    };

    const key = watchKey(watch);
    const exists = (data.watches || []).some((w) => watchKey(w) === key);
    if (exists) {
      await interaction.reply({ content: "That watch already exists.", ephemeral: true });
      return;
    }

    data.watches = data.watches || [];
    data.watches.push(watch);
    saveData(data);

    await interaction.reply({ content: `Added watch: **${course} ${section}** (term ${term}${va ? `, VA ${va}` : ""}).`, ephemeral: true });
  }

  if (interaction.commandName === "list") {
    const watches = (data.watches || []).filter((w) => w.userId === interaction.user.id);
    if (watches.length === 0) {
      await interaction.reply({ content: "No watches yet. Use /watch to add one.", ephemeral: true });
      return;
    }
    const lines = watches.map((w) =>
      `ID: \`${w.id}\` | **${w.course} ${w.section}** | term ${w.term}${w.va ? ` | VA ${w.va}` : ""} | lastOpen ${w.lastOpen} | lastCheck ${w.lastCheckedIso || "never"}`
    );
    await interaction.reply({ content: lines.join("\n"), ephemeral: true });
  }

  if (interaction.commandName === "remove") {
    const id = interaction.options.getString("id", true).trim();
    const before = data.watches || [];
    const after = before.filter((w) => !(w.userId === interaction.user.id && w.id === id));
    data.watches = after;
    saveData(data);
    await interaction.reply({ content: before.length === after.length ? "No matching watch found." : "Removed.", ephemeral: true });
  }

  if (interaction.commandName === "notify") {
    const mode = interaction.options.getString("mode", true);
    const channel = interaction.options.getChannel("channel", false);

    const prefs = getPrefs(data, interaction.user.id);

    if (mode === "dm") {
      prefs.notifyMode = "dm";
      prefs.channelId = "";
      saveData(data);
      await interaction.reply({ content: "Ok. I will DM you.", ephemeral: true });
      return;
    }

    if (!channel) {
      await interaction.reply({ content: "Pick a channel when using mode=channel.", ephemeral: true });
      return;
    }
    if (!channel.isTextBased()) {
      await interaction.reply({ content: "That channel is not a text channel.", ephemeral: true });
      return;
    }

    prefs.notifyMode = "channel";
    prefs.channelId = channel.id;
    saveData(data);
    await interaction.reply({ content: `Ok. I will notify you in ${channel}.`, ephemeral: true });
  }

  if (interaction.commandName === "settings") {
    const prefs = getPrefs(data, interaction.user.id);
    const modeText = prefs.notifyMode === "channel"
      ? `channel (<#${prefs.channelId || "not set"}>)`
      : "dm";
    await interaction.reply({ content: `Notification mode: **${modeText}**`, ephemeral: true });
  }

  if (interaction.commandName === "checknow") {
    await interaction.reply({ content: "Running a poll now. I will notify you if anything opens.", ephemeral: true });
    try { await pollOnce(client); } catch {}
  }
});

client.login(TOKEN);
