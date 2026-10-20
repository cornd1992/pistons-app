'use strict';
/* Pistons Front Office — static SPA. Data: data/bundle.json (built by build.py), data/snapshots/*.json */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>v==null?'—':(v<0?'-':'')+'$'+Math.abs(v).toLocaleString('en-US');
const mm=v=>v==null?'—':Math.abs(v)<10000?money(v):'$'+(v/1e6).toFixed(v%1e6===0?1:2)+'M';
const f1=v=>v==null||isNaN(v)?'—':(+v).toFixed(1);
const pct3=v=>v==null?'—':(+v).toFixed(3).replace(/^0/,'');
const ord=n=>n+(['th','st','nd','rd'][(n%100-20)%10]||['th','st','nd','rd'][n%100]||'th');
const S={tab:'team',draft:{sort:'fit',dir:-1,pos:'ALL',q:'',onlyNear:false},player:null,cmp:null,lb:'ppg'};
let B=null, SNAPS=[];

/* ---------- ratings & scoring ---------- */
const GRADE={'A+':100,'A':95,'A-':90,'B+':85,'B':80,'B-':75,'C+':70,'C':65,'C-':60,'D+':55,'D':50,'D-':45,'F+':40,'F':35,'F-':30};
const RK=['in','out','hn','df','reb','pot'];
const RNAME={in:'Inside',out:'Outside',hn:'Handling',df:'Defense',reb:'Rebound',pot:'Potential'};
const ATTR2RK={inside_scoring:'in',outside_scoring:'out',handling:'hn',defense:'df',rebounding:'reb',potential:'pot'};
const POS=['PG','SG','SF','PF','C'];
// Position weights for current ability (sum 1). Rationale: guards live on handling/outside, bigs on inside/defense/rebounding.
const PW={PG:{in:.15,out:.25,hn:.35,df:.15,reb:.10},SG:{in:.20,out:.35,hn:.20,df:.15,reb:.10},SF:{in:.25,out:.25,hn:.15,df:.20,reb:.15},
          PF:{in:.30,out:.10,hn:.05,df:.25,reb:.30},C:{in:.30,out:.05,hn:.05,df:.30,reb:.30}};
const gv=g=>GRADE[(g||'').trim()]??null;
function ratingsOf(p){ // normalise to {in:'B+',...}
  if(p.ratings) return p.ratings;
  if(p.attributes){const r={};for(const[k,v]of Object.entries(p.attributes)) if(ATTR2RK[k]) r[ATTR2RK[k]]=v;return r;}
  const r={};RK.forEach(k=>{if(p[k]!=null) r[k]=p[k];});return r;
}
function overall(r,pos){const w=PW[pos]||PW.SF;let s=0;for(const k in w) s+=w[k]*(gv(r[k])??50);return s;}
// Display-only 2K-style OVR: rank of the raw overall among ALL league players, mapped piecewise-linearly onto
// 2K-like anchors (rank 1 → 96, 10 → 88, 30 → 84, median → 73, 85th pct → 63, last → 50). Value/Fit/Now keep the raw overall.
function ovr2k(raw){if(raw==null)return null;if(!B.ovrSorted)B.ovrSorted=B.players.map(p=>overall(ratingsOf(p),p.pos)).sort((a,b)=>b-a);
  const s=B.ovrSorted,N=s.length;let lo=0,hi=N;while(lo<hi){const m=(lo+hi)>>1;if(s[m]>raw+1e-9)lo=m+1;else hi=m;}const rank=lo+1;
  const A=[[1,96],[10,88],[30,84],[Math.round(N/2),73],[Math.round(N*0.85),63],[N,50]];
  for(let i=1;i<A.length;i++)if(rank<=A[i][0]){const [r0,v0]=A[i-1],[r1,v1]=A[i];return Math.round(v0+(v1-v0)*(rank-r0)/Math.max(1,r1-r0));}return 50;}
const OVR=(r,pos)=>ovr2k(overall(r,pos));
function value(r,pos,age){const ov=overall(r,pos);return {ov,val:ov,ageAdj:0};} // creation-draft rule: Potential ignored; age enters only via real-career data (see draftScores)
const scaleTo=(arr)=>{const s=[...arr].filter(v=>v!=null).sort((a,b)=>a-b);if(!s.length)return()=>null;const q=p=>s[Math.min(s.length-1,Math.floor(p*(s.length-1)))],lo=q(0.10),hi=q(0.98);return v=>v==null?null:Math.round(Math.max(0,Math.min(100,(v-lo)/((hi-lo)||1)*100))*10)/10;}; // 10th pct → 0, 98th pct → 100
const pctRank=(arr)=>{const s=[...arr].filter(v=>v!=null).sort((a,b)=>a-b);return v=>{if(v==null||!s.length)return null;let lo=0,hi=s.length;while(lo<hi){const m=(lo+hi)>>1;if(s[m]<v)lo=m+1;else hi=m;}let eq=lo;while(eq<s.length&&s[eq]===v)eq++;return Math.round(((lo+eq)/2)/s.length*1000)/10;};};
function realOf(id){const r=((B.real||{}).players||{})[id];return r&&r.bbref_id?r:null;}
// Real production score (0-100 scale before ranking): 0.7 × near-term Win Shares + 0.3 × PER, both from 2005-06..2009-10.
function realRaw(x){if(!x)return null;const per=x.per_2005_10;return 0.7*(x.near_ws||0)*10+0.3*(per==null?0:Math.max(0,per-5)*4);}
function myRoster(){return (B.myTeam.players||[]);}
function needs(){ // positional need: 1.0 if nobody at the position, 0.5 if one, 0.2 if two or more
  const c={};POS.forEach(p=>c[p]=0);myRoster().forEach(p=>{if(c[p.pos]!=null)c[p.pos]++;});
  const n={};POS.forEach(p=>n[p]=c[p]===0?1:c[p]===1?0.5:0.2);return {count:c,need:n};
}
function deficits(){ // team skill gaps: 100 - best rostered rating per skill (pot excluded)
  const d={};['in','out','hn','df','reb'].forEach(k=>{const best=Math.max(0,...myRoster().map(p=>gv(ratingsOf(p)[k])??0));d[k]=Math.max(5,100-best);});return d;
}
function fit(r,pos,val,N,D){
  const tot=Object.values(D).reduce((a,b)=>a+b,0);let comp=0;for(const k in D) comp+=D[k]*(gv(r[k])??50);comp/=tot;
  return {fit:0.55*val+0.25*(N.need[pos]??0.5)*100+0.10*comp,comp};} // + 0.10 × value-per-real-$ added in prepDraft

/* ---------- boot ---------- */
async function boot(){
  try{B=await (await fetch('data/bundle.json',{cache:'no-cache'})).json();}catch(e){$('#view').innerHTML='<div class="empty"><b>Could not load data</b>Check your connection and reload.</div>';return;}
  B.myTeam=B.teams.find(t=>t.team_id===B.meta.my_team_id);
  B.pById=new Map(B.players.map(p=>[p.player_id,p]));
  B.teamByShort=new Map();B.teams.forEach(t=>{const w=t.name.split(' ');for(let i=1;i<w.length;i++) B.teamByShort.set(w.slice(i).join(' '),t);B.teamByShort.set(t.name,t);});
  const ca=B.meta.crawled_at?new Date(B.meta.crawled_at):null;
  $('#asof').textContent='Data as of '+(ca?ca.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'unknown')+(B.facts&&B.facts._meta&&B.facts._meta.as_of?' · draft facts '+new Date(B.facts._meta.as_of).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'')+' · simba.mygamesonline.org';
  fetch('data/version.json',{cache:'no-cache'}).then(r=>r.json()).then(v=>{const el=document.createElement('div');el.className='ver';el.textContent='Build '+v.version+' · app '+v.app;$('#asof').appendChild(el);}).catch(()=>{});
  addPendingPicks();
  prepDraft();
  try{const idx=await (await fetch('data/snapshots/index.json',{cache:'no-cache'})).json();
    SNAPS=(await Promise.all(idx.snapshots.map(k=>fetch('data/snapshots/'+k+'.json').then(r=>r.json()).catch(()=>null)))).filter(Boolean);}catch(e){SNAPS=[];}
  addEventListener('hashchange',route);route();
}
// Creation-draft picks the Pistons have made (league_facts.json) that the stats site hasn't moved onto the roster yet.
// They join the roster at their real 2005-06 salary (what the site assigns drafted players), so payroll/cap room/needs update now.
function addPendingPicks(){
  const t=B.myTeam,have=new Set((t.players||[]).map(p=>p.player_id));B.pending=[];
  ((B.facts||{}).creation_draft?.picks||[]).filter(k=>k.team===t.name&&k.player_id!=null&&!have.has(k.player_id)).forEach(k=>{
    const p=B.pById.get(k.player_id);if(!p)return;const rc=realOf(p.player_id),site=((p.contract||{}).salary_by_year||[])[0]||0;
    const hist=(rc&&rc.salary_history||[]).filter(([s])=>s>='2005-06').map(x=>x[2]),yrs=hist.length?hist:[rc&&rc.salary_2005_06||site];
    const sal=yrs[0]||0,salary=Object.fromEntries([1,2,3,4,5,6,7].map(y=>['year_'+y,yrs[y-1]||0]));
    const e={player_id:p.player_id,name:p.name,pos:p.pos,age:p.age,height:p.height,height_in:p.height_in,weight:p.weight,ratings:ratingsOf(p),salary,salary_total:yrs.reduce((a,b)=>a+b,0),
      season_stats:{},pending:{round:k.round,pick:k.pick,overall:k.overall,siteSal:site,realSal:sal,salSrc:rc&&rc.salary_2005_06?'real':'site'}};
    (t.players=t.players||[]).push(e);B.pending.push(e);
    if(t.team_salary!=null)t.team_salary+=sal;if(t.cap_room!=null)t.cap_room-=sal;
    const cr=(B.caproom||[]).find(x=>x.team_id===t.team_id);if(cr&&cr!==t){if(cr.team_salary!=null)cr.team_salary+=sal;if(cr.cap_room!=null)cr.cap_room-=sal;}});
}
function prepDraft(){
  const N=needs(),D=deficits(),nT=B.teams.length,F=B.facts,CD=F&&F.creation_draft;
  let made,order,nextOverall,source='stats site',onClock=null;
  const fc=CD&&CD.rounds;
  if(fc&&fc.length){ // hand-kept draft facts run ahead of the stats site
    source='league draft log';
    made=(CD.picks||[]).map(p=>({...p,player_name:p.player,player_pos:(B.pById.get(p.player_id)||{}).pos||''}));
    order=[];fc.forEach(d=>d.order.forEach(o=>order.push({round:d.round,pick:o.slot,team:o.team,gm:o.gm,overall:(d.round-1)*nT+o.slot})));
    const maxR=Math.max(...fc.map(d=>d.round)),sn=CD.order;
    if(sn) for(let r=maxR+1;r<=maxR+2;r++) (r%2?sn.odd_rounds:sn.even_rounds).forEach((t,i)=>order.push({round:r,pick:i+1,team:t,gm:(F.gms||{})[t],overall:(r-1)*nT+i+1,projected:true}));
    const cur=fc.find(d=>!d.complete);
    onClock=cur&&cur.on_the_clock?{...cur.on_the_clock,round:cur.round}:null;
    nextOverall=cur&&cur.on_the_clock?cur.on_the_clock.overall:(maxR*nT+1);
  } else {
    made=B.transactions.filter(t=>t.type==='draft').map(t=>({...t,overall:(t.round-1)*nT+t.pick}));
    order=B.draft.draft_order.map(o=>({...o,overall:(o.round-1)*nT+o.pick}));
    nextOverall=made.length+1;
  }
  const madeBy=new Map(made.map(m=>[m.overall,m]));
  const taken=new Map(made.filter(m=>m.player_id!=null).map(m=>[m.player_id,m]));
  const mine=order.filter(o=>o.team===B.myTeam.name);
  const myUpcoming=mine.filter(o=>o.overall>=nextOverall&&!madeBy.has(o.overall));
  const myNext=myUpcoming[0]||null;
  // ---- creation-draft scoring (Potential ignored; see "How the scores work") ----
  const base=B.draft.eligible_players.map(p=>{const r=ratingsOf(p),ov=overall(r,p.pos),rc=realOf(p.player_id),pl=B.pById.get(p.player_id)||{};
    const sal1=((pl.contract||{}).salary_by_year||[])[0]??null,realSal=rc&&rc.salary_2005_06||null;
    return {p,r,ov,rc,raw:realRaw(rc),sal1,realSal};});
  const pNow=scaleTo(base.map(x=>x.ov)),pReal=scaleTo(base.map(x=>x.raw));
  base.forEach(x=>{x.now=pNow(x.ov);x.real=x.rc?pReal(x.raw):null;x.val=x.real==null?x.now:0.5*x.now+0.5*x.real;
    const sal=x.realSal||x.sal1||0;x.salSrc=x.realSal?'real':x.sal1?'site':'none';x.vpd=x.real==null||!sal?null:x.real/Math.max(0.5,sal/1e6);});
  const pVpd=pctRank(base.map(x=>x.vpd)),compRaw=base.map(x=>fit(x.r,x.p.pos,0,N,D).comp),pComp=pctRank(compRaw);
  const board=base.map((x,i)=>{const p=x.p,need=(N.need[p.pos]??0.5)*100,comp=pComp(compRaw[i]),vd=x.vpd==null?50:pVpd(x.vpd);
    const fitv=0.55*x.val+0.25*need+0.10*comp+0.10*vd;
    const after=payrollOf(B.myTeam)+(x.realSal||x.sal1||0),warns=crossWarnings(payrollOf(B.myTeam),after);
    return {...p,r:x.r,ov:x.ov,now:x.now,real:x.real,rc:x.rc,noData:!x.rc,val:x.val,ageAdj:0,fit:fitv,comp,vd,need,
      taken:taken.get(p.player_id)||null,sal1:x.sal1,realSal:x.realSal,salSrc:x.salSrc,after,afterStatus:capStatus(after).k,warns};});
  const avail=board.filter(p=>!p.taken);
  [...avail].sort((a,b)=>b.val-a.val).forEach((p,i)=>p.valRank=i+1);
  [...avail].sort((a,b)=>b.fit-a.fit).forEach((p,i)=>p.fitRank=i+1);
  const picksBefore=myNext?order.filter(o=>o.overall>=nextOverall&&o.overall<myNext.overall&&!madeBy.has(o.overall)).length:0; // picks other teams make before ours
  avail.forEach(p=>p.likelyGone=p.valRank<=picksBefore);
  B.D={N,D,made,madeBy,order,nextOverall,mine,myNext,myUpcoming,board,avail,picksBefore,source,onClock,takenCount:taken.size};
}
function route(ev,keep){
  const h=(location.hash||'#team').slice(1).split('/');S.tab=h[0]||'team';
  document.querySelectorAll('.tabbar a').forEach(a=>a.classList.toggle('on',a.dataset.tab===S.tab));
  const T={team:['My Team',vTeam],draft:['Draft',vDraft],league:['League',vLeague],analytics:['Analytics',vAnalytics],players:['Players',vPlayers],rules:['League Rules',vRules],trade:['Trade Checker',vTrade]};
  const [title,fn]=T[S.tab]||T.team;$('#pageTitle').textContent=title;
  if(S.tab==='players'&&h[1]) {$('#view').innerHTML=vPlayer(+h[1]);}
  else if(S.tab==='analytics'){S.anp=h[1]?+h[1]:null;$('#view').innerHTML=fn();}
  else $('#view').innerHTML=fn();
  bind();if(!keep&&!(S.tab==='analytics'&&S.anp))scrollTo(0,0);
  if(S.tab==='rules'&&h[1]&&!keep){const id={cap:'capaprons',tax:'taxcalc'}[h[1]]||h[1];const el=document.getElementById(id);if(el)el.scrollIntoView();scrollBy(0,-90);}
}

/* ---------- helpers ---------- */
function gradeCell(g){const v=gv(g);if(v==null)return '<span class="g">—</span>';const h=Math.round((v-30)/70*120);return `<span class="g" style="background:hsl(${h} 70% 45% / .22);color:hsl(${h} 70% 35%)">${esc(g)}</span>`;}
function table(cols,rows,{id='',me=null,sortKey=null,sortDir=-1}={}){
  // Fit-to-width table: columns carry a hide priority (data-p, higher hides first; 0 = never) that fitTables() uses on narrow screens;
  // hidden cells stay in the DOM and a tap on the row shows them in a detail line beneath it.
  const pr=(c,i)=>c.k===sortKey?0:c.p!=null?c.p:(i===0?0:1); // the sorted column always stays visible
  const w=c=>c.w?` style="width:${c.w}"`:'';
  return `<div class="scroll"><table class="tbl" ${id?`data-id="${id}"`:''}><thead><tr>${cols.map((c,i)=>`<th class="${c.n?'n':''}" data-k="${c.k}" data-p="${pr(c,i)}"${w(c)}>${esc(c.l)}${sortKey===c.k?(sortDir>0?' ▲':' ▼'):''}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r=>`<tr class="${me&&me(r)?'me':''}" ${r._href?`data-href="${r._href}"`:''}${r._team!=null?` data-team="${r._team}"`:''}>${cols.map(c=>`<td class="${c.n?'n':''}" data-l="${esc(c.l)}">${c.f?c.f(r[c.k],r):esc(r[c.k]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function fitTables(root=document){
  const own=(t,sel)=>t.querySelectorAll(`:scope>thead>${sel},:scope>tbody>${sel}`); // never touch tables nested in an expanded row
  root.querySelectorAll('.scroll').forEach(wr=>{const t=wr.querySelector(':scope>table');if(!t)return;
    if(root===document){own(t,'tr.dt').forEach(x=>x.remove());own(t,'tr.open').forEach(x=>x.classList.remove('open'));}
    t.classList.remove('tfix');const ths=[...t.querySelectorAll(':scope>thead>tr>th')];
    const hide=(i,on)=>own(t,`tr>:nth-child(${i+1})`).forEach(c=>c.classList.toggle('hx',on));
    ths.forEach((_,i)=>hide(i,false));
    const order=ths.map((th,i)=>({i,p:+th.dataset.p})).filter(o=>o.p>0).sort((a,b)=>b.p-a.p||b.i-a.i);
    const over=()=>t.offsetWidth>wr.clientWidth+1||wr.clientWidth/(ths.length-n)<64;
    let n=0;while(over()&&n<order.length){hide(order[n].i,true);n++;}
    if(t.dataset.id==='draft'||t.offsetWidth>wr.clientWidth+1)t.classList.add('tfix');
    t.classList.toggle('hashid',n>0);});
}
function toggleDetail(tr){
  const nx=tr.nextElementSibling;if(nx&&nx.classList.contains('dt')){nx.remove();tr.classList.remove('open');return;}
  const tb=tr.parentElement,capx=tr.closest('table').dataset.id==='capx';
  if(capx){tb.querySelectorAll(':scope>tr.dt').forEach(x=>x.remove());tb.querySelectorAll(':scope>tr.open').forEach(x=>x.classList.remove('open'));}
  const t=tr.closest('table'),hid=[...tr.children].filter(c=>c.classList.contains('hx'));
  const vis=[...tr.children].length-hid.length,d=document.createElement('tr');d.className='dt';
  d.innerHTML=`<td colspan="${vis}"><div class="dl">${hid.map(c=>`<span><b>${c.dataset.l}</b> ${c.innerHTML}</span>`).join('')}${tr.dataset.href?`<a href="${tr.dataset.href}">Open →</a>`:''}</div>${capx?`<div class="capx">${capCore(B.teams.find(x=>x.team_id===+tr.dataset.team))}</div>`:''}</td>`;
  tr.after(d);tr.classList.add('open');if(capx){d.classList.add('cxrow');fitTables(d);}
}
// link a player name to his page (#players/<id>); resolves by name when no id is known, plain text if unknown
function pid(name,id){if(id!=null&&B.pById.has(+id))return +id;if(!B.pByName){B.pByName=new Map();B.players.forEach(p=>{const k=String(p.name).toLowerCase();if(!B.pByName.has(k))B.pByName.set(k,p.player_id);});}return B.pByName.get(String(name||'').toLowerCase().trim());}
function plink(name,id){const i=pid(name,id);return i!=null?`<a class="pl" href="#players/${i}">${esc(name)}</a>`:esc(name??'—');}
// Team page roster card (sim data only): name, position, bio table, placeholder portrait, current-season stat bar
// proper-case a scraped string only when it arrives all lower-case (keeps UCLA, DeShawn, etc. as given)
function properCase(v){const s=String(v??'');if(!s||s!==s.toLowerCase()||!/[a-z]/.test(s))return s;
  return s.replace(/[a-z0-9.']+/g,w=>{if(/^(ii|iii|iv|v|vi)$/.test(w))return w.toUpperCase();if(/^(jr|sr)\.?$/.test(w))return w[0].toUpperCase()+w.slice(1);
    if(/^(of|and|the|at|de|la)$/.test(w))return w;let o=w[0].toUpperCase()+w.slice(1);
    o=o.replace(/^Mc([a-z])/,(m,c)=>'Mc'+c.toUpperCase()).replace(/^O'([a-z])/,(m,c)=>"O'"+c.toUpperCase()).replace(/^D'([a-z])/,(m,c)=>"D'"+c.toUpperCase());return o;})
   .replace(/^./,c=>c.toUpperCase());}
const POSFULL={PG:'Guard',SG:'Guard',G:'Guard',SF:'Forward',PF:'Forward',F:'Forward',C:'Center'};
function rosterCard(r){const p=B.pById.get(r.player_id)||{},x={...p,...r,name:properCase(r.name||p.name),college:properCase((r.college??p.college)),hometown:properCase(r.hometown??p.hometown)},b=p.box||{},gp=b.gp||0,w=String(x.name||'').trim().split(/\s+/),first=w.length>1?w.slice(0,-1).join(' '):'',last=w[w.length-1]||'';
  const ok=v=>v!=null&&v!==''&&v!=='N/A',d=v=>gp>0&&v!=null?f1(v):'-';
  const bio=[['Height',x.height],['Weight',ok(x.weight)?x.weight+' lbs':null],['Age',x.age],['Exp',ok(x.experience)?(+x.experience===0?'Rookie':x.experience+' yrs'):null],['College',ok(x.college)?x.college:null],['Hometown',ok(x.hometown)?x.hometown:null]].filter(([,v])=>ok(v));
  const ini=w.map(s=>s[0]).join('').slice(0,2).toUpperCase(),season=(CR()._meta||{}).season||'';
  return `<article class="pcard"><div class="pc-top"><div class="pc-main"><a class="pc-name" href="#players/${x.player_id}"><span class="pc-first">${esc(first)}</span> <span class="pc-last">${esc(last)}</span></a>${x.jersey!=null?`<span class="pc-num">${esc(x.jersey)}</span>`:''}
   <div class="pc-pos">${esc(POSFULL[x.pos]||x.pos||'')}<span> · ${esc(x.pos||'')}</span>${r.pending?`<span class="tag pick" title="Drafted R${r.pending.round} #${r.pending.pick}; not on the stats-site roster yet">NEW R${r.pending.round}#${r.pending.pick}</span>`:''}</div>
   <table class="pc-bio">${bio.map(([k,v])=>`<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table></div>
   <div class="pc-img" aria-hidden="true"><svg viewBox="0 0 60 70"><circle cx="30" cy="22" r="13"/><path d="M4 70c0-17 12-27 26-27s26 10 26 27z"/></svg><span>${esc(ini)}</span></div></div>
   <div class="pc-rat"><div class="pc-ovr"><small>OVR</small><b>${OVR(x.ratings||ratingsOf(x),x.pos)}</b></div><div class="pc-gr">${RK.map(k=>`<div><small>${k==='pot'?'POT*':k.toUpperCase()}</small>${gradeCell((x.ratings||ratingsOf(x))[k])}</div>`).join('')}</div></div>
   <div class="pc-stats">${[['Season',season||'-'],['GP',gp>0?gp:'-'],['PPG',d(b.ppg)],['APG',d(b.apg)],['RPG',d(b.rpg)]].map(([k,v])=>`<div><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div></article>`;}
const empty=(t,s)=>`<div class="empty"><b>${esc(t)}</b>${esc(s||'')}</div>`;
const allZero=o=>!o||Object.values(o).every(v=>v==null||v===0||v===''||(typeof v==='string'&&/^[-.0]*$/.test(v)));
function capRank(){const c=[...B.caproom].sort((a,b)=>b.cap_room-a.cap_room);return {rank:c.findIndex(x=>x.team_id===B.myTeam.team_id)+1,n:c.length,sorted:c};}

/* ---------- cap thresholds (manual cap_rules.json) ---------- */
const CR=()=>B.meta.cap_rules||{salary_cap:B.meta.salary_cap};
const LEVELS=[['salary_floor','Floor','F'],['salary_cap','Cap','Cap'],['luxury_tax','Tax','Tax'],['first_apron','1st apron','A1'],['second_apron','2nd apron','A2']];
function payrollOf(t){return t.team_salary!=null?t.team_salary:(CR().salary_cap-(t.cap_room||0));}
function capStatus(pay){const c=CR();
  if(c.second_apron&&pay>=c.second_apron) return {k:'2nd apron',c:'#7f1d1d'};
  if(c.first_apron&&pay>=c.first_apron) return {k:'1st apron',c:'#b91c1c'};
  if(c.luxury_tax&&pay>=c.luxury_tax) return {k:'taxpayer',c:'#ea580c'};
  if(pay>c.salary_cap) return {k:'over cap',c:'#ca8a04'};
  if(c.salary_floor&&pay<c.salary_floor) return {k:'under floor',c:'#6b7280'};
  return {k:'room',c:'#15803d'};}
const statusChip=pay=>{const s=capStatus(pay);return `<span class="chip" style="background:${s.c};color:#fff">${s.k}</span>`;};
function crossWarnings(before,after){const c=CR(),w=[];
  if(c.salary_cap&&before<=c.salary_cap&&after>c.salary_cap) w.push('over the cap → no cap room');
  if(c.luxury_tax&&before<c.luxury_tax&&after>=c.luxury_tax) w.push('into the luxury tax');
  if(c.first_apron&&before<c.first_apron&&after>=c.first_apron) w.push('above 1st apron → lose BAE/NT-MLE; hard-capped if a 1st-apron tool was used');
  if(c.second_apron&&before<c.second_apron&&after>=c.second_apron) w.push('above 2nd apron → no TP-MLE, frozen future 1st');
  return w;}
/* settings persisted on the device */
const SET={get(k,d){try{const v=localStorage.getItem('pgm.'+k);return v==null?d:JSON.parse(v);}catch(e){return d;}},set(k,v){try{localStorage.setItem('pgm.'+k,JSON.stringify(v));}catch(e){}}};
function rookieMin(){const c=CR(),u=SET.get('rookieMin',null);if(u)return {v:+u,src:'your setting'};if(c.rookie_minimum)return {v:c.rookie_minimum,src:'league'};
  const p=c.rookie_minimum_placeholder;return p?{v:p.value,src:'placeholder',label:p.label}:{v:0,src:'unknown'};}
function luxTax(over,rep){const b=CR().luxury_tax_brackets;if(!b||over<=0)return {tax:0,rows:[]};
  const inc=b.increment,rates=b.rates.map(r=>rep?r.repeater:r.non_repeater);let t=0,i=0,rem=over;const rows=[];
  while(rem>0){const rate=i<rates.length?rates[i]:rates[rates.length-1]+b.each_further_increment_adds*(i-rates.length+1);const amt=Math.min(rem,inc);
    rows.push({br:`$${(i*inc/1e6).toFixed(2)}M–$${((i+1)*inc/1e6).toFixed(2)}M`,rate,amt,tax:amt*rate});t+=amt*rate;rem-=amt;i++;}
  return {tax:Math.round(t),rows};}
function capMath(t,{addSalary=0,addPlayers=0}={}){ // cap salary (with offseason incomplete-roster charge) vs tax salary
  const c=CR(),rm=rookieMin(),counted=(t.players||[]).length+addPlayers,need=Math.max(0,(c.roster_minimum_for_charge||12)-counted);
  const tax=payrollOf(t)+addSalary,charge=need*rm.v,holds=0;
  return {tax,charge,need,counted,holds,cap:tax+charge+holds,rm,floorGap:Math.max(0,(c.salary_floor||0)-tax)};}
function exceptionsFor(capSal,taxSal,usedRoom){const c=CR(),e=c.exceptions||{};
  if(usedRoom) return [{n:'Room Exception',v:e.room_exception,why:'you used cap room, so you are an under-the-cap team for the season; only the Room Exception remains'}];
  if(taxSal>=c.second_apron) return [];
  if(taxSal>=c.first_apron) return [{n:'Taxpayer MLE',v:e.taxpayer_mle,why:'above the 1st apron: no BAE and no full NT-MLE; using the Taxpayer MLE hard-caps you at the 2nd apron'}];
  return [{n:'Non-Taxpayer MLE',v:e.non_taxpayer_mle,why:'default over-the-cap mode, below the 1st apron; using it hard-caps you at the 1st apron'},
          {n:'Bi-Annual Exception',v:e.bi_annual_exception,why:'below the 1st apron; using it hard-caps you at the 1st apron'}];}
function thresholdBar(pay,capSal){
  const c=CR(),max=Math.max(c.second_apron||c.salary_cap,pay,capSal||0)*1.08,x=v=>(v/max*100).toFixed(2);
  const zones=[[0,c.salary_floor,'#9ca3af'],[c.salary_floor,c.salary_cap,'#22c55e'],[c.salary_cap,c.luxury_tax,'#eab308'],[c.luxury_tax,c.first_apron,'#f97316'],[c.first_apron,c.second_apron,'#ef4444'],[c.second_apron,max,'#7f1d1d']].filter(z=>z[1]!=null);
  return `<div class="tbar"><div class="zones">${zones.map(([a,b,col])=>`<i style="left:${x(a)}%;width:${(x(b)-x(a)).toFixed(2)}%;background:${col}"></i>`).join('')}</div>
   <div class="pay" style="width:${x(pay)}%"></div><div class="you" style="left:${x(pay)}%"><span>DET ${mm(pay)}</span></div>${capSal&&capSal>pay?`<div class="capsal" style="left:${x(pay)}%;width:${(x(capSal)-x(pay))}%" title="incomplete roster charge"></div>`:''}
   ${LEVELS.filter(([k])=>c[k]).map(([k,l,sh],i)=>`<div class="mk ${sh==='A1'||sh==='Cap'?'up':''}" style="left:${x(c[k])}%" title="${l} ${mm(c[k])}"><span>${sh}</span></div>`).join('')}</div><div class="legend small" style="flex-wrap:wrap">${LEVELS.filter(([k])=>c[k]).map(([k,l,sh])=>`<span><b>${sh}</b> ${l} ${mm(c[k])}</span>`).join('')}</div>`;}
// Shared cap breakdown for any team: stat boxes, threshold bar, threshold table, incomplete-roster charge, player salaries.
// Pistons use payrollOf() as on My Team (real salary for pending picks); other teams use the stats-site salary data.
function capCore(t,{players=true}={}){if(!t)return empty('No team data','');const c=CR(),m=capMath(t),rep=t===B.myTeam&&SET.get('repeater',false),nm=t.name.replace(/^.* /,'');
  const rows=LEVELS.filter(([k])=>c[k]).map(([k,l])=>{const base=k==='salary_floor'||k==='luxury_tax'||k.includes('apron')?m.tax:m.cap,d=c[k]-base;
    return {l,th:c[k],basis:k==='salary_cap'?'cap salary':'tax salary',d,txt:k==='salary_floor'?(d>0?`needs ${mm(d)}`:`${mm(-d)} above`):(d>0?`${mm(d)} under`:`${mm(-d)} over`)};});
  const tx=luxTax(m.tax-c.luxury_tax,rep);
  let h=`<div class="kpis"><div class="kpi"><div class="v">${mm(m.cap)}</div><div class="l">Cap salary (incl. ${mm(m.charge)} roster charge)</div></div><div class="kpi"><div class="v">${mm(m.tax)}</div><div class="l">Tax salary (no holds/charges)</div></div>
   <div class="kpi"><div class="v">${mm(c.salary_cap-m.cap)}</div><div class="l">Cap room (on cap salary)</div></div><div class="kpi"><div class="v">${mm(tx.tax)}</div><div class="l">Projected luxury tax${rep?' (repeater)':''}</div></div></div>`;
  h+=thresholdBar(m.tax,m.cap);
  h+=table([{k:'l',l:'Threshold'},{k:'th',l:'Amount',n:1,f:mm},{k:'basis',l:'Measured on',p:2},{k:'txt',l:nm,n:1,f:(v,r)=>`<span style="color:${(r.l==='Floor'?r.d<=0:r.d>0)?'var(--good)':'var(--bad)'}">${esc(v)}</span>`}],rows);
  h+=`<p class="note small"><b>Incomplete roster charge:</b> ${m.counted} player${m.counted===1?'':'s'} counted → ${m.need} × rookie minimum ${mm(m.rm.v)} = <b>${mm(m.charge)}</b> added to cap salary.</p>`;
  if(players){const ps=[...(t.players||[])].sort((a,b)=>(b.salary?.year_1||0)-(a.salary?.year_1||0));
    h+=ps.length?`<div class="capps">${ps.map(p=>`<span>${plink(p.name,p.player_id)} <i>${esc(p.pos||'')}</i> <b>${mm(p.salary?.year_1||0)}</b>${p.pending?' <em>(pending, real $)</em>':''}</span>`).join('')}</div>`:'<p class="note small">No players on the roster yet.</p>';}
  return h;}
function capPanel(t){const c=CR(),m=capMath(t),usedRoom=SET.get('usedRoom',false),rep=SET.get('repeater',false);
  const rows=LEVELS.filter(([k])=>c[k]).map(([k,l])=>{const base=k==='salary_floor'||k==='luxury_tax'||k.includes('apron')?m.tax:m.cap,d=c[k]-base;
    return {l,th:c[k],basis:k==='salary_cap'?'cap salary':'tax salary',d,txt:k==='salary_floor'?(d>0?`needs ${mm(d)}`:`${mm(-d)} above`):(d>0?`${mm(d)} under`:`${mm(-d)} over`)};});
  const ex=exceptionsFor(m.cap,m.tax,usedRoom),tx=luxTax(m.tax-c.luxury_tax,rep);
  let h='';
  if(m.floorGap>0) h+=`<div class="warn">⚠️ <b>Below the salary floor by ${mm(m.floorGap)}.</b> If the Pistons are still under ${mm(c.salary_floor)} when offseason free agency ends, the league will <b>auto-sign players</b> to reach the floor and may <b>cut players</b> to make room. Cap holds don't count toward the floor.</div>`;
  h+=capCore(t,{players:false})+`<div class="controls"><label class="note" style="display:flex;align-items:center;gap:8px;flex:1">Rookie minimum $<input id="rmin" inputmode="numeric" style="flex:1;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:0 10px" value="${m.rm.v}"></label></div>
   ${m.rm.src==='placeholder'?`<div class="warn small">🟨 <b>Rookie minimum is a placeholder.</b> ${esc(m.rm.label||'')}</div>`:`<p class="note small">Rookie minimum source: ${esc(m.rm.src)}.</p>`}`;
  h+=`<h3>Exceptions you can use</h3><div class="controls"><button class="ghost" id="usedRoom">${usedRoom?'✓ ':''}Used cap room this season</button></div>
   ${ex.length?ex.map(e=>`<div class="kpi" style="margin-bottom:6px"><div class="v">${esc(e.n)} · ${mm(e.v)}</div><div class="l">${esc(e.why)}</div></div>`).join(''):empty('No MLE available','Above the 2nd apron: no Taxpayer MLE.')}
   <p class="note small">Per league rules every team operates over the cap by default; spending cap room switches you to under-the-cap for the season (Room Exception only). Eligibility is modelled from the league's cap rules; exact edge cases are the commissioners' call. <a href="#rules/cap">Full cap rules →</a></p>`;
  return h;}
/* ---------- My Team ---------- */
function vTeam(){
  const t=B.myTeam,cap=B.meta.salary_cap,cr=capRank(),D=B.D;
  const rec=t.record||{};const sal=t.team_salary||0;
  let h=`<div class="card"><h2>${esc(t.name)} <span class="chip">${esc(t.division||'')}</span></h2>
  <div class="kpis"><div class="kpi"><div class="v">${rec.w??0}-${rec.l??0}</div><div class="l">Record</div></div>
  <div class="kpi"><div class="v">${myRoster().length}</div><div class="l">Players on roster</div></div>
  <div class="kpi"><div class="v">${mm(sal)}</div><div class="l">Team salary</div></div>
  <div class="kpi"><div class="v">${mm(t.cap_room)}</div><div class="l">Cap room as listed on stats site (excl. roster charge)</div></div></div>
  <div class="note small" style="margin-top:8px">${(sal/cap*100).toFixed(1)}% of cap used · cap room ranks <b>${ord(cr.rank)} of ${cr.n}</b> (1st = most room) · status ${statusChip(sal)}</div></div>
  <div class="card"><h2>Cap & aprons</h2>${(B.pending||[]).length?`<p class="note small">Includes ${B.pending.map(e=>`${plink(e.name,e.player_id)} (R${e.pending.round} #${e.pending.pick}, not on the stats-site roster yet) at his ${e.pending.salSrc} 2005-06 salary ${mm(e.pending.realSal)}`).join(', ')}. On the stats site's current figures (his site contract ${B.pending.map(e=>mm(e.pending.siteSal)).join(', ')}), payroll would be ${mm(payrollOf(t)-B.pending.reduce((a,e)=>a+e.pending.realSal-e.pending.siteSal,0))}.</p>`:''}${capPanel(t)}</div>`;
  const gm=B.facts&&B.facts.pistons_gm;
  if(D.myNext) h+=`<div class="callout">🏀 Creation draft is live${D.onClock?` — ${esc(D.onClock.team)} (${esc(D.onClock.gm||'?')}) on the clock at R${D.onClock.round} #${D.onClock.slot}`:''}${gm?`. GM: <b>${esc(gm)}</b>`:''}. Overall pick ${D.nextOverall} is up. Your next pick is <b>Round ${D.myNext.round}, #${D.myNext.pick}</b> (overall ${D.myNext.overall}, ${D.picksBefore} picks away). <a href="#draft">Open draft board →</a></div>`;
  h+=`<div class="card"><h2>Roster & ratings</h2>`;
  if(!myRoster().length) h+=empty('No players yet','Draft picks will appear here.');
  else h+=`<div class="rgrid">${myRoster().map(rosterCard).join('')}</div>`;
  h+=`</div><div class="card"><h2>Contracts by year</h2>`;
  const yrs=[1,2,3,4,5,6,7];
  if(myRoster().length){
    const rows=myRoster().map(p=>({...p,...Object.fromEntries(yrs.map(y=>['y'+y,p.salary['year_'+y]]))}));
    const tot={name:'Team total',...Object.fromEntries(yrs.map(y=>['y'+y,rows.reduce((a,r)=>a+(r['y'+y]||0),0)]))};
    h+=table([{k:'name',l:'Player',f:(v,r)=>r.player_id?plink(v,r.player_id):esc(v)},...yrs.map(y=>({k:'y'+y,l:'Yr '+y,n:1,f:v=>v?mm(v):'—'}))],[...rows,tot],{me:r=>r.name==='Team total'});
    h+=`<h3>Cap room by year (vs ${mm(cap)} cap, flat)</h3>`+table([{k:'l',l:''},...yrs.map(y=>({k:'y'+y,l:'Yr '+y,n:1,f:v=>mm(v)}))],[{l:'Room',...Object.fromEntries(yrs.map(y=>['y'+y,cap-tot['y'+y]]))}]);
    h+=`<p class="note small">Season 2005 = Year 1. Year columns as shown on the site (a $1 entry is the site's own placeholder).</p>`;
  }
  if((t.cut_players||[]).length) h+=`<h3>Cut players (dead money)</h3>`+table([{k:'name',l:'Player',f:(v,r)=>plink(v,r.player_id)},{k:'total',l:'Total',n:1,f:mm}],t.cut_players);
  h+=`</div><div class="card"><h2>Owned draft picks</h2>${(t.draft_picks||[]).length?table([{k:'season',l:'Season'},{k:'round',l:'Round',n:1},{k:'original_team',l:'Originally'}],[...t.draft_picks].sort((a,b)=>a.season-b.season||a.round-b.round)):empty('No future picks','')}
  ${D.mine.length?`<h3>Creation draft (${esc(D.source)})</h3>`+D.mine.map(o=>{const m=D.madeBy.get(o.overall);return `<span class="chip ${m?'':'red'}">R${o.round} #${o.pick} (ovr ${o.overall})${m?': '+plink(m.player_name,m.player_id):(o.projected?' — projected':' — upcoming')}</span>`;}).join(''):''}</div>`;
  h+=`<div class="card"><h2>Injuries</h2>${(t.injuries||[]).length?table([{k:'name',l:'Player',f:(v,r)=>plink(v,r.player_id)},{k:'injury',l:'Injury'},{k:'duration',l:'Duration'}],t.injuries):empty('No injuries','Your roster is healthy.')}</div>`;
  h+=`<div class="card"><h2>Season stats</h2>${allZero(t.yearly_stats)?empty('Fills in once games are played','The 2005 season has not tipped off yet.'):
     table([{k:'k',l:'Stat'},{k:'v',l:'Value',n:1}],Object.entries(t.yearly_stats).map(([k,v])=>({k:k.replace(/_/g,' '),v})))}</div>`;
  return h;
}

/* ---------- Draft ---------- */
function vDraft(){
  const D=B.D,st=S.draft;
  let rows=D.board.filter(p=>(st.showTaken||!p.taken)&&(st.pos==='ALL'||p.pos===st.pos)&&(!st.q||p.name.toLowerCase().includes(st.q.toLowerCase()))&&(!st.onlyNear||!p.likelyGone));
  const key=st.sort;rows.sort((a,b)=>{let x=a[key],y=b[key];if(RK.includes(key)){x=gv(a.r[key]);y=gv(b.r[key]);}if(key==='height')x=a.height_in,y=b.height_in;
    if(typeof x==='string')return st.dir*x.localeCompare(y);return st.dir*((x??-1)-(y??-1));});
  const near=D.avail.filter(p=>!p.likelyGone).sort((a,b)=>b.fit-a.fit).slice(0,5);
  const oc=D.onClock,ago=t=>{if(!t)return'';const m=Math.round((Date.now()-new Date(t))/6e4);return m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago';};
  let h=`<div class="card"><h2>Draft room <span class="chip red">On the clock: #${D.nextOverall}</span></h2>`;
  if(oc) h+=`<div class="callout">⏱ <b>${esc(oc.team)}</b> (${esc(oc.gm||'?')}) — Round ${oc.round}, pick ${oc.slot} (overall ${oc.overall}), on the clock since ${ago(oc.since)}.</div>`;
  h+=D.myNext?`<div class="callout">Your next pick: <b>Round ${D.myNext.round}, #${D.myNext.pick}</b> (overall ${D.myNext.overall}${D.myNext.projected?', projected from the snake order':''}) — <b>${D.picksBefore} picks away</b>.${D.myUpcoming[1]?` After that: R${D.myUpcoming[1].round} #${D.myUpcoming[1].pick} (overall ${D.myUpcoming[1].overall}).`:''} The top ${D.picksBefore} available players by Value are flagged “likely gone”.</div>`:'<div class="callout">You have no remaining picks in this draft.</div>';
  {const pay=payrollOf(B.myTeam),c=CR(),mx=Math.max(...D.avail.map(p=>p.sal1||0));
   h+=`<p class="note small">💰 Pistons payroll ${mm(pay)} (${capStatus(pay).k}): ${mm(c.salary_cap-pay)} under the cap, ${mm(c.luxury_tax-pay)} under the tax, ${mm(c.first_apron-pay)} under the 1st apron. Priciest available prospect: ${mm(mx)} in year 1, so no single pick crosses a threshold right now; rows show ⚠️ when one would (cap, tax, 1st/2nd apron and hard-cap consequences). Each row shows the prospect's year-1 salary and where the Pistons' payroll lands after adding him. Per league rules, creation-draft salary is unlimited, but teams over an apron when the draft ends face apron rules.</p>`;}
  h+=`<p class="note small">Picks source: <b>${esc(D.source)}</b> (${D.made.length} made; ${D.board.filter(p=>p.taken).length} of them were still listed as eligible on the stats site and are now marked taken)${D.source!=='stats site'?' — the league draft log runs ahead of the stats site, which still lists '+B.transactions.filter(t=>t.type==='draft').length+' picks':''}.</p>`;
  h+=`<h3>Best available at your pick (by Pistons fit)</h3><div class="plist">${near.map((p,i)=>row(p,`Fit ${f1(p.fit)}`,`Value ${f1(p.val)} · Now ${f1(p.now)} · Real ${p.noData?'no data':f1(p.real)} · #${p.valRank} on board${salLine(p)}`)).join('')}</div>`;
  h+=`<p class="note small">Need now: ${POS.map(p=>`${p} ${D.N.need[p]===1?'●':D.N.need[p]===.5?'◐':'○'}`).join(' · ')} (● = nobody on roster). Biggest skill gaps: ${Object.entries(D.D).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>RNAME[k]).join(', ')}.</p></div>`;
  h+=`<div class="card"><h2>Big board <span class="chip">${rows.length} players</span></h2><div class="controls">
    <input type="search" id="dq" placeholder="Search name" value="${esc(st.q)}">
    <select id="dpos">${['ALL',...POS].map(p=>`<option ${p===st.pos?'selected':''}>${p}</option>`).join('')}</select>
    <select id="dsort">${[['fit','Pistons fit'],['val','Value'],['ov','OVR / Now (ratings)'],['real','Real 2005+'],['realSal','Real $'],['age','Age'],['height','Height'],...RK.map(k=>[k,RNAME[k]])].map(([k,l])=>`<option value="${k}" ${k===st.sort?'selected':''}>Sort: ${l}</option>`).join('')}</select>
    <button class="ghost" id="dnear">${st.onlyNear?'✓ ':''}Hide likely gone</button><button class="ghost" id="dtaken">${st.showTaken?'✓ ':''}Show taken</button></div>`;
  const gg=r=>`<div class="gg">${RK.map(k=>`<span><small>${k==='pot'?'POT*':k.toUpperCase()}</small>${gradeCell(r.r[k])}</span>`).join('')}</div>`;
  h+=table([{k:'fitRank',l:'#',n:1,p:0,w:'5%',f:(v,r)=>r.taken?'—':v},{k:'name',l:'Player',p:0,w:'19%',f:(v,r)=>`<a href="#players/${r.player_id}">${esc(v)}</a>${r.taken?`<span class="tag pick">TAKEN R${r.taken.round}#${r.taken.pick} ${esc(r.taken.team.split(' ').pop())}</span>`:r.likelyGone?'':(r.fitRank<=10?'<span class="tag">TARGET</span>':'')}<div class="note small">${esc(r.pos)} · ${r.age??'—'} · ${esc(r.height??'—')}</div>`},
     {k:'grades',l:'Grades',p:5,w:'25%',f:(v,r)=>gg(r)},{k:'ov',l:'OVR / Now',n:1,p:3,w:'8%',f:(v,r)=>`${ovr2k(v)}<div class="note small">${f1(r.now)} now</div>`},{k:'real',l:'Real',n:1,p:3,w:'9%',f:(v,r)=>r.noData?'<span class="tag pick" title="No Basketball Reference match — scored on ratings only">no data</span>':`${f1(v)}<div class="note small">${f1(r.rc.near_ws)} WS* · ${r.rc.seasons_2005_on} yrs</div>`},{k:'val',l:'Value',n:1,p:2,w:'7%',f:f1},{k:'fit',l:'Fit',n:1,p:0,w:'7%',f:(v,r)=>`<b>${f1(v)}</b>`},
     {k:'realSal',l:'Real $ / Site $',n:1,p:4,w:'10%',f:(v,r)=>(v?mm(v)+(r.rc&&r.rc.contract_end_est?`<div class="note small">thru ${esc(r.rc.contract_end_est)}</div>`:''):'<span class="note">—</span>')+`<div class="note small">site ${r.sal1?mm(r.sal1):'none'}</div>`},{k:'after',l:'DET after',n:1,p:4,w:'10%',f:(v,r)=>`${mm(v)} ${statusChip(v)}${r.warns&&r.warns.length?`<div class="warnline">⚠️ ${esc(r.warns.join('; '))}</div>`:''}`}],
     rows.slice(0,200).map(r=>({...r,_style:r.likelyGone})),{id:'draft',sortKey:key,sortDir:st.dir,me:r=>!r.taken&&r.likelyGone===false&&r.fitRank<=10});
  if(rows.length>200) h+=`<p class="note small">Showing top 200 of ${rows.length}; filter by position or search to see more.</p>`;
  h+=`</div><div class="card"><h2>Draft order & picks made</h2>${table([{k:'overall',l:'Ovr',n:1},{k:'rp',l:'Pick'},{k:'team',l:'Team'},{k:'sel',l:'Selection',f:(v,r)=>r._m?`${esc(r._m.player_pos)} ${plink(r._m.player_name,r._m.player_id)}`:esc(v)}],
     D.order.map(o=>{const m=D.madeBy.get(o.overall);return {...o,_m:m,team:o.team+(o.gm?` (${o.gm})`:''),_team:o.team,rp:`R${o.round} #${o.pick}`,sel:m?`${m.player_pos} ${m.player_name}`:(o.overall===D.nextOverall?'⏱ on the clock':(o.projected?'projected':''))};}),{me:r=>r._team===B.myTeam.name})}</div>`;
  h+=`<div class="card"><details><summary>How the scores work</summary><div class="note">
   <p><b>Grades → numbers:</b> A+ 100, A 95, A- 90, B+ 85 … in 5-point steps … F- 30.</p>
   <p><b>OVR (shown)</b> is a display-only, NBA 2K-style rating: each player's raw overall is ranked against every league player and mapped onto a 2K-like scale (league best ≈ 96, top 10 ≈ 88+, top 30 ≈ 84+, median ≈ 73, end of bench ≈ 60–65, floor 50). The scores below all use the raw overall, so the 2K number never changes any ranking.</p>
   <p><b>Raw overall</b> = position-weighted average of the five skills (Inside, Outside, Handling, Defense, Rebound):<br>
   ${POS.map(p=>`${p}: `+Object.entries(PW[p]).map(([k,w])=>`${k} ${w*100}%`).join(', ')).join('<br>')}</p>
   <p><b>Now</b> = raw overall rescaled 0–100 across the eligible pool (10th-percentile player = 0, 98th-percentile = 100, capped).</p>
   <p><b>Real</b> = real-life NBA production from 2005-06 on (Basketball Reference, hand-kept file <code>real_careers.json</code>): raw = 0.7 × 10 × near-term Win Shares + 0.3 × 4 × max(0, PER − 5), where near-term WS = 1.0·WS(05-06) + 0.8·WS(06-07) + 0.6·WS(07-08) + 0.35·WS(08-09) + 0.25·WS(09-10) and PER is minutes-weighted over 2005-10; then rescaled 0–100 the same way. Age only matters through this (older players' real production falls off quickly).</p>
   <p><b>Value</b> = 0.5 × Now + 0.5 × Real. Players with no Basketball Reference match are flagged <b>no data</b> and use Value = Now (not punished).</p>
   <p><b>Potential is ignored</b> for the creation draft (user rule); the POT column is shown for reference only.</p>
   <p><b>Pistons fit</b> = 0.55 × Value + 0.25 × Need × 100 + 0.10 × Complement + 0.10 × Value-per-$.<br>
   Need = 1.0 if no rostered player at that position, 0.5 if one, 0.2 if two or more — computed live from the roster (now: ${myRoster().map(p=>plink(p.name,p.player_id)+' '+p.pos).join(', ')||'nobody'}).<br>
   Complement = the player's skills weighted by the team's gaps (100 − best rostered grade in each skill), as a percentile.<br>
   Value-per-$ = Real ÷ real 2005-06 salary in $M (min $0.5M; site salary used if the real one is missing), as a percentile; neutral 50 when real data or any salary is missing.</p>
   <p><b>Real $</b> = real 2005-06 NBA salary (BBRef team salary tables / HoopsHype); "thru" = estimated last contract season from the salary history. <b>Site $</b> = the stats-site contract.</p>
   <p>Coverage: ${Object.values((B.real||{}).players||{}).filter(x=>x.bbref_id).length} of ${Object.keys((B.real||{}).players||{}).length} league players have real-career data.</p>
   <p><b>Likely gone</b>: players ranked inside the top N by Value, where N = picks before yours. It's a projection, not a guarantee.</p></div></details></div>`;
  return h;
}
function salLine(p){const rs=p.realSal?` · Real $ ${mm(p.realSal)}${p.rc&&p.rc.contract_end_est?' thru '+p.rc.contract_end_est:''}`:' · Real $ —';return rs+(p.sal1?` · Site $ ${mm(p.sal1)}`:' · Site $ none')+` → DET ${mm(p.after)} (${p.afterStatus})${p.warns.length?' ⚠️ '+p.warns.join('; '):''}`;}
function _oldSalLine(p){return p.sal1?` · Yr1 ${mm(p.sal1)} → DET ${mm(p.after)} (${p.afterStatus})${p.warns.length?' ⚠️ '+p.warns.join('; '):''}`:' · no contract listed on site ($0)';}
function row(p,score,sub){return `<div class="row" data-href="#players/${p.player_id}"><span class="pos">${esc(p.pos)}</span><div><div class="nm">${plink(p.name,p.player_id)}</div><div class="meta">${p.age} yrs · ${esc(p.height||'')} · ${RK.map(k=>k.toUpperCase()+' '+esc(p.r[k]||'—')).join(' ')}</div><div class="meta">${esc(sub)}</div></div><div class="sc">${esc(score)}</div></div>`;}

/* ---------- League ---------- */
function vLeague(){
  const sub=S.lsub||'standings';
  let h=`<div class="note small" style="margin:0 0 4px 2px;font-weight:600">View</div><div class="seg aseg" style="margin-bottom:12px">${[['standings','Standings'],['cap','Cap room'],['stats','Team stats'],['leaders','Leaders']].map(([k,l])=>`<button data-lsub="${k}" class="${k===sub?'on':''}">${l}</button>`).join('')}</div>`;
  const me=r=>r.team_id===B.myTeam.team_id;
  if(sub==='standings'){
    const zero=B.standings.divisional.every(d=>d.teams.every(t=>!t.w&&!t.l));
    if(zero) h+=`<div class="callout">Season hasn't started — every team is 0-0.</div>`;
    B.standings.divisional.forEach(d=>{h+=`<div class="card"><h2>${esc(d.division)}</h2>${table([{k:'team',l:'Team'},{k:'w',l:'W',n:1},{k:'l',l:'L',n:1},{k:'win_pct',l:'Pct',n:1,f:pct3},{k:'gb',l:'GB',n:1},{k:'last10',l:'L10'},{k:'home',l:'Home'}],d.teams,{me})}</div>`;});
  } else if(sub==='cap'){
    const c=capRank().sorted.map((x,i)=>{const used=x.team_salary!=null?x.team_salary:B.meta.salary_cap-x.cap_room,cr=CR();return {...x,rank:i+1,used,status:capStatus(used).k,toFloor:Math.max(0,(cr.salary_floor||0)-used),underTax:(cr.luxury_tax||0)-used,projTax:luxTax(used-(cr.luxury_tax||0),false).tax};});
    const cnt={};c.forEach(x=>cnt[x.status]=(cnt[x.status]||0)+1);
    h+=`<div class="card"><h2>League cap picture</h2><div>${Object.entries(cnt).map(([k,v])=>`<span class="chip">${esc(k)}: ${v}</span>`).join('')}</div><p class="note small">Floor ${mm(CR().salary_floor)} · Cap ${mm(CR().salary_cap)} · Tax ${mm(CR().luxury_tax)} · 1st apron ${mm(CR().first_apron)} · 2nd apron ${mm(CR().second_apron)}</p></div>`;
    h+=`<div class="card"><h2>Cap room (cap ${mm(B.meta.salary_cap)})</h2>${table([{k:'rank',l:'#',n:1},{k:'team',l:'Team'},{k:'cap_room',l:'Room',n:1,f:mm},{k:'used',l:'Payroll',n:1,f:mm},{k:'status',l:'Status',f:(v,r)=>statusChip(r.used)},{k:'toFloor',l:'To floor',n:1,f:v=>v?mm(v):'—'},{k:'underTax',l:'Under tax',n:1,f:mm},{k:'projTax',l:'Proj. tax',n:1,f:v=>v?mm(v):'$0'}],c.map(x=>({...x,_team:x.team_id})),{me,id:'capx'})}<p class="note small">Projected tax uses non-repeater rates on current payroll (tax is actually assessed on salary at the final regular-season game).</p></div>`;
  } else if(sub==='stats'){
    const ts=(B.teamstats['tmstats/offense/team.htm']||[]).map(r=>({...r,team_id:r.team_id||B.teamByShort.get(r.team)?.team_id}));
    const z=ts.every(r=>allZero({a:r.ppg,b:r.rpg,c:r.apg}));
    h+=`<div class="card"><h2>Team stats (offense)</h2>${z?empty('Fills in once games are played','All teams are at 0.0 until the season starts.'):''}${table([{k:'team',l:'Team'},...['ppg','rpg','apg','spg','bpg','topg'].map(k=>({k,l:k.toUpperCase(),n:1,f:f1}))],ts,{me})}</div>`;
  } else {
    const L=B.leaders.league_leaders;const cats=Object.keys(L);
    h+=`<div class="card"><h2>League leaders</h2><select id="lcat" style="width:100%;margin-bottom:10px">${cats.map(c=>`<option ${c===S.lcat?'selected':''}>${esc(c)}</option>`).join('')}</select>`;
    const c=L[S.lcat||cats[0]];
    h+=(c&&c.leaders.length)?table([{k:'rank',l:'#',n:1},{k:'player',l:'Player',f:(v,r)=>plink(v,r.player_id)},{k:'pos',l:'Pos'},{k:'team',l:'Team'},{k:'value',l:c.stat,n:1}],c.leaders,{me:r=>r.team_id===B.myTeam.team_id}):empty('Fills in once games are played','League leaders are published after the first games.');
    h+=`</div>`;
  }
  return h;
}

/* ---------- Analytics ---------- */
function pctile(arr,v){if(v==null||!arr.length)return null;let below=0,eq=0;for(const x of arr){if(x<v)below++;else if(x===v)eq++;}return Math.round((below+0.5*eq)/arr.length*100);}
function radar(series,labels,size=280){
  const c=size/2,R=size/2-34,n=labels.length,pt=(i,v)=>{const a=-Math.PI/2+i*2*Math.PI/n;return [c+R*v/100*Math.cos(a),c+R*v/100*Math.sin(a)];};
  let s=`<svg viewBox="0 0 ${size} ${size}" width="100%" style="max-width:${size+40}px" role="img" aria-label="radar chart">`;
  [25,50,75,100].forEach(g=>{s+=`<polygon points="${labels.map((_,i)=>pt(i,g).join(',')).join(' ')}" fill="none" stroke="var(--line)"/>`;});
  labels.forEach((l,i)=>{const [x,y]=pt(i,100);const [lx,ly]=pt(i,118);s+=`<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="var(--line)"/><text x="${lx}" y="${ly}" font-size="11" fill="var(--mut)" text-anchor="middle" dominant-baseline="middle">${esc(l)}</text>`;});
  series.forEach(se=>{s+=`<polygon points="${se.v.map((v,i)=>pt(i,v??0).join(',')).join(' ')}" fill="${se.c}" fill-opacity=".25" stroke="${se.c}" stroke-width="2"/>`;});
  return s+'</svg>';
}
function line(points,{h=140,label=''}={}){
  if(points.length<2) return '';
  const w=320,xs=points.map((_,i)=>20+i*(w-40)/(points.length-1)),vs=points.map(p=>p.v),mn=Math.min(...vs),mx=Math.max(...vs),sp=mx-mn||1;
  const y=v=>h-20-(v-mn)/sp*(h-40);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%"><polyline fill="none" stroke="var(--red)" stroke-width="2.5" points="${points.map((p,i)=>xs[i]+','+y(p.v)).join(' ')}"/>${points.map((p,i)=>`<circle cx="${xs[i]}" cy="${y(p.v)}" r="3.5" fill="var(--blue)"/><text x="${xs[i]}" y="${h-4}" font-size="9" text-anchor="middle" fill="var(--mut)">${esc(p.l)}</text>`).join('')}<text x="4" y="12" font-size="10" fill="var(--mut)">${esc(label)} ${f1(mx)} max</text></svg>`;
}
/* ---------- Analytics (advanced stats) ----------
 Formulas (per-game inputs from data/bundle.json players[].box; team inputs = site team PPG / PA + sum of rostered players' box lines):
  TS%   = PTS / (2·(FGA + 0.44·FTA))            eFG% = (FGM + 0.5·3PM) / FGA          AST/TO = AST / TOV
  Per-36 = stat / MIN · 36
  Game Score (Hollinger, adapted) = PTS + 0.4·FGM − 0.7·FGA − 0.4·(FTA−FTM) + 0.39·REB + STL + 0.7·AST + 0.7·BLK − TOV
     (site has no OREB/DREB split or fouls: 0.39·REB = 0.7·ORB+0.3·DRB at a ~23% offensive-board share; PF term dropped)
  USG%  = 100 · (FGA + 0.44·FTA + TOV) · (TmMIN/5) / (MIN · (TmFGA + 0.44·TmFTA + TmTOV)),  TmMIN = 240 per game
  PER-lite = 15 · EFF36 / lgEFF36, EFF = PTS+REB+AST+STL+BLK − missed FG − missed FT − TOV, lgEFF36 = minute-weighted league EFF per 36
  Win Shares (simple) = team wins · max(0,EFF·GP) / Σ teammates max(0,EFF·GP)   (credits actual wins by share of positive production)
  Value / $1M = WS ÷ (this-year salary / 1e6);  also EFF per game per $1M
  Team possessions/g = TmFGA + 0.44·TmFTA + TmTOV − OREB_est, OREB_est = 0.23·TmREB (no OREB on site). Pace = possessions per 48.
  ORtg = 100·PPG/poss, DRtg = 100·PA/poss (opponent possessions assumed ≈ own), Net = ORtg − DRtg
  Four Factors (offense only): eFG%, TOV% = TOV/poss, FT rate = FTA/FGA; ORB% and all defensive factors need opponent/OREB data the site doesn't publish.
  Pythagorean W = GP · PF^14 / (PF^14 + PA^14)
*/
const sd=(a,b)=>b>0&&isFinite(a/b)?a/b:null;
const p1=v=>v==null||!isFinite(v)?'—':(v*100).toFixed(1)+'%';
const f2=v=>v==null||!isFinite(v)?'—':(+v).toFixed(2);
const sgn=v=>v==null||!isFinite(v)?'—':(v>0?'+':'')+(+v).toFixed(1);
function advCompute(){
  if(B._adv) return B._adv;
  const tById=new Map(B.teams.map(t=>[t.team_id,t]));
  const pl=B.players.filter(p=>p.team_id&&tById.has(p.team_id)).map(p=>{const b=p.box||{},g=b.gp||0,mpg=b.mpg||0;
    const reb=b.rpg||0,eff=(b.ppg||0)+reb+(b.apg||0)+(b.spg||0)+(b.bpg||0)-((b.fga||0)-(b.fgm||0))-((b.fta||0)-(b.ftm||0))-(b.topg||0);
    const sal=(p.contract?.salary_by_year||[])[0]||0;
    return {p,id:p.player_id,name:p.name,pos:p.pos,team_id:p.team_id,team:tById.get(p.team_id).name,b,g,mpg,eff,sal,
      ts:sd(b.ppg,2*((b.fga||0)+0.44*(b.fta||0))),efg:sd((b.fgm||0)+0.5*(b.tpm||0),b.fga),ato:sd(b.apg,b.topg),
      gs:g?(b.ppg||0)+0.4*(b.fgm||0)-0.7*(b.fga||0)-0.4*((b.fta||0)-(b.ftm||0))+0.39*reb+(b.spg||0)+0.7*(b.apg||0)+0.7*(b.bpg||0)-(b.topg||0):null,
      p36:k=>mpg>0?(b[k]||0)/mpg*36:null};});
  const teams=B.teams.map(t=>{const ro=pl.filter(x=>x.team_id===t.team_id&&x.g>0);const ts=t.team_stats||{},ys=t.yearly_stats||{},rec=t.record||{};
    const gp=(rec.w||0)+(rec.l||0),G=Math.max(gp,...ro.map(x=>x.g),0);
    const sum=k=>G?ro.reduce((a,x)=>a+(x.b[k]||0)*x.g,0)/G:0; // roster per-game totals (players' season totals ÷ team games)
    const fga=sum('fga'),fta=sum('fta'),tov=sum('topg')||ts.topg||0,fgm=sum('fgm'),tpm=sum('tpm'),reb=ts.rpg||sum('rpg');
    const pf=ts.ppg||ys.points_per_game||0,pa=ys.points_allowed_per_game||0;
    const mins=sum('mpg'),poss0=fga+0.44*fta+tov-0.23*reb,poss=fga>0&&mins>=180&&poss0>0?poss0:null; // need ≥180 of 240 team minutes covered by roster box lines
    const py=gp&&pf>0&&pa>0?gp*Math.pow(pf,14)/(Math.pow(pf,14)+Math.pow(pa,14)):null;
    return {t,mins,team_id:t.team_id,team:t.name,gp,w:rec.w||0,l:rec.l||0,pf,pa,fga,fta,tov,poss,pace:poss,
      ortg:poss&&pf?100*pf/poss:null,drtg:poss&&pa?100*pa/poss:null,efg:sd(fgm+0.5*tpm,fga),tovp:poss?tov/poss:null,ftr:sd(fta,fga),
      pyw:py,pyl:py!=null?gp-py:null,diff:py!=null?(rec.w||0)-py:null};});
  teams.forEach(x=>x.net=x.ortg!=null&&x.drtg!=null?x.ortg-x.drtg:null);
  const tm=new Map(teams.map(x=>[x.team_id,x]));
  const act=pl.filter(x=>x.g>0&&x.mpg>0),lgMin=act.reduce((a,x)=>a+x.mpg*x.g,0),lgEff36=lgMin?act.reduce((a,x)=>a+x.eff*x.g,0)/lgMin*36:0;
  pl.forEach(x=>{const T=tm.get(x.team_id);
    x.usg=x.g&&x.mpg&&T&&T.poss?100*((x.b.fga||0)+0.44*(x.b.fta||0)+(x.b.topg||0))*48/(x.mpg*((T.fga)+0.44*T.fta+T.tov)):null;
    x.per=x.g&&x.mpg>0&&lgEff36>0?15*(x.eff/x.mpg*36)/lgEff36:null;});
  teams.forEach(T=>{const ro=pl.filter(x=>x.team_id===T.team_id&&x.g>0),den=ro.reduce((a,x)=>a+Math.max(0,x.eff*x.g),0);
    ro.forEach(x=>{x.ws=den>0?T.w*Math.max(0,x.eff*x.g)/den:0;});});
  pl.forEach(x=>{if(x.ws==null)x.ws=x.g?0:null;const m=x.sal/1e6;x.wsm=x.g&&m>0?x.ws/m:null;x.effm=x.g&&m>0?x.eff/m:null;});
  return B._adv={pl,teams,tm,anyGames:act.length>0,anyTeam:teams.some(x=>x.gp>0||x.pf>0),lgEff36};
}
const ACOLS={
  name:{l:'Player'},team:{l:'Team'},pos:{l:'Pos'},g:{l:'GP',n:1,f:v=>v||0},mpg:{l:'MIN',n:1,f:f1},
  ppg:{l:'PTS',n:1,f:f1,v:x=>x.b.ppg},rpg:{l:'REB',n:1,f:f1,v:x=>x.b.rpg},apg:{l:'AST',n:1,f:f1,v:x=>x.b.apg},
  ts:{l:'TS%',n:1,f:p1},efg:{l:'eFG%',n:1,f:p1},usg:{l:'USG%',n:1,f:f1},ato:{l:'AST/TO',n:1,f:f2},gs:{l:'GmSc',n:1,f:f1},
  per:{l:'PER*',n:1,f:f1},ws:{l:'WS*',n:1,f:f2},wsm:{l:'WS/$1M',n:1,f:f2},sal:{l:'Salary',n:1,f:v=>v?mm(v):'—'}};
const AV=(x,k)=>ACOLS[k]?.v?ACOLS[k].v(x):x[k];
function vAnalytics(){
  const A=advCompute(),st=S.an=S.an||{q:'',team:'ALL',pos:'ALL',sort:'per',dir:-1,sub:'players',min:0};
  let h=`<div class="note small" style="margin:0 0 4px 2px;font-weight:600">View</div><div class="seg aseg" style="margin-bottom:12px">${[['players','Players'],['teams','Teams'],['formulas','Formulas']].map(([k,l])=>`<button data-asub="${k}" class="${st.sub===k?'on':''}">${l}</button>`).join('')}</div>`;
  if(!A.anyGames) h+=`<div class="callout"><b>No games played yet.</b> Advanced stats compute automatically from the daily scrape once the season tips off. Until then every metric shows “—”.</div>`;
  if(st.sub==='teams') return h+anTeams(A);
  if(st.sub==='formulas') return h+anFormulas(A);
  if(S.anp) h+=anCard(A,S.anp);
  const q=st.q.toLowerCase();
  let rows=A.pl.filter(x=>(!q||x.name.toLowerCase().includes(q))&&(st.team==='ALL'||x.team_id===+st.team)&&(st.pos==='ALL'||x.pos===st.pos)&&(!st.min||x.mpg>=st.min));
  rows.sort((a,b)=>{const va=AV(a,st.sort),vb=AV(b,st.sort);if(va==null&&vb==null)return a.name.localeCompare(b.name);if(va==null)return 1;if(vb==null)return -1;return (typeof va==='string'?va.localeCompare(vb):va-vb)*st.dir;});
  const cols=['name','team','pos','g','mpg','ppg','rpg','apg','ts','efg','usg','ato','gs','per','ws','wsm'].map(k=>({k,l:ACOLS[k].l,n:ACOLS[k].n,p:{name:0,per:0,ppg:1,rpg:1,apg:1,team:2,ts:2,mpg:2}[k]??3,f:ACOLS[k].f?((v,r)=>ACOLS[k].f(AV(r,k))):(k==='name'?(v,r)=>`<b>${plink(r.name,r.id)}</b>`:k==='team'?(v,r)=>esc(r.team.split(' ').slice(-1)[0]):null)}));
  h+=`<div class="card"><h2>Player advanced stats <span class="chip">${rows.length}</span></h2><div class="controls">
   <input type="search" id="aq" placeholder="Search players" value="${esc(st.q)}" autocomplete="off">
   <select id="ateam"><option value="ALL">All teams</option>${[...B.teams].sort((a,b)=>a.name.localeCompare(b.name)).map(t=>`<option value="${t.team_id}" ${+st.team===t.team_id?'selected':''}>${esc(t.name)}</option>`).join('')}</select>
   <select id="apos">${['ALL',...POS].map(p=>`<option ${p===st.pos?'selected':''}>${p}</option>`).join('')}</select>
   <select id="amin">${[0,10,20,30].map(m=>`<option value="${m}" ${+st.min===m?'selected':''}>${m?'≥'+m+' MPG':'Any MIN'}</option>`).join('')}</select></div>
   <p class="note small">Tap a column to sort, tap a player for the detail card. * = estimate (see Formulas).</p>
   ${table(cols,rows.slice(0,150).map(x=>({...x,_href:'#analytics/'+x.id})),{id:'adv',sortKey:st.sort,sortDir:st.dir,me:r=>r.team_id===B.meta.my_team_id})}
   ${rows.length>150?'<p class="note small">Showing first 150 — refine filters.</p>':''}</div>`;
  return h;
}
function anCard(A,id){const x=A.pl.find(y=>y.id===id);if(!x){const p=B.pById.get(id);return p?`<div class="card"><h2>${plink(p.name,p.player_id)}</h2>${empty('Not on a team roster','Advanced stats cover rostered players only.')}</div>`:'';}
  const b=x.b,k=(v,l)=>`<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  let h=`<div class="card" id="acard"><h2>${plink(x.name,x.id)} <span><span class="chip blue">${esc(x.pos)}</span><button class="ghost" id="aclose" style="min-height:36px">✕</button></span></h2><div class="note">${esc(x.team)} · ${x.sal?mm(x.sal)+' this yr':'no salary listed'} · <a href="#players/${x.id}">Profile ›</a></div>`;
  if(!x.g) return h+empty('No games played yet','This card fills in after the first games.')+'</div>';
  h+=`<h3>Efficiency</h3><div class="kpis">${k(p1(x.ts),'True shooting')}${k(p1(x.efg),'Effective FG%')}${k(f1(x.usg),'Usage rate*')}${k(f2(x.ato),'AST/TO')}${k(f1(x.gs),'Game Score / g')}${k(f1(x.per),'PER-lite*')}${k(f2(x.ws),'Win shares*')}${k(f2(x.wsm),'WS per $1M')}${k(f2(x.effm),'EFF per $1M')}${k(f1(x.eff),'EFF / g')}</div>`;
  const keys=[['ppg','PTS'],['rpg','REB'],['apg','AST'],['spg','STL'],['bpg','BLK'],['topg','TO'],['fgm','FGM'],['fga','FGA'],['tpm','3PM'],['tpa','3PA'],['ftm','FTM'],['fta','FTA']];
  h+=`<h3>Per game vs per 36 (${x.g} GP, ${f1(x.mpg)} MIN)</h3>${table([{k:'s',l:'Stat'},{k:'g',l:'Per game',n:1,f:f1},{k:'p',l:'Per 36',n:1,f:f1}],keys.map(([kk,l])=>({s:l,g:b[kk],p:x.p36(kk)})))}`;
  if(!b.has_shooting) h+=`<p class="note small">Shooting makes/attempts not yet on the site for this player; TS%/eFG%/usage use what's available.</p>`;
  // rolling split from snapshots: games between the two most recent snapshots with new games
  const sn=SNAPS.map(s=>({at:s.crawled_at,b:s.players?.[x.id]?.box})).filter(s=>s.b&&s.b.gp>0);
  if(sn.length>=2){const a=sn[sn.length-2].b,c=sn[sn.length-1].b,dg=c.gp-a.gp;
    if(dg>0){const sp=kk=>(c[kk]*c.gp-a[kk]*a.gp)/dg;h+=`<h3>Since previous refresh (${dg} game${dg>1?'s':''})</h3>${table([{k:'s',l:'Stat'},{k:'r',l:'Recent',n:1,f:f1},{k:'s2',l:'Season',n:1,f:f1}],[['ppg','PTS'],['rpg','REB'],['apg','AST'],['mpg','MIN']].map(([kk,l])=>({s:l,r:sp(kk),s2:c[kk]})))}`;}}
  return h+'</div>';
}
function anTeams(A){
  if(!A.anyTeam) return `<div class="card"><h2>Team ratings</h2>${empty('No games played yet','Pace, offensive/defensive rating, Four Factors and Pythagorean wins appear after the first games.')}</div>`;
  const st=S.an,me=r=>r.team_id===B.meta.my_team_id,ts=st.tsort||'net',td=st.tdir||-1;
  const rows=[...A.teams].sort((a,b)=>{const va=a[ts],vb=b[ts];if(va==null)return 1;if(vb==null)return -1;return (typeof va==='string'?va.localeCompare(vb):va-vb)*td;});
  const nm=(v,r)=>esc(r.team.split(' ').slice(-1)[0]);
  let h=`<div class="card"><h2>Team ratings</h2><p class="note small">Per 100 possessions. Possessions estimated from rostered players' shooting/turnovers; opponent possessions assumed equal. “—” = roster box lines cover under 180 of 240 team minutes, so possessions can't be estimated yet.</p>
   ${table([{k:'team',l:'Team',f:nm},{k:'w',l:'W',n:1},{k:'l',l:'L',n:1},{k:'pace',l:'Pace*',n:1,f:f1},{k:'ortg',l:'ORtg',n:1,f:f1},{k:'drtg',l:'DRtg',n:1,f:f1},{k:'net',l:'Net',n:1,f:sgn}],rows,{id:'ateams',me,sortKey:ts,sortDir:td})}</div>`;
  h+=`<div class="card"><h2>Four Factors (offense)</h2>${table([{k:'team',l:'Team',f:nm},{k:'efg',l:'eFG%',n:1,f:p1},{k:'tovp',l:'TOV%',n:1,f:p1},{k:'ftr',l:'FTA/FGA',n:1,f:f2},{k:'orb',l:'ORB%',n:1,f:()=>'n/a'}],rows,{me})}
   <p class="note small">ORB% and defensive factors need offensive-rebound and opponent shooting data, which the stats site doesn't publish.</p></div>`;
  h+=`<div class="card"><h2>Pythagorean wins</h2>${table([{k:'team',l:'Team',f:nm},{k:'pf',l:'PF',n:1,f:f1},{k:'pa',l:'PA',n:1,f:f1},{k:'w',l:'W',n:1},{k:'pyw',l:'Exp W',n:1,f:f1},{k:'diff',l:'Luck',n:1,f:sgn}],[...A.teams].sort((a,b)=>(b.pyw??-1)-(a.pyw??-1)),{me})}
   <p class="note small">Exp W = GP·PF¹⁴/(PF¹⁴+PA¹⁴). Luck = actual − expected wins.</p></div>`;
  return h;
}
function anFormulas(A){
  const L=[['TS%','PTS ÷ (2 × (FGA + 0.44 × FTA))'],['eFG%','(FGM + 0.5 × 3PM) ÷ FGA'],['AST/TO','AST ÷ TOV'],['Per 36','stat ÷ MIN × 36'],
   ['Game Score','PTS + 0.4·FGM − 0.7·FGA − 0.4·(FTA−FTM) + 0.39·REB + STL + 0.7·AST + 0.7·BLK − TOV (Hollinger; no OREB/DREB split or fouls on site, so 0.39·REB ≈ 0.7·ORB + 0.3·DRB)'],
   ['USG%*','100 × (FGA + 0.44·FTA + TOV) × (TmMIN/5) ÷ (MIN × (TmFGA + 0.44·TmFTA + TmTOV)); team totals = sum of rostered players'],
   ['PER-lite*','15 × EFF36 ÷ league EFF36, where EFF = PTS+REB+AST+STL+BLK − missed FG − missed FT − TOV (league average = 15; not pace-adjusted)'],
   ['Win Shares*','Team wins × player\'s share of team positive EFF (EFF × GP)'],['WS per $1M','WS ÷ (this season salary ÷ $1M); EFF per $1M likewise'],
   ['Possessions*','FGA + 0.44·FTA + TOV − 0.23·REB (OREB estimated at 23% of rebounds)'],['Pace*','possessions per 48 minutes'],
   ['ORtg / DRtg','100 × PTS scored (allowed) ÷ possessions'],['Net rating','ORtg − DRtg'],['Four Factors','eFG%, TOV% = TOV ÷ poss, FT rate = FTA ÷ FGA (ORB% unavailable)'],
   ['Pythagorean W','GP × PF¹⁴ ÷ (PF¹⁴ + PA¹⁴)']];
  return `<div class="card"><h2>How these are calculated</h2><ul class="ck">${L.map(([a,b])=>`<li class="info"><span class="ic">ƒ</span><span><b>${a}</b> — ${esc(b)}</span></li>`).join('')}</ul>
  <p class="note small">* estimate. Not available from the stats site: offensive/defensive rebound split, personal fouls, opponent shooting, play-by-play/lineups, per-game box scores (rolling splits use differences between daily snapshots instead).</p></div>`;
}

/* ---------- Players ---------- */
function vPlayers(){
  const q=(S.pq||'').toLowerCase();const pos=S.ppos||'ALL';
  const list=B.players.filter(p=>(!q||p.name.toLowerCase().includes(q))&&(pos==='ALL'||p.pos===pos)).map(p=>{const r=ratingsOf(p);return {...p,r,ov:overall(r,p.pos)};}).sort((a,b)=>b.ov-a.ov);
  return `<div class="card"><h2>Find a player <span class="chip">${list.length}</span></h2><div class="controls"><input type="search" id="pq" placeholder="Search ${B.players.length} players" value="${esc(S.pq||'')}" autocomplete="off">
   <select id="ppos">${['ALL',...POS].map(p=>`<option ${p===pos?'selected':''}>${p}</option>`).join('')}</select></div>
   <div class="plist">${list.slice(0,100).map(p=>row(p,'OVR '+ovr2k(p.ov),(p.team==='Draft'?'Draft pool':(p.team||'—'))+(p.contract?' · '+mm(p.contract.salary_by_year?.[0])+' this yr':''))).join('')}</div>
   ${list.length>100?`<p class="note small">Showing top 100 by OVR — refine the search.</p>`:''}</div>`;
}
function vPlayer(id){
  const p=B.pById.get(id);if(!p) return empty('Player not found','');
  const r=ratingsOf(p),v=value(r,p.pos,p.age),bd=B.D.board.find(x=>x.player_id===id);
  const kv=(o,fmt=x=>x)=>o&&Object.keys(o).length?`<div class="scroll"><table class="tbl">${Object.entries(o).map(([k,x])=>`<tr><td>${esc(k.replace(/_/g,' '))}</td><td class="n">${esc(fmt(x))}</td></tr>`).join('')}</table></div>`:empty('No data','');
  const c=p.contract||{};
  let h=`<button class="back" onclick="history.back()">‹ Back</button><div class="card"><h2>${esc(p.name)} <span class="chip blue">${esc(p.pos)}</span></h2>
   <div class="kpis"><div class="kpi"><div class="v">${ovr2k(v.ov)}</div><div class="l">Overall (OVR, 2K-style)</div></div><div class="kpi"><div class="v">${f1(v.val)}</div><div class="l">Value</div></div>
   ${bd?`<div class="kpi"><div class="v">${f1(bd.fit)}</div><div class="l">Pistons fit · #${bd.fitRank}</div></div><div class="kpi"><div class="v">#${bd.valRank}</div><div class="l">Board rank (value)${bd.likelyGone?' · likely gone':''}</div></div>`:''}</div>
   <h3>Profile</h3>${kv({team:p.team,age:p.age,height:p.height,weight:p.weight&&p.weight+' lb',college:p.college,hometown:p.hometown,experience:p.experience!=null?p.experience+' yrs':null,drafted:p.draft_round?`Round ${p.draft_round}, pick ${p.draft_pick}`:'—'})}
   <h3>Ratings</h3><div>${RK.map(k=>`<span class="chip">${RNAME[k]} ${gradeCell(r[k])}</span>`).join('')}</div>
   <h3>Contract</h3>${kv({loyalty:c.loyalty,greed:c.greed,'play for winner':c.play_for_winner,'bird years':c.bird_years,...Object.fromEntries((c.salary_by_year||[]).map((s,i)=>['year '+(i+1),money(s)])),total:money(c.total)})}
   <h3>Season averages</h3>${allZero(p.season_averages)?empty('Fills in once games are played',''):kv(p.season_averages)}
   <h3>Career totals</h3>${(()=>{const ca=p.stats?.career;return !ca||allZero(ca)?empty('Fills in once games are played','Season-by-season lines appear here as seasons complete.'):kv(ca);})()}
   ${(p.stats?.seasons||[]).length?'<h3>By season</h3>'+table((p.stats.columns||[]).map(c=>({k:c.toLowerCase().replace(/%/g,'_pct').replace(/3p/,'three_p').replace(/[^a-z0-9_]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,''),l:c})),p.stats.seasons):''}
   <h3>Career highs</h3>${allZero(p.career_highs)?empty('Fills in once games are played',''):kv(p.career_highs)}
   <h3>Achievements</h3>${kv(p.achievements)}
   <p class="note small"><a href="${esc(p.profile_url)}" target="_blank" rel="noopener">View on league site ↗</a></p></div>`;
  return h;
}

/* ---------- Cap & Aprons rules + tax calculator ---------- */
function capRulesHtml(q){
  const c=CR();if(!c.luxury_tax) return '';const ql=(q||'').toLowerCase(),ex=c.exceptions||{};
  const secs=(c.sections||[]).filter(sc=>!ql||(sc.title+' '+sc.items.join(' ')).toLowerCase().includes(ql));
  const showAll=!ql||'cap apron tax floor exception mle salary hard'.split(' ').some(w=>ql.includes(w)||w.includes(ql));
  if(!secs.length&&!showAll) return '';
  let h=`<div class="card" id="capaprons"><h2>Cap & Aprons <span class="chip">${esc(c._meta?.season||'')} season</span></h2>
   ${table([{k:'l',l:'Item'},{k:'v',l:'Amount',n:1,f:mm},{k:'d',l:'vs cap',n:1}],[
      {l:'Salary floor (90%)',v:c.salary_floor,d:'−'+mm(c.salary_cap-c.salary_floor)},{l:'Salary cap',v:c.salary_cap,d:'—'},{l:'Luxury tax',v:c.luxury_tax,d:'+'+mm(c.luxury_tax-c.salary_cap)},
      {l:'1st apron',v:c.first_apron,d:'+'+mm(c.first_apron-c.salary_cap)},{l:'2nd apron',v:c.second_apron,d:'+'+mm(c.second_apron-c.salary_cap)}])}
   <h3>Exceptions</h3>${table([{k:'l',l:'Exception'},{k:'v',l:'Amount',n:1,f:mm},{k:'w',l:'Who can use it'}],[
      {l:'Non-Taxpayer MLE',v:ex.non_taxpayer_mle,w:'over-cap teams below the 1st apron (hard cap at 1st apron)'},{l:'Bi-Annual Exception',v:ex.bi_annual_exception,w:'over-cap teams below the 1st apron (hard cap at 1st apron)'},
      {l:'Taxpayer MLE',v:ex.taxpayer_mle,w:'teams above the 1st apron, below the 2nd (hard cap at 2nd apron)'},{l:'Room Exception',v:ex.room_exception,w:'teams that used cap room (under-the-cap mode)'}])}
   <div class="note small" style="margin-top:6px"><a href="#rules/tax">Luxury tax calculator ↓</a></div></div>`;
  secs.forEach(sc=>{h+=`<div class="card rule" id="cap-${sc.id}"><h2>${esc(sc.title)}</h2><ul class="rl">${sc.items.map(i=>`<li>${hl(i,q)}</li>`).join('')}</ul>`;
    if(sc.id==='tax'){const b=c.luxury_tax_brackets;h+=`<h3>Tax brackets (per $1 over the tax line)</h3>`+table([{k:'br',l:'Amount over tax'},{k:'n',l:'Non-repeater',n:1},{k:'r',l:'Repeater',n:1}],
      [...b.rates.map(r=>({br:`${mm(r.from)} – ${mm(r.to)}`,n:'$'+r.non_repeater.toFixed(2),r:'$'+r.repeater.toFixed(2)})),{br:`each further ${mm(b.increment)}`,n:'+$'+b.each_further_increment_adds.toFixed(2),r:'+$'+b.each_further_increment_adds.toFixed(2)}]);}
    if(sc.id==='hardcap'&&c.hard_cap_triggers) h+=`<h3>Triggers</h3>`+table([{k:'action',l:'If you…'},{k:'at',l:'Hard cap at'}],c.hard_cap_triggers.map(t=>({action:t.action,at:t.hard_cap_at==='first_apron'?'1st apron '+mm(c.first_apron):'2nd apron '+mm(c.second_apron)})))+`<p class="note small">${esc(c.hard_cap_note||'')}</p>`;
    h+=`</div>`;});
  // calculator
  const pay=SET.get('taxPay',null)??payrollOf(B.myTeam),rep=SET.get('taxRep',false);
  h+=`<div class="card" id="taxcalc"><h2>Luxury tax calculator</h2>
   <div class="controls"><label class="note" style="display:flex;align-items:center;gap:8px;flex:1 1 100%">Tax salary $<input id="tpay" inputmode="numeric" style="flex:1;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:0 10px;font-size:16px" value="${pay}"></label>
   <button class="ghost" id="tuse">Use Pistons payroll</button><button class="ghost" id="tover5">Tax line + $5M</button><button class="ghost" id="trep">${rep?'✓ ':''}Repeater</button></div>
   <div id="tout">${taxOut(pay,rep)}</div>
   <p class="note small">Self-check: non-repeater $5,000,000 over → ${money(luxTax(5e6,false).tax)} (${luxTax(5e6,false).tax===8855000?'✓ matches the league example $8,855,000':'✗ mismatch'}).</p></div>`;
  return h;}
function taxOut(pay,rep){const c=CR(),over=pay-c.luxury_tax,r=luxTax(over,rep);
  if(over<=0) return `<div class="kpis"><div class="kpi"><div class="v">$0</div><div class="l">${mm(-over)} under the tax line (${mm(c.luxury_tax)})</div></div><div class="kpi"><div class="v">${statusChip(pay)}</div><div class="l">Status at ${mm(pay)}</div></div></div>`;
  return `<div class="kpis"><div class="kpi"><div class="v">${money(r.tax)}</div><div class="l">Tax owed${rep?' (repeater)':''}</div></div><div class="kpi"><div class="v">${mm(over)}</div><div class="l">Over the tax line · ${statusChip(pay)}</div></div></div>`+
    table([{k:'br',l:'Bracket'},{k:'amt',l:'Amount',n:1,f:mm},{k:'rate',l:'Rate',n:1,f:v=>'$'+v.toFixed(2)},{k:'tax',l:'Tax',n:1,f:v=>money(Math.round(v))}],r.rows);}

/* ---------- Rules (our own summaries: manual/league_rules.json + cap_rules.json) ---------- */
function hl(t,q){const e=esc(t);if(!q)return e;const rx=new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');return e.replace(rx,'<mark>$1</mark>');}
function vRules(){
  const RS=(B.rules&&B.rules.sections)||[],F=B.facts||{};
  const q=(S.rq||'').trim(),ql=q.toLowerCase();const secs=RS.filter(r=>!q||(r.title+' '+r.items.join(' ')).toLowerCase().includes(ql));
  let h=`<div class="card"><h2>League rules</h2><div class="controls"><input type="search" id="rq" placeholder="Search rules (e.g. clock, apron, lottery, cash)" value="${esc(q)}"></div>
   <p class="note small">Our own short summaries of the league's published rules — check with the commissioners for edge cases. Jump to: <a href="#rules" data-jump="capaprons">Cap & Aprons</a> · <a href="#rules" data-jump="taxcalc">Tax calculator</a> · ${secs.map(r=>`<a href="#rules" data-jump="rs-${r.id}">${esc(r.title)}</a>`).join(' · ')} · <a href="#trade">Trade checker →</a></p></div>`;
  secs.filter(r=>r.id==='overview'||r.id==='trades').forEach(r=>{h+=ruleCard(r,q);});
  h+=capRulesHtml(q);
  secs.filter(r=>r.id!=='overview'&&r.id!=='trades').forEach(r=>{h+=ruleCard(r,q);
    const lo=F.lottery_odds||{};
    if(r.id==='lottery'&&(lo.by_pick||[]).length) h+=`<div class="card"><h2>Default lottery odds</h2>${table([{k:'pick',l:'Pick',n:1},{k:'relegation_zone',l:'Releg.',n:1,f:v=>v+'%'},{k:'three_balls',l:'3 balls',n:1,f:v=>v+'%'},{k:'two_balls',l:'2 balls',n:1,f:v=>v+'%'},{k:'one_ball',l:'1 ball',n:1,f:v=>v+'%'}],lo.by_pick)}
     ${table([{k:'group',l:'Group'},{k:'top3',l:'Top 3',n:1,f:v=>v+'%'},{k:'top5',l:'Top 5',n:1,f:v=>v+'%'},{k:'top10',l:'Top 10',n:1,f:v=>v+'%'},{k:'avg_pick',l:'Avg pick',n:1}],lo.summary||[])}<p class="note small">Assumes no lottery team is under a #1 or top-5 restriction.</p></div>`;});
  if(F.gms&&!q) h+=`<div class="card"><h2>GM list</h2>${table([{k:'team',l:'Team'},{k:'gm',l:'GM'}],Object.entries(F.gms).map(([team,gm])=>({team,gm})),{me:r=>r.team===B.myTeam.name})}</div>`;
  if(!secs.length&&q&&!h.includes('id="capaprons"')) h+=empty('No matching rules','Try another word.');
  return h;
}
const ruleCard=(r,q)=>`<div class="card rule" id="rs-${r.id}"><h2>${esc(r.title)}</h2><ul class="rl">${r.items.map(i=>`<li>${hl(i,q)}</li>`).join('')}</ul></div>`;

/* ---------- Trade checker (rules: cap_rules.json → trade; league text in manual/trade_rules_full.md) ---------- */
const TRD=()=>{const t=CR().trade||{},o=SET.get('tradeRules',{})||{},a=t.assumed||{},lc=t.league_cash||{};
  return {tiers:(o.tiers||t.matching_tiers||[]).map(x=>({...x})),maxOut:o.maxOut??t.max_players_out??5,
    cashMax:o.cashMax??(CR().exceptions?.taxpayer_mle?Math.floor(CR().exceptions.taxpayer_mle/1e6)*1e6:(lc.max_per_trade??1000000)),cashQ2:lc.qualifying_min_two_team??110000,cashQM:lc.qualifying_min_multi_team??1100000,
    rosterMax:o.rosterMax??(a.roster_max||{}).value??15,rosterMin:o.rosterMin??(a.roster_min||{}).value??13,
    minSal:o.minSal??(a.min_salary_max||{}).value??1138500,absorb:o.absorb??((a.cap_room_absorption||{}).enabled!==false),
    stepien:o.stepien??((a.stepien||{}).enabled!==false),aboveApronPct:t.above_apron_max_incoming_pct??1.0,stPct:t.sign_and_trade_outgoing_pct_of_new??0.5,raw:t};};
function tierMax(out,tiers){const t=tiers.find(x=>x.up_to==null||out<=x.up_to)||tiers[tiers.length-1];return {max:Math.round(out*t.pct+t.plus),t};}
const TS={get(){const s=SET.get('trade',null);if(s&&s.teams&&s.teams.length>=2)return s;
  const other=(B.teams.find(t=>t.team_id!==B.myTeam.team_id&&(t.players||[]).length)||B.teams.find(t=>t.team_id!==B.myTeam.team_id)).team_id;
  return {teams:[B.myTeam.team_id,other],assets:[],cash:{},bal:{},adj:{},hc:{},rep:{},open:null};},
  set(s){SET.set('trade',s);}};
const tById=id=>B.teams.find(t=>t.team_id===+id);
const yrsLeft=p=>Object.values(p.salary||{}).filter(v=>v>1).length;
const sal1=p=>(p.salary||{}).year_1||0;
const pickKey=p=>`${p.season}-${p.round}-${p.original_team_id}`;
const pickLbl=p=>`${p.season} R${p.round}${p.original_team?` (${p.original_team})`:''}`;
function assetInfo(a){ // resolve an asset in the package → {name,sal,isPlayer,isPick,pick}
  const t=tById(a.from);
  if(a.kind==='player'){const p=(t.players||[]).find(x=>x.player_id===a.id)||{};return {name:p.name||'?',pos:p.pos,sal:sal1(p),yrs:yrsLeft(p),isPlayer:true};}
  if(a.kind==='custom') return {name:a.name||'Hypothetical player',sal:+a.sal||0,isPlayer:true,custom:true};
  const pk=(t.draft_picks||[]).find(x=>pickKey(x)===a.id);return {name:pk?pickLbl(pk):a.id,sal:0,isPick:true,pick:pk};}
function ppIn(a,i){const y=+a.ppy||0,tot=+a.ppt||0;return y>0&&tot>0?Math.round((i.sal+tot)/(1+y)):(+a.ppin||i.sal);} // poison pill: avg of current salary + all extension years
function assetFlag(a,info,R){return a.flag||(info.isPlayer&&info.sal>0&&info.sal<=R.minSal?'min':'std');}
function tradeEval(st){
  const c=CR(),R=TRD(),multi=st.teams.length>2,res=[],ck=[];
  const add=(lvl,msg,src,team)=>ck.push({lvl,msg,src,team});
  const draftLive=((B.facts||{}).creation_draft||{}).rounds?.some(r=>!r.complete);
  const _rd=((B.facts||{}).creation_draft||{}).rounds||[],draftR2=_rd.some(r=>r.round===1&&r.complete)&&_rd.some(r=>!r.complete); // current draft has reached round 2
  const cashSenders=st.teams.filter(id=>(+((st.cash[id]||{}).amt)||0)>0);
  st.teams.forEach(id=>{
    const t=tById(id),nm=t.name.replace(/^.* /,''),out=st.assets.filter(a=>a.from===id),inn=st.assets.filter(a=>a.to===id);
    let outAct=0,inAct=0,outCnt=0,inCnt=0,outP=0,inP=0,stIn=false,stOut=false;const partners=new Set();
    out.forEach(a=>{const i=assetInfo(a),f=assetFlag(a,i,R);partners.add(a.to);if(i.isPlayer){outP++;outAct+=i.sal;
      outCnt+=f==='st'?Math.max(+a.prev||0,R.stPct*(+a.nsal||i.sal)):i.sal; if(f==='st')stOut=true;}});
    inn.forEach(a=>{const i=assetInfo(a),f=assetFlag(a,i,R);partners.add(a.from);if(i.isPlayer){inP++;
      const act=f==='st'?(+a.nsal||i.sal):i.sal;inAct+=act;inCnt+=f==='min'?0:f==='pp'?ppIn(a,i):act;if(f==='st')stIn=true;}});
    const cs=st.cash[id]||{},cashOut=+cs.amt||0;if(cashOut>0&&cs.to)partners.add(+cs.to);
    const cashIn=st.teams.filter(o=>o!==id&&+((st.cash[o]||{}).to)===id).reduce((s,o)=>s+(+st.cash[o].amt||0),0);
    st.teams.forEach(o=>{if(o!==id&&+((st.cash[o]||{}).to)===id&&(+st.cash[o].amt||0)>0)partners.add(o);});
    const adj=+st.adj[id]||0,pre=capMath(t,{addSalary:adj}),post=capMath(t,{addSalary:adj+inAct-outAct,addPlayers:inP-outP});
    const rep=id===B.myTeam.team_id?(st.rep[id]??SET.get('repeater',false)):!!st.rep[id];
    const taxPre=luxTax(pre.tax-c.luxury_tax,rep).tax,taxPost=luxTax(post.tax-c.luxury_tax,rep).tax;
    const r={id,t,nm,out,inn,outAct,inAct,outCnt,inCnt,outP,inP,pre,post,taxPre,taxPost,cashOut,cashIn,rosterPre:(t.players||[]).length,rosterPost:(t.players||[]).length+inP-outP,mode:'',maxIn:null};
    const aboveApron=post.tax>c.first_apron,above2=post.tax>c.second_apron; // apron status is determined AFTER the trade
    // salary matching
    if(inCnt<=outCnt){r.mode='≤100%';add('pass',`${nm}: takes back ${mm(inCnt)} for ${mm(outCnt)} out (≤100%) — no matching needed, no hard cap`,'League',id);}
    else if(R.absorb&&post.cap<=c.salary_cap){r.mode='cap room';add('pass',`${nm}: absorbs ${mm(inCnt-outCnt)} into cap room (cap salary after ${mm(post.cap)} ≤ cap ${mm(c.salary_cap)})`,'Assumed',id);}
    else if(aboveApron){r.mode='100% (apron)';r.maxIn=outCnt*R.aboveApronPct;
      add('fail',`${nm}: above the ${above2?'2nd':'1st'} apron after the trade (${mm(post.tax)}) → incoming ${mm(inCnt)} may not exceed 100% of outgoing ${mm(outCnt)}`,'League',id);}
    else{const tm=tierMax(outCnt,R.tiers);r.maxIn=tm.max;r.mode=tm.t.label||'table';
      if(inCnt<=tm.max) add('warn',`${nm}: matching table OK (${mm(inCnt)} in ≤ ${mm(tm.max)} max; ${tm.t.label||''}) — this hard-caps ${nm} at the 1st apron (${mm(c.first_apron)}) for the season`,'League',id);
      else add('fail',`${nm}: below both aprons after the trade, so the matching table applies — incoming ${mm(inCnt)} exceeds the ${mm(tm.max)} max for ${mm(outCnt)} out (${tm.t.label||''}); needs ${mm(inCnt-tm.max)} more outgoing or less incoming`,'League',id);}
    if(inn.some(a=>assetFlag(a,assetInfo(a),R)==='min')) add('info',`${nm}: minimum-salary players are not counted as incoming salary`,'League',id);
    // player count / qualifying / receiving
    if(outP>R.maxOut) add('fail',`${nm}: sends ${outP} players (max ${R.maxOut} per team)`,'League',id);
    const qCash=multi?R.cashQM:R.cashQ2,qual=out.some(a=>{const i=assetInfo(a);return (i.isPlayer&&i.sal>0)||i.isPick;})||cashOut>=qCash;
    if(!qual) add('fail',`${nm}: must send a qualifying asset (${multi?'player under contract, future pick, stashed rights, or ≥ '+mm(qCash)+' league cash — pick swaps don\'t qualify in multi-team deals':'player under contract, future pick, stashed rights, unencumbered pick swap, or ≥ '+mm(qCash)+' league cash'})`,'League',id);
    if(!inn.length&&!cashIn) add('fail',`${nm}: receives nothing`,'League',id);
    if(multi&&partners.size<2) add('fail',`${nm}: in a multi-team trade each team must deal with at least two other teams`,'League',id);
    // aggregation & special players
    const salOut=out.filter(a=>assetInfo(a).isPlayer&&assetInfo(a).sal>0);
    if(above2&&salOut.length>1) add('fail',`${nm}: above the 2nd apron after the trade — can't aggregate salaries (${salOut.length} salaried players out)`,'League',id);
    else if(salOut.length>1&&!above2) add('info',`${nm}: aggregates ${salOut.length} salaries — allowed below the 2nd apron`,'League',id);
    out.forEach(a=>{const i=assetInfo(a),f=assetFlag(a,i,R);
      if(f==='untr') add('fail',`${nm}: ${i.name} isn't tradable yet (waiver claim: 20 days; new signing: 40–60 days)`,'League',id);
      if(f==='acq'&&salOut.length>1) add('fail',`${nm}: ${i.name} was acquired by trade <40 days ago — must be traded alone, not aggregated (unless he was acquired into cap room)`,'League',id);});
    if(stOut&&above2) add('fail',`${nm}: above the 2nd apron — can't send a player out via sign-and-trade`,'League',id);
    if(stIn){if(aboveApron) add('fail',`${nm}: above the 1st apron after the trade — can't acquire a sign-and-trade player`,'League',id);
      else add('warn',`${nm}: acquiring via sign-and-trade hard-caps ${nm} at the 1st apron`,'League',id);}
    // league cash
    if(cashOut>0){
      if(cashOut<R.cashQ2) add('fail',`${nm}: league cash ${money(cashOut)} is below the ${money(R.cashQ2)} minimum`,'League',id);
      if(cashOut>R.cashMax) add('fail',`${nm}: league cash ${money(cashOut)} is above the per-trade max ${money(R.cashMax)} (Taxpayer MLE rounded down to the nearest $1M)`,'League',id);
      if(above2) add('fail',`${nm}: above the 2nd apron after the trade — can't send league cash`,'League',id);
      if(cs.bal!==''&&cs.bal!=null&&!isNaN(+cs.bal)&&cashOut>+cs.bal) add('fail',`${nm}: sends ${money(cashOut)} league cash but only has ${money(+cs.bal)}`,'League',id);
      else if(cs.bal===''||cs.bal==null) add('check',`${nm}: confirm the league-cash balance covers ${money(cashOut)} (balance not entered)`,'Checklist',id);
      if(!cs.to) add('fail',`${nm}: choose who receives the league cash`,'League',id);}
    const soldForCash=!inn.length&&cashIn>0;
    if(soldForCash&&out.some(a=>{const i=assetInfo(a);return i.isPick&&i.pick&&i.pick.round===1;})) add('fail',`${nm}: 1st-round picks can never be sold for league cash`,'League',id);
    if(soldForCash&&draftR2&&out.some(a=>{const i=assetInfo(a);return i.isPick&&i.pick&&i.pick.round===2;})) add('fail',`${nm}: 2nd-round picks can't be sold while the current rookie draft is in round 2`,'League',id);
    // hard cap (manual)
    const hc=st.hc[id];if(hc&&hc!=='none'&&post.tax>c[hc]) add('fail',`${nm}: hard-capped at the ${hc==='first_apron'?'1st':'2nd'} apron (${mm(c[hc])}) — post-trade ${mm(post.tax)} exceeds it`,'League',id);
    // roster
    if(r.rosterPost>R.rosterMax) add('fail',`${nm}: roster would be ${r.rosterPost} (max ${R.rosterMax}) — needs roster space when posting`,'Assumed',id);
    else if(r.rosterPost<R.rosterMin) add('info',`${nm}: roster ${r.rosterPost} after the trade (in-season minimum ${R.rosterMin}; fine in the offseason/draft)`,'Assumed',id);
    if(post.tax<c.salary_floor) add('warn',`${nm}: ${mm(c.salary_floor-post.tax)} below the salary floor after the trade — auto-signings if still short when offseason FA ends`,'League',id);
    if(taxPost!==taxPre) add('info',`${nm}: projected luxury tax ${money(taxPre)} → ${money(taxPost)}${rep?' (repeater)':''}`,'League',id);
    // Stepien
    if(R.stepien){const own=new Set((t.draft_picks||[]).filter(p=>p.round===1).map(pickKey));
      out.forEach(a=>{const i=assetInfo(a);if(i.isPick)own.delete(a.id);});inn.forEach(a=>{const i=assetInfo(a);if(i.isPick&&i.pick&&i.pick.round===1)own.add(a.id);});
      const all=B.teams.flatMap(x=>(x.draft_picks||[]).filter(p=>p.round===1)),yrs=[...new Set(all.map(p=>p.season))].sort();
      const has=y=>[...own].some(k=>+k.split('-')[0]===y);
      for(let i=0;i+1<yrs.length;i++) if(!has(yrs[i])&&!has(yrs[i+1])&&(out.some(a=>assetInfo(a).isPick))){add('fail',`${nm}: would have no 1st-round pick in both ${yrs[i]} and ${yrs[i+1]} (Stepien rule)`,'Assumed',id);break;}}
    res.push(r);});
  if(cashSenders.length>1) add('fail',`Only one team may send league cash (${cashSenders.length} teams are sending)`,'League');
  if(draftLive) add('warn','The creation draft is still running — the league allows no trades of any kind until it ends. Use this as a planner for now.','League');
  if(!st.assets.length&&!cashSenders.length) add('info','Add players, picks or league cash to build a trade.','');
  const verdict=!st.assets.length&&!cashSenders.length?'empty':ck.some(x=>x.lvl==='fail')?'fail':'pass';
  return {res,ck,verdict,multi,R};}
function vTrade(){
  const st=TS.get(),c=CR(),R=TRD(),E=tradeEval(st);
  const teamOpts=sel=>B.teams.map(t=>`<option value="${t.team_id}" ${t.team_id===sel?'selected':''}>${esc(t.name)}</option>`).join('');
  let h=`<div class="card"><h2>Trade checker <span class="chip">${st.teams.length} teams</span></h2>
   <p class="note small">Pick teams, tap players or picks to add them, and the checker applies this league's trade rules (salary matching, aprons, hard caps, roster, league cash). Tags show where each rule comes from: <span class="src League">League</span> pasted league rules · <span class="src Assumed">Assumed</span> standard NBA where the league text is silent · <span class="src Checklist">Checklist</span> things the data can't show.</p>
   <div class="tteams">${st.teams.map((id,i)=>`<div class="trow"><select data-tteam="${i}" aria-label="Team ${i+1}">${teamOpts(id)}</select>${st.teams.length>2?`<button class="ghost" data-tdel="${i}" aria-label="Remove team">×</button>`:''}</div>`).join('')}</div>
   <div class="controls" style="margin-top:8px">${st.teams.length<4?'<button class="ghost" id="taddteam">+ Add team</button>':''}<button class="ghost" id="treset">Reset</button></div></div>`;
  // verdict
  const V={pass:['✅ Trade passes','ok'],fail:['❌ Trade fails','bad'],empty:['Build a trade','mut']}[E.verdict];
  const icon={pass:'✓',fail:'✗',warn:'⚠️',info:'ℹ',check:'☐'};
  h+=`<div class="card verdict ${V[1]}" id="tverdict"><h2>${V[0]}<span class="chip">${E.ck.filter(x=>x.lvl==='fail').length} fail · ${E.ck.filter(x=>x.lvl==='warn').length} warn</span></h2>
   <ul class="ck">${E.ck.filter(x=>x.lvl!=='check').sort((a,b)=>'fwip'.indexOf(a.lvl[0])-'fwip'.indexOf(b.lvl[0])).map(x=>`<li class="${x.lvl}"><span class="ic">${icon[x.lvl]}</span><span>${esc(x.msg)}${x.src?` <span class="src ${x.src}">${x.src}</span>`:''}</span></li>`).join('')}</ul></div>`;
  // summary table
  h+=`<div class="card"><h2>Salary & cap impact</h2>${table([{k:'nm',l:'Team'},{k:'outAct',l:'Out',n:1,f:mm},{k:'inAct',l:'In',n:1,f:mm},{k:'maxIn',l:'Max in',n:1,f:(v,r)=>r.mode==='cap room'?'room':r.mode==='≤100%'?'—':mm(v)},
     {k:'pre',l:'Payroll before',n:1,f:v=>mm(v.tax)},{k:'post',l:'After',n:1,f:v=>mm(v.tax)},{k:'st',l:'Status after',f:(v,r)=>statusChip(r.post.tax)},{k:'cap',l:'Cap salary after',n:1,f:(v,r)=>mm(r.post.cap)},
     {k:'vs',l:'vs Tax / A1 / A2',n:1,f:(v,r)=>[c.luxury_tax,c.first_apron,c.second_apron].map(x=>{const d=x-r.post.tax;return `<span class="${d<0?'neg':''}">${d<0?'+':'−'}${mm(Math.abs(d))}</span>`;}).join(' / ')},
     {k:'tax',l:'Lux. tax',n:1,f:(v,r)=>r.taxPre===r.taxPost?mm(r.taxPost):`${mm(r.taxPre)}→${mm(r.taxPost)}`},{k:'ro',l:'Roster',n:1,f:(v,r)=>`${r.rosterPre}→${r.rosterPost}`},
     {k:'cash',l:'League cash',n:1,f:(v,r)=>r.cashOut?'−'+mm(r.cashOut):r.cashIn?'+'+mm(r.cashIn):'—'}],E.res,{me:r=>r.id===B.myTeam.team_id})}
   <p class="note small">"In/Out" are actual salaries; matching uses counted salary (min-salary players don't count as incoming; sign-and-trade and poison-pill rules apply). Payroll is tax salary; cap salary adds the offseason incomplete-roster charge (rookie min ${mm(rookieMin().v)}${rookieMin().src==='placeholder'?' — placeholder':''}). League cash never touches payroll.</p></div>`;
  // per-team cards
  E.res.forEach(r=>{const id=r.id,t=r.t,others=st.teams.filter(x=>x!==id),cs=st.cash[id]||{};
    const inPkg=new Set(st.assets.filter(a=>a.from===id).map(a=>a.kind+':'+a.id));
    h+=`<div class="card tteam" id="tt-${id}"><h2>${esc(t.name)} ${statusChip(r.pre.tax)}</h2>
     <div class="note small">Payroll ${mm(r.pre.tax)} → <b>${mm(r.post.tax)}</b> · roster ${r.rosterPre} → ${r.rosterPost} · counted out ${mm(r.outCnt)} / in ${mm(r.inCnt)}</div>
     <h3>Sends</h3>${r.out.length?r.out.map(a=>{const i=assetInfo(a),f=assetFlag(a,i,R),k=st.assets.indexOf(a);
       return `<div class="pkg"><div class="pk1"><b>${i.isPlayer&&!i.custom?plink(i.name,a.id):esc(i.name)}</b> <span class="note small">${i.pos?esc(i.pos)+' · ':''}${i.isPick?'draft pick':mm(i.sal)+(i.yrs?` · ${i.yrs} yr${i.yrs>1?'s':''}`:'')}${i.custom?' · hypothetical':''}</span><button class="ghost x" data-trm="${k}" aria-label="Remove">×</button></div>
        <div class="pk2">${others.length>1?`<select data-tto="${k}" aria-label="Send to">${others.map(o=>`<option value="${o}" ${o===a.to?'selected':''}>→ ${esc(tById(o).name.replace(/^.* /,''))}</option>`).join('')}</select>`:`<span class="note small">→ ${esc(tById(a.to).name)}</span>`}
        ${i.isPlayer?`<select data-tflag="${k}" aria-label="Contract type"><option value="std" ${f==='std'?'selected':''}>Standard</option><option value="min" ${f==='min'?'selected':''}>Minimum contract</option><option value="st" ${f==='st'?'selected':''}>Sign-and-trade</option><option value="pp" ${f==='pp'?'selected':''}>Poison pill (extended)</option><option value="acq" ${f==='acq'?'selected':''}>Acquired by trade &lt;40 days</option><option value="untr" ${f==='untr'?'selected':''}>Not tradable yet (new signing/waivers)</option></select>`:''}</div>
        ${f==='st'?`<div class="pk2"><label class="note small">Prev salary <input data-tnum="${k}:prev" inputmode="numeric" value="${esc(a.prev||'')}"></label><label class="note small">New salary <input data-tnum="${k}:nsal" inputmode="numeric" value="${esc(a.nsal||i.sal)}"></label></div>`:''}
        ${f==='pp'?`<div class="pk2"><label class="note small">Extension years <input data-tnum="${k}:ppy" inputmode="numeric" value="${esc(a.ppy||'')}" style="width:60px"></label><label class="note small">Extension total $ <input data-tnum="${k}:ppt" inputmode="numeric" value="${esc(a.ppt||'')}"></label><span class="note small">Counts ${mm(i.sal)} out for this team; incoming for the receiver = (current + extension total) ÷ (1 + years) = ${mm(ppIn(a,i))}</span></div>`:''}</div>`;}).join(''):'<div class="note small">Nothing yet — tap below.</div>'}
     <details ${st.open===id||!r.out.length?'open':''}><summary>Add players & picks</summary>
      <div class="plist">${(t.players||[]).map(p=>`<div class="row ${inPkg.has('player:'+p.player_id)?'sel':''}" data-tadd="${id}:player:${p.player_id}"><div><div class="nm">${esc(p.name)}</div><div class="meta">${esc(p.pos)} · age ${p.age} · ${yrsLeft(p)} yr${yrsLeft(p)!==1?'s':''} left</div></div><div class="sc">${mm(sal1(p))}</div></div>`).join('')||'<div class="note small">No players on the stats-site roster yet.</div>'}</div>
      <div class="pchips">${(t.draft_picks||[]).map(p=>`<button class="ghost ${inPkg.has('pick:'+pickKey(p))?'on':''}" data-tadd="${id}:pick:${pickKey(p)}">${esc(pickLbl(p))}</button>`).join('')}</div>
      <div class="pk2"><input data-tcname="${id}" placeholder="Hypothetical player" style="flex:1"><input data-tcsal="${id}" inputmode="numeric" placeholder="Salary $" style="width:110px"><button class="ghost" data-tcadd="${id}">Add</button></div></details>
     <details><summary>League cash${cs.amt?` · sending ${mm(+cs.amt)}`:''}</summary>
      <p class="note small">League cash is a separate in-league currency, outside the cap — it never counts as salary. Balances aren't scraped, so enter one to check it.</p>
      <div class="pk2"><label class="note small">Send $<input data-tcash="${id}:amt" inputmode="numeric" value="${esc(cs.amt||'')}"></label><select data-tcashto="${id}" aria-label="Cash to"><option value="">to…</option>${others.map(o=>`<option value="${o}" ${+cs.to===o?'selected':''}>${esc(tById(o).name.replace(/^.* /,''))}</option>`).join('')}</select></div>
      <div class="pk2"><label class="note small">Balance $ (optional)<input data-tcash="${id}:bal" inputmode="numeric" value="${esc(cs.bal??'')}"></label></div></details>
     <details><summary>Status & what-if</summary>
      <div class="pk2"><label class="note small">Hard-capped at <select data-thc="${id}"><option value="none">not hard-capped</option><option value="first_apron" ${st.hc[id]==='first_apron'?'selected':''}>1st apron</option><option value="second_apron" ${st.hc[id]==='second_apron'?'selected':''}>2nd apron</option></select></label></div>
      <div class="pk2"><label class="note small">Payroll what-if adjustment $<input data-tadj="${id}" inputmode="numeric" value="${esc(st.adj[id]||'')}"></label><button class="ghost" data-trep="${id}">${(id===B.myTeam.team_id?(st.rep[id]??SET.get('repeater',false)):st.rep[id])?'✓ ':''}Tax repeater</button></div></details></div>`;});
  // checklist
  const chk=E.ck.filter(x=>x.lvl==='check').map(x=>x.msg).concat([
    'No player in the deal was claimed off waivers in the last 20 in-game days, or signed in the last 40 days (60 if signed after camp, or before camp with Bird rights and a >20% raise).',
    'Sign-and-trade / recently extended players are flagged above (contract-type menu) — signing and extension dates aren\'t on the stats site.',
    'Players acquired by trade in the last 40 days are flagged so they aren\'t aggregated.',
    'Nobody is reacquiring a player they traded away or released earlier this league year.',
    'Each team has roster space when the trade is posted; any releases go in the Waiver Wire thread (final).',
    'Pick protections can never leave a pick conveying nothing; 2nd-round picks aren\'t sold once the rookie draft reaches round 2.',
    'Stashed overseas rights and pick swaps aren\'t modelled — add them to the post by hand.',
    'Multi-team deals: every pick used as a qualifying asset has protections that can\'t leave it conveying nothing.',
    'The official Trade Machine thread is on the league forum — post the final trade there.',
    'Post team-by-team what each side sends and receives (and from whom) before the scheduled sim.']);
  h+=`<div class="card"><h2>Checklist <span class="src Checklist">Checklist</span></h2><ul class="ck">${chk.map(x=>`<li class="check"><span class="ic">☐</span><span>${esc(x)}</span></li>`).join('')}</ul></div>`;
  // settings
  h+=`<div class="card"><details><summary><b>Rule settings</b> <span class="note small">(defaults from cap_rules.json)</span></summary>
    <p class="note small">${esc(R.raw.matching_tiers_note||'')}</p>
    ${R.tiers.map((x,i)=>`<div class="pk2"><span class="note small" style="flex:1 1 100%">Tier ${i+1} <span class="src League">League</span></span><label class="note small">Up to $<input data-tset="tier:${i}:up_to" inputmode="numeric" value="${x.up_to??''}" placeholder="no limit" ${x.up_to==null?'disabled':''}></label><label class="note small">× <input data-tset="tier:${i}:pct" inputmode="decimal" value="${x.pct}" style="width:64px"></label><label class="note small">+ $<input data-tset="tier:${i}:plus" inputmode="numeric" value="${x.plus}"></label></div>`).join('')}
    <div class="pk2"><label class="note small">Max players out <span class="src League">League</span><input data-tset="maxOut" inputmode="numeric" value="${R.maxOut}" style="width:60px"></label><label class="note small">League cash max $ <span class="src League">League</span><input data-tset="cashMax" inputmode="numeric" value="${R.cashMax}"></label></div>
    <div class="pk2"><label class="note small">Roster max <span class="src Assumed">Assumed</span><input data-tset="rosterMax" inputmode="numeric" value="${R.rosterMax}" style="width:60px"></label><label class="note small">Roster min <span class="src Assumed">Assumed</span><input data-tset="rosterMin" inputmode="numeric" value="${R.rosterMin}" style="width:60px"></label></div>
    <div class="pk2"><label class="note small">Min-contract flag ≤ $ <span class="src Assumed">Placeholder</span><input data-tset="minSal" inputmode="numeric" value="${R.minSal}"></label></div>
    <div class="pk2"><button class="ghost" data-ttog="absorb">${R.absorb?'✓ ':''}Cap-room absorption</button><span class="src Assumed">Assumed</span><button class="ghost" data-ttog="stepien">${R.stepien?'✓ ':''}Stepien rule</button><span class="src Assumed">Assumed</span><button class="ghost" id="tsetreset">Reset settings</button></div>
    <p class="note small">${esc(((R.raw.assumed||{}).min_salary_max||{}).label||'')}</p></details></div>`;
  return h;}
function tradeBind(){
  if(S.tab!=='trade')return;const st=TS.get(),save=(s,id)=>{if(id!=null)s.open=id;TS.set(s);route(null,true);};
  const num=v=>{const n=parseInt(String(v).replace(/[^0-9-]/g,''),10);return isNaN(n)?'':n;};
  const fixTo=s=>{s.assets.forEach(a=>{if(!s.teams.includes(a.to)||a.to===a.from)a.to=s.teams.find(x=>x!==a.from);});Object.keys(s.cash).forEach(k=>{if(!s.teams.includes(+k))delete s.cash[k];else if(s.cash[k].to&&!s.teams.includes(+s.cash[k].to))s.cash[k].to='';});};
  document.querySelectorAll('[data-tteam]').forEach(el=>el.addEventListener('change',()=>{const i=+el.dataset.tteam,v=+el.value;if(st.teams.includes(v)){route(null,true);return;}
    const old=st.teams[i];st.teams[i]=v;st.assets=st.assets.filter(a=>a.from!==old);fixTo(st);save(st);}));
  document.querySelectorAll('[data-tdel]').forEach(el=>el.addEventListener('click',()=>{const old=st.teams.splice(+el.dataset.tdel,1)[0];st.assets=st.assets.filter(a=>a.from!==old);delete st.cash[old];fixTo(st);save(st);}));
  const at=document.getElementById('taddteam');if(at)at.addEventListener('click',()=>{const n=B.teams.find(t=>!st.teams.includes(t.team_id)&&(t.players||[]).length)||B.teams.find(t=>!st.teams.includes(t.team_id));st.teams.push(n.team_id);save(st);});
  const rs=document.getElementById('treset');if(rs)rs.addEventListener('click',()=>{SET.set('trade',null);route(null,true);});
  const sr=document.getElementById('tsetreset');if(sr)sr.addEventListener('click',()=>{SET.set('tradeRules',{});route(null,true);});
  document.querySelectorAll('[data-tadd]').forEach(el=>el.addEventListener('click',()=>{const [from,kind,...rest]=el.dataset.tadd.split(':'),f=+from,id=kind==='player'?+rest[0]:rest.join(':');
    const ix=st.assets.findIndex(a=>a.from===f&&a.kind===kind&&a.id===id);if(ix>=0)st.assets.splice(ix,1);else st.assets.push({kind,id,from:f,to:st.teams.find(x=>x!==f)});save(st,f);}));
  document.querySelectorAll('[data-tcadd]').forEach(el=>el.addEventListener('click',()=>{const f=+el.dataset.tcadd,nm=document.querySelector(`[data-tcname="${f}"]`).value,sv=num(document.querySelector(`[data-tcsal="${f}"]`).value);
    if(!sv)return;st.assets.push({kind:'custom',id:'c'+Date.now(),name:nm||'Hypothetical player',sal:sv,from:f,to:st.teams.find(x=>x!==f)});save(st,f);}));
  document.querySelectorAll('[data-trm]').forEach(el=>el.addEventListener('click',()=>{st.assets.splice(+el.dataset.trm,1);save(st);}));
  document.querySelectorAll('[data-tto]').forEach(el=>el.addEventListener('change',()=>{st.assets[+el.dataset.tto].to=+el.value;save(st);}));
  document.querySelectorAll('[data-tflag]').forEach(el=>el.addEventListener('change',()=>{st.assets[+el.dataset.tflag].flag=el.value;save(st);}));
  document.querySelectorAll('[data-tnum]').forEach(el=>el.addEventListener('change',()=>{const [k,f]=el.dataset.tnum.split(':');st.assets[+k][f]=num(el.value);save(st);}));
  document.querySelectorAll('[data-tcash]').forEach(el=>el.addEventListener('change',()=>{const [id,f]=el.dataset.tcash.split(':');st.cash[id]=st.cash[id]||{};st.cash[id][f]=num(el.value);if(f==='amt'&&!st.cash[id].to&&st.teams.length===2)st.cash[id].to=st.teams.find(x=>x!==+id);save(st,+id);}));
  document.querySelectorAll('[data-tcashto]').forEach(el=>el.addEventListener('change',()=>{const id=el.dataset.tcashto;st.cash[id]=st.cash[id]||{};st.cash[id].to=el.value?+el.value:'';save(st,+id);}));
  document.querySelectorAll('[data-thc]').forEach(el=>el.addEventListener('change',()=>{st.hc[el.dataset.thc]=el.value;save(st);}));
  document.querySelectorAll('[data-tadj]').forEach(el=>el.addEventListener('change',()=>{st.adj[el.dataset.tadj]=num(el.value)||0;save(st);}));
  document.querySelectorAll('[data-trep]').forEach(el=>el.addEventListener('click',()=>{const id=+el.dataset.trep,cur=id===B.myTeam.team_id?(st.rep[id]??SET.get('repeater',false)):!!st.rep[id];st.rep[id]=!cur;save(st);}));
  const RS=SET.get('tradeRules',{})||{},Rr=TRD();
  document.querySelectorAll('[data-tset]').forEach(el=>el.addEventListener('change',()=>{const k=el.dataset.tset;
    if(k.startsWith('tier:')){const [,i,f]=k.split(':');RS.tiers=RS.tiers||Rr.tiers;const v=f==='pct'?parseFloat(el.value):num(el.value);if(v===''||isNaN(v))return;RS.tiers[+i][f]=v;}
    else{const v=num(el.value);if(v==='')return;RS[k]=v;}SET.set('tradeRules',RS);route(null,true);}));
  document.querySelectorAll('[data-ttog]').forEach(el=>el.addEventListener('click',()=>{const k=el.dataset.ttog;RS[k]=!Rr[k];SET.set('tradeRules',RS);route(null,true);}));
}

/* ---------- events ---------- */
function bind(){
  tradeBind();
  fitTables();
  document.querySelectorAll('[data-href]:not(tr)').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('a'))return;location.hash=el.dataset.href.replace(/^#/,'');}));
  document.querySelectorAll('.tbl tbody').forEach(tb=>tb.addEventListener('click',e=>{const tr=e.target.closest('tr');if(!tr||tr.classList.contains('dt')||e.target.closest('a'))return;
    if(tr.parentElement!==tb)return;const tt=tr.closest('table');if(tt.classList.contains('hashid')||tt.dataset.id==='capx'){toggleDetail(tr);return;}if(tr.dataset.href)location.hash=tr.dataset.href.replace(/^#/,'');}));
  const on=(id,ev,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);};
  const rerender=(keepFocus)=>{const pos=keepFocus&&document.activeElement?.id;const sel=document.activeElement?.selectionStart;route(null,true);if(pos){const el=document.getElementById(pos);if(el){el.focus();try{el.setSelectionRange(sel,sel);}catch(e){}}}};
  on('dq','input',e=>{S.draft.q=e.target.value;rerender(true);});
  on('dpos','change',e=>{S.draft.pos=e.target.value;rerender();});
  on('dsort','change',e=>{S.draft.sort=e.target.value;S.draft.dir=['age'].includes(e.target.value)?1:-1;rerender();});
  on('dnear','click',()=>{S.draft.onlyNear=!S.draft.onlyNear;rerender();});
  on('dtaken','click',()=>{S.draft.showTaken=!S.draft.showTaken;rerender();});
  document.querySelectorAll('table[data-id=draft] th').forEach(th=>th.addEventListener('click',()=>{if(th.dataset.k==='grades')return;const k=th.dataset.k==='fitRank'?'fit':th.dataset.k;if(S.draft.sort===k)S.draft.dir*=-1;else{S.draft.sort=k;S.draft.dir=['name','pos','age'].includes(k)?1:-1;}rerender();}));
  document.querySelectorAll('[data-lsub]').forEach(b=>b.addEventListener('click',()=>{S.lsub=b.dataset.lsub;rerender();}));
  on('lcat','change',e=>{S.lcat=e.target.value;rerender();});
  on('cmp','change',e=>{S.cmp=+e.target.value;rerender();});
  on('posOnly','click',()=>{S.posOnly=!S.posOnly;rerender();});
  on('pq','input',e=>{S.pq=e.target.value;rerender(true);});
  on('rq','input',e=>{S.rq=e.target.value;rerender(true);});
  on('rmin','change',e=>{const v=parseInt(String(e.target.value).replace(/[^0-9]/g,''),10);SET.set('rookieMin',v>0?v:null);rerender(true);});
  on('usedRoom','click',()=>{SET.set('usedRoom',!SET.get('usedRoom',false));rerender(true);});
  const tcalc=()=>{const v=parseInt(String($('#tpay').value).replace(/[^0-9]/g,''),10)||0;SET.set('taxPay',v);$('#tout').innerHTML=taxOut(v,SET.get('taxRep',false));};
  on('tpay','input',tcalc);
  on('tuse','click',()=>{$('#tpay').value=payrollOf(B.myTeam);tcalc();});
  on('tover5','click',()=>{$('#tpay').value=CR().luxury_tax+5000000;tcalc();});
  on('trep','click',e=>{SET.set('taxRep',!SET.get('taxRep',false));e.target.textContent=(SET.get('taxRep',false)?'✓ ':'')+'Repeater';tcalc();});
  document.querySelectorAll('[data-jump]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();document.getElementById(a.dataset.jump)?.scrollIntoView({behavior:'smooth'});}));
  on('ppos','change',e=>{S.ppos=e.target.value;rerender();});
  if(S.tab==='analytics'){const A=S.an;
    document.querySelectorAll('[data-asub]').forEach(b=>b.addEventListener('click',()=>{A.sub=b.dataset.asub;rerender();}));
    on('aq','input',e=>{A.q=e.target.value;rerender(true);});
    on('ateam','change',e=>{A.team=e.target.value;rerender();});on('apos','change',e=>{A.pos=e.target.value;rerender();});on('amin','change',e=>{A.min=+e.target.value;rerender();});
    on('aclose','click',()=>{location.hash='analytics';});
    document.querySelectorAll('table[data-id=adv] th').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.k;if(A.sort===k)A.dir*=-1;else{A.sort=k;A.dir=['name','team','pos'].includes(k)?1:-1;}rerender();}));
    document.querySelectorAll('table[data-id=ateams] th').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.k;if(A.tsort===k)A.tdir=-(A.tdir||-1);else{A.tsort=k;A.tdir=k==='team'||k==='drtg'||k==='l'?1:-1;}rerender();}));
    if(S.anp){const c=document.getElementById('acard');if(c)c.scrollIntoView();}}
}
(()=>{const b=document.getElementById('menuBtn'),m=document.getElementById('menu');if(!b)return;
  b.addEventListener('click',e=>{e.stopPropagation();m.hidden=!m.hidden;});document.addEventListener('click',()=>m.hidden=true);addEventListener('hashchange',()=>m.hidden=true);})();
{let rt;addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(fitTables,120);});}
boot();
