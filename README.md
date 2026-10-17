# pistons-app

Mobile-first PWA for managing the **Detroit Pistons** in the Fast Break Basketball sim league
(stats from [simba.mygamesonline.org](https://simba.mygamesonline.org)).

Live: https://cornd1992.github.io/pistons-app/ — on iPhone, open in Safari → Share → *Add to Home Screen*.

## Layout
| Path | What |
|---|---|
| `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/` | the static app (served at the site root; all paths relative) |
| `data/` | built data: `bundle.json` + per-dataset JSON, `snapshots/<YYYYMMDDTHHMM>.json` history |
| `build.py` | builds `data/` from `simba-data/` and bumps the service-worker cache version |
| `simba-data/scrape.py` | stats-site scraper (`fetch.py` crawl → `parse.py` → `sitemap.py`); `--parse` re-parses the local `raw/` cache |
| `simba-data/validate.py` | sanity check after a scrape (used by the workflow's fallback) |
| `simba-data/cap_rules.json`, `simba-data/manual/` | **manual** league cap rules — never overwritten by scrapes |
| `simba-data/forum.json` | static forum snapshot (rules, draft picks). The forum is **not** crawled. |
| `.github/workflows/refresh.yml` | daily 10:00 UTC + manual: scrape → validate → build → commit snapshot → deploy to Pages |

## Local refresh
```bash
pip install -r requirements.txt
./refresh.sh          # full crawl (~20 min, 1 req/s) + build
./refresh.sh --parse  # re-parse cached simba-data/raw/ (gitignored) + build
python3 -m http.server 8765   # then open http://127.0.0.1:8765/
```

If the Actions scrape fails (e.g. the site blocks GitHub runners), the workflow restores the committed data and still deploys.

The rookie minimum salary isn't published in any accessible league source; the app uses an editable,
clearly labelled placeholder ($398,762) on My Team — set the real value in `simba-data/cap_rules.json` → `rookie_minimum`.
