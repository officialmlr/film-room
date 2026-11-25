# Film Room

A personal College Football 27 dynasty tracker.

- **Data:** every hour, GitHub Actions pulls each active dynasty listed in `config/leagues.json` from Dynasty Rewired and saves it under `data/<league id>/` as JSON. That folder is the permanent archive. Maryland (`cfb27-5156880`) was the test season and is archived.
- **Token:** the Rewired API token lives only in the repository secret `DR_API_TOKEN`. Never put it in a file here; this repository is public.
- **Run it now:** Actions tab → Sync dynasty → Run workflow. Tick "full" to re-download all 138 rosters.

- **Page:** `site/index.html` reads `site/leagues.json` and `site/data/<league id>.json`, which `scripts/build.mjs` makes from `data/` after every sync. The private copy lives in Claude as the "Film Room" page, with a dynasty switcher.
- **FIU canon:** `config/fiu-canon.md` is the coach's fictional backstory and house rules the writers, press room and feed draw on. The pyramid (promotion/relegation tiers) is defined in `config/leagues.json`.
- **Names and colors:** `config/overrides.json` renames generic opponents (FCS East → Hampton). `config/teams.json` holds badge abbreviations and colors.

## If syncing stops

- `401`: the token was replaced on Rewired. Make a new one under Account → API access and update the `DR_API_TOKEN` secret.
- `402`: the free trial ended. Subscribe to the league on Rewired.
- Scheduled runs pause if the repository has no activity for 60 days. Re-enable them on the Actions tab.
