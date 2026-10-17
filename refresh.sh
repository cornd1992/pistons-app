#!/usr/bin/env bash
# Local refresh: scrape the stats site (not the forum), then rebuild the app data.
#   ./refresh.sh          full crawl (~20 min at 1 req/s)
#   ./refresh.sh --parse  re-parse the cached raw/ HTML only (needs simba-data/raw/)
set -euo pipefail
cd "$(dirname "$0")"
python3 simba-data/scrape.py "$@"
python3 build.py
