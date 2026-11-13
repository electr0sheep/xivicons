#!/usr/bin/env node
// Builds public/data.js for the /micon icon search page from XIVAPI v2.
// Usage:  node fetch-data.mjs        (Node 18+, no dependencies)
// Re-run after each game patch to pick up new icons.

import { writeFileSync } from "node:fs";

const API = "https://v2.xivapi.com/api";
const PAGE = 500;          // the server clamps this if it is too high
const DELAY_MS = 150;      // be polite to the API
const BLU_CLASSJOB_ID = 36;
const REMOVED_ACTION_ICONS = new Set([784, 786]); // the "?" icons on removed actions
const UNSET_ICON = 405;    // what rows with no icon of their own carry (it is Cure's)

// ---------------------------------------------------------------------------
// Sheet -> /micon category map. Edit here if a category turns out wrong.
//   fields: columns to request (the API returns only Name/Icon unless asked)
//   query:  optional search filter, so only matching rows are downloaded
//   pick:   (fields, rowId) -> { name, icon, cat } or null to skip the row
// ---------------------------------------------------------------------------
const SHEETS = [
  {
    sheet: "Action",
    query: "IsPlayerAction=true", // drops enemy / unused actions
    fields: "Name,Icon,IsPvP,ClassJob.Abbreviation",
    pick: (f) => {
      let cat = "action";
      if (f.IsPvP) cat = "pvpaction";
      else if (linkId(f.ClassJob) === BLU_CLASSJOB_ID) cat = "blueaction";
      return { name: f.Name, icon: f.Icon, cat };
    },
  },
  { sheet: "CraftAction", fields: "Name,Icon", pick: (f) => ({ name: f.Name, icon: f.Icon, cat: "action" }) },
  { sheet: "GeneralAction", fields: "Name,Icon", pick: (f) => ({ name: f.Name, icon: f.Icon, cat: "general" }) },
  {
    sheet: "Item",
    fields: "Name,Icon,CanBeHq",
    pick: (f) => ({ name: f.Name, icon: f.Icon, cat: "item", hq: f.CanBeHq === true }),
  },
  { sheet: "Mount", fields: "Singular,Icon", pick: (f) => ({ name: title(f.Singular), icon: f.Icon, cat: "mount" }) },
  { sheet: "Companion", fields: "Singular,Icon", pick: (f) => ({ name: title(f.Singular), icon: f.Icon, cat: "minion" }) },
  { sheet: "Emote", fields: "Name,Icon", pick: (f) => ({ name: f.Name, icon: f.Icon, cat: "emote" }) },
  { sheet: "BuddyAction", fields: "Name,Icon", pick: (f) => ({ name: f.Name, icon: f.Icon, cat: "companion" }) },
  {
    sheet: "PetAction",
    fields: "Name,Icon",
    pick: (f) => (iconId(f.Icon) === UNSET_ICON ? null : { name: f.Name, icon: f.Icon, cat: "pet" }),
  },
  { sheet: "Marker", fields: "Name,Icon", pick: (f) => ({ name: f.Name, icon: f.Icon, cat: "enemysign" }) },
  { sheet: "FieldMarker", fields: "Name,UiIcon", pick: (f) => ({ name: f.Name, icon: f.UiIcon, cat: "waymark" }) },
  {
    sheet: "QuickChat",
    fields: "NameAction,Icon",
    // Row 0 is the "Deleted Message" stub.
    pick: (f, id) => (id > 0 ? { name: f.NameAction, icon: f.Icon, cat: "quickchat" } : null),
  },
  {
    sheet: "ClassJob",
    fields: "Name",
    // Job icons are not in the sheet; they live at icon id 62000 + job id.
    pick: (f, id) => (id > 0 ? { name: title(f.Name), icon: 62000 + id, cat: "classjob" } : null),
  },
];

// Display order + labels for the sidebar. The All view lists categories in this order too, so
// the everyday ones lead, and the PvP / Blue Mage look-alikes and the huge item list come last.
const CATEGORIES = [
  ["action", "Actions"],
  ["general", "General Actions"],
  ["mount", "Mounts"],
  ["minion", "Minions"],
  ["emote", "Emotes"],
  ["classjob", "Classes & Jobs"],
  ["waymark", "Waymarks"],
  ["enemysign", "Enemy Signs"],
  ["quickchat", "Quick Chat"],
  ["companion", "Chocobo Companion"],
  ["pet", "Pet Actions"],
  ["blueaction", "Blue Mage"],
  ["pvpaction", "PvP Actions"],
  ["item", "Items"],
];

// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function linkId(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") return v.value ?? v.row_id ?? null;
  return null;
}

// The game's own heading rule: every word is capitalised except these, unless first or last.
const LOWERCASE_WORDS = new Set([
  "of", "the", "to", "and", "a", "an", "or", "at", "by", "for", "in", "on", "with", "from",
  "sas", "zos", "van", "nan", "tol", "deus", "mal", "de", "rem", "out", "yae", "bas", "cen", "quo", "viator", "la",
]);

function title(s) {
  if (typeof s !== "string") return s;
  const words = s.split(" ");
  const staysLower = (w, i) => i > 0 && i < words.length - 1 && LOWERCASE_WORDS.has(w);
  return words.map((w, i) => (staysLower(w, i) ? w : w.replace(/^[a-z]/, (c) => c.toUpperCase()))).join(" ");
}

// Icon fields come back as a number or as an object with id / path.
function iconId(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    if (typeof v.id === "number") return v.id;
    const p = v.path_hr1 || v.path;
    const m = typeof p === "string" && p.match(/(\d{6})(?:_hr1)?\.tex$/);
    if (m) return Number(m[1]);
  }
  return 0;
}

async function getJson(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "micon-search-builder" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url} -> ${err.message}`);
      await sleep(1000 * i);
    }
  }
}

async function* rows(sheet, fields) {
  let after = null;
  for (;;) {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (fields) q.set("fields", fields);
    if (after !== null) q.set("after", String(after));
    const data = await getJson(`${API}/sheet/${sheet}?${q}`);
    const batch = data.rows ?? [];
    if (!batch.length) return;
    yield* batch;
    after = batch[batch.length - 1].row_id;
    await sleep(DELAY_MS);
  }
}

async function* search(sheet, query, fields) {
  const found = [];
  let cursor = null;
  do {
    const q = new URLSearchParams(cursor ? { cursor } : { sheets: sheet, query });
    q.set("limit", String(PAGE));
    q.set("fields", fields);
    const data = await getJson(`${API}/search?${q}`);
    found.push(...(data.results ?? []));
    cursor = data.next;
    if (cursor) await sleep(DELAY_MS);
  } while (cursor);
  yield* found.sort((a, b) => a.row_id - b.row_id); // search ranks by score, not row order
}

const catIndex = new Map(CATEGORIES.map(([id], i) => [id, i]));
const seen = new Set();
const entries = []; // [name, iconId, categoryIndex], plus a trailing 1 for items that can be HQ
const counts = {};
let failed = false;

for (const { sheet, query, fields, pick } of SHEETS) {
  let kept = 0;
  let total = 0;
  try {
    for await (const row of query ? search(sheet, query, fields) : rows(sheet, fields)) {
      total++;
      const hit = pick(row.fields ?? {}, row.row_id);
      if (!hit) continue;
      const name = typeof hit.name === "string" ? hit.name.trim() : "";
      const icon = iconId(hit.icon);
      if (!name || !icon) continue;
      if (name.startsWith("●") || REMOVED_ACTION_ICONS.has(icon)) continue; // dev stubs and removed actions
      const key = hit.cat + "\u0000" + name.toLowerCase();
      if (seen.has(key)) continue; // e.g. same crafting action on every crafter
      seen.add(key);
      const entry = [name, icon, catIndex.get(hit.cat)];
      if (hit.hq) entry.push(1);
      entries.push(entry);
      counts[hit.cat] = (counts[hit.cat] ?? 0) + 1;
      kept++;
      if (total % 5000 === 0) process.stdout.write(`  ${sheet}: ${total} rows...\r`);
    }
    console.log(`${kept ? "ok  " : "WARN"} ${sheet.padEnd(14)} kept ${kept} of ${total} rows`);
    if (!kept) failed = true;
  } catch (err) {
    console.log(`FAIL ${sheet.padEnd(14)} ${err.message}`);
    failed = true;
    break;
  }
}

if (failed) {
  console.error("\npublic/data.js left as it was. WARN: that sheet's field names need a tweak in SHEETS. FAIL: the request itself broke.");
  process.exitCode = 1;
} else {
  entries.sort((a, b) => a[2] - b[2] || a[0].localeCompare(b[0]));

  const out = {
    built: new Date().toISOString().slice(0, 10),
    categories: CATEGORIES.map(([id, label]) => ({ id, label })),
    entries,
  };
  writeFileSync(new URL("./public/data.js", import.meta.url), "window.MICON_DATA=" + JSON.stringify(out) + ";\n");

  console.log(`\nWrote public/data.js with ${entries.length} icons.`);
}
