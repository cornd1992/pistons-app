#!/usr/bin/env python3
"""Full refresh for simba.mygamesonline.org (Fast Break Basketball league site).

  python3 scrape.py            # re-fetch every page politely (~1 req/s), then parse + rebuild sitemap
  python3 scrape.py --cache    # no network: re-parse from raw/ cache only (re-fetches only missing pages)
  python3 scrape.py --parse    # parse only (no crawl at all)

Outputs (next to this script): teams.json players.json standings.json schedule.json freeagents.json
draft.json injuries.json caproom.json transactions.json leaders.json teamstats.json, raw/ HTML cache,
crawl_meta.json, and simba-sitemap.{html,md} in the parent folder (override with SITEMAP_DIR).
Notes: the site's TLS cert is for a different hostname, so verification is disabled; no robots.txt exists.
"""
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch, parse, sitemap
def main():
    t0=time.time()
    if "--parse" not in sys.argv:
        fetch.crawl(use_cache="--cache" in sys.argv, rate=1.0, workers=3, log=lambda m: print(m, flush=True))
    parse.run()
    sitemap.main()
    print(f"total {time.time()-t0:.0f}s")
if __name__=="__main__": main()
