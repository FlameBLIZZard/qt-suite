"""Windows toast for a new phone notification (Ping). Best effort, never blocks the caller.

Uses PowerShell + WinRT so it needs nothing installed. Bursts are merged: at most one toast
every couple of seconds; extra ones become "+N more".
"""
import os
import subprocess
import threading
import time
from xml.sax.saxutils import escape

import ping

NOWIN = 0x08000000
AUMID = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
GAP = 2.5

_lock = threading.Lock()
_queue = []
_worker = None
_last = 0.0
enabled = os.name == "nt" and not os.environ.get("BEAM_NO_TOAST")


def show(n):
    global _worker
    if not enabled:
        return
    with _lock:
        _queue.append(n)
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, daemon=True, name="ping-toast")
            _worker.start()


def _run():
    global _last
    while True:
        time.sleep(max(0.0, GAP - (time.time() - _last)))
        with _lock:
            if not _queue:
                return
            batch, _queue[:] = list(_queue), []
        _last = time.time()
        try:
            _toast(batch[-1], len(batch) - 1)
        except Exception as e:
            print("[beam] toast:", e)


def xml_for(n, more=0):
    title = n.get("title") or n.get("app") or "Phone"
    body = n.get("text") or ""
    if n.get("msgs"):
        m = n["msgs"][-1]
        body = (m["who"] + ": " if m.get("who") and m["who"] != title else "") + m["text"]
    attrib = (n.get("app") or "Phone") + (f"  +{more} more" if more else "")
    icon = ping.icon_path(n.get("pkg", ""))
    logo = f'<image placement="appLogoOverride" hint-crop="circle" src="file:///{escape(icon.replace(os.sep, "/"))}"/>' if icon else ""
    return ('<toast activationType="protocol" launch="http://127.0.0.1:7788/notify">'
            '<visual><binding template="ToastGeneric">'
            f'<text>{escape(title[:120])}</text><text>{escape(body[:300])}</text>'
            f'<text placement="attribution">{escape(attrib)}</text>{logo}'
            '</binding></visual><audio silent="true"/></toast>')


def _toast(n, more):
    x = xml_for(n, more).replace("'", "''")
    ps = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;"
        "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null;"
        "$x = New-Object Windows.Data.Xml.Dom.XmlDocument;"
        f"$x.LoadXml('{x}');"
        "$t = New-Object Windows.UI.Notifications.ToastNotification $x;"
        "$t.Tag = 'ping'; $t.Group = 'beam';"
        f"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{AUMID}').Show($t)"
    )
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                   creationflags=NOWIN, timeout=20, capture_output=True)
