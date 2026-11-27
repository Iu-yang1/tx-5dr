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
    ap.add_argument("--actions", help="JSON file mapping action names to exact N1MM control AutomationIds")
    a = ap.parse_args()
    token = os.environ.get("TX5DR_N1MM_TOKEN", "")
    if not token:
        ap.error("Set TX5DR_N1MM_TOKEN to an authorized operator session token")
    action_ids = {}
    if a.actions:
        with open(a.actions, encoding="utf-8") as stream:
            action_ids = json.load(stream)
    allowed = {"STOP","LOG","WIPE","MARK","STORE","SPOT","RUN","S&P"} | {"F"+str(i) for i in range(1,13)}
    if not isinstance(action_ids, dict) or any(k not in allowed or not isinstance(v,str) or not v for k,v in action_ids.items()):
        ap.error("Invalid action mapping")
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
        buttons = {}
        for name, auto_id in action_ids.items():
            items = [x for x in win.descendants() if x.element_info.automation_id == auto_id and x.element_info.control_type in ("Button","RadioButton")]
            if len(items) == 1:
                buttons[name] = items[0]
        return edit(a.call_id), edit(a.zone_id), buttons
    def read(c,z):
        return {"call":re.sub(r"[^A-Z0-9/]","",c.get_value().upper())[:20],
                "zone":re.sub(r"\D","",z.get_value())[:2]}
    acknowledged = None
    last_action = None
    while True:
        try:
            c,z,buttons = controls()
            state = request(a.api,token,{"fields":read(c,z),"actions":list(buttons),**(acknowledged or {})})
            acknowledged = None
            pending = state.get("pending")
            if pending and pending["expiresAt"] > time.time()*1000:
                fields = pending["fields"]
                # Re-resolve target before edits; never send keys to the foreground.
                c,z,buttons = controls()
                try:
                    action = pending.get("action")
                    rev = pending["revision"]
                    if action and rev == last_action:
                        # Never invoke a one-shot action twice after an HTTP retry.
                        acknowledged = {"appliedRevision":rev,"error":"Action already attempted; inspect N1MM"}
                        continue
                    if action != "STOP":
                        previous = read(c,z)
                        if previous["call"] != fields["call"]: c.set_edit_text(fields["call"])
                        if previous["zone"] != fields["zone"]: z.set_edit_text(fields["zone"])
                        if read(c,z) != fields: raise RuntimeError("N1MM fields did not match requested values")
                    if action:
                        if action not in buttons: raise RuntimeError("N1MM action control unavailable")
                        last_action = rev
                        button = buttons[action]
                        if button.element_info.control_type == "RadioButton": button.select()
                        else: button.invoke()
                    acknowledged = {"appliedRevision":rev}
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
