#!/usr/bin/env python3
"""Build step: copy scraped JSON from simba-data/ into data/, slim it for the app,
and save a dated snapshot (data/snapshots/<crawl time>.json) so trends accumulate across refreshes."""
import json, os, shutil, glob, re
APP=os.path.dirname(os.path.abspath(__file__))
# data source: $SIMBA_DATA, else ./simba-data (GitHub repo layout), else ../simba-data (/workspace layout)
SRC=os.environ.get("SIMBA_DATA") or next((p for p in (os.path.join(APP,"simba-data"),os.path.join(os.path.dirname(APP),"simba-data")) if os.path.isdir(p)),"/workspace/simba-data")
D=os.path.join(APP,"data"); SN=os.path.join(D,"snapshots"); os.makedirs(SN,exist_ok=True)
MY_TEAM=12
def load(n): return json.load(open(os.path.join(SRC,n)))
def _n(v):
    try: return float(v)
    except (TypeError,ValueError): return 0.0
def box_of(p):
    """Normalised current-season box line for analytics (all per-game, plus counts).
    Shooting makes/attempts come from the player-stats iframe (latest season row; summed if split across teams).
    The site prints FG/FGA/FT/FTA/3P/3PA as season totals (integers, MPG has decimals); if a value has a fraction it is
    treated as per-game instead. Per-game rates come from the profile 'Season Averages' block, falling back to the row."""
    sa=p.get("season_averages") or {}; st=p.get("stats") or {}; rows=st.get("seasons") or []
    row=None
    if rows:
        last=rows[-1].get("season"); cur=[r for r in rows if r.get("season")==last]
        tot=[r for r in cur if str(r.get("team","")).strip().lower() in ("total","tot","totals")]
        if tot: row=tot[0]
        elif len(cur)==1: row=cur[0]
        else:
            g=sum(_n(r.get("games")) for r in cur) or 1; row={"games":g}
            for k in ("fg","fga","ft","fta","three_p","three_pa","dq"): row[k]=sum(_n(r.get(k)) for r in cur)
            for k in ("mpg","rpg","apg","spg","bpg","topg","ppg"): row[k]=sum(_n(r.get(k))*_n(r.get("games")) for r in cur)/g
    row=row or {}
    gp=_n(sa.get("games")) or _n(row.get("games"))
    pick=lambda a,b: _n(sa.get(a)) if _n(sa.get(a)) else _n(row.get(b))
    b={"gp":gp,"mpg":pick("mpg","mpg"),"ppg":pick("ppg","ppg"),"rpg":pick("rpg","rpg"),"apg":pick("apg","apg"),
       "spg":pick("spg","spg"),"bpg":pick("bpg","bpg"),"topg":pick("topg","topg")}
    shoot={}
    for k in ("fg","fga","ft","fta","three_p","three_pa"):
        v=_n(row.get(k)); per_game=(v!=int(v))
        shoot[k]=v if per_game else (v/gp if gp else 0.0)
    b.update({"fgm":shoot["fg"],"fga":shoot["fga"],"ftm":shoot["ft"],"fta":shoot["fta"],"tpm":shoot["three_p"],"tpa":shoot["three_pa"],
              "has_shooting":bool(row) and any(_n(row.get(k)) for k in ("fga","fta"))})
    b={k:(round(v,3) if isinstance(v,float) else v) for k,v in b.items()}
    return b
files=["teams","players","standings","schedule","freeagents","draft","injuries","caproom","transactions","leaders","teamstats"]
data={f:load(f+".json") for f in files}
meta=data["teams"]["_meta"]
# slim players: drop empty/duplicate keys to cut size
players=[]
for p in data["players"]["players"]:
    q={k:v for k,v in p.items() if v not in (None,[],{},"")}
    q["box"]=box_of(p)
    players.append(q)
# schedule: keep league calendar + all teams (small enough after dropping raw text)
cap_path=os.path.join(SRC,"cap_rules.json")  # manual, hand-maintained (never overwritten by refresh)
CAP=json.load(open(cap_path)) if os.path.exists(cap_path) else {"salary_cap":49500000}
bundle={"meta":{**meta,"my_team_id":MY_TEAM,"salary_cap":CAP["salary_cap"],"cap_rules":CAP},
        "teams":data["teams"]["teams"],"players":players,"standings":data["standings"],
        "draft":data["draft"],"caproom":data["caproom"]["teams"],"transactions":data["transactions"]["transactions"],
        "leaders":data["leaders"],"teamstats":data["teamstats"]["pages"],"injuries":data["injuries"],
        "freeagents":data["freeagents"]["free_agents"],
        "schedule":{"league":data["schedule"]["league"],"my_team":data["schedule"]["teams"].get(str(MY_TEAM))}}
# hand-kept league facts + our own rule summaries (manual/, never overwritten). Forum posts are NOT bundled or published.
for key,fn in (("facts","league_facts.json"),("rules","league_rules.json")):
    p=os.path.join(SRC,"manual",fn)
    if os.path.exists(p): bundle[key]=json.load(open(p))
stale=os.path.join(D,"forum.json")
if os.path.exists(stale): os.remove(stale)  # never publish the forum copy
json.dump(bundle,open(os.path.join(D,"bundle.json"),"w"),separators=(",",":"),ensure_ascii=False)
if os.path.exists(cap_path): shutil.copy(cap_path,os.path.join(D,"cap_rules.json"))
for f in files: shutil.copy(os.path.join(SRC,f+".json"),os.path.join(D,f+".json"))  # full copies for reference
# ---- snapshot (compact, stats-focused) ----
crawled=meta.get("crawled_at") or meta.get("parsed_at"); key=re.sub(r"[^0-9T]","",crawled)[:13]  # YYYYMMDDTHHMM
my=next(t for t in bundle["teams"] if t["team_id"]==MY_TEAM)
snap={"crawled_at":crawled,
      "my_team":{"record":my.get("record"),"team_salary":my.get("team_salary"),"cap_room":my.get("cap_room"),
                 "yearly_stats":my.get("yearly_stats"),"team_stats":my.get("team_stats")},
      "league_team_stats":{t["team_id"]:t.get("team_stats") for t in bundle["teams"]},
      "league_records":{t["team_id"]:t.get("record") for t in bundle["teams"]},
      "players":{p["player_id"]:{"team_id":p.get("team_id"),"season_averages":p.get("season_averages"),"box":p.get("box"),
                 "career":(p.get("stats") or {}).get("career"),"attributes":p.get("attributes")} for p in players if p.get("team_id")}}
json.dump(snap,open(os.path.join(SN,f"{key}.json"),"w"),separators=(",",":"))
idx=sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(SN,"*.json")) if not f.endswith("index.json"))
json.dump({"snapshots":idx},open(os.path.join(SN,"index.json"),"w"))
# bump service-worker cache version so phones pick up new data
sw=os.path.join(APP,"sw.js")
if os.path.exists(sw):
    import hashlib  # version also changes when the app code changes, not just the data
    hsh=hashlib.sha1(b"".join(open(os.path.join(APP,f),"rb").read() for f in ("index.html","app.js","styles.css","manifest.webmanifest",os.path.join("data","bundle.json")) if os.path.exists(os.path.join(APP,f)))).hexdigest()[:8]
    s=open(sw).read(); s=re.sub(r"const VERSION='[^']*'",f"const VERSION='{key}-{len(idx)}-{hsh}'",s); open(sw,"w").write(s)
print(f"built bundle ({os.path.getsize(os.path.join(D,'bundle.json'))//1024} KB), snapshot {key}, {len(idx)} snapshots total")
