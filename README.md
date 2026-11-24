# Film Room

A personal College Football 27 dynasty tracker.

- **Data:** every hour, GitHub Actions pulls the Maryland dynasty (`cfb27-5156880`) from Dynasty Rewired and saves it under `data/` as JSON. That folder is the permanent archive.
- **Token:** the Rewired API token lives only in the repository secret `DR_API_TOKEN`. Never put it in a file here; this repository is public.
- **Run it now:** Actions tab → Sync dynasty → Run workflow. Tick "full" to re-download all 138 rosters.

## If syncing stops

- `401`: the token was replaced on Rewired. Make a new one under Account → API access and update the `DR_API_TOKEN` secret.
- `402`: the free trial ended. Subscribe to the league on Rewired.
- Scheduled runs pause if the repository has no activity for 60 days. Re-enable them on the Actions tab.
