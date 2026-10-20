#!/usr/bin/env python3
"""Offline helper (NOT run by CI): builds simba-data/manual/real_careers.json from locally saved
Basketball Reference pages (league advanced pages NBA_2006..2020, team 2006 pages for 2005-06 salaries,
optional player pages for salary history). Usage: python tools/real_careers.py /tmp/bbr"""
import json,os,re,sys,unicodedata,glob,datetime
SRC=sys.argv[1] if len(sys.argv)>1 else "/tmp/bbr"
APP=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(APP,"simba-data","manual","real_careers.json")
def norm(n):
    n=unicodedata.normalize("NFKD",n).encode("ascii","ignore").decode().lower()
    n=re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?","",n); return re.sub(r"[^a-z]","",n)
ALIAS={"ronartest":"mettaworldpeace","nenehilario":"nene","peesstojakovic":"pejastojakovic"}
def uncomment(s): return s.replace("<!--","").replace("-->","")
def rows(html,table_id):
    m=re.search(r'<table[^>]*id="%s".*?</table>'%table_id,uncomment(html),re.S)
    if not m: return []
    out=[]
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>",m.group(0),re.S):
        cells=re.findall(r'<t[hd][^>]*data-stat="([^"]+)"[^>]*>(.*?)</t[hd]>',tr,re.S)
        if not cells: continue
        d={k:re.sub("<[^>]+>","",v).strip() for k,v in cells}
        a=re.search(r'href="(/players/./([a-z0-9]+)\.html)"',tr)
        if a: d["_href"],d["_id"]=a.group(1),a.group(2)
        out.append(d)
    return out
def f(x):
    try: return float(x)
    except: return None
# ---- advanced stats by season ----
adv={}  # bbref id -> {season: row}
names={}
for fn in sorted(glob.glob(os.path.join(SRC,"adv","*.html"))):
    yr=int(os.path.basename(fn)[:4]); season=f"{yr-1}-{str(yr)[2:]}"
    for r in rows(open(fn,errors="ignore").read(),"advanced"):
        pid=r.get("_id")
        if not pid: continue
        nm=r.get("name_display") or r.get("player") or ""
        names.setdefault(pid,nm)
        team=r.get("team_name_abbr") or r.get("team_id") or ""
        d=adv.setdefault(pid,{})
        # keep TOT / 2TM / 3TM row when a player was traded
        if season in d and not re.match(r"(TOT|\dTM)$",team): continue
        d[season]={"g":f(r.get("games")) or f(r.get("g")),"mp":f(r.get("mp")),"per":f(r.get("per")),"ws":f(r.get("ws")),
                   "bpm":f(r.get("bpm")),"vorp":f(r.get("vorp")),"age":f(r.get("age"))}
# ---- 2005-06 salaries from team pages ----
sal={}
for fn in glob.glob(os.path.join(SRC,"team","*.html")):
    for r in rows(open(fn,errors="ignore").read(),"salaries2"):
        v=re.sub(r"[^0-9]","",r.get("salary",""))
        if r.get("_id") and v: sal[r["_id"]]=max(sal.get(r["_id"],0),int(v))
# ---- optional player pages: salary history -> estimated contract end ----
hist={}
for fn in glob.glob(os.path.join(SRC,"players","*.html")):
    pid=os.path.basename(fn)[:-5]; s=open(fn,errors="ignore").read()
    rs=rows(s,"all_salaries") or rows(s,"salaries")
    h=[(r.get("season"),r.get("team_name") or r.get("team_id"),int(re.sub(r"[^0-9]","",r.get("salary","")) or 0)) for r in rs if re.match(r"\d{4}-\d\d",r.get("season",""))]
    if h: hist[pid]=h
def contract_end(h):
    """Estimate: from 2005-06, follow consecutive seasons with the same team whose salary stays within
    -15%..+30% of the previous year (NBA raise/decline structure). Labelled 'est.'."""
    seq=[x for x in h if x[0]>="2005-06"]
    if not seq or seq[0][0]!="2005-06": return None
    end=seq[0];
    for prev,cur in zip(seq,seq[1:]):
        if cur[1]!=prev[1] or not prev[2] or not (0.85<=cur[2]/prev[2]<=1.30): break
        end=cur
    return end[0]
# ---- match league players ----
P=json.load(open(os.path.join(APP,"simba-data","players.json")))["players"]
byname={}
for pid,nm in names.items(): byname.setdefault(norm(nm),[]).append(pid)
W={"2005-06":1.0,"2006-07":0.8,"2007-08":0.6,"2008-09":0.35,"2009-10":0.25}
out={"_meta":{"source":"Basketball Reference (basketball-reference.com) league advanced pages NBA_2006..NBA_2020, 2005-06 team salary tables, player salary histories","fetched_at":datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
  "note":"Hand-kept / offline-generated (tools/real_careers.py). Never overwritten by CI. near_ws = weighted WS 2005-06..2009-10 (weights 1.0/0.8/0.6/0.35/0.25). contract_end is an estimate from salary history.","weights":W},"players":{}}
miss=[]
for p in P:
    key=ALIAS.get(norm(p["name"]),norm(p["name"])); cands=byname.get(key,[])
    if len(cands)>1:  # disambiguate by age in 2005-06
        cands=sorted(cands,key=lambda c:abs(((adv[c].get("2005-06") or next(iter(adv[c].values()))).get("age") or 0)-(p.get("age") or 0)))
    if not cands: miss.append(p["name"]); out["players"][str(p["player_id"])]={"name":p["name"],"status":"no data"}; continue
    b=cands[0]; seas=adv[b]; sk=sorted(seas)
    near=sum(W[s]*(seas[s]["ws"] or 0) for s in W if s in seas)
    per=[(seas[s]["per"],seas[s]["mp"] or 0) for s in W if s in seas and seas[s]["per"] is not None]
    bpm=[(seas[s]["bpm"],seas[s]["mp"] or 0) for s in W if s in seas and seas[s]["bpm"] is not None]
    wavg=lambda L: round(sum(a*m for a,m in L)/sum(m for a,m in L),2) if L and sum(m for a,m in L)>0 else None
    rec={"name":p["name"],"bbref_id":b,"url":f"https://www.basketball-reference.com/players/{b[0]}/{b}.html",
         "seasons_2005_on":len(sk),"last_season":sk[-1] if sk else None,"ws_total_2005_on":round(sum(seas[s]["ws"] or 0 for s in sk),1),
         "ws_2005_10":{s:seas[s]["ws"] for s in W if s in seas},"near_ws":round(near,2),
         "per_2005_10":wavg(per),"bpm_2005_10":wavg(bpm),"vorp_2005_10":round(sum(seas[s]["vorp"] or 0 for s in W if s in seas),1),
         "salary_2005_06":sal.get(b),"salary_source":"BBRef 2005-06 team salary table" if b in sal else None}
    if b in hist: rec["contract_end_est"]=contract_end(hist[b]); rec["salary_history"]=hist[b][:8]
    if len(byname.get(key,[]))>1: rec["ambiguous_name"]=True
    out["players"][str(p["player_id"])]=rec
# manual overrides (known facts; HoopsHype fallback)
OV=os.path.join(APP,"simba-data","manual","real_careers_overrides.json")
if os.path.exists(OV):
    for k,v in json.load(open(OV)).items():
        if k.startswith("_"): continue
        out["players"].setdefault(k,{}).update(v)
json.dump(out,open(OUT,"w"),indent=1,ensure_ascii=False)
print("players",len(P),"matched",len(P)-len(miss),"missing",len(miss),miss[:40])
print("with salary",sum(1 for v in out["players"].values() if v.get("salary_2005_06")))
