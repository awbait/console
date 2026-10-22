#!/usr/bin/env python3
"""Changelog fragments: create, check, preview and release.

Pending entries live one per file in a fragments directory (changelog.d/ by
default). A release renders them into a new section at the top of every
changelog file, one file per language, and deletes the used fragments.

Fragment format (one entry per file):

    ### Fixed

    #### en
    Fixed the order form refusing a service built from several charts.

    #### ru
    <the same entry in Russian>

With a single language the "#### <lang>" heading may be omitted. Line breaks
inside an entry carry no meaning: the text is one paragraph and is wrapped by
this script, so every item in the changelog has the same shape.

Configuration is optional. Without it the script looks at the changelog files
that exist: CHANGELOG.md is the primary language (English unless configured)
and every CHANGELOG.<lang>.md adds a language. To configure, create
<fragments dir>/changelog.toml:

    languages = ["ru", "en"]      # first one is primary
    wrap = 80                     # 0 disables wrapping

    [files]
    ru = "CHANGELOG.md"
    en = "CHANGELOG.en.md"

    # Optional: keep the "[X.Y.Z]: url" reference block at the end of every
    # changelog in step with the version headings. {version} is the released
    # version, {previous} the one below it; "first" is used for the oldest.
    [links]
    compare = "https://github.com/org/repo/compare/v{previous}...v{version}"
    first = "https://github.com/org/repo/releases/tag/v{version}"

Only the Python standard library is used (3.11+ for the TOML config).

Commands:
    new <slug> --category Fixed   create a fragment skeleton
    check                         validate fragments (and links, if configured),
                                  exit 1 on problems
    preview                       print the pending section per language (default)
    next                          suggest the next SemVer version
    release X.Y.Z [--date D] [--dry-run]
                                  write the section into every file, add its
                                  link and delete the used fragments
    links [--dry-run]             add the missing version links to every file
"""

from __future__ import annotations

import argparse
import datetime as _dt
import re
import sys
import textwrap
from dataclasses import dataclass, field
from pathlib import Path

CATEGORIES = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"]

# Localized category headings. Non-ASCII text is escaped so the source stays
# plain ASCII. Languages missing here fall back to the English names.
CATEGORY_NAMES = {
    "ru": {
        "Added": "\u0414\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e",
        "Changed": "\u0418\u0437\u043c\u0435\u043d\u0435\u043d\u043e",
        "Deprecated": "\u0423\u0441\u0442\u0430\u0440\u0435\u043b\u043e",
        "Removed": "\u0423\u0434\u0430\u043b\u0435\u043d\u043e",
        "Fixed": "\u0418\u0441\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e",
        "Security": "\u0411\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c",
    },
}

# Title and intro line for a changelog file created by the first release.
FILE_HEADERS = {
    "en": "# Changelog\n\nAll notable changes to this project are documented in this file.\n",
    "ru": (
        "# \u0421\u043f\u0438\u0441\u043e\u043a \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439\n\n"
        "\u0412\u0441\u0435 \u0437\u043d\u0430\u0447\u0438\u043c\u044b\u0435 "
        "\u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u043f\u0440\u043e\u0435\u043a\u0442\u0430 "
        "\u0444\u0438\u043a\u0441\u0438\u0440\u0443\u044e\u0442\u0441\u044f \u0432 \u044d\u0442\u043e\u043c "
        "\u0444\u0430\u0439\u043b\u0435.\n"
    ),
}

EM_DASH = "\u2014"
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
HEADING_VERSION_RE = re.compile(r"^## \[(\d+)\.(\d+)\.(\d+)(?:-[^\]]*)?\]", re.MULTILINE)
UNRELEASED_RE = re.compile(r"^## \[?Unreleased\]?", re.MULTILINE | re.IGNORECASE)
LANG_FILE_RE = re.compile(r"^CHANGELOG\.([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.md$")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
# Every version heading, prerelease suffix included, in file order (newest first).
HEADING_ANY_RE = re.compile(r"^## \[(\d+\.\d+\.\d+(?:-[^\]]*)?)\]", re.MULTILINE)
# A reference-style link line for a version: "[1.4.0]: https://...".
LINK_LINE_RE = re.compile(r"^\[(\d+\.\d+\.\d+(?:-[^\]]*)?)\]:[ \t]*(\S+)[ \t]*$")


class ChangelogError(Exception):
    """A problem the user has to fix; printed without a traceback."""


@dataclass
class Config:
    root: Path
    fragments: Path
    languages: list[str]
    files: dict[str, Path]
    wrap: int = 80
    # URL templates for the version link block; empty when links are not kept.
    link_compare: str = ""
    link_first: str = ""

    @property
    def keeps_links(self) -> bool:
        return bool(self.link_compare or self.link_first)


@dataclass
class Fragment:
    name: str
    category: str
    texts: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------- config


def load_config(root: Path, fragments_dir: str, primary_lang: str | None) -> Config:
    fragments = root / fragments_dir
    cfg_path = fragments / "changelog.toml"
    if cfg_path.exists():
        try:
            import tomllib
        except ModuleNotFoundError as exc:  # Python < 3.11
            raise ChangelogError(f"{cfg_path} needs Python 3.11+ (tomllib)") from exc
        data = tomllib.loads(cfg_path.read_text(encoding="utf-8"))
        languages = [str(x) for x in data.get("languages", [])]
        if not languages:
            raise ChangelogError(f"{cfg_path}: 'languages' must list at least one language")
        files_raw = data.get("files", {})
        files = {}
        for i, lang in enumerate(languages):
            default = "CHANGELOG.md" if i == 0 else f"CHANGELOG.{lang}.md"
            files[lang] = root / files_raw.get(lang, default)
        wrap = int(data.get("wrap", 80))
        links = data.get("links", {})
        compare, first = str(links.get("compare", "")), str(links.get("first", ""))
        if compare and "{version}" not in compare:
            raise ChangelogError(f"{cfg_path}: links.compare must contain {{version}}")
        if first and "{version}" not in first:
            raise ChangelogError(f"{cfg_path}: links.first must contain {{version}}")
        return Config(root, fragments, languages, files, wrap, compare, first)

    primary = primary_lang or "en"
    languages = [primary]
    files = {primary: root / "CHANGELOG.md"}
    for path in sorted(root.glob("CHANGELOG.*.md")):
        m = LANG_FILE_RE.match(path.name)
        if m and m.group(1) not in files:
            languages.append(m.group(1))
            files[m.group(1)] = path
    return Config(root, fragments, languages, files)


# ------------------------------------------------------------- fragments


def canonical_category(raw: str) -> str | None:
    value = raw.strip().lower()
    for cat in CATEGORIES:
        if value == cat.lower():
            return cat
        for names in CATEGORY_NAMES.values():
            if value == names[cat].lower():
                return cat
    return None


def parse_fragment(name: str, content: str, languages: list[str]) -> Fragment:
    category = None
    lang = languages[0] if len(languages) == 1 else None
    parts: dict[str, list[str]] = {}
    for raw in content.replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        if line.startswith("#### "):
            lang = line[5:].strip().lower()
            if lang not in languages:
                raise ChangelogError(
                    f"{name}: language '{lang}' is not configured (expected: {', '.join(languages)})"
                )
            continue
        if line.startswith("### "):
            if category is not None:
                raise ChangelogError(f"{name}: more than one category; one file holds one entry")
            category = canonical_category(line[4:])
            if category is None:
                raise ChangelogError(
                    f"{name}: unknown category '{line[4:].strip()}'. Use one of: {', '.join(CATEGORIES)}"
                )
            continue
        if not line:
            continue
        if line.startswith("#"):
            raise ChangelogError(f"{name}: unexpected heading '{line}'")
        if lang is None:
            raise ChangelogError(f"{name}: text before any '#### <lang>' heading: '{line}'")
        parts.setdefault(lang, []).append(line)

    if category is None:
        raise ChangelogError(f"{name}: no category. Start the file with a line like '### Fixed'")
    texts = {k: " ".join(v) for k, v in parts.items()}
    missing = [lg for lg in languages if not texts.get(lg)]
    if missing:
        raise ChangelogError(f"{name}: missing text for: {', '.join(missing)}")
    for lg, text in texts.items():
        if EM_DASH in text:
            raise ChangelogError(f"{name} ({lg}): em dash found; use a hyphen, a colon or rephrase")
    return Fragment(name, category, texts)


def fragment_paths(cfg: Config) -> list[Path]:
    if not cfg.fragments.is_dir():
        return []
    return sorted(
        p
        for p in cfg.fragments.iterdir()
        if p.is_file() and p.suffix == ".md" and not p.name.upper().startswith("README")
    )


def read_fragments(cfg: Config) -> tuple[list[Fragment], list[str]]:
    """Return parsed fragments and a list of errors (all files are checked)."""
    frs, errors = [], []
    for path in fragment_paths(cfg):
        try:
            frs.append(parse_fragment(path.name, path.read_text(encoding="utf-8"), cfg.languages))
        except ChangelogError as exc:
            errors.append(str(exc))
    return frs, errors


# -------------------------------------------------------------- rendering


def category_name(cat: str, lang: str) -> str:
    return CATEGORY_NAMES.get(lang, {}).get(cat, cat)


def render_item(text: str, wrap: int) -> str:
    if wrap <= 0:
        return f"- {text}\n"
    return (
        textwrap.fill(
            text,
            width=wrap,
            initial_indent="- ",
            subsequent_indent="  ",
            break_long_words=False,
            break_on_hyphens=False,
        )
        + "\n"
    )


def render_section(frs: list[Fragment], lang: str, version: str, date: str | None, wrap: int) -> str:
    out = [f"## [{version}] - {date}\n" if date else f"## [{version}]\n"]
    for cat in CATEGORIES:
        items = [render_item(f.texts[lang], wrap) for f in frs if f.category == cat]
        if items:
            out.append(f"\n### {category_name(cat, lang)}\n")
            out.extend(items)
    return "".join(out)


def insert_section(text: str, section: str) -> str:
    """Put the section above the newest version, below the title block."""
    text = text.replace("\r\n", "\n")
    m = re.search(r"^## ", text, re.MULTILINE)
    if not m:
        return text.rstrip("\n") + "\n\n" + section
    head = text[: m.start()].rstrip("\n")
    rest = text[m.start():].lstrip("\n")
    return head + "\n\n" + section + "\n" + rest


# ------------------------------------------------------------------ links


def version_link(cfg: Config, version: str, previous: str | None) -> str:
    if previous is None or not cfg.link_compare:
        template = cfg.link_first or cfg.link_compare
    else:
        template = cfg.link_compare
    return template.format(version=version, previous=previous or "")


def missing_links(cfg: Config, text: str) -> list[str]:
    """Versions with a heading but no reference link, newest first."""
    have = {m.group(1) for m in (LINK_LINE_RE.match(ln) for ln in text.split("\n")) if m}
    return [v for v in HEADING_ANY_RE.findall(text) if v not in have]


def sync_links(cfg: Config, text: str) -> str:
    """Rebuild the trailing link block: one line per version heading, newest
    first, existing URLs kept, missing ones generated from the templates."""
    text = text.replace("\r\n", "\n")
    versions = HEADING_ANY_RE.findall(text)
    if not versions:
        return text
    existing: dict[str, str] = {}
    body: list[str] = []
    for ln in text.split("\n"):
        m = LINK_LINE_RE.match(ln)
        if m:
            existing[m.group(1)] = m.group(2)
        else:
            body.append(ln)
    block = []
    for i, v in enumerate(versions):
        previous = versions[i + 1] if i + 1 < len(versions) else None
        block.append(f"[{v}]: {existing.get(v) or version_link(cfg, v, previous)}")
    return "\n".join(body).rstrip("\n") + "\n\n" + "\n".join(block) + "\n"


# --------------------------------------------------------------- versions


def latest_version(cfg: Config) -> tuple[int, int, int] | None:
    path = cfg.files[cfg.languages[0]]
    if not path.exists():
        return None
    m = HEADING_VERSION_RE.search(path.read_text(encoding="utf-8"))
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def suggest_version(cfg: Config, frs: list[Fragment]) -> tuple[str, str]:
    cats = {f.category for f in frs}
    cur = latest_version(cfg)
    if cur is None:
        return "0.1.0", "no released version found; starting at 0.1.0"
    major, minor, patch = cur
    if "Removed" in cats:
        if major == 0:
            return f"0.{minor + 1}.0", "Removed before 1.0.0: MINOR (check whether anything else is breaking)"
        return f"{major + 1}.0.0", "Removed: MAJOR (check whether anything else is breaking)"
    if cats & {"Added", "Changed", "Deprecated"}:
        return f"{major}.{minor + 1}.0", "new or changed behaviour: MINOR (Changed may be breaking: then MAJOR)"
    return f"{major}.{minor}.{patch + 1}", "fixes only: PATCH"


# --------------------------------------------------------------- commands


def cmd_new(cfg: Config, args: argparse.Namespace) -> int:
    slug = args.slug.removesuffix(".md")
    if not SLUG_RE.match(slug):
        raise ChangelogError("slug: lowercase latin letters, digits, '.', '_' and '-' only")
    category = canonical_category(args.category)
    if category is None:
        raise ChangelogError(f"unknown category '{args.category}'. Use one of: {', '.join(CATEGORIES)}")
    cfg.fragments.mkdir(parents=True, exist_ok=True)
    path = cfg.fragments / f"{slug}.md"
    if path.exists():
        raise ChangelogError(f"{path} already exists")
    body = [f"### {category}\n"]
    for lang in cfg.languages:
        body.append(f"\n#### {lang}\nTODO\n")
    path.write_text("".join(body), encoding="utf-8", newline="\n")
    print(path.relative_to(cfg.root).as_posix())
    return 0


def cmd_check(cfg: Config, _args: argparse.Namespace) -> int:
    frs, errors = read_fragments(cfg)
    todo = [f.name for f in frs if any(t.strip() == "TODO" for t in f.texts.values())]
    errors += [f"{n}: still contains the TODO placeholder" for n in todo]
    for lang, path in cfg.files.items():
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        if UNRELEASED_RE.search(text):
            errors.append(f"{path.name}: has an Unreleased section; this script does not merge it")
        if cfg.keeps_links:
            for v in missing_links(cfg, text):
                errors.append(f"{path.name}: no link for version {v}; run 'links'")
    for e in errors:
        print(e, file=sys.stderr)
    print(f"{len(frs)} fragment(s) ok, {len(errors)} problem(s); languages: {', '.join(cfg.languages)}")
    return 1 if errors else 0


def cmd_preview(cfg: Config, _args: argparse.Namespace) -> int:
    frs, errors = read_fragments(cfg)
    if errors:
        raise ChangelogError("\n".join(errors))
    if not frs:
        print(f"nothing waiting in {cfg.fragments.relative_to(cfg.root).as_posix()}")
        return 0
    for i, lang in enumerate(cfg.languages):
        if i:
            print()
        print(f"<!-- {cfg.files[lang].name} -->")
        print(render_section(frs, lang, "Unreleased", None, cfg.wrap), end="")
    print(f"\n{len(frs)} entr{'y' if len(frs) == 1 else 'ies'} waiting", file=sys.stderr)
    return 0


def cmd_next(cfg: Config, _args: argparse.Namespace) -> int:
    frs, errors = read_fragments(cfg)
    if errors:
        raise ChangelogError("\n".join(errors))
    if not frs:
        raise ChangelogError("nothing waiting; no version to suggest")
    version, why = suggest_version(cfg, frs)
    print(version)
    print(why, file=sys.stderr)
    return 0


def cmd_release(cfg: Config, args: argparse.Namespace) -> int:
    version = args.version
    if not VERSION_RE.match(version):
        raise ChangelogError(f"version '{version}' is not X.Y.Z")
    date = args.date or _dt.date.today().isoformat()
    try:
        _dt.date.fromisoformat(date)
    except ValueError as exc:
        raise ChangelogError(f"date '{date}' is not YYYY-MM-DD") from exc

    frs, errors = read_fragments(cfg)
    if errors:
        raise ChangelogError("\n".join(errors))
    if not frs:
        raise ChangelogError("nothing waiting; refusing to write an empty release")
    if any(any(t.strip() == "TODO" for t in f.texts.values()) for f in frs):
        raise ChangelogError("a fragment still contains the TODO placeholder; run 'check'")

    cur = latest_version(cfg)
    new = tuple(int(x) for x in version.split("-")[0].split("."))
    if cur is not None and new <= cur:
        raise ChangelogError(f"version {version} is not above the latest released {'.'.join(map(str, cur))}")

    outputs = {}
    for lang in cfg.languages:
        path = cfg.files[lang]
        text = path.read_text(encoding="utf-8") if path.exists() else FILE_HEADERS.get(lang, FILE_HEADERS["en"])
        if UNRELEASED_RE.search(text):
            raise ChangelogError(f"{path.name}: has an Unreleased section; move it by hand first")
        if re.search(rf"^## \[{re.escape(version)}\]", text, re.MULTILINE):
            raise ChangelogError(f"{path.name}: version {version} is already there")
        out = insert_section(text, render_section(frs, lang, version, date, cfg.wrap))
        if cfg.keeps_links:
            out = sync_links(cfg, out)
        outputs[path] = out

    if args.dry_run:
        for path, text in outputs.items():
            print(f"<!-- {path.name} -->\n{text}")
        return 0

    for path, text in outputs.items():
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {path.relative_to(cfg.root).as_posix()}")
    # Delete only after every file is written, so a failure leaves the entries in place.
    for f in frs:
        (cfg.fragments / f.name).unlink()
    print(f"released {len(frs)} entr{'y' if len(frs) == 1 else 'ies'} as {version}")
    return 0


def cmd_links(cfg: Config, args: argparse.Namespace) -> int:
    if not cfg.keeps_links:
        raise ChangelogError("no [links] in the config; nothing to maintain")
    changed = 0
    for lang in cfg.languages:
        path = cfg.files[lang]
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        missing = missing_links(cfg, text)
        if not missing:
            continue
        changed += len(missing)
        out = sync_links(cfg, text)
        if args.dry_run:
            print(f"<!-- {path.name} -->\n{out}")
        else:
            path.write_text(out, encoding="utf-8", newline="\n")
            print(f"{path.relative_to(cfg.root).as_posix()}: added {', '.join(missing)}")
    if not changed:
        print("every version has its link")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", default=".", help="repository root (default: current directory)")
    parser.add_argument("--dir", default="changelog.d", help="fragments directory relative to root")
    parser.add_argument("--lang", help="primary language of CHANGELOG.md when there is no config (default: en)")
    sub = parser.add_subparsers(dest="command")

    p_new = sub.add_parser("new", help="create a fragment skeleton")
    p_new.add_argument("slug", help="file name without .md, e.g. fix-order-form-errors")
    p_new.add_argument("--category", "-c", required=True, help=", ".join(CATEGORIES))
    sub.add_parser("check", help="validate fragments")
    sub.add_parser("preview", help="print the pending section")
    sub.add_parser("next", help="suggest the next version")
    p_rel = sub.add_parser("release", help="write a release section and delete fragments")
    p_rel.add_argument("version", help="X.Y.Z")
    p_rel.add_argument("--date", help="YYYY-MM-DD, default today")
    p_rel.add_argument("--dry-run", action="store_true", help="print the resulting files, change nothing")
    p_links = sub.add_parser("links", help="add the missing version links")
    p_links.add_argument("--dry-run", action="store_true", help="print the resulting files, change nothing")

    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        cfg = load_config(Path(args.root).resolve(), args.dir, args.lang)
        handler = {
            "new": cmd_new,
            "check": cmd_check,
            "next": cmd_next,
            "release": cmd_release,
            "links": cmd_links,
        }.get(args.command, cmd_preview)
        return handler(cfg, args)
    except ChangelogError as exc:
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
