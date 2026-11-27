"""Bind a local Windows N1MM Entry Window to TX-5DR via UI Automation."""
import argparse
import json
import os
import re
import time
import urllib.request

ALLOWED_ACTIONS = {"STOP", "LOG", "WIPE", "MARK", "STORE", "SPOT", "RUN", "S&P"} | {
    "F" + str(i) for i in range(1, 13)
}


def request(base, token, update):
    data = json.dumps(update).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(
        base.rstrip("/") + "/cw/contest/entry/agent",
        data=data,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=2) as resp:
        return json.load(resp)


def read_fields(call_control, zone_control):
    return {
        "call": re.sub(r"[^A-Z0-9/]", "", call_control.get_value().upper())[:20],
        "zone": re.sub(r"\D", "", zone_control.get_value())[:2],
    }


class EntryExecutor:
    """One-shot action fence. A failed transport acknowledgement never repeats a click."""

    def __init__(self):
        self.last_action = None

    def apply(self, pending, call_control, zone_control, buttons, now=None):
        rev = pending["revision"]
        action = pending.get("action")
        fields = pending["fields"]
        try:
            if pending["expiresAt"] <= (time.time() * 1000 if now is None else now):
                raise RuntimeError("Entry command expired")
            if action and rev == self.last_action:
                raise RuntimeError("Action already attempted; inspect N1MM")
            if action != "STOP":
                previous = read_fields(call_control, zone_control)
                if previous["call"] != fields["call"]:
                    call_control.set_edit_text(fields["call"])
                if previous["zone"] != fields["zone"]:
                    zone_control.set_edit_text(fields["zone"])
                if read_fields(call_control, zone_control) != fields:
                    raise RuntimeError("N1MM fields did not match requested values")
            if action:
                if action not in buttons:
                    raise RuntimeError("N1MM action control unavailable")
                self.last_action = rev
                button = buttons[action]
                if button.element_info.control_type == "RadioButton":
                    button.select()
                else:
                    button.invoke()
            return {"appliedRevision": rev}
        except Exception as exc:
            return {"appliedRevision": rev, "error": str(exc)[:400]}


def find_window(title, exe):
    from pywinauto import Desktop
    import psutil

    matches = []
    for window in Desktop(backend="uia").windows():
        if title and window.window_text() != title:
            continue
        try:
            if psutil.Process(window.process_id()).name().lower() == exe.lower():
                matches.append(window)
        except psutil.Error:
            continue
    if len(matches) != 1:
        raise RuntimeError("Exactly one matching N1MM Entry Window required")
    return matches[0]


def resolve_controls(window, call_id, zone_id, action_ids):
    descendants = window.descendants()

    def edit(auto_id):
        items = [
            x for x in descendants
            if x.element_info.automation_id == auto_id and x.element_info.control_type == "Edit"
        ]
        if len(items) != 1:
            raise RuntimeError("Missing or ambiguous N1MM field: " + auto_id)
        return items[0]

    buttons = {}
    for name, auto_id in action_ids.items():
        items = [
            x for x in descendants if x.element_info.automation_id == auto_id
            and x.element_info.control_type in ("Button", "RadioButton")
        ]
        if len(items) == 1:
            buttons[name] = items[0]
    return edit(call_id), edit(zone_id), buttons


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", help="TX-5DR API base, including /api")
    ap.add_argument("--title", required=True, help="Exact N1MM Entry Window title")
    ap.add_argument("--call-id")
    ap.add_argument("--zone-id")
    ap.add_argument("--exe", default="N1MMLogger.net.exe")
    ap.add_argument("--actions", help="JSON mapping native actions to N1MM AutomationIds")
    ap.add_argument("--inspect", action="store_true", help="List actual control names and IDs")
    ap.add_argument("--no-auth", action="store_true", help="Only for a server with authentication disabled")
    args = ap.parse_args()
    if args.inspect:
        window = find_window(args.title, args.exe)
        for control in window.descendants():
            info = control.element_info
            if info.control_type in ("Edit", "Button", "RadioButton"):
                print(info.control_type, repr(info.name), repr(info.automation_id))
        return
    if not (args.api and args.call_id and args.zone_id):
        ap.error("--api, --call-id and --zone-id are required")
    token = os.environ.get("TX5DR_N1MM_TOKEN", "")
    if not token and not args.no_auth:
        ap.error("Set TX5DR_N1MM_TOKEN to an authorized operator session token")
    action_ids = {}
    if args.actions:
        with open(args.actions, encoding="utf-8") as stream:
            action_ids = json.load(stream)
    if not isinstance(action_ids, dict) or any(
        k not in ALLOWED_ACTIONS or not isinstance(v, str) or not v for k, v in action_ids.items()
    ):
        ap.error("Invalid action mapping")

    def controls():
        window = find_window(args.title, args.exe)
        return resolve_controls(window, args.call_id, args.zone_id, action_ids)

    executor = EntryExecutor()
    acknowledged = None
    while True:
        try:
            call_control, zone_control, buttons = controls()
            state = request(args.api, token, {
                "fields": read_fields(call_control, zone_control),
                "actions": list(buttons),
                **(acknowledged or {}),
            })
            acknowledged = None
            pending = state.get("pending")
            if pending and pending["expiresAt"] > time.time() * 1000:
                call_control, zone_control, buttons = controls()
                acknowledged = executor.apply(pending, call_control, zone_control, buttons)
            time.sleep(0.15)
        except KeyboardInterrupt:
            return
        except Exception as exc:
            print("N1MM Entry agent:", str(exc), flush=True)
            time.sleep(1)


if __name__ == "__main__":
    main()
