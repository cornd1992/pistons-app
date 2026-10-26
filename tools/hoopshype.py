"""Build simba-data/manual/hoopshype_2005_06.json from a saved HoopsHype 2005-06 salaries page.
Source: https://hoopshype.com/salaries/players/2005-2006/ (live site returns 402 to scripts; fetched via web.archive.org).
Run: python3 tools/hoopshype.py [path-to-html]"""
import re,html,json,sys,unicodedata,os
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src=sys.argv[1] if len(sys.argv)>1 else f"{R}/simba-data/manual/hoopshype_2005_06_source.htm"
ALIAS={"Ron Artest":"Metta World Peace","Predrag Drobnjak":None,"Ibrahim Kutluay":"Ibo Kutluay","D.J. Mbenga":"Didier Ilunga-Mbenga",
 "Slava Medvedenko":"Stanislav Medvedenko","Sergei Monia":"Sergey Monya","Nene Hilario":"Nenê","Rasho Nesterovic":"Radoslav Nesterovic",
 "Sasha Pavlovic":"Aleksandar Pavlovic","J.R. Smith":"JR Smith","Peja Stojakovic":"Predrag Stojakovic","Michael Sweetney":"Mike Sweetney",
 "Jake Tsakalidis":"Iakovos Tsakalidis","Hedo Turkoglu":"Hidayet Turkoglu","Lou Williams":"Louis Williams","Mo Williams":"Maurice Williams"}
def k(n):
    n=unicodedata.normalize('NFKD',n).encode('ascii','ignore').decode().lower();n=re.sub(r'\b(jr|sr|ii|iii|iv)\.?$','',n.strip());return re.sub(r'[^a-z]','',n)
t=open(src,errors='ignore').read();rows=[]
for r in re.findall(r'<tr.*?</tr>',t,re.S):
    c=[re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>','',x))).strip() for x in re.findall(r'<td.*?</td>',r,re.S)]
    if len(c)>=3 and c[2].startswith('$'): rows.append((c[1],int(re.sub(r'[^0-9]','',c[2]))))
hh={}
for n,s in rows: hh.setdefault(k(n),[]).append((n,s))
P=json.load(open(f"{R}/simba-data/players.json"));P=P if isinstance(P,list) else P.get('players',list(P.values()))
players,un={},[]
for p in P:
    a=ALIAS.get(p['name'],p['name']);m=hh.get(k(a)) if a else None
    if m: players[str(p['player_id'])]={'name':p['name'],'hoopshype_name':m[0][0],'salary_2005_06':sum(s for _,s in m)}
    else: un.append({'player_id':p['player_id'],'name':p['name']})
used={v['hoopshype_name'] for v in players.values()}
out={'source':'HoopsHype 2005-06 player salaries, https://hoopshype.com/salaries/players/2005-2006/ (web.archive.org snapshot; live site returns 402)',
 'hoopshype_rows':len(rows),'league_players':len(P),'matched':len(players),'players':players,'unmatched_league_players':un,
 'unmatched_hoopshype':[n for n,_ in rows if n not in used]}
json.dump(out,open(f"{R}/simba-data/manual/hoopshype_2005_06.json",'w'),indent=1)
print(f"{len(rows)} HoopsHype rows, matched {len(players)}/{len(P)} league players; unmatched HH: {out['unmatched_hoopshype']}")
