def main():
    import json, html, datetime
    from urllib.parse import urlparse, unquote
    import sys,os
    HERE=os.path.dirname(os.path.abspath(__file__))
    OUTDIR=os.environ.get("SITEMAP_DIR",os.path.dirname(HERE))  # default: parent of simba-data (/workspace locally, repo root on GitHub)
    d=json.load(open(os.path.join(HERE,"crawl_meta.json"))); P=d["pages"]; R=d["refs"]
    HOST="simba.mygamesonline.org"; date=datetime.date.today().isoformat()
    ok={u:i for u,i in P.items() if i["status"]==200}
    bad={u:i for u,i in P.items() if i["status"]!=200}
    # tree
    tree={}
    for u,i in ok.items():
        path=urlparse(u).path; q=urlparse(u).query
        parts=[p for p in path.split("/") if p]
        node=tree
        if not parts: node.setdefault("__pages__",[]).append((u,i)); continue
        for p in parts[:-1]: node=node.setdefault(p+"/",{})
        if path.endswith("/"):
            node=node.setdefault(parts[-1]+"/",{})
        node.setdefault("__pages__",[]).append((u,i))
    def title(u,i):
        t=(i.get("title") or "").strip() or unquote(urlparse(u).path.rsplit("/",1)[-1]) or "/"
        return t
    def sortkey(x): return urlparse(x[0]).path.lower()
    def count(node): return len(node.get("__pages__",[]))+sum(count(v) for k,v in node.items() if k!="__pages__")
    def h(node,depth=0):
        out=["<ul>"]
        for u,i in sorted(node.get("__pages__",[]),key=sortkey):
            out.append(f'<li class="page"><a href="{html.escape(u)}">{html.escape(title(u,i))}</a> <span class="path">{html.escape(urlparse(u).path)}</span></li>')
        for k in sorted(x for x in node if x!="__pages__"):
            out.append(f'<li class="dir"><details {"open" if depth<1 else ""}><summary>📁 {html.escape(k)} <span class="cnt">({count(node[k])})</span></summary>{h(node[k],depth+1)}</details></li>')
        out.append("</ul>"); return "\n".join(out)
    def md(node,depth=0):
        ind="  "*depth; out=[]
        for u,i in sorted(node.get("__pages__",[]),key=sortkey):
            out.append(f"{ind}- [{title(u,i).replace('[','(').replace(']',')')}]({u}) `{urlparse(u).path}`")
        for k in sorted(x for x in node if x!="__pages__"):
            out.append(f"{ind}- **{k}** ({count(node[k])})"); out+=md(node[k],depth+1)
        return out
    brows=[]; bmd=[]
    for u,i in sorted(bad.items()):
        st=i["status"] if i["status"]!="ERR" else "ERR: "+i.get("error","")
        rf=R.get(u,[])
        brows.append(f'<tr><td>{html.escape(str(st))}</td><td><a href="{html.escape(u)}">{html.escape(urlparse(u).path)}</a></td><td>{"<br>".join(html.escape(urlparse(x).path) for x in rf[:5])}{" …(+%d)"%(len(rf)-5) if len(rf)>5 else ""}</td></tr>')
        bmd.append(f"| {st} | {u} | {', '.join(urlparse(x).path for x in rf[:5])}{' …(+%d)'%(len(rf)-5) if len(rf)>5 else ''} |")
    capnote=(f"<p class='note'>{len(d['unvisited'])} discovered URLs were not fetched (page cap).</p>" if d["unvisited"] else "<p class='note'>Full crawl: every discovered same-host page was fetched (no cap hit).</p>")+f"<p class='note'>Crawl took {d.get('elapsed_s')} s, {d.get('requests')} HTTP requests.</p>"
    notes="""<ul class="notes">
    <li>HTTPS certificate does not match host (served cert is for <code>p52-preview.runhosting.com</code>); crawled with certificate verification disabled. Plain HTTP timed out.</li>
    <li>No <code>/robots.txt</code> (404) and no <code>/sitemap.xml</code> (404) — no crawl restrictions.</li>
    <li>Home page is a frameset (<code>index2.htm</code> header menu + <code>index1.htm</code> main); navigation uses JavaScript &lt;select&gt; menus, whose option values were extracted as links.</li>
    </ul>"""
    H=f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sitemap — {HOST}</title>
    <style>
    body{{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1000px;margin:2em auto;padding:0 1em;color:#222;background:#fafafa}}
    header{{background:#1f3a5f;color:#fff;padding:1.2em 1.5em;border-radius:8px}} header h1{{margin:0 0 .3em}} header p{{margin:.2em 0;opacity:.9}}
    h2{{border-bottom:2px solid #1f3a5f;padding-bottom:.2em;margin-top:1.6em}}
    ul{{list-style:none;padding-left:1.2em;margin:.2em 0}} li{{margin:.15em 0}}
    li.page::before{{content:"📄 "}} a{{color:#0b5cad;text-decoration:none}} a:hover{{text-decoration:underline}}
    .path{{color:#888;font-size:.82em;font-family:monospace}} .cnt{{color:#888;font-size:.85em}}
    summary{{cursor:pointer;font-weight:600}} table{{border-collapse:collapse;width:100%;background:#fff}}
    td,th{{border:1px solid #ddd;padding:.35em .6em;text-align:left;font-size:.9em;vertical-align:top}} th{{background:#eef}}
    .note,.notes{{color:#555;font-size:.9em}}
    </style></head><body>
    <header><h1>Sitemap: {HOST}</h1><p>Crawled: {date} · Pages found: <b>{len(ok)}</b> · Broken/errored links: <b>{len(bad)}</b> · URLs fetched: {len(P)}</p><p>Start URL: <a style="color:#cde" href="https://{HOST}/">https://{HOST}/</a></p></header>
    <h2>Crawl notes</h2>{notes}{capnote}
    <h2>Pages ({len(ok)})</h2>
    {h(tree)}
    <h2>Broken links ({len(bad)})</h2>
    {"<table><tr><th>Status</th><th>URL</th><th>Linked from</th></tr>"+"".join(brows)+"</table>" if bad else "<p>None found.</p>"}
    </body></html>"""
    open(os.path.join(OUTDIR,"simba-sitemap.html"),"w").write(H)
    M=[f"# Sitemap: {HOST}","",f"- **Crawl date:** {date}",f"- **Pages found:** {len(ok)}",f"- **Broken/errored links:** {len(bad)}",f"- **URLs fetched:** {len(P)}","","## Crawl notes","",
    "- HTTPS cert mismatch (cert for `p52-preview.runhosting.com`); crawled with verification disabled. Plain HTTP timed out.",
    "- No `/robots.txt` (404) and no `/sitemap.xml` (404).",
    "- Home is a frameset (`index2.htm` menu + `index1.htm`); JS `<select>` menu option values extracted as links."]
    M.append(f"- {len(d['unvisited'])} discovered URLs not fetched." if d["unvisited"] else "- Full crawl: every discovered same-host page was fetched.")
    M.append(f"- Crawl took {d.get('elapsed_s')} s, {d.get('requests')} HTTP requests.")
    M.append("- Player pages embed a stats iframe (`playerNstats.htm`), crawled as separate pages.")
    M+=["",f"## Pages ({len(ok)})",""]+md(tree)+["",f"## Broken links ({len(bad)})",""]
    M+=(["| Status | URL | Linked from |","|---|---|---|"]+bmd) if bad else ["None found."]
    open(os.path.join(OUTDIR,"simba-sitemap.md"),"w").write("\n".join(M)+"\n")
    print('sitemap:',len(ok),'pages,',len(bad),'broken,',len(d['unvisited']),'unvisited')
    
if __name__=='__main__': main()
