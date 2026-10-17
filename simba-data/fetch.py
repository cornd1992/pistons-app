"""Polite crawler for simba.mygamesonline.org; caches raw HTML under raw/ (mirrors URL path)."""
import requests, time, json, re, os, sys, urllib3
from urllib.parse import urljoin, urlparse, urldefrag
from bs4 import BeautifulSoup
urllib3.disable_warnings()
HOST="simba.mygamesonline.org"; BASE=f"https://{HOST}/"
HERE=os.path.dirname(os.path.abspath(__file__)); RAW=os.path.join(HERE,"raw")
SKIP=re.compile(r"\.(jpg|jpeg|gif|png|bmp|ico|css|js|zip|pdf|exe|mp3|wav|mid|swf|doc|xls|txt|dat|csv)$",re.I)
def norm(u):
    u=urldefrag(u)[0]; p=urlparse(u)
    if p.scheme not in("http","https") or p.hostname!=HOST: return None
    return f"https://{HOST}{p.path or '/'}"+(f"?{p.query}" if p.query else "")
def rawpath(u):
    p=urlparse(u).path
    if p.endswith("/"): p+="index.html"
    return os.path.join(RAW,p.lstrip("/"))
def links_of(u,text):
    soup=BeautifulSoup(text,"html.parser"); base=u
    b=soup.find("base",href=True)
    if b: base=urljoin(u,b["href"])
    out=[]
    for tag,attr in (("a","href"),("frame","src"),("iframe","src"),("area","href"),("option","value")):
        for el in soup.find_all(tag):
            v=(el.get(attr) or "").strip()
            if not v or v.lower().startswith(("javascript:","mailto:","#")): continue
            if tag=="option" and not re.search(r"\.(s?html?|php|asp)\b|/$",v,re.I): continue
            n=norm(urljoin(base,v))
            if n and not SKIP.search(urlparse(n).path): out.append(n)
    return out
import threading
from concurrent.futures import ThreadPoolExecutor
class RateLimiter:
    def __init__(self, rate): self.dt=1.0/rate; self.lock=threading.Lock(); self.next=0.0
    def wait(self):
        with self.lock:
            now=time.time(); t=max(now,self.next); self.next=t+self.dt
        time.sleep(max(0,t-now))
_local=threading.local()
def _session():
    if not hasattr(_local,"s"):
        s=requests.Session(); s.verify=False  # site's TLS cert is issued for another hostname
        s.headers["User-Agent"]="SimbaScraper/1.0 (polite; ~1 req/s)"; _local.s=s
    return _local.s
def fetch_one(u, rl, use_cache, retries=4):
    rp=rawpath(u)
    if use_cache and os.path.exists(rp):
        return u,{"status":200,"cached":True},open(rp,encoding="utf-8",errors="replace").read(),0
    info={}; n=0
    for a in range(retries):
        rl.wait(); n+=1
        try:
            r=_session().get(u,timeout=45)
            info={"status":r.status_code,"ct":r.headers.get("content-type","")}
            if r.status_code==200 and "html" in info["ct"]:
                try: text=r.content.decode("utf-8")
                except UnicodeDecodeError: text=r.content.decode("cp1252",errors="replace")
                os.makedirs(os.path.dirname(rp),exist_ok=True)
                open(rp,"w",encoding="utf-8").write(text)
                return u,info,text,n
            if r.status_code<500: return u,info,None,n
        except Exception as e:
            info={"status":"ERR","error":str(e)[:150]}
        time.sleep(3*(a+1))
    return u,info,None,n
def crawl(use_cache=False, rate=1.0, workers=3, maxpages=5000, log=print):
    """BFS crawl. Global rate limit `rate` req/s (request *starts*); up to `workers` in flight
    because the server is slow (~3-4 s per response)."""
    rl=RateLimiter(rate); pages={}; refs={}; queued={BASE}; frontier=[BASE]; t0=time.time(); nfetch=0
    with ThreadPoolExecutor(workers) as ex:
        while frontier and len(pages)<maxpages:
            nxt=[]
            for u,info,text,n in ex.map(lambda x: fetch_one(x,rl,use_cache), frontier[:maxpages-len(pages)]):
                nfetch+=n
                if text:
                    s=BeautifulSoup(text,"html.parser"); info["title"]=s.title.get_text(" ",strip=True) if s.title else ""
                    for l in links_of(u,text):
                        refs.setdefault(l,set()).add(u)
                        if l not in queued: queued.add(l); nxt.append(l)
                pages[u]=info
                if len(pages)%100==0: log(f"[{time.time()-t0:.0f}s] {len(pages)} pages, requests {nfetch}")
            frontier=nxt
    meta={"pages":pages,"refs":{k:sorted(v) for k,v in refs.items()},"unvisited":frontier,
          "elapsed_s":round(time.time()-t0,1),"requests":nfetch,"crawled_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())}
    json.dump(meta,open(os.path.join(HERE,"crawl_meta.json"),"w"),indent=1)
    log(f"crawl done: {len(pages)} pages, {nfetch} HTTP requests, {meta['elapsed_s']}s")
    return meta
if __name__=="__main__":
    crawl(use_cache="--cache" in sys.argv, log=lambda m: print(m,flush=True))
