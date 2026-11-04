#!/usr/bin/env python3
"""Synchronize exact mfsk-core dependency and native ABI guards.

Intentionally do not change the independent pinned golden WAV corpus.
Usage: python3 scripts/update-mfsk-core.py 0.15.2 UPSTREAM_40_HEX_COMMIT
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent

def read(name):
    return (ROOT / name).read_text(encoding="utf8")

def edit(name, old, new):
    content = read(name)
    assert content.count(old) == 1, "Expected one occurrence of %r in %s" % (old, name)
    (ROOT / name).write_text(content.replace(old, new), encoding="utf8")
    print("updated", name)

def main():
    assert len(sys.argv) == 3, "Usage: update-mfsk-core.py X.Y.Z UPSTREAM_SHA"
    version, sha = sys.argv[1:]
    assert re.fullmatch(r"\d+\.\d+\.\d+", version), "Require stable semver"
    assert re.fullmatch(r"[0-9a-f]{40}", sha), "Require verified upstream commit"
    manifest = read("packages/mfsk-native/Cargo.toml")
    match = re.search(r'mfsk-core\s*=\s*\{\s*version\s*=\s*"=(\d+\.\d+\.\d+)"', manifest)
    assert match, "Missing pinned mfsk-core crate"
    old = match.group(1)
    assert tuple(map(int, version.split("."))) >= tuple(map(int, old.split("."))), "No downgrade"
    if version == old:
        print("Already pinned to", version)
        return
    edit("packages/mfsk-native/Cargo.toml", 'version = "=' + old + '"', 'version = "=' + version + '"')
    for file in (
        "packages/mfsk-native/src/lib.rs",
        "packages/server/src/decode/MfskNativeAdapter.ts",
        "packages/server/src/routes/mfsk-capabilities.ts",
        "packages/server/src/decode/__tests__/MfskNativeAdapter.test.ts",
    ):
        edit(file, "mfsk-core/" + old + ";", "mfsk-core/" + version + ";")
    for file in (
        "packages/mfsk-native/smoke.cjs",
        "packages/server/scripts/p9-codec-runtime-audit.cjs",
    ):
        edit(file, re.escape(old), re.escape(version))
    edit(".github/workflows/mfsk-native-acceptance.yml",
         "fixed mfsk-core v" + old, "fixed mfsk-core v" + version)
    doc_file = "docs/decisions/mfsk-six-mode-migration.md"
    doc = read(doc_file)
    line = re.search(r"^- Rust upstream: .*$", doc, re.MULTILINE)
    assert line, "Missing upstream provenance in documentation"
    tick = chr(96)
    entry = ("- Rust upstream: " + tick + "jl1nie/mfsk-core" + tick + " " +
             tick + "v" + version + tick + " at " + tick + sha + tick +
             ". WSJT-X golden WAV reference corpus remains independently pinned.")
    (ROOT / doc_file).write_text(doc[:line.start()] + entry + doc[line.end():], encoding="utf8")
    print("Updated immutable source provenance. No automatic merge or Release.")

if __name__ == "__main__":
    main()
