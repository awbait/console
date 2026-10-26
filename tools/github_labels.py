#!/usr/bin/env python3
"""Sync repository labels on GitHub with .github/labels.json.

Creates missing labels and updates colour and description of existing ones.
Never deletes labels: extra labels are only reported. GitHub has no exclusive
label groups, so the one-status-at-a-time rule (issue-workflow skill) is kept
by hand.

Requests go through the `gh` CLI, which carries the authentication; nothing is
stored in the repository. The repository is taken from the `origin` remote
unless given explicitly.

Usage:
    python tools/github_labels.py --dry-run     show what would change
    python tools/github_labels.py               apply
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REMOTE_RE = re.compile(r"^(?:git@|ssh://git@|https?://)github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?/?$")


def remote() -> str:
    url = subprocess.run(
        ["git", "-C", str(ROOT), "remote", "get-url", "origin"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    m = REMOTE_RE.match(url)
    if not m:
        raise SystemExit(f"origin is not a GitHub remote: {url}")
    return f"{m.group(1)}/{m.group(2)}"


def gh(method: str, path: str, payload: dict | None = None) -> object:
    cmd = ["gh", "api", "-X", method, path]
    if method == "GET":
        cmd.append("--paginate")
    for key, value in (payload or {}).items():
        cmd += ["-f", f"{key}={value}"]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        raise SystemExit(f"{method} {path} failed: {res.stderr.strip()}")
    body = res.stdout.strip()
    if not body:
        return None
    # --paginate concatenates one JSON array per page.
    if method == "GET":
        items: list = []
        for chunk in re.split(r"\]\s*\[", body):
            chunk = chunk.strip()
            if not chunk.startswith("["):
                chunk = "[" + chunk
            if not chunk.endswith("]"):
                chunk = chunk + "]"
            items.extend(json.loads(chunk))
        return items
    return json.loads(body)


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync GitHub labels with .github/labels.json")
    ap.add_argument("--dry-run", action="store_true", help="show changes, apply nothing")
    ap.add_argument("--file", default=str(ROOT / ".github" / "labels.json"))
    ap.add_argument("--repo", help="owner/repo, default from the origin remote")
    args = ap.parse_args()

    wanted = json.loads(Path(args.file).read_text(encoding="utf-8"))["labels"]
    repo = args.repo or remote()
    base = f"repos/{repo}/labels"

    existing = gh("GET", f"{base}?per_page=100") or []
    by_name = {lb["name"]: lb for lb in existing}

    changes = 0
    for lb in wanted:
        body = {
            "name": lb["name"],
            "color": lb["color"].lstrip("#"),
            "description": lb.get("description", ""),
        }
        cur = by_name.get(lb["name"])
        if cur is None:
            print(f"create  {lb['name']}")
            if not args.dry_run:
                gh("POST", base, body)
            changes += 1
            continue
        same = (
            cur.get("color", "").lower() == body["color"].lower()
            and (cur.get("description") or "") == body["description"]
        )
        if not same:
            print(f"update  {lb['name']}")
            if not args.dry_run:
                gh("PATCH", f"{base}/{lb['name']}", body)
            changes += 1

    extra = sorted(set(by_name) - {lb["name"] for lb in wanted})
    for name in extra:
        print(f"extra   {name} (not in {Path(args.file).name}, left as is)")
    print(f"{repo}: {changes} change(s){' planned' if args.dry_run else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
