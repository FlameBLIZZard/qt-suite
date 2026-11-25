"""Surf - the QT Suite web browser (server half). Page: suite/apps/surf.html + static/surf.js/.css.

Two ways a tab can show a page:
  Live  the real site in a sandboxed iframe. Fast, full JavaScript, logins work. Many big sites
        (Google, GitHub, YouTube) refuse to be shown inside another page, so ...
  Lite  ... this module fetches the page itself and serves it from its own throwaway origin
        (127.0.0.1:<random port>) with the frame-blocking headers removed. A small script in the
        page sends link clicks and form posts back to Surf so the address bar and history follow.
        No cookies are sent or kept, so it is for reading, not logging in.

Hub routes (same origin as the hub):
  GET  /api/web/info            {lite: <port>}
  GET  /api/web/check?u=URL     {ok, frame, final, status, ctype, why}  can it show Live?
  POST /api/web/pop   {url}     open the page in a small Edge app window

Safety: Lite pages run with a CSP sandbox (opaque origin, no top navigation), only the hub may frame
them, and the fetcher refuses private, loopback and link-local addresses (also after redirects),
so a web page can't use it to poke at Beam, VOLT or the router.
"""
import html as _html
import ipaddress
import json
import os
import re
import socket
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")
CAP = 24 << 20          # biggest thing Lite will pass through
HUB_PORT = 7800
LITE_PORT = 0
_srv = None


# ---------------------------------------------------------------- address safety
def _public(host):
    """True when every address the host resolves to is a public one."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved
                or ip.is_unspecified or (ip.version == 6 and ip.ipv4_mapped and not ip.ipv4_mapped.is_global)):
            return False
    return True


def _check_url(u):
    p = urllib.parse.urlsplit(u)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ValueError("only http and https links")
    if not _public(p.hostname):
        raise PermissionError("that address is on this PC or your network")
    return p


def is_local(u):
    try:
        h = urllib.parse.urlsplit(u).hostname or ""
    except ValueError:
        return False
    if h in ("localhost",) or h.endswith(".localhost"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False


class _Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_Redirects())


def fetch(u, data=None, ctype=None, timeout=15):
    _check_url(u)
    h = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-IN,en;q=0.9"}
    if ctype:
        h["Content-Type"] = ctype
    try:
        return _opener.open(urllib.request.Request(u, data=data, headers=h), timeout=timeout)
    except urllib.error.HTTPError as e:   # 404 pages etc. are still pages
        return e


# ---------------------------------------------------------------- can it be framed?
def frame_ok(headers):
    xfo = (headers.get("X-Frame-Options") or "").strip().lower()
    if xfo in ("deny", "sameorigin") or xfo.startswith("allow-from"):
        return False, "X-Frame-Options " + xfo.upper()
    for csp in headers.get_all("Content-Security-Policy") or []:
        for part in csp.split(";"):
            part = part.strip()
            if part.lower().startswith("frame-ancestors"):
                srcs = part.split()[1:]
                if "*" in srcs or any(s.rstrip("/") in (f"http://127.0.0.1:{HUB_PORT}", "http://127.0.0.1:*", "http:") for s in srcs):
                    continue
                return False, "frame-ancestors " + " ".join(srcs)
    return True, ""


_cache = {}


def check(u):
    if is_local(u):
        return {"ok": True, "frame": True, "final": u, "local": True}
    host = urllib.parse.urlsplit(u).hostname or ""
    try:
        r = fetch(u, timeout=8)
        try:
            ok, why = frame_ok(r.headers)
            out = {"ok": True, "frame": ok, "why": why, "final": r.geturl(), "status": r.status if hasattr(r, "status") else r.code,
                   "ctype": (r.headers.get("Content-Type") or "").split(";")[0]}
            if out["ctype"] in ("text/html", "application/xhtml+xml"):
                try:
                    m = re.search(rb"<title[^>]*>(.*?)</title>", r.read(262144), re.I | re.S)
                    if m:
                        out["title"] = _html.unescape(m.group(1).decode("utf-8", "replace")).strip()[:200]
                except Exception:
                    pass
        finally:
            r.close()
    except PermissionError as e:
        return {"ok": False, "frame": False, "why": str(e)}
    except Exception as e:
        if host in _cache:
            return dict(_cache[host], cached=True)
        return {"ok": False, "frame": False, "why": str(e)[:200]}
    _cache[host] = {"ok": True, "frame": out["frame"], "why": out["why"], "final": out["final"]}
    return out


# ---------------------------------------------------------------- Lite page rewrite
SHIM = r"""<script>(()=>{"use strict";
const U=%(url)s,PB=%(pb)s,K=%(k)s,P=parent;
const send=m=>{try{P.postMessage(Object.assign({qtweb:1,k:K},m),"*")}catch(e){}};
const abs=h=>{try{return new URL(h,document.baseURI).href}catch(e){return null}};
const noHash=u=>String(u).split("#")[0];
try{const mk=()=>{const d=new Map();return{getItem:k=>d.has(k+"")?d.get(k+""):null,setItem:(k,v)=>d.set(k+"",v+""),removeItem:k=>d.delete(k+""),clear:()=>d.clear(),key:i=>[...d.keys()][i]??null,get length(){return d.size}}};
 try{localStorage}catch(e){Object.defineProperty(window,"localStorage",{value:mk()});Object.defineProperty(window,"sessionStorage",{value:mk()})}
 try{document.cookie}catch(e){let c="";Object.defineProperty(document,"cookie",{get:()=>c,set:v=>{c=(c?c+"; ":"")+String(v).split(";")[0]}})}}catch(e){}
const icon=()=>{const l=document.querySelector('link[rel~="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]');return l?abs(l.getAttribute("href")):null};
const page=()=>send({t:"page",url:U,title:document.title||"",icon:icon()});
document.addEventListener("DOMContentLoaded",page);addEventListener("load",page);
const go=(u,nt)=>send({t:nt?"newtab":"nav",url:u});
const web=u=>/^https?:/i.test(u||"");
addEventListener("click",e=>{if(e.defaultPrevented||e.button>1)return;const a=e.target.closest&&e.target.closest("a[href]");if(!a)return;
 const h=a.getAttribute("href");if(!h||/^\s*javascript:/i.test(h)||a.hasAttribute("download"))return;const u=abs(a.href);if(!web(u))return;
 if(noHash(u)===noHash(U)&&u.includes("#"))return;e.preventDefault();go(u,a.target==="_blank"||e.ctrlKey||e.metaKey||e.shiftKey||e.button===1)});
addEventListener("auxclick",e=>{if(e.button!==1)return;const a=e.target.closest&&e.target.closest("a[href]");if(a&&web(abs(a.href))){e.preventDefault();go(abs(a.href),1)}});
addEventListener("submit",e=>{if(e.defaultPrevented)return;const f=e.target,s=e.submitter;
 const act=abs((s&&s.getAttribute("formaction"))||f.getAttribute("action")||U);if(!web(act))return;
 const m=((s&&s.getAttribute("formmethod"))||f.method||"get").toLowerCase();const fd=new FormData(f,s||undefined);const q=new URLSearchParams();
 for(const[k,v]of fd)if(typeof v==="string")q.append(k,v);
 if(m==="get"){e.preventDefault();const x=new URL(act);x.search=q.toString();go(x.href,f.target==="_blank");return}
 f.setAttribute("action",PB+"/p?u="+encodeURIComponent(act)+"&k="+encodeURIComponent(K));f.setAttribute("enctype","application/x-www-form-urlencoded");f.removeAttribute("target")});
const wo=window.open;window.open=function(u){const x=abs(u||"");if(web(x)){go(x,1);return null}return null};
for(const k of["pushState","replaceState"]){const o=history[k].bind(history);history[k]=function(s,t,u){if(u!=null){const x=abs(u);if(x)send({t:"url",url:x,title:document.title})}try{return o(s,t)}catch(e){}}}
addEventListener("keydown",e=>{const k=e.key.toLowerCase(),c=e.ctrlKey||e.metaKey;
 if((c&&!e.altKey&&["l","t","w","k","d","r","h","tab"].includes(k))||(e.altKey&&!c&&(k==="arrowleft"||k==="arrowright"||k==="home"))||k==="f5"||(c&&e.shiftKey&&k==="t")){
  e.preventDefault();send({t:"key",key:e.key,ctrl:c,shift:e.shiftKey,alt:e.altKey})}},true);
addEventListener("mouseup",e=>{if(e.button===3||e.button===4){e.preventDefault();send({t:"key",key:e.button===3?"ArrowLeft":"ArrowRight",alt:true})}});
})();</script>"""

_HEAD = re.compile(rb"<head(\s[^>]*)?>", re.I)
_BASE = re.compile(rb"<base\s[^>]*href\s*=\s*[\"']?([^\"'\s>]+)[^>]*>", re.I)
_METACSP = re.compile(rb"<meta[^>]+http-equiv\s*=\s*[\"']?(content-security-policy|x-frame-options)[^>]*>", re.I)
_CHARSET = re.compile(rb"<meta[^>]+charset\s*=\s*[\"']?([\w-]+)", re.I)


def rewrite(body, final, ctype_header, key=""):
    m = re.search(r"charset=([\w-]+)", ctype_header or "", re.I)
    cs = m.group(1) if m else None
    if not cs:
        mm = _CHARSET.search(body[:4096])
        cs = mm.group(1).decode("ascii", "ignore") if mm else "utf-8"
    try:
        text = body.decode(cs, "replace")
    except LookupError:
        text = body.decode("utf-8", "replace")
    body = text.encode("utf-8")
    base = final
    bm = _BASE.search(body)
    if bm:
        base = urllib.parse.urljoin(final, _html.unescape(bm.group(1).decode("utf-8", "ignore")))
        body = body[:bm.start()] + body[bm.end():]
    body = _METACSP.sub(b"", body)
    shim = SHIM % {"url": json.dumps(final), "pb": json.dumps(f"http://127.0.0.1:{LITE_PORT}"), "k": json.dumps(key)}
    inject = (f'<base href="{_html.escape(base, quote=True)}"><meta name="referrer" content="no-referrer">' + shim).encode("utf-8")
    hm = _HEAD.search(body[:65536])
    if hm:
        body = body[:hm.end()] + inject + body[hm.end():]
    else:
        body = inject + body
    return body


def _lite_page(title, msg, url=""):
    u = _html.escape(url)
    return f"""<!doctype html><meta charset="utf-8"><title>{_html.escape(title)}</title>
<style>body{{background:#16141a;color:#fff8ec;font:15px/1.5 "Space Grotesk","Segoe UI",sans-serif;display:grid;place-items:center;min-height:90vh;margin:0}}
.c{{background:#221f27;border:2.5px solid #000;border-radius:14px;box-shadow:5px 5px 0 #000;padding:26px 30px;max-width:520px}}
h1{{font:400 26px "Archivo Black","Arial Black",sans-serif;margin:0 0 8px}}code{{font:12px Consolas,monospace;color:#b6aea3;word-break:break-all}}</style>
<div class="c"><h1>{_html.escape(title)}</h1><p>{_html.escape(msg)}</p><code>{u}</code></div>""".encode("utf-8")


class Lite(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _out(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy",
                         "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads; "
                         f"frame-ancestors http://127.0.0.1:{HUB_PORT} http://localhost:{HUB_PORT}")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self, data=None, ctype=None):
        if self.headers.get("Host", "") != f"127.0.0.1:{LITE_PORT}":
            return self._out(403, b"bad host", "text/plain")
        p = urllib.parse.urlsplit(self.path)
        if p.path == "/favicon.ico":
            return self._out(404, b"", "text/plain")
        if p.path != "/p":
            return self._out(404, b"not found", "text/plain")
        qs = urllib.parse.parse_qs(p.query)
        u = (qs.get("u") or [""])[0]
        key = re.sub(r"[^\w-]", "", (qs.get("k") or [""])[0])[:40]
        try:
            r = fetch(u, data=data, ctype=ctype)
        except PermissionError as e:
            return self._out(403, _lite_page("Not in Lite mode", str(e).capitalize() + ". Lite only opens public websites; switch the tab to Live for local pages.", u), "text/html; charset=utf-8")
        except ValueError as e:
            return self._out(400, _lite_page("Can't open that", str(e), u), "text/html; charset=utf-8")
        except Exception as e:
            return self._out(502, _lite_page("Couldn't reach the site", str(e)[:200], u), "text/html; charset=utf-8")
        try:
            final = r.geturl()
            code = getattr(r, "status", None) or r.code
            ct = r.headers.get("Content-Type") or "application/octet-stream"
            body = r.read(CAP + 1)
        except Exception as e:
            return self._out(502, _lite_page("The site stopped answering", str(e)[:200], u), "text/html; charset=utf-8")
        finally:
            r.close()
        if len(body) > CAP:
            return self._out(413, _lite_page("Too big for Lite", "This is a large file. Use Pop out or your browser to download it.", final), "text/html; charset=utf-8")
        if ct.split(";")[0].strip().lower() in ("text/html", "application/xhtml+xml"):
            return self._out(code, rewrite(body, final, ct, key), "text/html; charset=utf-8")
        extra = {}
        if r.headers.get("Content-Disposition"):
            extra["Content-Disposition"] = r.headers["Content-Disposition"]
        return self._out(code, body, ct, extra)

    def do_POST(self):
        n = min(int(self.headers.get("Content-Length") or 0), 1 << 20)
        data = self.rfile.read(n) if n else b""
        return self.do_GET(data=data, ctype=self.headers.get("Content-Type") or "application/x-www-form-urlencoded")


# ---------------------------------------------------------------- hub side
def init(hub_port):
    global HUB_PORT, LITE_PORT, _srv
    HUB_PORT = hub_port
    if _srv:
        return
    want = int(os.environ.get("QT_SURF_LITE_PORT", "0"))
    _srv = ThreadingHTTPServer(("127.0.0.1", want), Lite)
    _srv.daemon_threads = True
    LITE_PORT = _srv.server_address[1]
    threading.Thread(target=_srv.serve_forever, daemon=True, name="surf-lite").start()


def route_get(p, q):
    if p == "/api/web/info":
        return 200, {"lite": LITE_PORT}
    if p == "/api/web/check":
        u = (q.get("u") or [""])[0]
        if not re.match(r"^https?://", u, re.I):
            return 400, {"ok": False, "why": "only http and https links"}
        return 200, check(u)
    return None


def pop(url):
    if not re.match(r"^https?://", url or "", re.I):
        return False, "only http and https links"
    for edge in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(edge):
            subprocess.Popen([edge, f"--app={url}", "--window-size=1200,860"])
            return True, "opened"
    import webbrowser
    webbrowser.open(url)
    return True, "opened in your browser"


def route_post(p, body):
    if p == "/api/web/pop":
        ok, msg = pop(str(body.get("url") or ""))
        return (200 if ok else 400), {"ok": ok, "msg": msg}
    if p == "/api/web/browser":
        u = str(body.get("url") or "")
        if not re.match(r"^https?://", u, re.I):
            return 400, {"ok": False, "msg": "only http and https links"}
        os.startfile(u)
        return 200, {"ok": True, "msg": "opened in your browser"}
    return None
