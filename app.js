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
function value(r,pos,age){const ov=overall(r,pos),pt=gv(r.pot)??50;const ageAdj=Math.max(-6,Math.min(6,(24-(age||24))*1.0));return {ov,val:0.65*ov+0.35*pt+ageAdj,ageAdj};}
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
  return {fit:0.60*val+0.25*(N.need[pos]??0.5)*100+0.15*comp,comp};
}

/* ---------- boot ---------- */
async function boot(){
  try{B=await (await fetch('data/bundle.json',{cache:'no-cache'})).json();}catch(e){$('#view').innerHTML='<div class="empty"><b>Could not load data</b>Check your connection and reload.</div>';return;}
  B.myTeam=B.teams.find(t=>t.team_id===B.meta.my_team_id);
  B.pById=new Map(B.players.map(p=>[p.player_id,p]));
  B.teamByShort=new Map();B.teams.forEach(t=>{const w=t.name.split(' ');for(let i=1;i<w.length;i++) B.teamByShort.set(w.slice(i).join(' '),t);B.teamByShort.set(t.name,t);});
  const ca=B.meta.crawled_at?new Date(B.meta.crawled_at):null;
  $('#asof').textContent='Data as of '+(ca?ca.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'unknown')+(B.forum&&B.forum.meta&&B.forum.meta.fetched_at?' · forum '+new Date(B.forum.meta.fetched_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'')+' · simba.mygamesonline.org';
  prepDraft();
  try{const idx=await (await fetch('data/snapshots/index.json',{cache:'no-cache'})).json();
    SNAPS=(await Promise.all(idx.snapshots.map(k=>fetch('data/snapshots/'+k+'.json').then(r=>r.json()).catch(()=>null)))).filter(Boolean);}catch(e){SNAPS=[];}
  addEventListener('hashchange',route);route();
}
function prepDraft(){
  const N=needs(),D=deficits(),nT=B.teams.length,F=B.forum;
  let made,order,nextOverall,source='stats site',onClock=null;
  const fc=F&&(F.drafts||[]).filter(d=>d.draft==='creation');
  if(fc&&fc.length){ // forum is the source of truth (it runs ahead of the stats site)
    source='forum';
    made=(F.draft_picks||[]).filter(p=>p.draft==='creation').map(p=>({...p,player_name:p.player,player_pos:(B.pById.get(p.player_id)||{}).pos||''}));
    order=[];fc.forEach(d=>d.order.forEach(o=>order.push({round:d.round,pick:o.slot,team:o.team,gm:o.gm,overall:(d.round-1)*nT+o.slot})));
    const maxR=Math.max(...fc.map(d=>d.round)),sn=F.creation_draft_order;
    if(sn) for(let r=maxR+1;r<=maxR+2;r++) (r%2?sn.odd_rounds:sn.even_rounds).forEach((t,i)=>order.push({round:r,pick:i+1,team:t,gm:(F.gms[t]||{}).gm,overall:(r-1)*nT+i+1,projected:true}));
    const cur=fc.find(d=>!d.complete);
    onClock=cur?{...cur.on_the_clock,round:cur.round,url:cur.url}:null;
    nextOverall=cur?cur.on_the_clock.overall:(maxR*nT+1);
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
  const board=B.draft.eligible_players.map(p=>{const r=ratingsOf(p);const v=value(r,p.pos,p.age);const f=fit(r,p.pos,v.val,N,D);
    const pl=B.pById.get(p.player_id)||{},sal1=((pl.contract||{}).salary_by_year||[])[0]??null,after=payrollOf(B.myTeam)+(sal1||0),warns=crossWarnings(payrollOf(B.myTeam),after);
    return {...p,r,ov:v.ov,val:v.val,ageAdj:v.ageAdj,fit:f.fit,comp:f.comp,taken:taken.get(p.player_id)||null,sal1,after,afterStatus:capStatus(after).k,warns};});
  const avail=board.filter(p=>!p.taken);
  [...avail].sort((a,b)=>b.val-a.val).forEach((p,i)=>p.valRank=i+1);
  [...avail].sort((a,b)=>b.fit-a.fit).forEach((p,i)=>p.fitRank=i+1);
  const picksBefore=myNext?myNext.overall-nextOverall:0; // picks other teams make before ours
  avail.forEach(p=>p.likelyGone=p.valRank<=picksBefore);
  B.D={N,D,made,madeBy,order,nextOverall,mine,myNext,myUpcoming,board,avail,picksBefore,source,onClock,takenCount:taken.size};
}
function route(ev,keep){
  const h=(location.hash||'#team').slice(1).split('/');S.tab=h[0]||'team';
  document.querySelectorAll('.tabbar a').forEach(a=>a.classList.toggle('on',a.dataset.tab===S.tab));
  const T={team:['My Team',vTeam],draft:['Draft',vDraft],league:['League',vLeague],analytics:['Analytics',vAnalytics],players:['Players',vPlayers],rules:['League Rules',vRules],forum:['Forum',vForum]};
  const [title,fn]=T[S.tab]||T.team;$('#pageTitle').textContent=title;
  if(S.tab==='players'&&h[1]) {$('#view').innerHTML=vPlayer(+h[1]);}
  else $('#view').innerHTML=fn();
  bind();if(!keep)scrollTo(0,0);
  if(S.tab==='rules'&&h[1]&&!keep){const id={cap:'capaprons',tax:'taxcalc'}[h[1]]||h[1];const el=document.getElementById(id);if(el)el.scrollIntoView();scrollBy(0,-90);}
}

/* ---------- helpers ---------- */
function gradeCell(g){const v=gv(g);if(v==null)return '<span class="g">—</span>';const h=Math.round((v-30)/70*120);return `<span class="g" style="background:hsl(${h} 70% 45% / .22);color:hsl(${h} 70% 35%)">${esc(g)}</span>`;}
function table(cols,rows,{id='',me=null,sortKey=null,sortDir=-1}={}){
  return `<div class="scroll"><table class="tbl" ${id?`data-id="${id}"`:''}><thead><tr>${cols.map(c=>`<th class="${c.n?'n':''}" data-k="${c.k}">${esc(c.l)}${sortKey===c.k?(sortDir>0?' ▲':' ▼'):''}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r=>`<tr class="${me&&me(r)?'me':''}" ${r._href?`data-href="${r._href}"`:''}>${cols.map(c=>`<td class="${c.n?'n':''}">${c.f?c.f(r[c.k],r):esc(r[c.k]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
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
function capPanel(t){const c=CR(),m=capMath(t),usedRoom=SET.get('usedRoom',false),rep=SET.get('repeater',false);
  const rows=LEVELS.filter(([k])=>c[k]).map(([k,l])=>{const base=k==='salary_floor'||k==='luxury_tax'||k.includes('apron')?m.tax:m.cap,d=c[k]-base;
    return {l,th:c[k],basis:k==='salary_cap'?'cap salary':'tax salary',d,txt:k==='salary_floor'?(d>0?`needs ${mm(d)}`:`${mm(-d)} above`):(d>0?`${mm(d)} under`:`${mm(-d)} over`)};});
  const ex=exceptionsFor(m.cap,m.tax,usedRoom),tx=luxTax(m.tax-c.luxury_tax,rep);
  let h='';
  if(m.floorGap>0) h+=`<div class="warn">⚠️ <b>Below the salary floor by ${mm(m.floorGap)}.</b> If the Pistons are still under ${mm(c.salary_floor)} when offseason free agency ends, the league will <b>auto-sign players</b> to reach the floor and may <b>cut players</b> to make room. Cap holds don't count toward the floor.</div>`;
  h+=`<div class="kpis"><div class="kpi"><div class="v">${mm(m.cap)}</div><div class="l">Cap salary (incl. ${mm(m.charge)} roster charge)</div></div><div class="kpi"><div class="v">${mm(m.tax)}</div><div class="l">Tax salary (no holds/charges)</div></div>
   <div class="kpi"><div class="v">${mm(c.salary_cap-m.cap)}</div><div class="l">Cap room (on cap salary)</div></div><div class="kpi"><div class="v">${mm(tx.tax)}</div><div class="l">Projected luxury tax${rep?' (repeater)':''}</div></div></div>`;
  h+=thresholdBar(m.tax,m.cap);
  h+=table([{k:'l',l:'Threshold'},{k:'th',l:'Amount',n:1,f:mm},{k:'basis',l:'Measured on'},{k:'txt',l:'Pistons',n:1,f:(v,r)=>`<span style="color:${(r.l==='Floor'?r.d<=0:r.d>0)?'var(--good)':'var(--bad)'}">${esc(v)}</span>`}],rows);
  h+=`<h3>Incomplete roster charge (offseason)</h3><p class="note">${m.counted} player${m.counted===1?'':'s'} counted → ${m.need} × rookie minimum ${mm(m.rm.v)} = <b>${mm(m.charge)}</b> added to cap salary.</p>
   <div class="controls"><label class="note" style="display:flex;align-items:center;gap:8px;flex:1">Rookie minimum $<input id="rmin" inputmode="numeric" style="flex:1;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:0 10px" value="${m.rm.v}"></label></div>
   ${m.rm.src==='placeholder'?`<div class="warn small">🟨 <b>Rookie minimum is a placeholder.</b> ${esc(m.rm.label||'')}</div>`:`<p class="note small">Rookie minimum source: ${esc(m.rm.src)}.</p>`}`;
  h+=`<h3>Exceptions you can use</h3><div class="controls"><button class="ghost" id="usedRoom">${usedRoom?'✓ ':''}Used cap room this season</button></div>
   ${ex.length?ex.map(e=>`<div class="kpi" style="margin-bottom:6px"><div class="v">${esc(e.n)} · ${mm(e.v)}</div><div class="l">${esc(e.why)}</div></div>`).join(''):empty('No MLE available','Above the 2nd apron: no Taxpayer MLE.')}
   <p class="note small">Per league rules every team operates over the cap by default; spending cap room switches you to under-the-cap for the season (Room Exception only). Eligibility is modelled from the forum rules; exact edge cases are the commissioners' call. <a href="#rules/cap">Full cap rules →</a></p>`;
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
  <div class="card"><h2>Cap & aprons</h2>${capPanel(t)}</div>`;
  const gm=B.forum&&B.forum.pistons_gm;
  if(D.myNext) h+=`<div class="callout">🏀 Creation draft is live${D.onClock?` — ${esc(D.onClock.team)} (${esc(D.onClock.gm||'?')}) on the clock at R${D.onClock.round} #${D.onClock.slot}`:''}${gm?`. GM per forum: <b>${esc(gm.gm)}</b>`:''}. Overall pick ${D.nextOverall} is up. Your next pick is <b>Round ${D.myNext.round}, #${D.myNext.pick}</b> (overall ${D.myNext.overall}, ${D.picksBefore} picks away). <a href="#draft">Open draft board →</a></div>`;
  h+=`<div class="card"><h2>Roster & ratings</h2>`;
  if(!myRoster().length) h+=empty('No players yet','Draft picks will appear here.');
  else h+=table([{k:'name',l:'Player',f:(v,r)=>`<a href="#players/${r.player_id}">${esc(v)}</a>`},{k:'pos',l:'Pos'},{k:'age',l:'Age',n:1},{k:'height',l:'Ht'},
    ...RK.map(k=>({k,l:k.toUpperCase(),f:(v,r)=>gradeCell(r.ratings[k])})),{k:'ovr',l:'OVR',n:1,f:(v,r)=>f1(overall(r.ratings,r.pos))}],myRoster());
  h+=`</div><div class="card"><h2>Contracts by year</h2>`;
  const yrs=[1,2,3,4,5,6,7];
  if(myRoster().length){
    const rows=myRoster().map(p=>({...p,...Object.fromEntries(yrs.map(y=>['y'+y,p.salary['year_'+y]]))}));
    const tot={name:'Team total',...Object.fromEntries(yrs.map(y=>['y'+y,rows.reduce((a,r)=>a+(r['y'+y]||0),0)]))};
    h+=table([{k:'name',l:'Player'},...yrs.map(y=>({k:'y'+y,l:'Yr '+y,n:1,f:v=>v?mm(v):'—'}))],[...rows,tot],{me:r=>r.name==='Team total'});
    h+=`<h3>Cap room by year (vs ${mm(cap)} cap, flat)</h3>`+table([{k:'l',l:''},...yrs.map(y=>({k:'y'+y,l:'Yr '+y,n:1,f:v=>mm(v)}))],[{l:'Room',...Object.fromEntries(yrs.map(y=>['y'+y,cap-tot['y'+y]]))}]);
    h+=`<p class="note small">Season 2005 = Year 1. Year columns as shown on the site (a $1 entry is the site's own placeholder).</p>`;
  }
  if((t.cut_players||[]).length) h+=`<h3>Cut players (dead money)</h3>`+table([{k:'name',l:'Player'},{k:'total',l:'Total',n:1,f:mm}],t.cut_players);
  h+=`</div><div class="card"><h2>Owned draft picks</h2>${(t.draft_picks||[]).length?table([{k:'season',l:'Season'},{k:'round',l:'Round',n:1},{k:'original_team',l:'Originally'}],[...t.draft_picks].sort((a,b)=>a.season-b.season||a.round-b.round)):empty('No future picks','')}
  ${D.mine.length?`<h3>Creation draft (${esc(D.source)})</h3>`+D.mine.map(o=>{const m=D.madeBy.get(o.overall);return `<span class="chip ${m?'':'red'}">R${o.round} #${o.pick} (ovr ${o.overall})${m?': '+esc(m.player_name):(o.projected?' — projected':' — upcoming')}</span>`;}).join(''):''}</div>`;
  h+=`<div class="card"><h2>Injuries</h2>${(t.injuries||[]).length?table([{k:'name',l:'Player'},{k:'injury',l:'Injury'},{k:'duration',l:'Duration'}],t.injuries):empty('No injuries','Your roster is healthy.')}</div>`;
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
  if(oc) h+=`<div class="callout">⏱ <b>${esc(oc.team)}</b> (${esc(oc.gm||'?')}) — Round ${oc.round}, pick ${oc.slot} (overall ${oc.overall}), on the clock since ${ago(oc.since)}. <a href="${esc(oc.url)}" target="_blank" rel="noopener">Thread ↗</a></div>`;
  h+=D.myNext?`<div class="callout">Your next pick: <b>Round ${D.myNext.round}, #${D.myNext.pick}</b> (overall ${D.myNext.overall}${D.myNext.projected?', projected from the snake order':''}) — <b>${D.picksBefore} picks away</b>.${D.myUpcoming[1]?` After that: R${D.myUpcoming[1].round} #${D.myUpcoming[1].pick} (overall ${D.myUpcoming[1].overall}).`:''} The top ${D.picksBefore} available players by Value are flagged “likely gone”.</div>`:'<div class="callout">You have no remaining picks in this draft.</div>';
  {const pay=payrollOf(B.myTeam),c=CR(),mx=Math.max(...D.avail.map(p=>p.sal1||0));
   h+=`<p class="note small">💰 Pistons payroll ${mm(pay)} (${capStatus(pay).k}): ${mm(c.salary_cap-pay)} under the cap, ${mm(c.luxury_tax-pay)} under the tax, ${mm(c.first_apron-pay)} under the 1st apron. Priciest available prospect: ${mm(mx)} in year 1, so no single pick crosses a threshold right now; rows show ⚠️ when one would (cap, tax, 1st/2nd apron and hard-cap consequences). Each row shows the prospect's year-1 salary and where the Pistons' payroll lands after adding him. Per the forum, creation-draft salary is unlimited, but teams over an apron when the draft ends face apron rules.</p>`;}
  h+=`<p class="note small">Picks source: <b>${esc(D.source)}</b> (${D.made.length} made; ${D.board.filter(p=>p.taken).length} of them were still listed as eligible on the stats site and are now marked taken)${D.source==='forum'?' — the forum runs ahead of the stats site, which still lists '+B.transactions.filter(t=>t.type==='draft').length+' picks':''}.</p>`;
  h+=`<h3>Best available at your pick (by Pistons fit)</h3><div class="plist">${near.map((p,i)=>row(p,`Fit ${f1(p.fit)}`,`Value ${f1(p.val)} · #${p.valRank} on board${salLine(p)}`)).join('')}</div>`;
  h+=`<p class="note small">Need now: ${POS.map(p=>`${p} ${D.N.need[p]===1?'●':D.N.need[p]===.5?'◐':'○'}`).join(' · ')} (● = nobody on roster). Biggest skill gaps: ${Object.entries(D.D).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>RNAME[k]).join(', ')}.</p></div>`;
  h+=`<div class="card"><h2>Big board <span class="chip">${rows.length} players</span></h2><div class="controls">
    <input type="search" id="dq" placeholder="Search name" value="${esc(st.q)}">
    <select id="dpos">${['ALL',...POS].map(p=>`<option ${p===st.pos?'selected':''}>${p}</option>`).join('')}</select>
    <select id="dsort">${[['fit','Pistons fit'],['val','Value'],['ov','Overall now'],['age','Age'],['height','Height'],...RK.map(k=>[k,RNAME[k]])].map(([k,l])=>`<option value="${k}" ${k===st.sort?'selected':''}>Sort: ${l}</option>`).join('')}</select>
    <button class="ghost" id="dnear">${st.onlyNear?'✓ ':''}Hide likely gone</button><button class="ghost" id="dtaken">${st.showTaken?'✓ ':''}Show taken</button></div>`;
  h+=table([{k:'fitRank',l:'#',n:1,f:(v,r)=>r.taken?'—':v},{k:'name',l:'Player',f:(v,r)=>`<a href="#players/${r.player_id}">${esc(v)}</a>${r.taken?`<span class="tag pick">TAKEN R${r.taken.round}#${r.taken.pick} ${esc(r.taken.team.split(' ').pop())}</span>`:r.likelyGone?'':(r.fitRank<=10?'<span class="tag">TARGET</span>':'')}`},{k:'pos',l:'Pos'},{k:'age',l:'Age',n:1},{k:'height',l:'Ht'},
     ...RK.map(k=>({k,l:k.toUpperCase(),f:(v,r)=>gradeCell(r.r[k])})),{k:'ov',l:'OVR',n:1,f:f1},{k:'val',l:'Value',n:1,f:f1},{k:'fit',l:'Fit',n:1,f:(v,r)=>`<b>${f1(v)}</b>`},{k:'sal1',l:'Yr1 $',n:1,f:v=>v?mm(v):'<span class="note">none</span>'},{k:'after',l:'DET after',n:1,f:(v,r)=>`${mm(v)} ${statusChip(v)}${r.warns&&r.warns.length?`<div class="warnline">⚠️ ${esc(r.warns.join('; '))}</div>`:''}`}],
     rows.slice(0,200).map(r=>({...r,_style:r.likelyGone})),{id:'draft',sortKey:key,sortDir:st.dir,me:r=>!r.taken&&r.likelyGone===false&&r.fitRank<=10});
  if(rows.length>200) h+=`<p class="note small">Showing top 200 of ${rows.length}; filter by position or search to see more.</p>`;
  h+=`</div><div class="card"><h2>Draft order & picks made</h2>${table([{k:'overall',l:'Ovr',n:1},{k:'rp',l:'Pick'},{k:'team',l:'Team'},{k:'sel',l:'Selection'}],
     D.order.map(o=>{const m=D.madeBy.get(o.overall);return {...o,team:o.team+(o.gm?` (${o.gm})`:''),_team:o.team,rp:`R${o.round} #${o.pick}`,sel:m?`${m.player_pos} ${m.player_name}`:(o.overall===D.nextOverall?'⏱ on the clock':(o.projected?'projected':''))};}),{me:r=>r._team===B.myTeam.name})}</div>`;
  h+=`<div class="card"><details><summary>How the scores work</summary><div class="note">
   <p><b>Grades → numbers:</b> A+ 100, A 95, A- 90, B+ 85 … in 5-point steps … F- 30.</p>
   <p><b>Overall (OVR)</b> = position-weighted average of the five skills (Inside, Outside, Handling, Defense, Rebound):<br>
   ${POS.map(p=>`${p}: `+Object.entries(PW[p]).map(([k,w])=>`${k} ${w*100}%`).join(', ')).join('<br>')}</p>
   <p><b>Value</b> = 0.65 × OVR + 0.35 × Potential + age bonus (+1 per year under 24, −1 per year over; capped ±6).</p>
   <p><b>Pistons fit</b> = 0.60 × Value + 0.25 × Need × 100 + 0.15 × Complement.<br>
   Need = 1.0 if no rostered player at that position, 0.5 if one, 0.2 if two or more (now: only Kobe Bryant at SG).<br>
   Complement = the player's skills weighted by the team's gaps (100 − best rostered grade in each skill), so skills the roster lacks count more.</p>
   <p><b>Potential (forum rule):</b> for <i>rookie-draft prospects</i>, the potential shown is only their historical potential; after the draft each prospect's real potential is re-rolled from one of four sources (historical, historical draft slot, this league's draft slot, or random). It does not apply to base-file players, which is everyone in this creation draft, so Value uses the listed Potential as-is. For future rookie drafts, treat Potential as roughly half signal: about 1 in 4 prospects keep it outright and a random 1 in 4 lose it.</p>
   <p><b>Likely gone</b>: players ranked inside the top N by Value, where N = picks before yours. It's a projection, not a guarantee.</p></div></details></div>`;
  return h;
}
function salLine(p){return p.sal1?` · Yr1 ${mm(p.sal1)} → DET ${mm(p.after)} (${p.afterStatus})${p.warns.length?' ⚠️ '+p.warns.join('; '):''}`:' · no contract listed on site ($0)';}
function row(p,score,sub){return `<div class="row" data-href="#players/${p.player_id}"><span class="pos">${esc(p.pos)}</span><div><div class="nm">${esc(p.name)}</div><div class="meta">${p.age} yrs · ${esc(p.height||'')} · ${RK.map(k=>k.toUpperCase()+' '+esc(p.r[k]||'—')).join(' ')}</div><div class="meta">${esc(sub)}</div></div><div class="sc">${esc(score)}</div></div>`;}

/* ---------- League ---------- */
function vLeague(){
  const sub=S.lsub||'standings';
  let h=`<div class="seg" style="margin-bottom:12px">${[['standings','Standings'],['cap','Cap room'],['stats','Team stats'],['leaders','Leaders']].map(([k,l])=>`<button data-lsub="${k}" class="${k===sub?'on':''}">${l}</button>`).join('')}</div>`;
  const me=r=>r.team_id===B.myTeam.team_id;
  if(sub==='standings'){
    const zero=B.standings.divisional.every(d=>d.teams.every(t=>!t.w&&!t.l));
    if(zero) h+=`<div class="callout">Season hasn't started — every team is 0-0.</div>`;
    B.standings.divisional.forEach(d=>{h+=`<div class="card"><h2>${esc(d.division)}</h2>${table([{k:'team',l:'Team'},{k:'w',l:'W',n:1},{k:'l',l:'L',n:1},{k:'win_pct',l:'Pct',n:1,f:pct3},{k:'gb',l:'GB',n:1},{k:'last10',l:'L10'},{k:'home',l:'Home'}],d.teams,{me})}</div>`;});
  } else if(sub==='cap'){
    const c=capRank().sorted.map((x,i)=>{const used=x.team_salary!=null?x.team_salary:B.meta.salary_cap-x.cap_room,cr=CR();return {...x,rank:i+1,used,status:capStatus(used).k,toFloor:Math.max(0,(cr.salary_floor||0)-used),underTax:(cr.luxury_tax||0)-used,projTax:luxTax(used-(cr.luxury_tax||0),false).tax};});
    const cnt={};c.forEach(x=>cnt[x.status]=(cnt[x.status]||0)+1);
    h+=`<div class="card"><h2>League cap picture</h2><div>${Object.entries(cnt).map(([k,v])=>`<span class="chip">${esc(k)}: ${v}</span>`).join('')}</div><p class="note small">Floor ${mm(CR().salary_floor)} · Cap ${mm(CR().salary_cap)} · Tax ${mm(CR().luxury_tax)} · 1st apron ${mm(CR().first_apron)} · 2nd apron ${mm(CR().second_apron)}</p></div>`;
    h+=`<div class="card"><h2>Cap room (cap ${mm(B.meta.salary_cap)})</h2>${table([{k:'rank',l:'#',n:1},{k:'team',l:'Team'},{k:'cap_room',l:'Room',n:1,f:mm},{k:'used',l:'Payroll',n:1,f:mm},{k:'status',l:'Status',f:(v,r)=>statusChip(r.used)},{k:'toFloor',l:'To floor',n:1,f:v=>v?mm(v):'—'},{k:'underTax',l:'Under tax',n:1,f:mm},{k:'projTax',l:'Proj. tax',n:1,f:v=>v?mm(v):'$0'}],c,{me})}<p class="note small">Projected tax uses non-repeater rates on current payroll (tax is actually assessed on salary at the final regular-season game).</p></div>`;
  } else if(sub==='stats'){
    const ts=(B.teamstats['tmstats/offense/team.htm']||[]).map(r=>({...r,team_id:r.team_id||B.teamByShort.get(r.team)?.team_id}));
    const z=ts.every(r=>allZero({a:r.ppg,b:r.rpg,c:r.apg}));
    h+=`<div class="card"><h2>Team stats (offense)</h2>${z?empty('Fills in once games are played','All teams are at 0.0 until the season starts.'):''}${table([{k:'team',l:'Team'},...['ppg','rpg','apg','spg','bpg','topg'].map(k=>({k,l:k.toUpperCase(),n:1,f:f1}))],ts,{me})}</div>`;
  } else {
    const L=B.leaders.league_leaders;const cats=Object.keys(L);
    h+=`<div class="card"><h2>League leaders</h2><select id="lcat" style="width:100%;margin-bottom:10px">${cats.map(c=>`<option ${c===S.lcat?'selected':''}>${esc(c)}</option>`).join('')}</select>`;
    const c=L[S.lcat||cats[0]];
    h+=(c&&c.leaders.length)?table([{k:'rank',l:'#',n:1},{k:'player',l:'Player'},{k:'pos',l:'Pos'},{k:'team',l:'Team'},{k:'value',l:c.stat,n:1}],c.leaders,{me:r=>r.team_id===B.myTeam.team_id}):empty('Fills in once games are played','League leaders are published after the first games.');
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
function vAnalytics(){
  const roster=myRoster();let h='';
  if(!roster.length) return empty('No Pistons players yet','');
  const pid=S.cmp||roster[0].player_id;const me=B.pById.get(pid)||roster[0];const posOnly=S.posOnly;
  const pool=B.players.filter(p=>!posOnly||p.pos===me.pos);
  const mr=ratingsOf(me);
  const vals=RK.map(k=>pctile(pool.map(p=>gv(ratingsOf(p)[k])).filter(v=>v!=null),gv(mr[k])));
  const avg=RK.map(k=>50);
  h+=`<div class="card"><h2>Player vs league</h2><div class="controls"><select id="cmp" style="flex:1">${roster.map(p=>`<option value="${p.player_id}" ${p.player_id===me.player_id?'selected':''}>${esc(p.name)} (${p.pos})</option>`).join('')}</select>
  <button class="ghost" id="posOnly">${posOnly?'✓ ':''}Same position only</button></div>
  <div class="radarwrap">${radar([{v:avg,c:'#94a3b8'},{v:vals,c:'#c8102e'}],RK.map(k=>RNAME[k]))}</div>
  <div class="legend"><span><i style="background:#c8102e"></i>${esc(me.name)}</span><span><i style="background:#94a3b8"></i>League median</span></div>
  <h3>Rating percentiles (vs ${pool.length} ${posOnly?me.pos+'s':'league players'})</h3>
  ${RK.map((k,i)=>`<div class="pct"><span>${RNAME[k]} ${gradeCell(mr[k])}</span><div class="bar"><i style="width:${vals[i]}%;background:${vals[i]>=75?'var(--good)':vals[i]>=40?'var(--blue)':'var(--bad)'}"></i></div><b class="n">${ord(vals[i])}</b></div>`).join('')}
  <h3>Stat percentiles</h3>`;
  const sa=me.season_averages||{};
  if(allZero(sa)) h+=empty('Fills in once games are played','Per-game stat percentiles (PPG, RPG, APG, FG% …) appear after the first games.');
  else{const keys=Object.keys(sa).filter(k=>k!=='games');const pl=B.players.filter(p=>(p.season_averages||{}).games>0);
    h+=keys.map(k=>{const v=pctile(pl.map(p=>p.season_averages[k]),sa[k]);return `<div class="pct"><span>${k.toUpperCase()} ${f1(sa[k])}</span><div class="bar"><i style="width:${v}%"></i></div><b>${ord(v)}</b></div>`;}).join('');}
  h+=`</div>`;
  // team vs league
  const ts=(B.teamstats['tmstats/offense/team.htm']||[]);const my=B.myTeam.team_stats||{};
  h+=`<div class="card"><h2>Team vs league average</h2>`;
  if(ts.every(r=>allZero({a:r.ppg,b:r.rpg,c:r.apg}))) h+=empty('Fills in once games are played','Team PPG/RPG/APG/SPG/BPG/TOPG vs the league average will show here.');
  else h+=table([{k:'k',l:'Stat'},{k:'me',l:'Pistons',n:1,f:f1},{k:'lg',l:'League avg',n:1,f:f1},{k:'d',l:'Diff',n:1,f:v=>`<span style="color:${v>=0?'var(--good)':'var(--bad)'}">${v>=0?'+':''}${f1(v)}</span>`}],
     ['ppg','rpg','apg','spg','bpg','topg'].map(k=>{const lg=ts.reduce((a,r)=>a+(r[k]||0),0)/ts.length;return {k:k.toUpperCase(),me:my[k],lg,d:(my[k]||0)-lg};}));
  // ratings-based roster profile vs league teams
  const teamOvr=B.teams.filter(t=>(t.players||[]).length).map(t=>({team:t.name,team_id:t.team_id,n:t.players.length,ovr:t.players.reduce((a,p)=>a+overall(p.ratings,p.pos),0)/t.players.length}));
  h+=`<h3>Roster quality now (avg OVR of rostered players)</h3>${table([{k:'team',l:'Team'},{k:'n',l:'Players',n:1},{k:'ovr',l:'Avg OVR',n:1,f:f1}],teamOvr.sort((a,b)=>b.ovr-a.ovr),{me:r=>r.team_id===B.myTeam.team_id})}</div>`;
  // trends
  h+=`<div class="card"><h2>Trends across refreshes <span class="chip">${SNAPS.length} snapshot${SNAPS.length===1?'':'s'}</span></h2>`;
  const lab=s=>new Date(s.crawled_at).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  const trendSeries=[['Wins',s=>s.my_team.record?.w],['Team PPG',s=>s.my_team.team_stats?.ppg],['Cap room ($M)',s=>(s.my_team.cap_room||0)/1e6],[`${me.name} PPG`,s=>s.players?.[me.player_id]?.season_averages?.ppg]];
  if(SNAPS.length<2) h+=empty('Trends build over time','Each data refresh saves a dated snapshot. Charts appear after the second refresh; stat lines fill in once games are played.');
  else trendSeries.forEach(([l,fn])=>{const pts=SNAPS.map(s=>({l:lab(s),v:+fn(s)||0}));h+=`<h3>${esc(l)}</h3>`+(pts.every(p=>p.v===0)?empty('Fills in once games are played',''):line(pts,{label:l}));});
  h+=`<p class="note small">Snapshots: ${SNAPS.map(s=>esc(new Date(s.crawled_at).toLocaleString())).join(' · ')||'none'}</p></div>`;
  return h;
}

/* ---------- Players ---------- */
function vPlayers(){
  const q=(S.pq||'').toLowerCase();const pos=S.ppos||'ALL';
  const list=B.players.filter(p=>(!q||p.name.toLowerCase().includes(q))&&(pos==='ALL'||p.pos===pos)).map(p=>{const r=ratingsOf(p);return {...p,r,ov:overall(r,p.pos)};}).sort((a,b)=>b.ov-a.ov);
  return `<div class="card"><h2>Find a player <span class="chip">${list.length}</span></h2><div class="controls"><input type="search" id="pq" placeholder="Search ${B.players.length} players" value="${esc(S.pq||'')}" autocomplete="off">
   <select id="ppos">${['ALL',...POS].map(p=>`<option ${p===pos?'selected':''}>${p}</option>`).join('')}</select></div>
   <div class="plist">${list.slice(0,100).map(p=>row(p,'OVR '+f1(p.ov),(p.team==='Draft'?'Draft pool':(p.team||'—'))+(p.contract?' · '+mm(p.contract.salary_by_year?.[0])+' this yr':''))).join('')}</div>
   ${list.length>100?`<p class="note small">Showing top 100 by OVR — refine the search.</p>`:''}</div>`;
}
function vPlayer(id){
  const p=B.pById.get(id);if(!p) return empty('Player not found','');
  const r=ratingsOf(p),v=value(r,p.pos,p.age),bd=B.D.board.find(x=>x.player_id===id);
  const kv=(o,fmt=x=>x)=>o&&Object.keys(o).length?`<div class="scroll"><table class="tbl">${Object.entries(o).map(([k,x])=>`<tr><td>${esc(k.replace(/_/g,' '))}</td><td class="n">${esc(fmt(x))}</td></tr>`).join('')}</table></div>`:empty('No data','');
  const c=p.contract||{};
  let h=`<button class="back" onclick="history.back()">‹ Back</button><div class="card"><h2>${esc(p.name)} <span class="chip blue">${esc(p.pos)}</span></h2>
   <div class="kpis"><div class="kpi"><div class="v">${f1(v.ov)}</div><div class="l">Overall (OVR)</div></div><div class="kpi"><div class="v">${f1(v.val)}</div><div class="l">Value</div></div>
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
   <p class="note small">Self-check: non-repeater $5,000,000 over → ${money(luxTax(5e6,false).tax)} (${luxTax(5e6,false).tax===8855000?'✓ matches the forum example $8,855,000':'✗ mismatch'}).</p></div>`;
  return h;}
function taxOut(pay,rep){const c=CR(),over=pay-c.luxury_tax,r=luxTax(over,rep);
  if(over<=0) return `<div class="kpis"><div class="kpi"><div class="v">$0</div><div class="l">${mm(-over)} under the tax line (${mm(c.luxury_tax)})</div></div><div class="kpi"><div class="v">${statusChip(pay)}</div><div class="l">Status at ${mm(pay)}</div></div></div>`;
  return `<div class="kpis"><div class="kpi"><div class="v">${money(r.tax)}</div><div class="l">Tax owed${rep?' (repeater)':''}</div></div><div class="kpi"><div class="v">${mm(over)}</div><div class="l">Over the tax line · ${statusChip(pay)}</div></div></div>`+
    table([{k:'br',l:'Bracket'},{k:'amt',l:'Amount',n:1,f:mm},{k:'rate',l:'Rate',n:1,f:v=>'$'+v.toFixed(2)},{k:'tax',l:'Tax',n:1,f:v=>money(Math.round(v))}],r.rows);}

/* ---------- Rules & Forum (menu) ---------- */
function hl(t,q){const e=esc(t);if(!q)return e;const rx=new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');return e.replace(rx,'<mark>$1</mark>');}
function vRules(){
  const F=B.forum||{rules:[]};
  const q=(S.rq||'').trim();const rules=(F.rules||[]).filter(r=>!q||(r.title+' '+r.text).toLowerCase().includes(q.toLowerCase()));
  let h=`<div class="card"><h2>League rules <span class="chip">${rules.length}</span></h2><div class="controls"><input type="search" id="rq" placeholder="Search rules (e.g. clock, apron, lottery)" value="${esc(q)}"></div>
   <p class="note small">From pinned threads on the league forum, read-only. <a href="#rules" data-jump="capaprons">Cap & Aprons</a> · ${rules.map(r=>`<a href="#rules" data-jump="r${r.thread_id}">${esc(r.title)}</a>`).join(' · ')}</p></div>`;
  h+=capRulesHtml(q);
  rules.forEach(r=>{h+=`<div class="card rule" id="r${r.thread_id}"><h2>${esc(r.title)} <span class="chip">${esc(r.board||'')}</span></h2><div class="txt">${hl(r.text,q)}</div>
    <p class="note small">${esc(r.author)} · ${r.timestamp?new Date(r.timestamp).toLocaleDateString():''} · <a href="${esc(r.url)}" target="_blank" rel="noopener">Open thread ↗</a></p></div>`;});
  const lo=F.lottery_odds||{};
  if((lo.by_pick||[]).length&&(!q||'lottery odds'.includes(q.toLowerCase()))) h+=`<div class="card"><h2>Default lottery odds</h2>${table([{k:'pick',l:'Pick',n:1},{k:'relegation_zone',l:'Releg.',n:1,f:v=>v+'%'},{k:'three_balls',l:'3 balls',n:1,f:v=>v+'%'},{k:'two_balls',l:'2 balls',n:1,f:v=>v+'%'},{k:'one_ball',l:'1 ball',n:1,f:v=>v+'%'}],lo.by_pick)}
     ${table([{k:'group',l:'Group'},{k:'top3',l:'Top 3',n:1,f:v=>v+'%'},{k:'top5',l:'Top 5',n:1,f:v=>v+'%'},{k:'top10',l:'Top 10',n:1,f:v=>v+'%'},{k:'avg_pick',l:'Avg pick',n:1}],lo.summary||[])}</div>`;
  if(F.gms&&!q) h+=`<div class="card"><h2>GM list</h2>${table([{k:'team',l:'Team'},{k:'gm',l:'GM'}],Object.entries(F.gms).map(([team,g])=>({team,gm:g.gm})),{me:r=>r.team===B.myTeam.name})}</div>`;
  if((F.inaccessible_threads||[]).length) h+=`<div class="empty"><b>Some linked rule threads aren't public</b>${F.inaccessible_threads.map(t=>esc(t.url.split('/').pop())).join(', ')} — they need a forum login, so they're not included.</div>`;
  return h;
}
function vForum(){
  const F=B.forum;if(!F) return empty('Forum not loaded','Run refresh.sh to pull the league forum.');
  const bd=S.fb||'ALL';const posts=(F.recent_posts||[]).filter(p=>bd==='ALL'||p.board===bd);
  const boards=[...new Set((F.recent_posts||[]).map(p=>p.board).filter(Boolean))];
  let h=`<div class="card"><h2>Forum feed <span class="chip">${posts.length}</span></h2><div class="controls"><select id="fb" style="flex:1"><option>ALL</option>${boards.map(b=>`<option ${b===bd?'selected':''}>${esc(b)}</option>`).join('')}</select></div>
   <p class="note small">Newest first · fetched ${F.meta&&F.meta.fetched_at?new Date(F.meta.fetched_at).toLocaleString():'?'} · read-only copy of tsfbl.proboards.com</p>`;
  h+=posts.map(p=>`<div class="post"><div class="hd"><span class="au">${esc(p.author)}</span><span class="tm">${p.timestamp?new Date(p.timestamp).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):''}</span></div>
     <a class="th" href="${esc(p.thread_url||'#')}" target="_blank" rel="noopener">${esc(p.board||'')} › ${esc(p.thread_title||'')}</a>
     <div class="tx">${esc(p.text.length>600?p.text.slice(0,600)+'…':p.text)}</div></div>`).join('')||empty('No posts','');
  return h+'</div>';
}

/* ---------- events ---------- */
function bind(){
  document.querySelectorAll('[data-href]').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('a'))return;location.hash=el.dataset.href.replace(/^#/,'');}));
  const on=(id,ev,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);};
  const rerender=(keepFocus)=>{const pos=keepFocus&&document.activeElement?.id;const sel=document.activeElement?.selectionStart;route(null,true);if(pos){const el=document.getElementById(pos);if(el){el.focus();try{el.setSelectionRange(sel,sel);}catch(e){}}}};
  on('dq','input',e=>{S.draft.q=e.target.value;rerender(true);});
  on('dpos','change',e=>{S.draft.pos=e.target.value;rerender();});
  on('dsort','change',e=>{S.draft.sort=e.target.value;S.draft.dir=['age'].includes(e.target.value)?1:-1;rerender();});
  on('dnear','click',()=>{S.draft.onlyNear=!S.draft.onlyNear;rerender();});
  on('dtaken','click',()=>{S.draft.showTaken=!S.draft.showTaken;rerender();});
  document.querySelectorAll('table[data-id=draft] th').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.k==='fitRank'?'fit':th.dataset.k;if(S.draft.sort===k)S.draft.dir*=-1;else{S.draft.sort=k;S.draft.dir=['name','pos','age'].includes(k)?1:-1;}rerender();}));
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
  on('fb','change',e=>{S.fb=e.target.value;rerender();});
  document.querySelectorAll('[data-jump]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();document.getElementById(a.dataset.jump)?.scrollIntoView({behavior:'smooth'});}));
  on('ppos','change',e=>{S.ppos=e.target.value;rerender();});
}
(()=>{const b=document.getElementById('menuBtn'),m=document.getElementById('menu');if(!b)return;
  b.addEventListener('click',e=>{e.stopPropagation();m.hidden=!m.hidden;});document.addEventListener('click',()=>m.hidden=true);addEventListener('hashchange',()=>m.hidden=true);})();
boot();
