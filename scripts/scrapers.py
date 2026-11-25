"""Readers for official institutions that publish news on web pages but have no RSS feed.

Each function takes the page HTML and returns entries in the same shape parse_feed() produces:
{"title", "link", "date", "summary", "author"}. They link to the institution's own document
(usually the press-release PDF), so every item points at the primary source.

If a site redesign breaks a parser it just returns [], and the Sources tab shows "0 recent".
"""
import re
from urllib.parse import urljoin


def _text(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def _entry(title, link, date, summary="", author=""):
    return {"title": title, "link": link, "date": date, "summary": summary, "author": author}


def icj(page, base="https://www.icj-cij.org"):
    out = []
    for row in re.split(r'<div class="views-row">', page)[1:]:
        title = re.search(r'views-field-field-document-long-title.*?<p>(.*?)</p>', row, re.S)
        date = re.search(r'<time datetime="([^"]+)"', row)
        num = re.search(r'field-press-release-number.*?<a href="([^"]+)"[^>]*>(.*?)</a>', row, re.S)
        if not (title and date and num):
            continue
        out.append(_entry(_text(title.group(1)), urljoin(base, num.group(1)), date.group(1),
                          f"ICJ {_text(num.group(2))}"))
    return out


def itlos(page, base="https://www.itlos.org"):
    out = []
    for block in re.split(r'<div class="fs-case-list-item fs-case-list-item', page)[1:]:
        head = re.search(r'<h3>\s*<a href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        body = re.search(r'fs-case-list-item-text">\s*<a[^>]*>(.*?)</a>', block, re.S)
        if not (head and body):
            continue
        label = _text(head.group(2))                       # "ITLOS/Press 405 - 18 November 2026"
        date = re.search(r"(\d{1,2} \w+ \d{4})", label)
        out.append(_entry(_text(body.group(1)), urljoin(base, head.group(1)),
                          date.group(1) if date else "", label))
    return out


def irmct(page, base="https://www.irmct.org"):
    out = []
    for row in re.split(r'<div class="views-row">', page)[1:]:
        a = re.search(r'news-list-article-title"><a href="([^"]+)"[^>]*>(.*?)</a>', row, re.S)
        loc = re.search(r'news-list-article-location-date[^>]*>(.*?)</p>', row, re.S)
        summ = re.search(r'news-list-article-summary[^>]*>(.*?)</div>', row, re.S)
        if not a:
            continue
        date = re.search(r"(\d{1,2} \w+ \d{4})", _text(loc.group(1)) if loc else "")
        out.append(_entry(_text(a.group(2)), urljoin(base, a.group(1)),
                          date.group(1) if date else "", _text(summ.group(1)) if summ else ""))
    return out


def icsid(page, base="https://icsid.worldbank.org"):
    out = []
    for m in re.finditer(r'<time datetime="([^"]+)"[^>]*>.*?field--name-node-title[^>]*>\s*<a href="([^"]+)"[^>]*>(.*?)</a>',
                         page, re.S):
        out.append(_entry(_text(m.group(3)), urljoin(base, m.group(2)), m.group(1)))
    return out


SCRAPERS = {"icj": icj, "itlos": itlos, "irmct": irmct, "icsid": icsid}


def bluesky(page, base="https://bsky.app"):
    """A scholar's own recent posts via Bluesky's public API (no replies, no reposts).

    The post text becomes the title; a shared article (link card) is kept as ext_title/ext_url.
    """
    import json
    out, seen = [], set()
    for item in json.loads(page).get("feed", []):
        if "reason" in item:            # a repost of someone else
            continue
        post = item["post"]
        text = re.sub(r"\s+", " ", post.get("record", {}).get("text", "")).strip()
        if len(text) < 60 or text[:80] in seen:
            continue
        seen.add(text[:80])
        rkey = post["uri"].rsplit("/", 1)[-1]
        embed = post.get("embed") or {}
        ext = embed.get("external") or (embed.get("media") or {}).get("external") or {}
        out.append({
            "title": text,
            "link": f"{base}/profile/{post['author']['handle']}/post/{rkey}",
            "date": post.get("record", {}).get("createdAt") or post.get("indexedAt", ""),
            "summary": "",
            "author": post["author"].get("displayName", ""),
            "kind": "post",
            "ext_title": ext.get("title", ""),
            "ext_url": ext.get("uri", ""),
        })
    return out


SCRAPERS["bluesky"] = bluesky
