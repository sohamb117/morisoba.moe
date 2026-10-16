#!/usr/bin/env python3
"""Snapshot public lists; never modify handwritten data/library.json."""
import argparse
from datetime import datetime, timezone
import hashlib
from html import escape
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
PROFILES = {'letterboxd': 'morisoba', 'myanimelist': 'ch0p1n117'}
STATUSES = {1: 'in progress', 2: 'completed', 3: 'on hold', 4: 'dropped', 6: 'planned'}


class ImportFailure(ValueError):
    pass


class Client:
    def __init__(self, browser_pages=None):
        self.browser_pages = browser_pages or {}
        self.evidence = []
        self.last_request = 0

    def get(self, url):
        if urlparse(url).hostname not in {'letterboxd.com', 'myanimelist.net'}:
            raise ImportFailure('Unexpected source host')
        if url in self.browser_pages:
            page = self.browser_pages[url]
            raw = json.dumps(page, ensure_ascii=False).encode()
            self.evidence.append({'url': url, 'method': 'browser-dom',
                                  'sha256': hashlib.sha256(raw).hexdigest(),
                                  'retrievedAt': page['retrievedAt']})
            return browser_page_html(page)
        for attempt in range(3):
            time.sleep(max(0, 1.0 - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            try:
                req = Request(url, headers={'User-Agent': 'morisoba-library-sync/1.0 (public personal library)'})
                with urlopen(req, timeout=30) as res:
                    raw = res.read()
                self.evidence.append({'url': url, 'sha256': hashlib.sha256(raw).hexdigest(),
                                      'retrievedAt': datetime.now(timezone.utc).isoformat()})
                return raw.decode('utf-8')
            except HTTPError as exc:
                if exc.code not in {429, 500, 502, 503, 504} or attempt == 2:
                    raise ImportFailure(f'{url}: HTTP {exc.code}') from exc
                time.sleep(min(30, int(exc.headers.get('Retry-After', '3')) if exc.headers.get('Retry-After', '3').isdigit() else 3))
            except (URLError, TimeoutError) as exc:
                if attempt == 2:
                    raise ImportFailure(f'{url}: {exc}') from exc
                time.sleep(2 ** attempt)
        raise ImportFailure('Request failed')


def browser_page_html(page):
    """Convert an explicitly supplied public DOM extraction to the same strict parser."""
    html = f'<h1 class="section-heading">{int(page["total"])} films</h1><ul>'
    for slug, title, stars in page['rows']:
        if stars and not re.fullmatch(r'★{0,5}½?', stars):
            raise ImportFailure('Invalid browser-extracted rating')
        rating = stars.count('★') * 2 + ('½' in stars)
        html += f'<li class="griditem"><div data-item-slug="{escape(slug)}" data-item-name="{escape(title)}"></div>'
        if stars:
            html += f'<span class="rating rated-{rating}">{stars}</span>'
        html += '</li>'
    html += '</ul>'
    if page.get('next'):
        html += f'<a class="next" href="{escape(page["next"])}">Older</a>'
    return html


def parse_letterboxd(html, url, status):
    soup = BeautifulSoup(html, 'html.parser')
    heading = soup.select_one('h1.section-heading')
    if not heading:
        raise ImportFailure('Letterboxd list heading missing (blocked or changed markup)')
    count_text = heading.get_text(' ', strip=True) + ' ' + ' '.join(
        el.get('title', '') for el in heading.select('[title]'))
    match = re.search(r'([\d,]+)\s+films?\b', count_text)
    if not match:
        raise ImportFailure('Letterboxd total missing')
    expected = int(match[1].replace(',', ''))
    entries = []
    for row in soup.select('li.griditem, li.poster-container'):
        poster = row.select_one('[data-item-slug], [data-film-slug]')
        if poster is None:
            raise ImportFailure('Unrecognized Letterboxd poster')
        slug = poster.get('data-item-slug') or poster.get('data-film-slug')
        if not re.fullmatch(r'[a-z0-9-]+', slug):
            raise ImportFailure('Invalid film slug')
        img = poster.select_one('img[alt]')
        display = poster.get('data-item-name', '')
        year_match = re.search(r'\((\d{4})\)$', display)
        title = img.get('alt') if img else re.sub(r' \(\d{4}\)$', '', display)
        if not title:
            raise ImportFailure('Film title missing')
        rating = row.select_one('.rating')
        score = re.search(r'\brated-(\d+)\b', ' '.join(rating.get('class', []))) if rating else None
        value = int(score[1]) / 2 if score else None
        if value is not None and not 0.5 <= value <= 5:
            raise ImportFailure('Invalid Letterboxd rating')
        entries.append({'id': f'letterboxd:{slug}', 'source': 'letterboxd', 'title': title,
                        'kind': 'films', 'format': 'film', 'status': status,
                        'year': int(year_match[1]) if year_match else None,
                        'rating': value, 'ratingMax': 5,
                        'url': f'https://letterboxd.com/film/{slug}/',
                        'userUrl': f'https://letterboxd.com/{PROFILES["letterboxd"]}/film/{slug}/'})
    next_link = soup.select_one('a.next[href]')
    next_url = urljoin(url, next_link['href']) if next_link else None
    return entries, next_url, expected


def fetch_letterboxd(client):
    result = {}
    counts = {}
    for shelf, status in [('watchlist', 'planned'), ('films', 'completed')]:
        url = f'https://letterboxd.com/{PROFILES["letterboxd"]}/{shelf}/'
        seen_urls, seen_ids = set(), set()
        total = None
        while url:
            if url in seen_urls or len(seen_urls) >= 100:
                raise ImportFailure('Letterboxd pagination repeated or exceeded limit')
            if not re.fullmatch(rf'https://letterboxd.com/{PROFILES["letterboxd"]}/{shelf}/(?:page/\d+/)?', url):
                raise ImportFailure('Unexpected Letterboxd next page')
            seen_urls.add(url)
            entries, url, expected = parse_letterboxd(client.get(url), url, status)
            if total is not None and expected != total:
                raise ImportFailure('Letterboxd total changed during sync; retry')
            total = expected
            for entry in entries:
                if entry['id'] in seen_ids:
                    raise ImportFailure('Duplicate film across list pages')
                seen_ids.add(entry['id'])
                result[entry['id']] = entry  # Watched wins if present on both shelves.
        if len(seen_ids) != total:
            raise ImportFailure(f'Incomplete Letterboxd {shelf}: {len(seen_ids)}/{total}')
        counts[shelf] = total
    return list(result.values()), counts


def parse_mal(rows, medium):
    if not isinstance(rows, list):
        raise ImportFailure('MAL returned an error or private list instead of an array')
    result = []
    for row in rows:
        ident, title = row.get(f'{medium}_id'), row.get(f'{medium}_title')
        status, score = row.get('status'), row.get('score')
        if not isinstance(ident, int) or ident <= 0 or not isinstance(title, str) or not title.strip():
            raise ImportFailure('MAL entry identity missing')
        if status not in STATUSES or not isinstance(score, (int, float)) or not 0 <= score <= 10:
            raise ImportFailure('MAL status or score invalid')
        fmt = row.get(f'{medium}_media_type_string', medium)
        entry = {'id': f'myanimelist:{medium}:{ident}', 'source': 'myanimelist',
                 'title': title, 'alternateTitle': row.get(f'{medium}_title_eng') or row.get('manga_english') or '',
                 'kind': 'manga' if medium == 'manga' else ('films' if fmt == 'Movie' else 'shows'),
                 'format': fmt, 'status': STATUSES[status], 'rating': score or None, 'ratingMax': 10,
                 'url': f'https://myanimelist.net/{medium}/{ident}',
                 'userUrl': f'https://myanimelist.net/{medium}list/{PROFILES["myanimelist"]}'}
        unit = 'episodes' if medium == 'anime' else 'chapters'
        progress = row.get('num_watched_episodes' if medium == 'anime' else 'num_read_chapters')
        total = row.get(f'{medium}_num_{unit}')
        if not isinstance(progress, int) or progress < 0 or not isinstance(total, int) or total < 0:
            raise ImportFailure('MAL progress invalid')
        entry['progress'] = {'value': progress, 'total': total or None, 'unit': unit}
        # MAL dates are MM-DD-YY, sometimes partial; preserve rather than invent a century/day.
        for src, dest in [('start_date_string', 'sourceStarted'), ('finish_date_string', 'sourceFinished')]:
            if row.get(src):
                entry[dest] = row[src]
        result.append(entry)
    return result


def fetch_mal(client):
    result, counts = [], {}
    for medium in ['anime', 'manga']:
        offset, seen = 0, set()
        for _ in range(100):
            url = f'https://myanimelist.net/{medium}list/{PROFILES["myanimelist"]}/load.json?status=7&offset={offset}'
            entries = parse_mal(json.loads(client.get(url)), medium)
            if not entries:
                break
            for entry in entries:
                if entry['id'] in seen:
                    raise ImportFailure('MAL pagination repeated an entry')
                seen.add(entry['id'])
            result.extend(entries)
            offset += len(entries)
        else:
            raise ImportFailure('MAL pagination exceeded limit')
        counts[medium] = offset
    return result, counts


def write_snapshot(path, source, entries, counts, evidence, allow_shrink=False):
    old = json.loads(path.read_text()) if path.exists() else None
    # Unexpected drops commonly indicate upstream blocking or partial responses.
    if old and not allow_shrink:
        for key, previous in old['counts'].items():
            if counts.get(key, 0) < previous * 0.9:
                raise ImportFailure(f'{key} shrank by more than 10%; inspect and use --allow-shrink if intentional')
    entries.sort(key=lambda e: e['id'])
    if old and old['entries'] == entries and old['counts'] == counts:
        return False  # Idempotent; timestamp describes the last changed snapshot.
    payload = {'schemaVersion': 1, 'source': source, 'username': PROFILES[source],
               'syncedAt': datetime.now(timezone.utc).isoformat(), 'counts': counts,
               'evidence': evidence, 'entries': entries}
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.json.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', choices=['all', *PROFILES], default='all')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data/imports')
    parser.add_argument('--letterboxd-browser-pages', type=Path, help='JSON array of public DOM page extractions; see docs/library-imports.md')
    parser.add_argument('--allow-shrink', action='store_true', help='Accept a verified drop greater than 10%%')
    args = parser.parse_args()
    browser_pages = {}
    if args.letterboxd_browser_pages:
        for page in json.loads(args.letterboxd_browser_pages.read_text()):
            observed = datetime.fromisoformat(page['retrievedAt'])
            if abs((datetime.now(timezone.utc) - observed).total_seconds()) > 86400:
                parser.error('Browser extracts must be retrieved within 24 hours; recapture the public pages')
            browser_pages[page['url']] = page
    failed = False
    for source, fetcher in [('letterboxd', fetch_letterboxd), ('myanimelist', fetch_mal)]:
        if args.source not in {'all', source}:
            continue
        client = Client(browser_pages)
        try:
            entries, counts = fetcher(client)
            changed = write_snapshot(args.output_dir / f'{source}.json', source, entries, counts, client.evidence, args.allow_shrink)
            print(f'{source}: {counts}; {"updated" if changed else "unchanged"}')
        except (ImportFailure, ValueError, OSError) as exc:
            failed = True
            print(f'{source}: FAILED; existing snapshot retained: {exc}', file=sys.stderr)
    return int(failed)


if __name__ == '__main__':
    sys.exit(main())
