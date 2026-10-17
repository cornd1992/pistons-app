"""Parse cached HTML in raw/ into JSON files for the team-management app."""
import os, re, json, glob, time
from bs4 import BeautifulSoup
HERE=os.path.dirname(os.path.abspath(__file__)); RAW=os.path.join(HERE,"raw")
BASE="https://simba.mygamesonline.org/"
def soup(rel, parser="html.parser"):
    p=os.path.join(RAW,rel)
    return BeautifulSoup(open(p,encoding="utf-8",errors="replace").read(),parser) if os.path.exists(p) else None
def txt(el): return re.sub(r"\s+"," ",el.get_text(" ",strip=True)).strip() if el else ""
def cells(tr): return tr.find_all(["td","th"],recursive=False)
def leaf_tables(s): return [t for t in s.find_all("table") if not t.find("table")]
def num(v):
    """'$1,234' -> 1234, '.512' -> 0.512, '12' -> 12, else original string (None for '')."""
    if v is None: return None
    v=v.strip()
    if v=="" : return None
    m=re.fullmatch(r"-?\$?-?[\d,]*\.?\d+%?",v)
    if m and re.search(r"\d",v):
        w=v.replace("$","").replace(",","").rstrip("%")
        try: return int(w) if re.fullmatch(r"-?\d+",w) else float(w)
        except ValueError: return v
    return v
def height_in(h):
    m=re.match(r"(\d+)'\s*(\d+)",h or "");  return int(m[1])*12+int(m[2]) if m else None
def pid(href):
    m=re.search(r"player(\d+)\.htm",href or ""); return int(m[1]) if m else None
def tid(href):
    m=re.search(r"roster(\d+)\.htm",href or ""); return int(m[1]) if m else None
def slug(k): return re.sub(r"_+","_",re.sub(r"[^a-z0-9]+","_",k.lower().replace("%","_pct").replace("#","num").replace("3p","three_p"))).strip("_")
def header_index(rows, must):
    for i,r in enumerate(rows):
        hs=[txt(c) for c in cells(r)]
        if all(m in hs for m in must): return i,hs
    return None,None
def table_records(t, must, keymap=None):
    """Rows after the header row as dicts (slugged keys), adding *_id from player/roster links."""
    rows=t.find_all("tr"); i,hs=header_index(rows,must)
    if i is None: return []
    out=[]
    for r in rows[i+1:]:
        cs=cells(r)
        if not cs or all(not txt(c) for c in cs): continue
        rec={}
        for h,c in zip(hs,cs):
            if not h: continue
            k=(keymap or {}).get(h,slug(h)); v=txt(c); rec[k]=num(v) if k not in("name","player","team","pos","height","season_label") else v
            a=c.find("a",href=True)
            if a:
                if pid(a["href"]) is not None: rec["player_id"]=pid(a["href"])
                if tid(a["href"]) is not None: rec["team_id"]=tid(a["href"])
        if len(cs)>=len([h for h in hs if h]) or len(rec)>1: out.append(rec)
    return out
def find_table(s, *must):
    for t in leaf_tables(s):
        i,_=header_index(t.find_all("tr"),list(must))
        if i is not None: return t
    return None
def kv_tables(s):
    """Leaf tables shaped 'Title' + rows of 'Label:' value -> {title:{label:value}}."""
    out={}
    for t in leaf_tables(s):
        rows=t.find_all("tr");
        if not rows: continue
        k0=0
        while k0<len(rows)-1 and not txt(rows[k0]): k0+=1
        title=txt(rows[k0]).rstrip(":"); d={}
        for r in rows[k0+1:]:
            vals=[txt(c) for c in cells(r)]
            j=0
            while j<len(vals):
                if vals[j].endswith(":"):
                    k=vals[j][:-1]; v=next((x for x in vals[j+1:] if x!=""),"")
                    # value is the next non-empty cell that is not itself a label
                    nxt=[x for x in vals[j+1:] if x!=""]
                    v="" if (not nxt or nxt[0].endswith(":")) else nxt[0]
                    d[slug(k)]=v; j+=1
                else: j+=1
        if d or title: out.setdefault(slug(title) or f"t{len(out)}",d)
    return out

# ---------------- teams ----------------
def parse_team_index():
    s=soup("rosters/index.htm"); teams={}; div=None
    for el in s.find_all(["td","a"]):
        if el.name=="a" and tid(el.get("href")):
            teams[tid(el["href"])]={"team_id":tid(el["href"]),"name":txt(el),"division":div}
        elif el.name=="td" and not el.find("a") and "Division" in txt(el) and len(txt(el))<40: div=txt(el)
    return teams
def short_names(teams):
    m={}
    for t in teams.values():
        for k in range(1,len(t["name"].split())):
            m.setdefault(" ".join(t["name"].split()[k:]),t["team_id"])
    m["76ers"]=next((t["team_id"] for t in teams.values() if "76ers" in t["name"]),None)
    return m
def parse_roster(t):
    s=soup(f"rosters/roster{t['team_id']}.htm"); r={}
    if not s: return None
    kv=kv_tables(s)
    rec=find_table(s,"W","L"); 
    if rec:
        rows=rec.find_all("tr"); hdr=[txt(c) for c in cells(rows[1])]; val=[txt(c) for c in cells(rows[2])]
        d=dict(zip(hdr,val)); r["record"]={k.lower():num(d.get(k)) for k in ("W","L","T") if k in d}
        lab=[txt(c) for c in rec.find_all(["td"])]
        for i,x in enumerate(lab):
            if x in("Team Salary:","Cap Room:"): r[slug(x[:-1])]=num(lab[i+1])
    r["yearly_stats"]={k:num(v) for k,v in kv.get("yearly_statistics",{}).items()}
    ab={p["id"]:p for p in table_records(find_table(s,"ID","Name","In","Pot"),["ID","Name","In"])} if find_table(s,"ID","Name","In","Pot") else {}
    st={p["id"]:p for p in table_records(find_table(s,"ID","Name","MPG"),["ID","Name","MPG"])} if find_table(s,"ID","Name","MPG") else {}
    sa={p["id"]:p for p in table_records(find_table(s,"ID","Name","Year 1"),["ID","Name","Year 1"])} if find_table(s,"ID","Name","Year 1") else {}
    players=[]
    for i in list(dict.fromkeys(list(ab)+list(st)+list(sa))):
        a=ab.get(i,{}); b=st.get(i,{}); c=sa.get(i,{})
        p={"player_id":a.get("player_id") or b.get("player_id") or c.get("player_id") or i,"name":a.get("name") or b.get("name") or c.get("name"),
           "pos":a.get("pos") or b.get("pos") or c.get("pos"),"age":a.get("age") or c.get("age"),
           "height":a.get("height"),"height_in":height_in(a.get("height")),"weight":a.get("weight"),
           "ratings":{k:a.get(k) for k in ("in","out","hn","df","reb","pot") if k in a},
           "season_stats":{k:v for k,v in b.items() if k not in("id","name","pos","player_id")},
           "salary":{k:v for k,v in c.items() if k.startswith("year_")},"salary_total":c.get("total"),
           "profile_url":f"{BASE}players/player{a.get('player_id') or i}.htm"}
        players.append(p)
    r["players"]=players
    cut=next((x for x in leaf_tables(s) if "Cut Players:" in txt(x)),None)
    r["cut_players"]=[x for x in table_records(cut,["Year 1","Total"]) if any(v not in(None,0) for v in x.values())] if cut else []
    # draft picks
    dp=[]; t8=next((x for x in s.find_all("table") if txt(x.find("tr")).startswith("Draft Picks")),None)
    if t8:
        rows=t8.find_all("tr"); years=[txt(c) for c in cells(rows[1])]
        for row in rows[3:]:
            cs=cells(row)
            for k,y in enumerate(years):
                if 2*k+1<len(cs) and txt(cs[2*k]):
                    a=cs[2*k+1].find("a",href=True)
                    dp.append({"season":num(y),"round":num(txt(cs[2*k])),"original_team":txt(cs[2*k+1]),"original_team_id":tid(a["href"]) if a else None})
    r["draft_picks"]=dp
    inj=find_table(s,"Name","Injury","Duration"); r["injuries"]=table_records(inj,["Name","Injury"]) if inj else []
    return r
def parse_team_schedule(team_id):
    """rosterNsched.htm: 'Day | Game' pairs laid out in side-by-side column blocks + Post-Season grid."""
    s=soup(f"rosters/roster{team_id}sched.htm")
    if not s: return None
    games=[]; post=None
    t=find_table(s,"Day","Game")
    if t:
        rows=t.find_all("tr"); hs=[txt(c) for c in cells(rows[0])]
        blocks=[j for j,h in enumerate(hs) if h=="Day"]
        for r in rows[1:]:
            cs=cells(r)
            for j in blocks:
                if j+1<len(cs) and txt(cs[j]):
                    g=txt(cs[j+1]); a=cs[j+1].find("a",href=True); o=next((x for x in cs[j+1].find_all("a",href=True) if tid(x["href"])),None)
                    rec={"day":num(txt(cs[j])),"game":g,"has_game":g.lower()!="no game"}
                    m=re.match(r"(@|vs\.?|at)?\s*(.+?)(?:\s+([WL])\s*(\d+)\s*-\s*(\d+))?$",g) if rec["has_game"] else None
                    if m:
                        rec.update({"home_away":"away" if m[1] in("@","at") else ("home" if m[1] else None),"opponent":m[2],
                                    "result":m[3],"score_for":int(m[4]) if m[4] else None,"score_against":int(m[5]) if m[5] else None})
                    if o: rec["opponent_team_id"]=tid(o["href"])
                    if a: rec["link"]=a["href"]
                    games.append(rec)
        games.sort(key=lambda x:x["day"] if isinstance(x["day"],int) else 0)
    pt=next((x for x in leaf_tables(s) if txt(x.find("tr"))=="Post-Season"),None)
    if pt:
        rows=pt.find_all("tr"); hs=[txt(c) for c in cells(rows[1])]
        post={h:[txt(cells(r)[k]) for r in rows[2:] if k<len(cells(r))] for k,h in enumerate(hs)}
    return {"regular_season":games,"games_scheduled":sum(g["has_game"] for g in games),"post_season":post}
def parse_team_history(team_id):
    """rosterNhist.htm: Team Information (kv) + franchise Player Records and Team Records."""
    s=soup(f"rosters/roster{team_id}hist.htm")
    if not s: return None
    kv=kv_tables(s); info={k:num(v) for k,v in kv.get("team_information",{}).items()}
    pr=[]; tr=[]
    t=find_table(s,"Player Records","Record","Player")
    if t:
        rows=t.find_all("tr"); hs=[txt(c) for c in cells(rows[0])]
        split=hs.index("Team Records") if "Team Records" in hs else len(hs)
        for r in rows[1:]:
            v=[txt(c) for c in cells(r)]
            if v[0]: pr.append({"category":v[0].rstrip(":"),"record":num(v[1]),"player":v[2],"season":num(v[3])})
            if split<len(v) and v[split]: tr.append({"category":v[split].rstrip(":"),"record":num(v[split+1]),"season":num(v[split+2])})
    return {"team_information":info,"franchise_player_records":pr,"franchise_team_records":tr}
# ---------------- players ----------------
def parse_player(path):
    s=BeautifulSoup(open(path,encoding="utf-8",errors="replace").read(),"html.parser")
    pid_=int(re.search(r"player(\d+)\.htm",path)[1])
    kv=kv_tables(s); head=txt(leaf_tables(s)[0]) if leaf_tables(s) else ""
    title=txt(s.title); m=re.match(r"(.*?)\s+(PG|SG|SF|PF|C|G|F)\s*$",head) or re.match(r"(PG|SG|SF|PF|C|G|F)\s+(.*?) - ",title)
    name,pos=(m[1],m[2]) if m and m.re.pattern.startswith("(.*?)") else ((m[2],m[1]) if m else (head,None))
    gi=kv.get("general_information",{})
    team_a=next((a for a in s.find_all("a",href=True) if tid(a["href"])),None)
    p={"player_id":pid_,"name":name,"pos":pos,"team":gi.get("team"),"team_id":tid(team_a["href"]) if team_a else None,
       "age":num(gi.get("age")),"height":gi.get("height"),"height_in":height_in(gi.get("height")),"weight":num(gi.get("weight")),
       "college":gi.get("college"),"hometown":gi.get("hometown"),"experience":num(gi.get("experience")),
       "draft_round":num(gi.get("round")),"draft_pick":num(gi.get("pick")),
       "attributes":kv.get("attributes",{}),
       "achievements":{k:num(v) for k,v in kv.get("achievements",{}).items()},
       "awards":[txt(r) for r in (next((t for t in leaf_tables(s) if txt(t.find("tr"))=="Awards"),None) or BeautifulSoup("","html.parser")).find_all("tr")[1:] if txt(r)],
       "season_averages":{k:num(v) for k,v in kv.get("season_averages",{}).items()},
       "career_highs":{k:num(v) for k,v in kv.get("career_highs",{}).items()}}
    c=kv.get("contract",{})
    p["contract"]={"loyalty":num(c.get("loyalty")),"greed":num(c.get("greed")),"play_for_winner":num(c.get("play_for_winner")),
                   "bird_years":num(c.get("bird_years")),"salary_by_year":[num(c.get(f"year_{i}")) for i in range(1,8)]}
    p["contract"]["total"]=sum(x for x in p["contract"]["salary_by_year"] if isinstance(x,(int,float)))
    known={"general_information","attributes","achievements","awards","season_averages","career_highs","contract"}
    extra={k:v for k,v in kv.items() if k not in known and v}
    if extra: p["other_sections"]=extra
    p["stats"]=parse_player_stats(pid_)
    p["profile_url"]=f"{BASE}players/player{pid_}.htm"
    return p
def parse_player_stats(pid_):
    """Iframe page playerNstats.htm: per-season rows + career totals line, every column kept.
    Columns on site: Season, Team, Games, MPG, FG, FGA, FG %, FT, FTA, FT %, 3P, 3PA, 3P %, RPG, APG, SPG, BPG, TOPG, DQ, PPG."""
    s=soup(f"players/player{pid_}stats.htm")
    if not s: return None
    t=find_table(s,"Season","Team","Games")
    if not t: return {"columns":[],"seasons":[],"career":None,"unparsed_text":txt(s.body)[:2000]}
    rows=t.find_all("tr"); i,hs=header_index(rows,["Season","Team","Games"])
    keys=[slug(h) for h in hs]; seasons=[]; career=None
    for r in rows[i+1:]:
        v=[txt(c) for c in cells(r)]
        if not any(v): continue
        rec={k:(x if k in("season","team") else num(x)) for k,x in zip(keys,v)}
        a=r.find("a",href=True)
        if a and tid(a["href"]): rec["team_id"]=tid(a["href"])
        if v[0].rstrip(":").lower()=="career": rec.pop("season",None); rec.pop("team",None); career=rec
        else: seasons.append(rec)
    return {"columns":hs,"seasons":seasons,"career":career}

# ---------------- league pages ----------------
def parse_standings(teams):
    s=soup("divstand.htm"); div=[]
    for t in leaf_tables(s):
        rows=t.find_all("tr"); i,hs=header_index(rows,["W","L","GB"])
        if i is None: continue
        name=txt(rows[0]) if i>0 else txt(cells(rows[i])[0])
        recs=[]
        for r in rows[i+1:]:
            v=[txt(c) for c in cells(r)]
            if len(v)<7 or not v[0]: continue
            if "Division" in v[0]: name=v[0]; continue
            a=r.find("a",href=True); nm=v[0]
            recs.append({"team":nm,"team_id":(tid(a["href"]) if a else None) or next((x["team_id"] for x in teams.values() if x["name"]==nm),None),
                         "w":num(v[1]),"l":num(v[2]),"win_pct":num(v[3]),"last10":v[4],"home":v[5],"gb":num(v[6]) if v[6]!="-" else 0.0})
        div.append({"division":name,"teams":recs})
    # divisional table may be one big table: split by "Division" header rows
    if len(div)==1 or not div:
        div=[]; s2=soup("divstand.htm"); cur=None
        for r in s2.find_all("tr"):
            v=[txt(c) for c in cells(r)]
            if r.find("table"): continue
            if v and v[0].endswith("Division"): cur={"division":v[0],"teams":[]}; div.append(cur); continue
            if cur and len(v)>=7 and v[0] and v[1]!="W":
                nm=v[0]; cur["teams"].append({"team":nm,"team_id":next((x["team_id"] for x in teams.values() if x["name"]==nm),None),
                   "w":num(v[1]),"l":num(v[2]),"win_pct":num(v[3]),"last10":v[4],"home":v[5],"gb":0.0 if v[6]=="-" else num(v[6])})
    conf=[]; s=soup("playstand.htm")
    for t in leaf_tables(s):
        rows=t.find_all("tr"); i,hs=header_index(rows,["W","L","GB"])
        if i is None: continue
        recs=[]
        for r in rows[i+1:]:
            v=[txt(c) for c in cells(r)]
            if len(v)<7 or not v[0]: continue
            a=r.find("a",href=True)
            recs.append({"team":v[0].lstrip("* ").strip(),"clinched_marker":v[0].startswith("*"),"team_id":tid(a["href"]) if a else None,
                         "w":num(v[1]),"l":num(v[2]),"win_pct":num(v[3]),"last10":v[4],"home":v[5],"gb":0.0 if v[6]=="-" else num(v[6])})
        conf.append({"conference":txt(rows[0]),"teams":recs})
    hist=find_table(soup("historicalperformance.htm"),"Team","Wins","Losses")
    return {"divisional":div,"playoff_seeding":conf,"historical_team_performance":table_records(hist,["Team","Wins"]) if hist else []}
def parse_league_schedule():
    s=soup("leagueschedule.htm"); months=[]
    for t in leaf_tables(s):
        rows=t.find_all("tr")
        if len(rows)<2: continue
        m=txt(rows[0]); days=[]
        for r in rows[1:]:
            for c in cells(r):
                a=c.find("a",href=True); d=txt(c)
                if d: days.append({"day":num(d),"url":(BASE+a["href"].lstrip("./")) if a else None})
        if days: months.append({"month":m.replace("Novemeber","November"),"days":days})
    return {"months":months,"note":"League calendar of day numbers; days only become links to box scores once games are played."}
def parse_list_page(rel, must):
    s=soup(rel); t=find_table(s,*must) if s else None
    return table_records(t,must) if t else []
def parse_free_agents():
    recs=parse_list_page("fa/fa-pos.htm",["Name","Pos","Pot"])
    for r in recs: r["height_in"]=height_in(r.get("height"))
    return recs
def parse_draft():
    el=parse_list_page("draft/draftplayers-pos.htm",["Name","Pos","Pot"])
    for r in el: r["height_in"]=height_in(r.get("height"))
    s=soup("draftorder.htm"); order=[]
    t=find_table(s,"#","Team")
    if t:
        for r in t.find_all("tr")[2:]:
            v=[txt(c) for c in cells(r)]
            if len(v)>=5:
                if v[0]: order.append({"round":1,"pick":num(v[0]),"team":v[1]})
                if v[3]: order.append({"round":2,"pick":num(v[3]),"team":v[4]})
    order.sort(key=lambda x:(x["round"],x["pick"]))
    p1=parse_list_page("past1picks.htm",["Season","Team","Player"])
    return {"eligible_players":el,"draft_order":order,"past_number_one_picks":p1}
def parse_transactions():
    recs=parse_list_page("transactions.htm",["Season","Day","Team","Action"])
    for r in recs:
        m=re.match(r"Draft (\w+) (.+?) with pick #(\d+) of round (\d+)",r.get("action") or "")
        if m: r.update({"type":"draft","player_pos":m[1],"player_name":m[2],"pick":int(m[3]),"round":int(m[4])})
        else:
            a=(r.get("action") or "").split()[0].lower() if r.get("action") else None; r["type"]=a
    return recs
def parse_leaders():
    s=soup("leagueleaders.htm","lxml"); out={}  # lxml copes with the page's malformed <tr><u><b><td> markup
    for t in s.find_all("table"):
        rows=t.find_all("tr",recursive=False) or t.find_all("tr")
        if len(rows)<2: continue
        i,hs=header_index(rows,["#","Player","Pos","Team"])
        if i is None or i==0: continue
        cat=txt(rows[0]); stat=hs[-1]
        recs=[]
        for r in rows[i+1:]:
            v=[txt(c) for c in cells(r)]
            if len(v)>=5 and v[1]:
                a=r.find("a",href=lambda h:h and "player" in h); b=r.find("a",href=lambda h:h and "roster" in h)
                recs.append({"rank":num(v[0]),"player":v[1],"player_id":pid(a["href"]) if a else None,"pos":v[2],"team":v[3],"team_id":tid(b["href"]) if b else None,"value":num(v[4])})
        out[cat]={"stat":stat,"leaders":recs}
    # also records + awards pages
    rec={}
    for rel in ("playergmrecords.htm","playerssnrecords.htm","playercareerrecords.htm","teamssnrecords.htm"):
        s=soup(rel); t=find_table(s,"Record") if s else None
        if t:
            rows=t.find_all("tr"); hs=[txt(c) for c in cells(rows[0])]
            rec[rel[:-4]]=[{"category":txt(cells(r)[0]).rstrip(":"),**{slug(h):num(txt(c)) for h,c in zip(hs[1:],cells(r)[1:])}} for r in rows[1:]]
    aw={}
    s=soup("wkly-mnthly.htm")
    for t in leaf_tables(s):
        rows=t.find_all("tr")
        if len(rows)>=2 and txt(rows[0]).endswith(":"):
            hs=[txt(c).rstrip(":").lower() for c in cells(rows[1])]
            aw[txt(rows[0]).rstrip(":")]=[dict(zip(hs,[txt(c) for c in cells(r)])) for r in rows[2:] if any(txt(c) for c in cells(r))]
    s=soup("allstarweekend.htm")
    for t in leaf_tables(s) if s else []:
        rows=t.find_all("tr")
        if len(rows)>=2 and txt(rows[0]).endswith(":"):
            hs=[txt(c).rstrip(":").lower() for c in cells(rows[1])]
            aw[txt(rows[0]).rstrip(":")]=[dict(zip(hs,[txt(c) for c in cells(r)])) for r in rows[2:] if any(txt(c) for c in cells(r))]
    champs=parse_list_page("pastchamps.htm",["Season","Championship"])
    hof=parse_list_page("hof/all.htm",["Player","Pos","Retired"])
    return {"league_leaders":out,"records":rec,"awards":aw,"past_champions":champs,"hall_of_fame":hof}
def parse_team_stats():
    out={}
    for f in sorted(glob.glob(os.path.join(RAW,"tmstats","**","*.htm"),recursive=True)):
        rel=os.path.relpath(f,RAW); s=soup(rel); t=find_table(s,"Team")
        if t: out[rel]=table_records(t,["Team"])
    return out

def run(log=print):
    t0=time.time(); OUT=HERE
    teams=parse_team_index(); sn=short_names(teams)
    for t in teams.values():
        t["roster_url"]=f"{BASE}rosters/roster{t['team_id']}.htm"
        t["history_url"]=f"{BASE}rosters/roster{t['team_id']}hist.htm"; t["schedule_url"]=f"{BASE}rosters/roster{t['team_id']}sched.htm"
        t.update(parse_roster(t) or {}); t["history"]=parse_team_history(t["team_id"])
    ts=parse_team_stats()
    for rel,recs in ts.items():
        for r in recs:
            r.setdefault("team_id",sn.get(r.get("team")))
    tsd={r["team_id"]:{k:v for k,v in r.items() if k not in("team","team_id")} for r in ts.get(os.path.join("tmstats","offense","team.htm"),[]) if r.get("team_id")}
    for t in teams.values(): t["team_stats"]=tsd.get(t["team_id"])
    players=[]
    for f in sorted(glob.glob(os.path.join(RAW,"players","player*.htm")),key=lambda x:int(re.search(r"(\d+)",os.path.basename(x))[1])):
        if re.search(r"player\d+\.htm$",f):
            try: players.append(parse_player(f))
            except Exception as e: log(f"player parse error {f}: {e}")
    on_roster={p["player_id"]:t["team_id"] for t in teams.values() for p in t.get("players",[])}
    for p in players:
        if p["team_id"] is None and p["player_id"] in on_roster: p["team_id"]=on_roster[p["player_id"]]
        if p["team_id"]: p["team"]=teams[p["team_id"]]["name"]
    sched={"league":parse_league_schedule(),"teams":{t["team_id"]:{"team":t["name"],**(parse_team_schedule(t["team_id"]) or {})} for t in teams.values()}}
    cap=[]
    t=find_table(soup("salaryneeds.htm"),"Team","Cap Room")
    for r in table_records(t,["Team","Cap Room"]) if t else []:
        tm=next((x for x in teams.values() if x["name"]==r["team"]),{})
        cap.append({"team":r["team"],"team_id":tm.get("team_id"),"cap_room":r.get("cap_room"),"team_salary":tm.get("team_salary"),
                    "committed_by_year":[sum((p["salary"].get(f"year_{i}") or 0) for p in tm.get("players",[])) for i in range(1,8)]})
    inj={"league_ir":parse_list_page("ir.htm",["Name","Team","Injury"]),"by_team":{t["team_id"]:t.get("injuries",[]) for t in teams.values() if t.get("injuries")}}
    files={"teams.json":{"teams":list(teams.values())},"players.json":{"players":players},"standings.json":parse_standings(teams),
           "schedule.json":sched,"freeagents.json":{"free_agents":parse_free_agents()},"draft.json":parse_draft(),"injuries.json":inj,
           "caproom.json":{"teams":cap},"transactions.json":{"transactions":parse_transactions()},"leaders.json":parse_leaders(),
           "teamstats.json":{"pages":ts}}
    meta=json.load(open(os.path.join(HERE,"crawl_meta.json"))) if os.path.exists(os.path.join(HERE,"crawl_meta.json")) else {}
    gen={"source":BASE,"crawled_at":meta.get("crawled_at"),"parsed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())}
    for fn,data in files.items():
        data={"_meta":gen,**data}
        json.dump(data,open(os.path.join(OUT,fn),"w"),indent=1,ensure_ascii=False)
    log(f"parse done in {time.time()-t0:.1f}s")
    return files
if __name__=="__main__": run()
