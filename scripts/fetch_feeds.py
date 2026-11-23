#!/usr/bin/env python3
"""Fetch every source in feeds.json, tag items by field of law, write app/data/news.json.

Standard library only, so it runs anywhere (locally or in GitHub Actions) with no installs.
Usage: python3 scripts/fetch_feeds.py [--out app/data/news.json]
"""
import argparse
import gzip
import hashlib
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

from scrapers import SCRAPERS

ROOT = Path(__file__).resolve().parent.parent
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
DEFAULT_MAX_AGE = 30
DEFAULT_MAX_ITEMS = 30

# Keyword rules: an item gets a topic if its title/summary matches any pattern.
TOPIC_RULES = {
    "ICL": [
        r"international criminal", r"\bICC\b", r"war crimes?", r"crimes? against humanity",
        r"genocide", r"rome statute", r"\bICTY\b", r"\bICTR\b", r"\bIRMCT\b", r"crime of aggression",
        r"arrest warrant", r"universal jurisdiction", r"special tribunal", r"kosovo specialist",
        r"extraordinary chambers", r"prosecutor (?:karim|of the icc)", r"\bimpunity\b", r"accountability mechanism",
    ],
    "IHL": [
        r"humanitarian law", r"\bIHL\b", r"laws? of war", r"law of armed conflict", r"\bLOAC\b",
        r"geneva conventions?", r"additional protocol", r"\bICRC\b", r"red cross", r"jus in bello",
        r"belligerent occupation", r"\boccupying power", r"targeting", r"humanitarian access",
        r"autonomous weapons", r"prisoners? of war", r"\bcivilian (?:casualties|objects|population)",
        r"\bhostages?\b", r"cluster munitions?", r"landmines?",
    ],
    "IHRL": [
        r"human rights", r"\bECtHR\b", r"european court of human rights", r"inter-american",
        r"\bIACtHR\b", r"african commission", r"african court", r"\bOHCHR\b", r"\btorture\b",
        r"\brefugees?\b", r"\basylum\b", r"non-refoulement", r"\bICCPR\b", r"special rapporteur",
        r"freedom of (?:expression|speech|assembly|religion)", r"\bECHR\b", r"death penalty",
        r"enforced disappearance", r"discrimination", r"\bmigrants?\b", r"rule of law",
    ],
    "IDS": [
        r"arbitration", r"arbitral", r"\bICSID\b", r"investment treat", r"\bISDS\b", r"\bWTO\b",
        r"appellate body", r"permanent court of arbitration", r"\bPCA\b", r"dispute settlement",
        r"international court of justice", r"\bICJ\b", r"advisory opinion", r"provisional measures",
        r"\btribunal\b", r"\bITLOS\b", r"\bBIT\b", r"energy charter", r"\bpanel (?:report|ruling)", r"\bWTO (?:dispute|ruling|panel)",
    ],
    "LOS": [
        r"law of the sea", r"\bUNCLOS\b", r"\bITLOS\b", r"maritime", r"continental shelf",
        r"exclusive economic zone", r"\bEEZ\b", r"south china sea", r"high seas", r"\bBBNJ\b",
        r"seabed", r"deep[- ]sea mining", r"freedom of navigation", r"\bpiracy\b", r"red sea",
        r"strait of (?:hormuz|taiwan|malacca)", r"\bfisheries\b", r"shipping lanes?",
        r"international seabed authority", r"arctic (?:shipping|sea|ocean|sovereignty|council|route)", r"shadow fleet",
    ],
    "PIL": [
        r"international law", r"un charter", r"use of force", r"self-defen[cs]e", r"\bsovereignty\b",
        r"international court of justice", r"\bICJ\b", r"\btreat(?:y|ies)\b", r"\bILC\b",
        r"international law commission", r"security council", r"general assembly", r"\bsanctions\b",
        r"state responsibility", r"\bimmunit(?:y|ies)\b", r"self-determination", r"jus ad bellum",
        r"annex(?:ation|ed)", r"\brecognition of\b", r"customary (?:international )?law", r"\bveto\b",
        r"countermeasures", r"\bextradition\b", r"territorial integrity",
    ],
}
COMPILED = {t: re.compile("|".join(p), re.I) for t, p in TOPIC_RULES.items()}
LAW_TOPICS = {"PIL", "ICL", "IHRL", "IDS", "IHL", "LOS"}

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "rss1": "http://purl.org/rss/1.0/",
}


def clean(text, limit=None):
    if not text:
        return ""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    # Drop WordPress boilerplate like "The post X appeared first on Y."
    text = re.sub(r"The post .{0,300}? appeared first on .{0,120}?\.?$", "", text).strip()
    text = re.sub(r"\[(?:…|\.\.\.)\]\s*$", "…", text)
    if limit and len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0] + "…"
    return text


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        d = None
    if d is None:
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            d = None
    for fmt in ("%A, %B %d, %Y - %H:%M", "%B %d, %Y", "%d %B %Y", "%Y-%m-%d %H:%M:%S"):
        if d is not None:
            break
        try:
            d = datetime.strptime(s, fmt)
        except ValueError:
            pass
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def txt(el, path):
    found = el.find(path, NS)
    return (found.text or "") if found is not None else ""


def richer(teaser, full):
    """Use the article body when the feed's teaser is only a line or two."""
    return full if full and len(clean(teaser)) < 250 else (teaser or full)


def parse_feed(raw):
    """Return list of dicts (title, link, date, summary) for RSS 2.0, RSS 1.0/RDF or Atom."""
    root = ET.fromstring(raw)
    entries = []
    if root.tag.endswith("feed"):  # Atom
        for e in root.findall("atom:entry", NS):
            link = ""
            for l in e.findall("atom:link", NS):
                if l.get("rel", "alternate") == "alternate":
                    link = l.get("href", "")
                    break
            entries.append({
                "title": txt(e, "atom:title"),
                "link": link,
                "date": txt(e, "atom:published") or txt(e, "atom:updated"),
                "summary": richer(txt(e, "atom:summary"), txt(e, "atom:content")),
                "author": txt(e, "atom:author/atom:name"),
            })
    else:  # RSS 2.0 (<channel><item>) or RSS 1.0 (<rdf:RDF><item>)
        items = root.findall("./channel/item") or root.findall("rss1:item", NS)
        for e in items:
            g = lambda tag: txt(e, tag) or txt(e, "rss1:" + tag)
            entries.append({
                "title": g("title"),
                "link": g("link") or txt(e, "guid"),
                "date": g("pubDate") or txt(e, "dc:date"),
                "summary": richer(g("description"), txt(e, "content:encoded")),
                "author": txt(e, "dc:creator") or g("author"),
            })
    return entries


XML_ENTITIES = {"amp", "lt", "gt", "quot", "apos"}


def fix_entities(raw):
    """Replace HTML-only named entities (&nbsp; &hellip; …) that break strict XML parsers."""
    def rep(m):
        name = m.group(1).decode()
        if name in XML_ENTITIES:
            return m.group(0)
        ch = html.unescape(f"&{name};")
        return m.group(0) if ch.startswith("&") else html.escape(ch).encode()
    return re.sub(rb"&([A-Za-z][A-Za-z0-9]{1,31});", rep, raw)


def fetch(src):
    req = urllib.request.Request(src["url"], headers={
        "User-Agent": UA,
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=25) as r:
        raw = r.read()
    if raw[:2] == b"\x1f\x8b":  # some servers gzip even when not asked
        raw = gzip.decompress(raw)
    if src.get("scraper"):  # institution web page without RSS
        return SCRAPERS[src["scraper"]](raw.decode("utf-8", "replace"))
    raw = fix_entities(raw)
    # Some feeds have junk before the XML declaration
    start = raw.find(b"<")
    raw = raw[start:] if start > 0 else raw
    try:
        return parse_feed(raw)
    except ET.ParseError:
        return parse_feed_loose(raw.decode("utf-8", "replace"))


def parse_feed_loose(s):
    """Regex fallback for feeds whose XML is malformed (e.g. stray HTML in descriptions)."""
    def field(block, *tags):
        for tag in tags:
            m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", block, re.S)
            if m:
                return re.sub(r"^<!\[CDATA\[(.*)\]\]>$", r"\1", m.group(1).strip(), flags=re.S)
        return ""
    return [{
        "title": field(b, "title"), "link": field(b, "link", "guid"),
        "date": field(b, "pubDate", "dc:date"), "summary": field(b, "description"),
        "author": field(b, "dc:creator"),
    } for b in re.findall(r"<item[ >].*?</item>", s, re.S)]


def keyword_topics(title, summary):
    hay = f"{title} {summary}"
    return {t for t, rx in COMPILED.items() if rx.search(hay)}


def process(src, now):
    max_age = timedelta(days=src.get("maxAgeDays", DEFAULT_MAX_AGE))
    max_items = src.get("maxItems", DEFAULT_MAX_ITEMS)
    try:
        entries = fetch(src)
    except Exception as e:  # noqa: BLE001 — one bad feed must never break the run
        return src, [], f"{type(e).__name__}: {e}"[:200]
    items = []
    for en in entries:
        title = clean(en["title"])
        link = en["link"].strip()
        if not title or not link.startswith("http"):
            continue
        d = parse_date(en["date"]) or now
        if now - d > max_age or d > now + timedelta(days=1):
            continue
        summary = clean(en["summary"], 700)
        if summary.lower().startswith(title.lower()[:60]) and len(summary) <= len(title) + 5:
            summary = ""
        kw = keyword_topics(title, summary)
        topics = kw | set(src.get("topics", []))
        # Law angle = the headline/summary itself raises a legal issue (not just the outlet's default)
        law_hit = bool(kw & LAW_TOPICS)
        items.append({
            "id": hashlib.sha1(link.encode()).hexdigest()[:12],
            "title": title,
            "link": link,
            "source": src["id"],
            "author": clean(en.get("author", ""), 80),
            "date": d.isoformat().replace("+00:00", "Z"),
            "summary": summary,
            "topics": sorted(topics) or ["GEO"],
            # Media/think-tank item that touches a legal field: the law–politics bridge
            "lawAngle": law_hit and src["type"] in ("media", "analysis"),
        })
        if len(items) >= max_items:
            break
    return src, items, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "app" / "data" / "news.json"))
    ap.add_argument("--feeds", default=str(ROOT / "scripts" / "feeds.json"))
    args = ap.parse_args()

    sources = json.loads(Path(args.feeds).read_text())["sources"]
    now = datetime.now(timezone.utc)
    with ThreadPoolExecutor(max_workers=12) as ex:
        results = list(ex.map(lambda s: process(s, now), sources))

    seen, items, src_meta = set(), [], []
    for src, its, err in results:
        kept = 0
        for it in its:
            key = it["link"].split("?")[0].rstrip("/")
            if key in seen:
                continue
            seen.add(key)
            items.append(it)
            kept += 1
        src_meta.append({k: src.get(k) for k in ("id", "name", "type", "site", "topics")}
                        | {"ok": err is None, "count": kept, **({"error": err} if err else {})})
        status = "ok " if err is None else "ERR"
        print(f"[{status}] {src['name']:<45} {kept:>3} items {err or ''}", file=sys.stderr)

    items.sort(key=lambda i: i["date"], reverse=True)
    out = {"generated": now.isoformat().replace("+00:00", "Z"), "sources": src_meta, "items": items}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    ok = sum(1 for s in src_meta if s["ok"])
    print(f"\n{len(items)} items from {ok}/{len(src_meta)} sources -> {args.out}", file=sys.stderr)
    if ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
