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
# Team W-L updates as soon as games are played. Per-player counting stats live on the roster
# Player Statistics table; if that parse misses, every box stays 0 and Analytics still says no games.
if ok:
    try:
        T=json.load(open(os.path.join(HERE,"teams.json")))["teams"]
        P=json.load(open(os.path.join(HERE,"players.json")))["players"]
        wins=sum(((t.get("record") or {}).get("w") or 0)+((t.get("record") or {}).get("l") or 0) for t in T)
        played=sum(1 for p in P if ((p.get("roster_stats") or {}).get("games") or 0)>0)
        shot=sum(1 for p in P if ((p.get("box_totals") or {}).get("fga") or 0)>0 or ((p.get("box_totals") or {}).get("fta") or 0)>0)
        print(f"team_games={wins} roster_stat_lines={played} box_shooting_lines={shot}")
        if wins>0 and played==0:
            print("FAILED: teams have played but no roster player stat lines were parsed")
            ok=False
        if wins>0 and shot==0:
            print("FAILED: teams have played but no box-score makes/attempts were parsed")
            ok=False
    except Exception as e:
        print(f"roster stat check unreadable ({e})")
        ok=False
print("OK" if ok else "FAILED sanity check")
sys.exit(0 if ok else 1)
