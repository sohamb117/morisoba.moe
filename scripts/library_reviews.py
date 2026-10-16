"""Public review extraction; IDs join reviews to list entries without title matching."""
from copy import deepcopy
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup


class ReviewFailure(ValueError):
    pass


def plain_text(element):
    """Keep paragraph/line breaks and inline text; never store executable markup."""
    node = deepcopy(element)
    for junk in node.select('script, style, button, .thumb-right, .js-visible'):
        junk.decompose()
    for br in node.select('br'):
        br.replace_with('\n')
    for block in node.select('p, blockquote, li'):
        block.append('\n\n')
    text = node.get_text().replace('\r\n', '\n').replace('\xa0', ' ')
    text = '\n'.join(re.sub(r'[\t ]+', ' ', line).strip() for line in text.splitlines())
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def lb_review_url(url, username):
    return re.fullmatch(rf'https://letterboxd.com/{re.escape(username)}/film/([a-z0-9-]+)/(?:\d+/)?', url)


def parse_letterboxd_reviews(html, url, username):
    soup = BeautifulSoup(html, 'html.parser')
    heading = soup.select_one('h1.section-heading')
    if not heading:
        raise ReviewFailure('Letterboxd reviews heading missing')
    heading_text = heading.get_text(' ', strip=True) + ' ' + ' '.join(
        el.get('title') or el.get('data-original-title', '') for el in heading.select('[title], [data-original-title]'))
    total_match = re.search(r'([\d,]+)\s+reviews?\b', heading_text, re.I)
    if not total_match:
        raise ReviewFailure('Letterboxd review total missing')
    rows = soup.select('article.production-viewing')
    reviews = []
    for row in rows:
        if row.get('data-owner') != username or row.get('data-object-name') != 'review':
            raise ReviewFailure('Unexpected Letterboxd review owner/type')
        link = row.select_one('h2.primaryname a[href]')
        body = row.select_one('.js-review-body')
        rid = row.get('data-object-id', '')
        if link is None or body is None or not re.fullmatch(r'viewing:\d+', rid):
            raise ReviewFailure('Letterboxd review identity or text missing')
        permalink = urljoin(url, link['href'])
        film = lb_review_url(permalink, username)
        if not film:
            raise ReviewFailure('Unexpected Letterboxd review link')
        text = plain_text(body)
        if not text:
            raise ReviewFailure('Empty Letterboxd review body')
        # Long/collapsed excerpts must be verified against the dedicated review page.
        truncated = bool(body.select_one('.collapsed-text, .more-link, .read-more, .js-more')) or len(text) >= 500 or text.endswith(('…', '...'))
        date = row.select_one('time[datetime]')
        reviews.append({'id': f'letterboxd:{rid}', 'entryId': f'letterboxd:{film[1]}',
                        'url': permalink, 'text': text,
                        'spoiler': bool(row.select_one('.spoiler-warning, .contains-spoilers, .hidden-spoilers')),
                        'watchedOn': date['datetime'] if date else None,
                        '_needsFullText': truncated})
    nxt = soup.select_one('a.next[href]')
    return reviews, urljoin(url, nxt['href']) if nxt else None, int(total_match[1].replace(',', ''))


def letterboxd_full_text(html, url, username):
    soup = BeautifulSoup(html, 'html.parser')
    section = soup.select_one('section.review')
    author = section.select_one('.person-summary a.name[href]') if section else None
    film = section.select_one('h2.primaryname a[href]') if section else None
    body = section.select_one('.js-review-body') if section else None
    expected = lb_review_url(url, username)
    if not author or author['href'] != f'/{username}/' or not expected or not film or film['href'] != f'/film/{expected[1]}/' or not body:
        raise ReviewFailure('Full Letterboxd review identity/text did not match')
    text = plain_text(body)
    if not text:
        raise ReviewFailure('Full Letterboxd review was empty')
    return text


def fetch_letterboxd_reviews(client, username):
    url = f'https://letterboxd.com/{username}/reviews/'
    reviews, pages, ids, total = [], set(), set(), None
    while url:
        if not re.fullmatch(rf'https://letterboxd.com/{re.escape(username)}/reviews/(?:films/(?:page/\d+/)?)?', url) or url in pages or len(pages) >= 100:
            raise ReviewFailure('Unexpected/repeated Letterboxd reviews page')
        pages.add(url)
        batch, nxt, count = parse_letterboxd_reviews(client.get(url), url, username)
        if total is not None and count != total:
            raise ReviewFailure('Letterboxd review count changed during sync')
        total = count
        for review in batch:
            if review['id'] in ids:
                raise ReviewFailure('Repeated Letterboxd review')
            ids.add(review['id'])
            if review.pop('_needsFullText'):
                review['text'] = letterboxd_full_text(client.get(review['url']), review['url'], username)
            reviews.append(review)
        url = nxt
    if len(reviews) != total:
        raise ReviewFailure(f'Incomplete Letterboxd reviews: {len(reviews)}/{total}')
    return reviews


def parse_mal_reviews(html, url, username):
    soup = BeautifulSoup(html, 'html.parser')
    profile = f'https://myanimelist.net/profile/{username}/reviews'
    counter = next((a.select_one('.user-status-data') for a in soup.select('.user-status a[href]')
                    if urljoin(url, a['href']) == profile and a.select_one('.user-status-data')), None)
    if counter is None or not re.fullmatch(r'[\d,]+', counter.get_text(strip=True)):
        raise ReviewFailure('MAL review count/profile missing (blocked or changed markup)')
    total = int(counter.get_text(strip=True).replace(',', ''))
    rows = soup.select('#content .review-element')
    if not rows and not (total == 0 and 'No reviews were found.' in soup.get_text()):
        raise ReviewFailure('MAL reviews missing without an explicit empty state')
    reviews = []
    for row in rows:
        author = row.select_one('.username a[href]')
        if author and urljoin(url, author['href']) != f'https://myanimelist.net/profile/{username}':
            raise ReviewFailure('Unexpected MAL review author')
        title = row.select_one('.titleblock a.title[href]')
        link = row.select_one('a[data-ga-click-type="review-permalink"]')
        body = row.select_one('.text')
        if title is None or link is None or body is None:
            raise ReviewFailure('MAL review title/link/text missing')
        target = re.fullmatch(r'https://myanimelist.net/(anime|manga)/(\d+)(?:/[^?#]*)?', urljoin(url, title['href']))
        permalink = urljoin(url, link['href'])
        rid = re.fullmatch(r'https://myanimelist.net/reviews.php\?id=(\d+)', permalink)
        if not target or not rid:
            raise ReviewFailure('Unexpected MAL review identity')
        if body.select_one('.js-visible') and not body.select_one('.js-hidden'):
            raise ReviewFailure('MAL review is truncated without its full text')
        text = plain_text(body)
        if not text:
            raise ReviewFailure('MAL review text is empty')
        reviews.append({'id': f'myanimelist:review:{rid[1]}', 'entryId': f'myanimelist:{target[1]}:{target[2]}',
                        'url': permalink, 'text': text,
                        'spoiler': bool(row.select_one('.tag.spoiler')),
                        'watchedOn': None})
    next_url = None
    for link in soup.select('#content a[href]'):
        if 'next' in link.get('rel', []) or re.match(r'^Next(?:\b|\s*[»>])', link.get_text(' ', strip=True), re.I):
            candidate = urljoin(url, link['href'])
            if candidate.startswith(profile):
                next_url = candidate
                break
    return reviews, next_url, total


def fetch_mal_reviews(client, username):
    url = f'https://myanimelist.net/profile/{username}/reviews'
    reviews, pages, ids, total = [], set(), set(), None
    while url:
        if not re.fullmatch(rf'https://myanimelist.net/profile/{re.escape(username)}/reviews(?:\?p=\d+)?', url) or url in pages or len(pages) >= 100:
            raise ReviewFailure('Unexpected/repeated MAL reviews page')
        pages.add(url)
        batch, nxt, count = parse_mal_reviews(client.get(url), url, username)
        if total is not None and count != total:
            raise ReviewFailure('MAL review count changed during sync')
        total = count
        for review in batch:
            if review['id'] in ids:
                raise ReviewFailure('Repeated MAL review')
            ids.add(review['id'])
            reviews.append(review)
        url = nxt
    if len(reviews) != total:
        raise ReviewFailure(f'Incomplete MAL reviews: {len(reviews)}/{total}')
    return reviews
