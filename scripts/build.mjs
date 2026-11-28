// Builds site/film-room.json: one small file with everything the Film Room page shows.
// Reads data/ (written by sync.mjs) plus config/teams.json and config/overrides.json.

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const config = JSON.parse(await readFile("config/leagues.json", "utf8")).leagues;
const built = [];
for (const cfg of config) {
  if (cfg.hidden) { console.log(`${cfg.id}: hidden, skipped`); continue; }
  try { await readFile(join("data", cfg.id, "league.json")); } catch { console.log(`${cfg.id}: no data yet, skipped`); continue; }
  built.push(await buildOne(cfg.id, cfg));
}
await mkdir("site", { recursive: true });
await writeFile("site/leagues.json", JSON.stringify({ leagues: built }));
console.log(`site/leagues.json: ${built.map((b) => b.label).join(", ")}`);

async function buildOne(LEAGUE, cfg) {
const root = join("data", LEAGUE);
const J = async (f) => JSON.parse(await readFile(f, "utf8"));
const tryJ = async (f) => { try { return await J(f); } catch { return null; } };

const league = await J(join(root, "league.json"));
const seasons = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const season = String(league?.data?.currentSeason ?? seasons.at(-1));
const dir = join(root, season);
const teamInfo = await J("config/teams.json");
const overrides = (await tryJ("config/overrides.json"))?.games || {};

const schedule = (await J(join(dir, "schedule.json"))).data;
const rankings = (await tryJ(join(dir, "rankings.json")))?.data;
const recruiting = (await tryJ(join(dir, "recruiting.json")))?.data;
const coaches = (await tryJ(join(dir, "coaches.json")))?.data;
const awards = (await tryJ(join(dir, "awards.json")))?.data;

const rename = (gameId, name) => overrides[gameId]?.[name] ?? name;
const userTeam = schedule.teams.find((t) => t.userControlled) || null;

const teams = schedule.teams.map((t) => {
  const [abbr, color] = teamInfo[t.name] || [t.name.replace(/[^A-Z]/g, "").slice(0, 4) || t.name.slice(0, 4).toUpperCase(), null];
  return {
    id: t.teamId, name: t.name, abbr, color, conf: t.conference, rec: t.record, confRec: t.conferenceRecord,
    w: t.wins, l: t.losses, cw: t.conferenceWins, cl: t.conferenceLosses,
    ovr: t.overall, off: t.offense, def: t.defense, stars: t.prestigeStars, user: !!t.userControlled
  };
});
// Renamed opponents (FCS placeholders) get their own badge entries.
for (const [, map] of Object.entries(overrides)) for (const real of Object.values(map)) {
  if (!teams.find((t) => t.name === real)) {
    const [abbr, color] = teamInfo[real] || [real.slice(0, 4).toUpperCase(), null];
    teams.push({ id: "name:" + real, name: real, abbr, color, conf: "FCS", fcs: true });
  }
}
const idFor = (gameId, teamId, name) => {
  const real = rename(gameId, name);
  return real !== name ? "name:" + real : teamId;
};

const weeks = schedule.weeks.map((w) => ({
  label: w.label,
  current: w.id === schedule.currentWeekId,
  games: w.games.map((g) => ({
    id: g.gameId, st: g.status,
    a: idFor(g.gameId, g.awayTeamId, g.awayName), h: idFor(g.gameId, g.homeTeamId, g.homeName),
    an: rename(g.gameId, g.awayName), hn: rename(g.gameId, g.homeName),
    as: g.awayScore, hs: g.homeScore, au: !!g.awayUserControlled, hu: !!g.homeUserControlled
  }))
}));

// Player stat codes worth showing, grouped the way a box score reads.
const P = {
  pass: { PSPC: "cmp", PSPA: "att", PSPY: "yds", PSPT: "td", PSPI: "int", PSPL: "lng", PSPS: "sck" },
  rush: { PSRA: "car", PSRY: "yds", PSRT: "td", PSRL: "lng", PSRF: "fum" },
  rec: { PRRT: "rec", PRYD: "yds", PRTD: "td", PRLR: "lng", PRDP: "drop" },
  def: { PSTT: "tkl", PDTS: "solo", PTFL: "tfl", PSDS: "sck", PDIT: "int", PDPD: "pd", PDFF: "ff", PDFR: "fr", PDDT: "td" },
  kick: { PFGM: "fgm", PFGA: "fga", PFGL: "lng", PKXM: "xpm", PKXA: "xpa" },
  punt: { PPNT: "no", PPYD: "yds", PPLO: "lng", PPDT: "in20", PPTB: "tb" },
  ret: { PKRA: "kr", PKRY: "kryd", PKRT: "krtd", PPRA: "pr", PPRY: "pryd", PPRT: "prtd" },
  line: { BKSA: "sckAllowed", BLKP: "pancakes" }
};
const T = { SCR1: "q1", SCR2: "q2", SCR3: "q3", SCR4: "q4", SCRO: "ot", SCOR: "pts", OFYD: "yds", OFPY: "passYds", OFRY: "rushYds",
  PSAT: "passAtt", COMP: "comp", ORUS: "rushAtt", OFFD: "firstDowns", THRD: "thirdConv", THDD: "thirdAtt", FRTH: "fourthConv",
  FTHD: "fourthAtt", TURN: "turnovers", FUMB: "fumLost", INTC: "intThrown", PNLT: "pen", PNTY: "penYds", PSSC: "top", PLAY: "plays",
  OYPP: "ypp", YPRU: "ypr", YPPA: "ypa", TPUN: "punts", PSTD: "passTd", OFTD: "rushTd", REDP: "rzTrips", RDTD: "rzTd", TWOP: "twoConv", TWPA: "twoAtt", KRYD: "krYds", PRYD: "prYds" };
const pick = (stats, map) => {
  const out = {}; let any = false;
  for (const [code, key] of Object.entries(map)) { const v = stats?.[code]; if (v != null && v !== 0) { out[key] = Math.round(v * 10) / 10; any = true; } }
  return any ? out : null;
};

const boxes = [];
let boxFiles = [];
try { boxFiles = await readdir(join(dir, "box-scores")); } catch {}
for (const f of boxFiles) {
  const b = await J(join(dir, "box-scores", f));
  const g = b.game;
  const players = b.players.map((p) => {
    const row = { n: p.name, t: p.teamId, pos: p.position, j: p.jersey };
    let any = false;
    for (const [grp, map] of Object.entries(P)) { const s = pick(p.stats, map); if (s) { row[grp] = s; any = true; } }
    return any ? row : null;
  }).filter(Boolean);
  boxes.push({
    id: g.gameId, week: weeks.find((w) => w.games.some((x) => x.id === g.gameId))?.label || null,
    a: idFor(g.gameId, g.awayTeamId, g.awayName), h: idFor(g.gameId, g.homeTeamId, g.homeName),
    aRaw: g.awayTeamId, hRaw: g.homeTeamId,
    an: rename(g.gameId, g.awayName), hn: rename(g.gameId, g.homeName), as: g.awayScore, hs: g.homeScore,
    away: pick(b.away, T) || {}, home: pick(b.home, T) || {}, players
  });
}

// Polls: keep every captured week, slimmed.
const polls = (rankings?.weeks || []).map((w) => ({
  label: w.stage?.label, week: w.stage?.week,
  media: w.polls.find((p) => p.poll === "media" && p.state === "available")?.rows?.map((r) => ({ r: r.rank, t: r.teamId, s: r.school, rec: r.record, pr: r.previousState === "ranked" ? r.previousRank : null })) || null,
  coaches: w.polls.find((p) => p.poll === "coaches" && p.state === "available")?.rows?.map((r) => ({ r: r.rank, t: r.teamId, s: r.school, rec: r.record, pr: r.previousState === "ranked" ? r.previousRank : null })) || null
}));

// Recruiting: latest class rankings, the top 150 recruits.
const caps = recruiting?.captures || [];
const latestClasses = caps.filter((c) => c.dataset === "top_classes" && c.classes?.length).at(-1);
const pool = caps.filter((c) => c.dataset === "all_recruits" && c.recruits?.length).at(-1);
const classes = (latestClasses?.classes || []).map((c) => ({ t: c.teamId, s: c.school, r: c.rank, n: c.commits, pts: c.points, st: [c.five, c.four, c.three, c.two, c.one] }));
const classesWeek = latestClasses?.stage?.label || null;
// Week-by-week class rank for every school (rank only, to keep it small).
const classHistory = caps.filter((c) => c.dataset === "top_classes" && c.classes?.length)
  .map((c) => ({ label: c.stage?.label, ranks: Object.fromEntries(c.classes.map((x) => [x.teamId, x.rank])), commits: Object.fromEntries(c.classes.filter((x) => x.commits).map((x) => [x.teamId, x.commits])) }));
// Latest status for each recruit: 0 top 10, 1 top 5, 2 top 3, 3 battle, 4 soft commit, 5 hard commit, 6 signed.
const statusCap = caps.filter((c) => c.dataset === "recruit_status" && c.status?.length).at(-1);
const statusById = Object.fromEntries((statusCap?.status || []).map((s) => [s.recruitId, s]));
const teamByName = Object.fromEntries(schedule.teams.map((t) => [t.name, t.teamId]));
const slimRecruit = (r) => {
  const st = statusById[r.recruitId];
  return { id: r.recruitId, r: r.rank, n: r.name, s: r.stars, pos: r.position, from: [r.hometown, r.state].filter(Boolean).join(", "), arch: r.archetype,
    ht: r.height, wt: r.weight, stage: st?.stage ?? null, sch: st?.school?.name || null, t: st?.school?.name ? teamByName[st.school.name] || null : null, since: st?.committedSince || null };
};
const allRecruits = (pool?.recruits || []).filter((r) => r.rank).sort((a, b) => a.rank - b.rank);
const recruits = allRecruits.slice(0, 150).map(slimRecruit);
const commits = allRecruits.filter((r) => statusById[r.recruitId]?.school).map(slimRecruit);
const stageCounts = [0, 1, 2, 3, 4, 5, 6].map((k) => (statusCap?.status || []).filter((s) => s.stage === k).length);
const recruitingWeek = statusCap?.stage?.label || classesWeek;

// Rosters: the user school in full; top players for everyone else.
const RATE_KEYS = ["PSPD", "PACC", "PAGI", "PSTR", "PAWR", "PTHP", "PTHA", "PTUP", "PCAR", "PBCV", "PBTK", "PCTH", "PRRS", "PRRM", "PRRD", "PPBK", "PRBK", "PTAK", "PBSG", "PLPU", "PLPR", "PLMC", "PLZC", "PKPR", "PKAC"];
const rosters = {};
const topPlayers = {};
for (const t of schedule.teams) {
  const r = (await tryJ(join(dir, "rosters", `${t.teamId}.json`)))?.data;
  if (!r) continue;
  const slim = (p, full) => {
    const o = { n: p.name, pos: p.position, yr: p.year, ovr: p.overall, spd: p.speed, j: p.jersey, dev: p.devTraitId ?? null };
    if (full) {
      o.ht = p.heightInches; o.wt = p.weightPounds; o.nil = p.nilCompensation ?? null;
      o.rt = Object.fromEntries(RATE_KEYS.filter((k) => p.ratings?.[k] != null).map((k) => [k, p.ratings[k]]));
      o.ab = (r.abilities || []).filter((a) => a.playerId === p.playerId && a.owned).map((a) => [a.name, a.tier]);
    }
    return o;
  };
  const sorted = [...r.players].sort((a, b) => b.overall - a.overall);
  if (t.userControlled) rosters[t.teamId] = sorted.map((p) => slim(p, true));
  topPlayers[t.teamId] = sorted.slice(0, 6).map((p) => slim(p, false));
}

// National scoring table from every final game in the schedule (all 138 schools).
const scoring = {};
for (const w of schedule.weeks) for (const g of w.games) {
  if (g.status !== "final" || g.awayScore == null) continue;
  for (const [id, pf, pa] of [[g.awayTeamId, g.awayScore, g.homeScore], [g.homeTeamId, g.homeScore, g.awayScore]]) {
    if (!id) continue;
    const s = (scoring[id] ||= { g: 0, pf: 0, pa: 0 }); s.g++; s.pf += pf; s.pa += pa;
  }
}
const nilTotals = {};
for (const t of schedule.teams) {
  const r = (await tryJ(join(dir, "rosters", `${t.teamId}.json`)))?.data;
  if (r) nilTotals[t.teamId] = r.players.reduce((a, p) => a + (p.nilCompensation || 0), 0);
}
for (const t of teams) { if (scoring[t.id]) t.sc = scoring[t.id]; if (nilTotals[t.id] != null) t.nil = nilTotals[t.id]; }

const out = {
  builtAt: Math.max(schedule.capturedAt || 0, schedule.teamsCapturedAt || 0, ...boxes.map(() => 0)) || null,
  league: { id: LEAGUE, name: league?.data?.name, season: Number(season), stage: league?.data?.stage?.label || schedule.currentStage?.label, lastCapture: league?.data?.lastCaptureAt },
  user: userTeam ? userTeam.teamId : null,
  coach: coaches?.active?.find((c) => c.role === "HC" && c.userControlled) || null,
  teams, weeks, boxes, polls, classes, classesWeek, classHistory, recruits, commits, stageCounts, recruitingWeek, rosters, topPlayers,
  awards: (awards?.winners || []).map((w) => ({ a: w.award, w: w.winner, s: w.school, t: w.teamId, pos: w.position })),
  // Weekly players of the week: national plus one per conference, offense and defense.
  weeklyAwards: (awards?.weekly || []).map((wk) => ({ label: wk.label, week: wk.week, list: (wk.awards || []).map((x) => ({ type: /Defens/.test(x.award) ? "def" : "off", conf: x.conference, n: x.name, pos: x.position, s: x.school, t: x.teamId, res: x.result, line: String(x.statLine || "").trim().replace(/\s*\n\s*/g, " · ") })) })).sort((a, b) => a.week - b.week)
};
out.cfg = { label: cfg.label, status: cfg.status, legacy: !!cfg.legacy, pyramid: cfg.pyramid || null, ledgerStart: cfg.ledgerStart || [], canon: cfg.canon ? await readFile(cfg.canon, "utf8").catch(() => "") : "" };
await mkdir("site/data", { recursive: true });
const text = JSON.stringify(out);
await writeFile(`site/data/${LEAGUE}.json`, text);
console.log(`site/data/${LEAGUE}.json: ${(text.length / 1024).toFixed(0)} KB, ${boxes.length} box scores, ${teams.length} teams`);
return { id: LEAGUE, label: cfg.label, status: cfg.status, team: userTeam?.name || null, season: Number(season), stage: out.league.stage };

}
