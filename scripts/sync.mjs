// Film Room sync: copies a Dynasty Rewired league into data/ as JSON files.
// Runs in GitHub Actions every hour. Needs DR_API_TOKEN (a repository secret).
// Rewired only changes data when the league advances, so most runs make 1-2
// requests, see nothing new, and stop.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const BASE = "https://dynastyrewired.com/api/developer/v1";
const TOKEN = process.env.DR_API_TOKEN;
const LEAGUES = (process.env.LEAGUE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const DATA = "data";
const SEASON_DATASETS = ["schedule", "rankings", "postseason", "recruiting", "coaches", "awards", "rosters"];
const FORCE = process.env.FORCE_FULL === "true";

if (!TOKEN) {
  console.error("DR_API_TOKEN is not set. Add it under Settings > Secrets and variables > Actions.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0;

// One request, with the waits Rewired's docs ask for. Stays under 60/minute.
async function get(path, tries = 0) {
  if (requests > 0) await sleep(1100);
  requests++;
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  const code = body?.error?.code || res.status;
  if ((res.status === 429 || res.status === 503) && tries < 3) {
    const wait = Number(res.headers.get("retry-after") || 30) * 1000;
    console.log(`${code} on ${path}; waiting ${wait / 1000}s`);
    await sleep(Math.min(wait, 120000));
    return get(path, tries + 1);
  }
  const err = new Error(`${res.status} ${code} on ${path}: ${body?.error?.message || ""}`);
  err.status = res.status;
  throw err;
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

// Writes only when the content changed, so git sees no change otherwise.
async function save(file, value) {
  const text = JSON.stringify(value, null, 2) + "\n";
  let old = null;
  try { old = await readFile(file, "utf8"); } catch {}
  if (old === text) return false;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return true;
}

// Every string that looks like a school id in a dataset, for roster fetches.
function teamIdsFrom(schedule) {
  const ids = new Set();
  for (const t of schedule?.data?.teams || []) if (t?.teamId != null) ids.add(String(t.teamId));
  return [...ids];
}

async function syncSeason(league, seasonArg) {
  // "current" is resolved to the real year from the first response's envelope.
  const first = await get(`/leagues/${league}/seasons/${seasonArg}/schedule`);
  const season = first?.season ?? seasonArg;
  const dir = join(DATA, league, String(season));
  const changed = [];
  const docs = { schedule: first };
  if (await save(join(dir, "schedule.json"), first)) changed.push("schedule");
  for (const ds of SEASON_DATASETS.filter((d) => d !== "schedule")) {
    docs[ds] = await get(`/leagues/${league}/seasons/${season}/${ds}`);
    if (await save(join(dir, `${ds}.json`), docs[ds])) changed.push(ds);
  }

  // Box scores: 20 per page. Save each game once; re-save only if it changed.
  let after = null;
  let games = 0;
  do {
    const q = after ? `?limit=20&after=${encodeURIComponent(after)}` : "?limit=20";
    const page = await get(`/leagues/${league}/seasons/${season}/box-scores${q}`);
    for (const g of page?.data?.games || []) {
      games++;
      if (await save(join(dir, "box-scores", `${g.gameId}.json`), g)) changed.push(`box ${g.gameId}`);
    }
    after = page?.data?.next || null;
  } while (after);

  // School rosters: 138 requests, so only when a new roster capture appeared.
  const rosterIndexChanged = changed.includes("rosters");
  const teamIds = teamIdsFrom(docs.schedule);
  if (rosterIndexChanged || FORCE) {
    for (const id of teamIds) {
      try {
        const r = await get(`/leagues/${league}/seasons/${season}/rosters/${encodeURIComponent(id)}`);
        if (await save(join(dir, "rosters", `${id}.json`), r)) changed.push(`roster ${id}`);
      } catch (e) {
        if (e.status === 404) continue;
        throw e;
      }
    }
  }
  console.log(`${league} ${season}: ${games} box scores, ${teamIds.length} schools, ${changed.length} files changed`);
  changed.season = season;
  return changed;
}

async function main() {
  if (!LEAGUES.length) {
    const list = await get("/leagues");
    await save(join(DATA, "leagues.json"), list);
    for (const l of list?.data || []) LEAGUES.push(l.id);
  }
  let total = 0;
  for (const league of LEAGUES) {
    const summaryFile = join(DATA, league, "league.json");
    const before = await readJson(summaryFile);
    let summary;
    try {
      summary = await get(`/leagues/${league}`);
    } catch (e) {
      if (e.status === 402) { console.log(`${league}: trial ended, subscribe on Rewired to resume.`); continue; }
      throw e;
    }
    const same = before && JSON.stringify(before) === JSON.stringify(summary);
    await save(summaryFile, summary);
    if (same && !FORCE) { console.log(`${league}: no new capture.`); continue; }
    const seasons = new Set(["current"]);
    const real = (summary?.data?.seasons || []).map((s) => (typeof s === "object" ? s.season ?? s.year : s)).filter(Boolean);
    // Back-fill any season we have never saved.
    for (const s of real) if (!(await readJson(join(DATA, league, String(s), "schedule.json")))) seasons.add(s);
    const done = new Set();
    for (const s of seasons) {
      if (done.has(String(s))) continue;
      const changed = await syncSeason(league, s);
      done.add(String(changed.season));
      total += changed.length;
    }
  }
  console.log(`Done: ${requests} requests, ${total} files changed.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
