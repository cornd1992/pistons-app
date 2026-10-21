#!/usr/bin/env python3
"""Build a FAKE 20-game season preview into preview/ (never touches data/).
Seeded; production driven by current rosters + logged creation-draft picks and their letter grades.
Run: python tools/sim_preview.py   (from any cwd)"""
import json, os, random, shutil, copy, re, math
APP=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(APP,"preview")
rng=random.Random(2005)
G={'A+':100,'A':95,'A-':90,'B+':85,'B':80,'B-':75,'C+':70,'C':65,'C-':60,'D+':55,'D':50,'D-':45,'F+':40,'F':35,'F-':30}
B=json.load(open(os.path.join(APP,"data","bundle.json")))
B=copy.deepcopy(B)
pid={p["player_id"]:p for p in B["players"]}
teams=B["teams"]; tid={t["team_id"]:t for t in teams}; tname={t["name"]:t for t in teams}
def gr(p,k):
    r=p.get("ratings") or {}
    a=p.get("attributes") or {}
    m={"in":"inside_scoring","out":"outside_scoring","hn":"handling","df":"defense","reb":"rebounding"}
    return G.get(r.get(k) or a.get(m[k]) or "C",65)
# rosters: site roster + logged creation-draft picks
ros={t["team_id"]:[pl["player_id"] for pl in t.get("players",[])] for t in teams}
for k in B["facts"]["creation_draft"]["picks"]:
    t=tname.get(k["team"]); i=k.get("player_id")
    if t and i in pid and i not in ros[t["team_id"]]: ros[t["team_id"]].append(i)
def rating(i):
    p=pid[i]; pos=p.get("pos","SF")
    w={"PG":(1,1.3,1.5,1,.6),"SG":(1.1,1.4,1.1,1,.6),"SF":(1.2,1.1,.9,1,.9),"PF":(1.3,.7,.6,1,1.3),"C":(1.3,.5,.5,1.1,1.5)}[pos]
    v=[gr(p,k) for k in ("in","out","hn","df","reb")]
    return sum(a*b for a,b in zip(w,v))/sum(w)
R={i:rating(i) for t in ros for i in ros[t]}
def rotation(t):
    ids=sorted(ros[t],key=lambda i:-R[i])[:12]
    base=[34,33,32,31,29,24,20,16,12,6,3,0][:len(ids)]
    tot=sum(base) or 1; return [(i,min(40,m*240/tot)) for i,m in zip(ids,base)]
strength={t:sum(R[i]*m for i,m in rotation(t))/240 for t in ros}
# schedule: circulant 20-regular graph on 29 teams (each team plays exactly 20)
order=[t["team_id"] for t in teams]; rng.shuffle(order); n=len(order)
pairs=[(order[a],order[(a+d)%n]) for a in range(n) for d in range(1,11)]
rng.shuffle(pairs)
days=[]; left=pairs[:]
while left:
    used=set(); today=[]; rest=[]
    for a,b in left:
        if a in used or b in used or len(today)>=11: rest.append((a,b))
        else: today.append((a,b)); used|={a,b}
    days.append(today); left=rest
acc={}; teamacc={t:dict(g=0,w=0,l=0,hw=0,hl=0,pf=0,pa=0,reb=0,ast=0,stl=0,blk=0,tov=0,fgm=0,fga=0,res=[]) for t in ros}
sched={t:[] for t in ros}
def zero(): return dict(g=0,min=0,pts=0,reb=0,ast=0,stl=0,blk=0,tov=0,fgm=0,fga=0,ftm=0,fta=0,tpm=0,tpa=0,hi=dict(points=0,rebounds=0,assists=0,steals=0,blocks=0))
def play(t,opp_def):
    rot=rotation(t); lines=[]
    for i,mins in rot:
        if mins<=0: continue
        p=pid[i]; mins=max(0,mins*rng.uniform(.85,1.12)); f=mins/36
        ins,out,hn,df,rb=(gr(p,k) for k in ("in","out","hn","df","reb"))
        pos=p.get("pos","SF"); big=pos in("PF","C")
        usage=((ins+out)/2-45)/40
        fga=max(0,round(rng.gauss(f*(6+10*usage),1.8)))
        tpr=max(0,(out-55)/100)*(0.3 if big else 1.4)
        tpa=min(fga,max(0,round(fga*tpr*rng.uniform(.7,1.3))))
        two=fga-tpa
        p2=min(.62,max(.36,.38+(ins-60)/300+opp_def+rng.gauss(0,.05)))
        p3=min(.5,max(.2,.27+(out-60)/250+rng.gauss(0,.08)))
        fgm2=sum(rng.random()<p2 for _ in range(two)); tpm=sum(rng.random()<p3 for _ in range(tpa))
        fta=max(0,round(rng.gauss(f*(1.5+5*max(0,(ins-60)/40)),1.2)))
        ftp=.62+ (out-50)/250 if not big else .58+(out-50)/300
        ftm=sum(rng.random()<min(.92,ftp) for _ in range(fta))
        reb=max(0,round(rng.gauss(f*(2+ (rb-50)/50*(7 if big else 4)),1.5)))
        ast=max(0,round(rng.gauss(f*(0.8+(hn-50)/50*(6 if pos=="PG" else 2.5)),1.2)))
        stl=max(0,round(rng.gauss(f*(0.5+(df-50)/50*0.9),.6)))
        blk=max(0,round(rng.gauss(f*((0.2+(df-50)/50*1.8) if big else 0.15+(df-50)/50*.4),.6)))
        tov=max(0,round(rng.gauss(f*(1+(usage*1.2)+(0.8 if pos=="PG" else 0)),.8)))
        lines.append(dict(id=i,min=mins,pts=2*fgm2+3*tpm+ftm,reb=reb,ast=ast,stl=stl,blk=blk,tov=tov,fgm=fgm2+tpm,fga=fga,ftm=ftm,fta=fta,tpm=tpm,tpa=tpa))
    return lines
def bench(L,st):
    # minutes not covered by the (still-forming) roster go to unnamed reserves; counted in team totals only
    m=max(0,240-sum(x["min"] for x in L)); f=m/48
    return dict(pts=max(0,round(rng.gauss(f*(19+(st-65)*.3),3))),reb=round(f*8.5),ast=round(f*4.5),stl=round(f*1.4),blk=round(f*0.9),tov=round(f*2.8),fga=round(f*17),fgm=round(f*7.6))
day_no=0; sday=[]
for d,games in enumerate(days):
    day=d+1; sday.append((day,games))
    for home,away in games:
        while True:
            dh=-(strength[home]-65)/400; da=-(strength[away]-65)/400
            Lh=play(home,da); La=play(away,dh)
            Bh=bench(Lh,strength[home]); Ba=bench(La,strength[away])
            ph=sum(x["pts"] for x in Lh)+Bh["pts"]+round(rng.gauss(2+ (strength[home]-strength[away])*0.6,4))
            pa=sum(x["pts"] for x in La)+Ba["pts"]
            if ph!=pa: break
        bonus=ph-sum(x["pts"] for x in Lh)  # home court / team-play adjustment credited as free throws to starters
        if bonus>0:
            for k in range(bonus): x=Lh[k%min(5,len(Lh))]; x["pts"]+=1; x["ftm"]+=1; x["fta"]+=1
        elif bonus<0:
            for k in range(-bonus):
                x=max(Lh,key=lambda y:y["ftm"])
                if x["ftm"]==0: x=max(Lh,key=lambda y:y["pts"]); x["pts"]-=0
                else: x["pts"]-=1; x["ftm"]-=1
        ph=sum(x["pts"] for x in Lh)+Bh["pts"]
        for t,L,us,them,isH,Bn in((home,Lh,ph,pa,True,Bh),(away,La,pa,ph,False,Ba)):
            A=teamacc[t]; A["g"]+=1; win=us>them
            A["w" if win else "l"]+=1
            if isH: A["hw" if win else "hl"]+=1
            A["pf"]+=us; A["pa"]+=them; A["res"].append(win)
            for k in("reb","ast","stl","blk","tov","fgm","fga"): A[k]+=sum(x[k] for x in L)+Bn[k]
            o=tname_by_id=tid[away if isH else home]["name"]
            sched[t].append(dict(day=day,game=f"{'vs' if isH else '@'} {o} {'W' if win else 'L'} {us}-{them}",has_game=True))
            for x in L:
                a=acc.setdefault(x["id"],zero()); a["g"]+=1
                for k in("min","pts","reb","ast","stl","blk","tov","fgm","fga","ftm","fta","tpm","tpa"): a[k]+=x[k]
                for k,s in(("points","pts"),("rebounds","reb"),("assists","ast"),("steals","stl"),("blocks","blk")): a["hi"][k]=max(a["hi"][k],x[s])
r1=lambda v:round(v,1); r3=lambda a,b:round(a/b,3) if b else 0.0
# write players
for i,a in acc.items():
    p=pid[i]; g=a["g"]; pg=lambda k:r1(a[k]/g)
    p["box"]=dict(gp=float(g),mpg=pg("min"),ppg=pg("pts"),rpg=pg("reb"),apg=pg("ast"),spg=pg("stl"),bpg=pg("blk"),topg=pg("tov"),fgm=pg("fgm"),fga=pg("fga"),ftm=pg("ftm"),fta=pg("fta"),tpm=pg("tpm"),tpa=pg("tpa"),has_shooting=True)
    p["season_averages"]=dict(games=g,mpg=pg("min"),ppg=pg("pts"),rpg=pg("reb"),apg=pg("ast"),spg=pg("stl"),bpg=pg("blk"),topg=pg("tov"),fg_pct=r3(a["fgm"],a["fga"]),ft_pct=r3(a["ftm"],a["fta"]),three_p_pct=r3(a["tpm"],a["tpa"]))
    p["career_highs"]=a["hi"]
    p.setdefault("stats",{})["career"]=dict(games=g,mpg=pg("min"),fg=a["fgm"],fga=a["fga"],fg_pct=r3(a["fgm"],a["fga"]),ft=a["ftm"],fta=a["fta"],ft_pct=r3(a["ftm"],a["fta"]),three_p=a["tpm"],three_pa=a["tpa"],three_p_pct=r3(a["tpm"],a["tpa"]),rpg=pg("reb"),apg=pg("ast"),spg=pg("stl"),bpg=pg("blk"),topg=pg("tov"),dq=0,ppg=pg("pts"))
for t in teams:
    for pl in t.get("players",[]):
        p=pid.get(pl["player_id"],{}); s=p.get("season_averages")
        if s and s.get("games"): pl["season_stats"]=dict(games=s["games"],mpg=s["mpg"],ppg=s["ppg"],rpg=s["rpg"],apg=s["apg"],spg=s["spg"],bpg=s["bpg"],tpg=s["topg"],fg_pct=s["fg_pct"],ft_pct=s["ft_pct"],three_p_pct=s["three_p_pct"])
    A=teamacc[t["team_id"]]; g=A["g"]
    t["record"]={"w":A["w"],"l":A["l"]}
    t["yearly_stats"]=dict(points_per_game=r1(A["pf"]/g),steals_per_game=r1(A["stl"]/g),points_allowed_per_game=r1(A["pa"]/g),rebounds_per_game=r1(A["reb"]/g),assists_per_game=r1(A["ast"]/g),blocks_per_game=r1(A["blk"]/g),turnovers_per_game=r1(A["tov"]/g),field_goal_pct=r3(A["fgm"],A["fga"]))
    t["team_stats"]=dict(ppg=r1(A["pf"]/g),rpg=r1(A["reb"]/g),apg=r1(A["ast"]/g),spg=r1(A["stl"]/g),bpg=r1(A["blk"]/g),topg=r1(A["tov"]/g))
for k,rows in B["teamstats"].items():
    stat=re.search(r"/(\w+)\.htm",k).group(1)
    for r in rows: r.update(tid[r["team_id"]]["team_stats"])
    if stat!="team": rows.sort(key=lambda r:-r.get(stat,0) if stat!="topg" else r.get(stat,0))
def srow(t,lead):
    A=teamacc[t["team_id"]]; l10=A["res"][-10:]
    return dict(w=A["w"],l=A["l"],win_pct=r3(A["w"],A["g"]),last10=f"{sum(l10)}-{len(l10)-sum(l10)}",home=f"{A['hw']}-{A['hl']}",gb=((lead[0]-A["w"])+(A["l"]-lead[1]))/2)
for grp in B["standings"]["divisional"]+B["standings"]["playoff_seeding"]:
    for r in grp["teams"]: r["_A"]=teamacc[r["team_id"]]
    grp["teams"].sort(key=lambda r:(-r["_A"]["w"]/r["_A"]["g"],-r["_A"]["w"]))
    lead=(grp["teams"][0]["_A"]["w"],grp["teams"][0]["_A"]["l"])
    for r in grp["teams"]: del r["_A"]; r.update(srow(tid[r["team_id"]],lead))
for r in B["standings"].get("historical_team_performance",[]):
    A=teamacc.get(r.get("team_id"))
    if A: r.update(wins=A["w"],losses=A["l"],win_pct=r3(A["w"],A["g"]))
# leaders
cat={"MPG":"mpg","PPG":"ppg","RPG":"rpg","APG":"apg","BPG":"bpg","SPG":"spg","FGAPG":"fga","FTAPG":"fta","3PAPG":"tpa","TOPG":"topg"}
pl=[p for p in B["players"] if p.get("box",{}).get("gp")]
team_of={i:t for t in ros for i in ros[t]}
for name,c in B["leaders"]["league_leaders"].items():
    s=c["stat"]
    if s in cat: key=lambda p,k=cat[s]:p["box"][k]; pool=pl
    elif s=="FG %": key=lambda p:p["season_averages"]["fg_pct"]; pool=[p for p in pl if p["box"]["fga"]>=5]
    elif s=="FT %": key=lambda p:p["season_averages"]["ft_pct"]; pool=[p for p in pl if p["box"]["fta"]>=2]
    elif s=="3P %": key=lambda p:p["season_averages"]["three_p_pct"]; pool=[p for p in pl if p["box"]["tpa"]>=1.5]
    elif s=="FPG": key=lambda p:round(1+p["box"]["mpg"]/16+((p["player_id"]*7)%10)/10,1); pool=pl
    else: continue
    top=sorted(pool,key=key,reverse=True)[:10]
    c["leaders"]=[dict(rank=k+1,player=p["name"],player_id=p["player_id"],pos=p["pos"],team=tid[team_of[p["player_id"]]]["name"],team_id=team_of[p["player_id"]],value=key(p)) for k,p in enumerate(top)]
# schedule
my=B["meta"]["my_team_id"]
B["schedule"]["my_team"]["regular_season"]=[next((g for g in sched[my] if g["day"]==d),{"day":d,"game":"No Game","has_game":False}) for d in range(1,len(days)+1)]
B["schedule"]["my_team"]["games_scheduled"]=len(sched[my])
B["meta"]["simulated"]=True
B["meta"]["sim_note"]="SIMULATED DATA — preview. Fake 20-game season, seed 2005."
os.makedirs(os.path.join(OUT,"data"),exist_ok=True)
json.dump(B,open(os.path.join(OUT,"data","bundle.json"),"w"),separators=(",",":"))
v=json.load(open(os.path.join(APP,"data","version.json"))); v["version"]="SIM-"+v["version"]
json.dump(v,open(os.path.join(OUT,"data","version.json"),"w"))
for f in("app.js","styles.css","manifest.webmanifest"): shutil.copy(os.path.join(APP,f),os.path.join(OUT,f))
shutil.copytree(os.path.join(APP,"icons"),os.path.join(OUT,"icons"),dirs_exist_ok=True)
h=open(os.path.join(APP,"index.html")).read()
h=re.sub(r"<script>if\('serviceWorker'.*?</script>","",h,flags=re.S)
h=h.replace("<title>","<title>[SIMULATED] ",1)
banner='<div id="simbanner" style="position:sticky;top:0;z-index:9999;background:#b00020;color:#fff;text-align:center;font:700 13px/1.3 system-ui,sans-serif;padding:6px 8px">⚠️ SIMULATED DATA — preview (fake 20-game season, not real league results)</div>'
h=re.sub(r"(<body[^>]*>)",r"\1"+banner,h,count=1)
open(os.path.join(OUT,"index.html"),"w").write(h)
me=teamacc[my]; print("DET",me["w"],"-",me["l"],"PF",r1(me["pf"]/20),"PA",r1(me["pa"]/20))
for i in ros[my]:
    if i in acc: print(pid[i]["name"],pid[i]["box"])
print("days",len(days),"games/team",{t:teamacc[t]["g"] for t in list(ros)[:3]})
