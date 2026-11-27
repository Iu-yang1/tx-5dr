"""Local Windows N1MM Entry bridge. Requires pywinauto (UIA backend).
No global keystrokes, automatic logging, or network listening socket.
Select the exact Entry Window title and AutomationIds using Inspect.exe.
"""
import argparse
import json
import os
import re
import time
import urllib.request
import urllib.error

def request(base, token, update):
    data = json.dumps(update).encode("utf-8")
    req = urllib.request.Request(base.rstrip("/") + "/cw/contest/entry/agent",
        data=data, headers={"Content-Type": "application/json", "Authorization": "Bearer " + token}, method="POST")
    with urllib.request.urlopen(req, timeout=2) as resp:
        return json.load(resp)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True, help="TX-5DR API base, including /api")
    ap.add_argument("--title", required=True, help="Exact N1MM Entry Window title")
    ap.add_argument("--call-id", required=True)
    ap.add_argument("--zone-id", required=True)
    ap.add_argument("--exe", default="N1MMLogger.net.exe")
    a = ap.parse_args()
    token = os.environ.get("TX5DR_N1MM_TOKEN", "")
    if not token:
        ap.error("Set TX5DR_N1MM_TOKEN to an authorized operator session token")
    from pywinauto import Desktop
    import psutil
    def controls():
        matches = []
        for win in Desktop(backend="uia").windows():
            if win.window_text() != a.title:
                continue
            try:
                if psutil.Process(win.process_id()).name().lower() == a.exe.lower():
                    matches.append(win)
            except psutil.Error:
                continue
        if len(matches) != 1:
            raise RuntimeError("Exactly one matching N1MM Entry Window required")
        win = matches[0]
        def edit(auto_id):
            items = [x for x in win.descendants(control_type="Edit") if x.element_info.automation_id == auto_id]
            if len(items) != 1:
                raise RuntimeError("Missing or ambiguous N1MM field: " + auto_id)
            return items[0]
        return edit(a.call_id), edit(a.zone_id)
    def read(c,z):
        return {"call":re.sub(r"[^A-Z0-9/]","",c.get_value().upper())[:20],
                "zone":re.sub(r"\D","",z.get_value())[:2]}
    acknowledged = None
    while True:
        try:
            c,z = controls()
            state = request(a.api,token,{"fields":read(c,z),**(acknowledged or {})})
            acknowledged = None
            pending = state.get("pending")
            if pending and pending["expiresAt"] > time.time()*1000:
                fields = pending["fields"]
                # Re-resolve target before edits; never send keys to the foreground.
                c,z = controls()
                try:
                    c.set_edit_text(fields["call"])
                    z.set_edit_text(fields["zone"])
                    acknowledged = {"appliedRevision":pending["revision"]}
                except Exception as exc:
                    acknowledged = {"appliedRevision":pending["revision"],"error":str(exc)[:400]}
            time.sleep(0.15)
        except KeyboardInterrupt:
            return
        except Exception as exc:
            print("N1MM Entry agent:",str(exc),flush=True)
            time.sleep(1)

if __name__ == "__main__":
    main()
