#!/usr/bin/env python3
"""Build step: copy scraped JSON from /workspace/simba-data into data/, slim it for the app,
and save a dated snapshot (data/snapshots/<crawl time>.json) so trends accumulate across refreshes."""
import json, os, shutil, glob, re
APP=os.path.dirname(os.path.abspath(__file__))
# data source: $SIMBA_DATA, else ./simba-data (GitHub repo layout), else ../simba-data (/workspace layout)
SRC=os.environ.get("SIMBA_DATA") or next((p for p in (os.path.join(APP,"simba-data"),os.path.join(os.path.dirname(APP),"simba-data")) if os.path.isdir(p)),"/workspace/simba-data")
D=os.path.join(APP,"data"); SN=os.path.join(D,"snapshots"); os.makedirs(SN,exist_ok=True)
MY_TEAM=12
def load(n): return json.load(open(os.path.join(SRC,n)))
files=["teams","players","standings","schedule","freeagents","draft","injuries","caproom","transactions","leaders","teamstats"]
data={f:load(f+".json") for f in files}
meta=data["teams"]["_meta"]
# slim players: drop empty/duplicate keys to cut size
players=[]
for p in data["players"]["players"]:
    q={k:v for k,v in p.items() if v not in (None,[],{},"")}
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
# forum (optional): rules, picks, recent posts
fp=os.path.join(SRC,"forum.json")
if os.path.exists(fp):
    F=json.load(open(fp)); th={t["thread_id"]:t for t in F.get("threads",[])}
    recent=sorted(F.get("posts",[]),key=lambda p:p.get("timestamp") or "",reverse=True)[:150]
    bundle["forum"]={"meta":F.get("_meta"),"boards":F.get("boards"),"rules":F.get("rules"),"prospect_potential":F.get("prospect_potential"),
        "lottery_odds":F.get("lottery_odds"),"gms":F.get("gms"),"pistons_gm":F.get("pistons_gm"),"drafts":F.get("drafts"),
        "draft_picks":F.get("draft_picks"),"creation_draft_order":F.get("creation_draft_order"),
        "inaccessible_threads":[t for t in F.get("threads",[]) if t.get("inaccessible")],
        "recent_posts":[{**p,"thread_title":(th.get(p["thread_id"]) or {}).get("title"),"thread_url":(th.get(p["thread_id"]) or {}).get("url"),
                          "board":next((b["name"] for b in F.get("boards",[]) if b["board_id"]==(th.get(p["thread_id"]) or {}).get("board_id")),None)} for p in recent]}
    shutil.copy(fp,os.path.join(D,"forum.json"))
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
      "players":{p["player_id"]:{"team_id":p.get("team_id"),"season_averages":p.get("season_averages"),
                 "career":(p.get("stats") or {}).get("career"),"attributes":p.get("attributes")} for p in players if p.get("team_id")}}
json.dump(snap,open(os.path.join(SN,f"{key}.json"),"w"),separators=(",",":"))
idx=sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(SN,"*.json")) if not f.endswith("index.json"))
json.dump({"snapshots":idx},open(os.path.join(SN,"index.json"),"w"))
# bump service-worker cache version so phones pick up new data
sw=os.path.join(APP,"sw.js")
if os.path.exists(sw):
    s=open(sw).read(); s=re.sub(r"const VERSION='[^']*'",f"const VERSION='{key}-{len(idx)}'",s); open(sw,"w").write(s)
print(f"built bundle ({os.path.getsize(os.path.join(D,'bundle.json'))//1024} KB), snapshot {key}, {len(idx)} snapshots total")
