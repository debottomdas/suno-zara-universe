#!/usr/bin/env python3
"""Read-only audit of local creative video versions. Never edits manifests or media."""
import hashlib
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(os.environ.get("SZU_WORKER_ROOT", str(Path.home() / "Suno Zara Universe"))).expanduser()
MANIFEST = ROOT / "worker-manifest.json"
PROJECT_ID = sys.argv[1] if len(sys.argv) > 1 else ""
if not PROJECT_ID:
    sys.exit("Usage: python3 scripts/audit-video-versions.py PROJECT_ID")
with MANIFEST.open(encoding="utf-8") as stream:
    projects = json.load(stream).get("projects", {})
project = projects.get(PROJECT_ID)
if project is None:
    sys.exit("Project not found in local worker manifest.")

def checksum(filename):
    digest = hashlib.sha256()
    with filename.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

# Cross-project lookup identifies the same source media referenced under different songs.
references = defaultdict(set)
for pid, entry in projects.items():
    for version in (entry.get("creative") or {}).get("versions", []):
        filename = version.get("filePath")
        if filename:
            references[str(Path(filename).expanduser().resolve())].add(pid)

groups = defaultdict(list)
print("Read-only video ownership audit")
print("Song:", project.get("title"), "| Project:", PROJECT_ID)
print("No files or manifest records will be changed.\n")
for n, v in enumerate((project.get("creative") or {}).get("versions", []), 1):
    if v.get("slot") != 0 or v.get("recoveredFromLegacy"):
        continue
    if v.get("projectId") != PROJECT_ID:
        continue
    if v.get("source") == "generated" and v.get("dependencyKey") in (None, "", "legacy-unverified"):
        continue
    filename = Path(v.get("filePath") or "").expanduser()
    exists = filename.is_file()
    sha = checksum(filename) if exists else "MISSING"
    groups[sha].append(n)
    shared = sorted(references.get(str(filename.resolve()), set()) - {PROJECT_ID})
    dependency = v.get("dependencyKey") or ""
    audio = ""
    if isinstance(dependency, str) and dependency.startswith("{"):
        try:
            audio = str(json.loads(dependency).get("audio", ""))[:100]
        except ValueError:
            pass
    print(f"Version {n} | {v.get('source')} | {filename.name}")
    print(f"  SHA256: {sha}")
    print(f"  Size: {filename.stat().st_size if exists else 'MISSING'} bytes | Original source: {v.get('originalSource') or '-'}")
    print(f"  Generated: {v.get('generatedAt') or '-'} | Dependency audio: {audio or '-'}")
    print(f"  Shared file path with other projects: {', '.join(shared) if shared else 'none'}")
print("\nIDENTICAL-FILE GROUPS (SHA-256):")
for sha, indices in groups.items():
    print(f"  {sha[:16]}: manifest entries {', '.join(map(str, indices))}")
print(f"\n{sum(map(len, groups.values()))} visible entries; {len(groups)} distinct content hashes.")
print("Identical SHA-256 means byte-identical files, not proof of song ownership.")
