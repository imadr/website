#!/usr/bin/env python3
import os, sys, hashlib, urllib.request, tempfile
import fitz
from PIL import Image

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
INPUT_TXT   = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SCRIPT_DIR, "bookshelf.txt")
OUTPUT_HTML = os.path.join(SCRIPT_DIR, "index.html")
THUMB_DIR   = os.path.join(SCRIPT_DIR, "thumbnails")

VALID_SOURCES = ("web", "local")
VALID_TYPES   = ("paper", "book", "web", "video")


def parse_bookshelf(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        raw = f.read()

    books  = []
    blocks = [b.strip() for b in raw.split("\n\n") if b.strip()]

    for block in blocks:
        lines = [l.strip() for l in block.splitlines() if l.strip()]
        if not lines:
            continue

        title  = lines[0]
        kind   = None
        read   = False
        local  = False
        ref    = None
        tags   = []

        for line in lines[1:]:
            ll = line.lower()
            if ll in VALID_TYPES:
                kind = ll
            elif ll == "read":
                read = True
            elif ll == "local":
                local = True
            elif ll.startswith("http") or (local and line.endswith(".pdf")):
                ref = line
            elif "," in line or (line and line not in VALID_TYPES and ll != "read" and ll != "local" and not line.startswith("http")):
                tags = [t.strip() for t in line.split(",") if t.strip()]

        if not kind:
            print(f"  skip (no type): {title}")
            continue
        if not ref:
            print(f"  skip (no url/path): {title}")
            continue

        source = "local" if local else "web"
        books.append({"title": title, "source": source, "ref": ref,
                      "kind": kind, "tags": tags, "read": read})

    return books


def cache_key(ref: str) -> str:
    return hashlib.md5(ref.encode()).hexdigest()

def cached_thumb_path(ref: str) -> str:
    return os.path.join(THUMB_DIR, cache_key(ref) + ".png")

def thumb_exists(ref: str) -> bool:
    return os.path.isfile(cached_thumb_path(ref))


def pngquant_optimize(path: str) -> None:
    img = Image.open(path).convert("RGBA")
    img = img.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    img.save(path, optimize=True)


def screenshot_webpage(url: str, out_png: str) -> None:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page    = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto(url, wait_until="domcontentloaded", timeout=0)
        page.wait_for_load_state("load", timeout=0)
        page.screenshot(path=out_png, clip={"x": 0, "y": 0, "width": 1280, "height": 900})
        browser.close()


def youtube_video_id(url: str) -> str | None:
    for part in url.split("?", 1)[-1].split("&"):
        if part.startswith("v="):
            return part[2:]
    if "youtu.be/" in url:
        return url.split("youtu.be/")[-1].split("?")[0]
    return None

def fetch_youtube_thumb(url: str, out_png: str) -> None:
    vid = youtube_video_id(url)
    if not vid:
        raise ValueError(f"cannot extract video id from {url}")
    for quality in ("maxresdefault", "hqdefault", "mqdefault"):
        thumb_url = f"https://i.ytimg.com/vi/{vid}/{quality}.jpg"
        try:
            req = urllib.request.Request(thumb_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as r:
                data = r.read()
            if len(data) > 1000:
                with open(out_png, "wb") as f:
                    f.write(data)
                return
        except Exception:
            continue
    raise RuntimeError(f"could not fetch thumbnail for {url}")

def download_pdf(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as f:
        f.write(r.read())

def pdf_first_page_to_png(pdf_path: str, out_png: str, zoom: int = 2) -> None:
    doc  = fitz.open(pdf_path)
    page = doc[0]
    pix  = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    pix.save(out_png)
    doc.close()


def build_html(entries: list[dict], all_tags: list[str], all_kinds: list[str]) -> str:
    cards = ""
    for idx, e in enumerate(entries):
        read_class = " read" if e["read"] else ""
        read_badge = ('<span class="badge read-badge">read</span>'
                      if e["read"] else
                      '<span class="badge read-badge unread">unread</span>')
        kind_badge = f'<span class="badge kind-badge">{e["kind"]}</span>'
        tags_json  = str(e["tags"]).replace("'", '"')
        tags_chips = "".join(f'<span class="chip">{t}</span>' for t in e["tags"])
        cards += f"""
    <a class="book{read_class}" data-idx="{idx}" data-tags='{tags_json}' data-kind="{e['kind']}" data-title="{e['title']}" data-tagstr="{','.join(e['tags'])}" href="{e['href']}" target="_blank" rel="noopener">
      <div class="thumb">
        <img src="{e['thumb_src']}" alt="{e['title']}">
        {kind_badge}
        {read_badge}
      </div>
      <p class="book-title">{e['title']}</p>
      <div class="chips">{tags_chips}</div>
    </a>"""

    tag_buttons  = ""
    for t in all_tags:
        tag_buttons += f'<button class="tag-btn" data-tag="{t}">{t}</button>'

    kind_buttons = '<button class="kind-btn active" data-kind="all">all</button>'
    for k in sorted(all_kinds):
        kind_buttons += f'<button class="kind-btn" data-kind="{k}">{k}</button>'

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>bookshelf</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap">
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: 'Inter', sans-serif;
    background: #fff;
    color: #000;
    padding: 1.5rem 2rem;
  }}
  .zoom-corner {{
    position: fixed;
    top: 1rem;
    right: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.72rem;
    color: #999;
    z-index: 100;
  }}
  .zoom-corner input[type=range] {{
    width: 90px;
    accent-color: #000;
    cursor: pointer;
  }}
  #zoom-label {{ min-width: 3ch; }}
  #view-toggle {{
    font-family: inherit;
    font-size: 0.85rem;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 2px;
    cursor: pointer;
    padding: 1px 6px;
    color: #555;
    line-height: 1.4;
  }}
  #view-toggle:hover {{ border-color: #000; color: #000; }}

  .filter-bar {{
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }}
  #kind-bar {{ margin-bottom: 0.6rem; }}
  #read-bar {{ margin-bottom: 0.6rem; }}
  #tag-bar  {{ margin-bottom: 1.5rem; }}
  .bar-label {{
    font-size: 0.7rem;
    color: #999;
    width: 2.5rem;
    flex-shrink: 0;
  }}
  .tag-btn, .kind-btn, .read-btn, .sort-btn {{
    font-family: inherit;
    font-size: 0.7rem;
    padding: 3px 10px;
    border: 1px solid #ccc;
    background: #fff;
    cursor: pointer;
    border-radius: 2px;
    color: #555;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
    user-select: none;
  }}
  .tag-btn.active, .kind-btn.active, .read-btn.active, .sort-btn.active {{
    background: #000;
    color: #fff;
    border-color: #000;
  }}
  #clear-tags {{
    font-family: inherit;
    font-size: 0.7rem;
    color: #bbb;
    background: none;
    border: none;
    cursor: pointer;
    padding: 3px 4px;
    text-decoration: underline;
  }}

  .shelf {{
    display: grid;
    grid-template-columns: repeat(auto-fill, var(--col-w, 160px));
    gap: 1.5rem;
  }}
  .shelf.list {{
    display: flex;
    flex-direction: column;
    gap: 0;
  }}
  .book {{
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: inherit;
  }}
  .book[hidden] {{ display: none; }}

  .shelf.list .book {{
    flex-direction: row;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid #f0f0f0;
    cursor: pointer;
  }}
  .shelf.list .book:hover .book-title {{ text-decoration: underline; }}
  .shelf.list .thumb {{
    width: 36px;
    aspect-ratio: 3 / 4;
    flex-shrink: 0;
  }}
  .shelf.list .badge {{ display: none; }}
  .shelf.list .book-title {{
    margin-top: 0;
    font-size: 0.8rem;
    flex: 1;
  }}
  .shelf.list .chips {{ margin-top: 0; }}
  #sort-bar {{ margin-bottom: 1.5rem; }}

  .thumb {{
    display: block;
    width: 100%;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border: 1px solid #ddd;
    background: #fafafa;
    position: relative;
  }}
  .thumb img {{
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
    display: block;
    transition: opacity 0.15s;
  }}
  .thumb:hover img {{ opacity: 0.85; }}

  .badge {{
    position: absolute;
    font-size: 0.6rem;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 2px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    pointer-events: none;
  }}
  .kind-badge {{
    top: 6px;
    left: 6px;
    background: #000;
    color: #fff;
  }}
  .read-badge {{
    bottom: 6px;
    right: 6px;
    background: #000;
    color: #fff;
  }}
  .read-badge.unread {{
    background: #fff;
    color: #aaa;
    border: 1px solid #ddd;
  }}

  .book-title {{
    margin-top: 0.4rem;
    font-size: 0.68rem;
    line-height: 1.4;
    color: #000;
  }}
  .chips {{
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 0.3rem;
  }}
  .chip {{
    font-size: 0.6rem;
    color: #888;
    border: 1px solid #e0e0e0;
    padding: 1px 5px;
    border-radius: 2px;
  }}
</style>
</head>
<body>
<div class="zoom-corner">
  <button id="view-toggle" title="toggle view">☰</button>
  <input type="range" id="zoom" min="100" max="320" value="160" step="10">
  <span id="zoom-label">160</span>
</div>

<div class="filter-bar" id="read-bar">
  <span class="bar-label">read</span>
  <button class="read-btn active" data-read="all">all</button>
  <button class="read-btn" data-read="read">read</button>
  <button class="read-btn" data-read="unread">unread</button>
</div>
<div class="filter-bar" id="kind-bar">
  <span class="bar-label">type</span>
  {kind_buttons}
</div>
<div class="filter-bar" id="tag-bar">
  <span class="bar-label">tags</span>
  {tag_buttons}
  <button id="clear-tags">clear</button>
</div>

<div class="filter-bar" id="sort-bar">
  <span class="bar-label">sort</span>
  <button class="sort-btn active" data-sort="default">default</button>
  <button class="sort-btn" data-sort="name">name</button>
  <button class="sort-btn" data-sort="tags">tags</button>
</div>

<div class="shelf" id="shelf">{cards}
</div>

<script>
  const shelf      = document.getElementById('shelf');
  const slider     = document.getElementById('zoom');
  const zoomLbl    = document.getElementById('zoom-label');
  const tagBar     = document.getElementById('tag-bar');
  const clearBtn   = document.getElementById('clear-tags');
  const readBar    = document.getElementById('read-bar');
  const kindBtns   = document.querySelectorAll('.kind-btn');
  const sortBtns   = document.querySelectorAll('.sort-btn');
  const viewToggle = document.getElementById('view-toggle');

  let activeTags = new Set();
  let activeKind = 'all';
  let activeRead = 'all';
  let activeSort = 'default';
  let isList     = false;

  viewToggle.addEventListener('click', () => {{
    isList = !isList;
    shelf.classList.toggle('list', isList);
    viewToggle.textContent = isList ? '⊞' : '☰';
  }});

  function applyFilters() {{
    document.querySelectorAll('.book').forEach(b => {{
      const tags   = JSON.parse(b.dataset.tags || '[]');
      const kind   = b.dataset.kind;
      const isRead = b.classList.contains('read');
      const tagOk  = activeTags.size === 0 || [...activeTags].every(t => tags.includes(t));
      const kindOk = activeKind === 'all' || kind === activeKind;
      const readOk = activeRead === 'all'
                   || (activeRead === 'read'   &&  isRead)
                   || (activeRead === 'unread' && !isRead);
      b.hidden = !(tagOk && kindOk && readOk);
    }});
    tagBar.querySelectorAll('.tag-btn').forEach(btn =>
      btn.classList.toggle('active', activeTags.has(btn.dataset.tag))
    );
  }}

  function applySort() {{
    const books = [...shelf.querySelectorAll('.book')];
    if (activeSort === 'default') {{
      books.sort((a, b) => +a.dataset.idx - +b.dataset.idx);
    }} else if (activeSort === 'name') {{
      books.sort((a, b) => a.dataset.title.localeCompare(b.dataset.title));
    }} else if (activeSort === 'tags') {{
      books.sort((a, b) => a.dataset.tagstr.localeCompare(b.dataset.tagstr));
    }}
    books.forEach(b => shelf.appendChild(b));
  }}

  slider.addEventListener('input', () => {{
    zoomLbl.textContent = slider.value;
    shelf.style.setProperty('--col-w', slider.value + 'px');
  }});

  readBar.addEventListener('click', e => {{
    const btn = e.target.closest('.read-btn');
    if (!btn) return;
    document.querySelectorAll('.read-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeRead = btn.dataset.read;
    applyFilters();
  }});

  tagBar.addEventListener('click', e => {{
    const btn = e.target.closest('.tag-btn');
    if (!btn) return;
    if (activeTags.has(btn.dataset.tag)) activeTags.delete(btn.dataset.tag);
    else activeTags.add(btn.dataset.tag);
    applyFilters();
  }});

  clearBtn.addEventListener('click', () => {{
    activeTags.clear();
    applyFilters();
  }});

  kindBtns.forEach(btn => btn.addEventListener('click', () => {{
    kindBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeKind = btn.dataset.kind;
    applyFilters();
  }}));

  sortBtns.forEach(btn => btn.addEventListener('click', () => {{
    sortBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeSort = btn.dataset.sort;
    applySort();
  }}));
</script>
</body>
</html>"""


def main():
    if not os.path.isfile(INPUT_TXT):
        print(f"ERROR: input file not found: {INPUT_TXT}")
        sys.exit(1)

    os.makedirs(THUMB_DIR, exist_ok=True)

    books = parse_bookshelf(INPUT_TXT)
    print(f"Found {len(books)} entries in {INPUT_TXT}\n")

    entries   = []
    all_tags  = []
    all_kinds = []

    with tempfile.TemporaryDirectory() as tmpdir:
        for i, book in enumerate(books):
            title, source, ref = book["title"], book["source"], book["ref"]
            kind, tags, read   = book["kind"], book["tags"], book["read"]

            thumb     = cached_thumb_path(ref)
            thumb_src = "thumbnails/" + os.path.basename(thumb)
            label     = f"[{i+1}/{len(books)}]"

            if thumb_exists(ref):
                print(f"{label} cached:      {title}")
            else:
                if kind == "video":
                    print(f"{label} youtube thumb: {title}")
                    try:
                        fetch_youtube_thumb(ref, thumb)
                    except Exception as e:
                        print(f"       ERROR: {e} — skipping")
                        continue
                elif kind == "web":
                    print(f"{label} screenshotting webpage: {title}")
                    try:
                        screenshot_webpage(ref, thumb)
                    except Exception as e:
                        print(f"       ERROR: {e} — skipping")
                        continue
                elif source == "web":
                    pdf_path = os.path.join(tmpdir, f"doc_{i}.pdf")
                    print(f"{label} downloading: {title}")
                    try:
                        download_pdf(ref, pdf_path)
                        print(f"       screenshotting…")
                        pdf_first_page_to_png(pdf_path, thumb)
                    except Exception as e:
                        print(f"       ERROR: {e} — skipping")
                        continue
                else:
                    pdf_path = os.path.join(SCRIPT_DIR, ref)
                    if not os.path.isfile(pdf_path):
                        print(f"{label} ERROR: local file not found: {pdf_path} — skipping")
                        continue
                    print(f"{label} local:       {title}")
                    try:
                        print(f"       screenshotting…")
                        pdf_first_page_to_png(pdf_path, thumb)
                    except Exception as e:
                        print(f"       ERROR: {e} — skipping")
                        continue
                print(f"       optimizing…")
                pngquant_optimize(thumb)

            href = ref
            entries.append({
                "title":     title,
                "kind":      kind,
                "tags":      tags,
                "read":      read,
                "thumb_src": thumb_src,
                "href":      href,
            })

            if kind not in all_kinds:
                all_kinds.append(kind)
            for t in tags:
                if t not in all_tags:
                    all_tags.append(t)

    all_tags.sort()
    html = build_html(entries, all_tags, all_kinds)
    with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"\n✓ saved → {OUTPUT_HTML}  ({len(entries)}/{len(books)} books)")


if __name__ == "__main__":
    main()