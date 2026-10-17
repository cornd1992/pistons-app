"""Sanity-check freshly scraped data before it is built/committed.
Exits non-zero if the scrape looks broken (e.g. the stats site blocked the runner)."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
def n(name, key):
    try: return len(json.load(open(os.path.join(HERE, name)))[key])
    except Exception as e: print(f"{name}: unreadable ({e})"); return 0
teams, players = n("teams.json", "teams"), n("players.json", "players")
pages = n("crawl_meta.json", "pages")
print(f"teams={teams} players={players} pages={pages}")
ok = teams >= 20 and players >= 300 and pages >= 500
print("OK" if ok else "FAILED sanity check")
sys.exit(0 if ok else 1)
