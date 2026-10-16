import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import sync_library as sync

FIXTURES = Path(__file__).parent / 'fixtures'
HTML = (FIXTURES / 'letterboxd.html').read_text()


class FakeClient:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.urls = []
        self.evidence = []
    def get(self, url):
        self.urls.append(url)
        value = next(self.responses)
        if isinstance(value, Exception):
            raise value
        return value


class ImportTests(unittest.TestCase):
    def test_real_letterboxd_markup_and_half_stars(self):
        entries, next_url, total = sync.parse_letterboxd(HTML, 'https://letterboxd.com/morisoba/films/', 'completed')
        self.assertEqual(total, 2)
        self.assertIsNone(next_url)
        self.assertEqual(entries[0]['title'], 'Primetime')
        self.assertEqual(entries[0]['rating'], 3.5)
        self.assertEqual(entries[0]['year'], 2026)
        self.assertNotIn('finished', entries[0])

    def test_blocked_html_rejected(self):
        with self.assertRaises(sync.ImportFailure):
            sync.parse_letterboxd('<h1>Just a moment</h1>', '', 'completed')

    def test_count_mismatch_rejects_partial_list(self):
        client = FakeClient([HTML.replace('2 films', '3 films')])
        with self.assertRaisesRegex(sync.ImportFailure, 'Incomplete'):
            sync.fetch_letterboxd(client)

    def test_duplicate_pages_rejected(self):
        client = FakeClient([HTML + '<a class="next" href="/morisoba/watchlist/page/2/">Older</a>', HTML])
        with self.assertRaisesRegex(sync.ImportFailure, 'Duplicate'):
            sync.fetch_letterboxd(client)

    def test_foreign_pagination_rejected(self):
        client = FakeClient([HTML + '<a class="next" href="https://evil.example/">Older</a>'])
        with self.assertRaisesRegex(sync.ImportFailure, 'Unexpected'):
            sync.fetch_letterboxd(client)

    def test_watched_wins_overlap(self):
        entries, counts = sync.fetch_letterboxd(FakeClient([HTML, HTML]))
        self.assertEqual(len(entries), 2)
        self.assertTrue(all(e['status'] == 'completed' for e in entries))
        self.assertEqual(counts, {'watchlist': 2, 'films': 2})

    def test_browser_extract_matches_http(self):
        rows, _, _ = sync.parse_letterboxd(HTML, '', 'completed')
        page = {'total': 2, 'next': None, 'rows': [
            [r['id'].split(':')[1], f'{r["title"]} ({r["year"]})', '★'*int(r['rating']) + ('½' if r['rating'] % 1 else '')] for r in rows]}
        actual, _, _ = sync.parse_letterboxd(sync.browser_page_html(page), '', 'completed')
        self.assertEqual(rows, actual)

    def test_mal_status_score_progress_movie_and_manga(self):
        row = json.loads((FIXTURES / 'mal-anime.json').read_text())[0]
        for code, label in sync.STATUSES.items():
            row.update(status=code, score=0, anime_media_type_string='Movie')
            item = sync.parse_mal([row], 'anime')[0]
            self.assertEqual(item['status'], label)
            self.assertIsNone(item['rating'])
            self.assertEqual(item['kind'], 'films')
        row['score'] = 7
        self.assertEqual(sync.parse_mal([row], 'anime')[0]['rating'], 7)
        manga = sync.parse_mal(json.loads((FIXTURES / 'mal-manga.json').read_text()), 'manga')[0]
        self.assertEqual(manga['kind'], 'manga')
        self.assertEqual(manga['progress']['unit'], 'chapters')

    def test_mal_pagination_until_empty(self):
        anime = (FIXTURES / 'mal-anime.json').read_text()
        manga = (FIXTURES / 'mal-manga.json').read_text()
        client = FakeClient([anime, '[]', manga, '[]'])
        items, counts = sync.fetch_mal(client)
        self.assertEqual(counts, {'anime': 1, 'manga': 1})
        self.assertEqual(len(items), 2)
        self.assertTrue(client.urls[1].endswith('offset=1'))

    def test_mal_duplicate_page_rejected(self):
        anime = (FIXTURES / 'mal-anime.json').read_text()
        with self.assertRaisesRegex(sync.ImportFailure, 'repeated'):
            sync.fetch_mal(FakeClient([anime, anime]))

    def test_mal_private_and_invalid_rejected(self):
        with self.assertRaises(sync.ImportFailure):
            sync.parse_mal({'error': 'private'}, 'anime')
        row = json.loads((FIXTURES / 'mal-anime.json').read_text())[0]
        row['score'] = 11
        with self.assertRaises(sync.ImportFailure):
            sync.parse_mal([row], 'anime')

    def test_idempotence_and_shrink_keep_previous_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.json'
            self.assertTrue(sync.write_snapshot(path, 'letterboxd', [{'id':'x'}], {'films':10}, []))
            before = path.read_bytes()
            self.assertFalse(sync.write_snapshot(path, 'letterboxd', [{'id':'x'}], {'films':10}, []))
            self.assertEqual(before, path.read_bytes())
            with self.assertRaises(sync.ImportFailure):
                sync.write_snapshot(path, 'letterboxd', [], {'films':0}, [])
            self.assertEqual(before, path.read_bytes())
            self.assertTrue(sync.write_snapshot(path, 'letterboxd', [], {'films':0}, [], allow_shrink=True))

    def test_source_failure_does_not_write(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'letterboxd.json'
            path.write_text('previous snapshot')
            with patch.object(sys, 'argv', ['sync', '--source', 'letterboxd', '--output-dir', directory]), patch.object(sync, 'fetch_letterboxd', side_effect=sync.ImportFailure('blocked')):
                self.assertEqual(sync.main(), 1)
            self.assertEqual(path.read_text(), 'previous snapshot')

    def test_shelf_counts_survive_shared_heading_animation(self):
        soup = sync.BeautifulSoup((sync.ROOT / 'library/index.html').read_text(), 'html.parser')
        self.assertEqual(soup.select_one('#p-shows .tl').get_text().strip(), 'layer:α.3 series')
        self.assertIsNone(soup.select_one('#p-sources'))
        self.assertEqual(soup.select_one('#library-sort option[selected]')['value'], 'rating')
        for panel in ['p-books', 'p-films', 'p-shows', 'p-manga']:
            count = soup.select_one(f'#{panel} .shelf-count')
            self.assertIsNotNone(count)
            self.assertFalse(count.find_parent(class_='tl'), 'Shared glitch animation replaces .tl textContent')

    def test_committed_snapshot_integrity(self):
        for source in sync.PROFILES:
            snapshot = json.loads((sync.ROOT / f'data/imports/{source}.json').read_text())
            self.assertEqual(snapshot['username'], sync.PROFILES[source])
            ids = [e['id'] for e in snapshot['entries']]
            self.assertEqual(len(ids), len(set(ids)))
            self.assertTrue(snapshot['evidence'])
            for e in snapshot['entries']:
                self.assertTrue(e['title'])
                self.assertIn(e['kind'], ['films','shows','manga'])
                self.assertIn(e['status'], sync.STATUSES.values())
                self.assertTrue(e['rating'] is None or 0 < e['rating'] <= e['ratingMax'])


if __name__ == '__main__':
    unittest.main()
