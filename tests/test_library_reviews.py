import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import library_reviews as reviews
import sync_library as sync
from test_sync_library import FakeClient

FIXTURES = Path(__file__).parent / 'fixtures'
LB = (FIXTURES / 'letterboxd-reviews.html').read_text()
MAL = (FIXTURES / 'mal-reviews.html').read_text()
MAL_EMPTY = (FIXTURES / 'mal-reviews-empty.html').read_text()
LB_URL = 'https://letterboxd.com/morisoba/reviews/'
MAL_URL = 'https://myanimelist.net/profile/ch0p1n117/reviews'


class ReviewTests(unittest.TestCase):
    def test_letterboxd_real_markup(self):
        batch, nxt, total = reviews.parse_letterboxd_reviews(LB, LB_URL, 'morisoba')
        self.assertEqual(total, 1)
        self.assertIsNone(nxt)
        self.assertEqual(batch[0]['entryId'], 'letterboxd:angels-egg')
        self.assertEqual(batch[0]['text'], 'I don’t know if there is another film this visually beautiful.')
        self.assertEqual(batch[0]['watchedOn'], '2026-09-20')
        self.assertFalse(batch[0]['_needsFullText'])

    def test_repeat_viewing_reviews_are_preserved_and_pagination_followed(self):
        page1 = LB.replace('1 review', '2 reviews') + '<a class="next" href="/morisoba/reviews/films/page/2/">Older</a>'
        page2 = LB.replace('1 review', '2 reviews').replace('1503088554', '1503088555').replace('/morisoba/film/angels-egg/', '/morisoba/film/angels-egg/1/')
        result = reviews.fetch_letterboxd_reviews(FakeClient([page1,page2]), 'morisoba')
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['entryId'], result[1]['entryId'])
        self.assertNotEqual(result[0]['id'], result[1]['id'])

    def test_truncated_review_fetches_full_permalink_and_validates_owner(self):
        truncated = LB.replace('I don’t know if there is another film this visually beautiful.', 'Preview…')
        full = '<section class="review"><div class="person-summary"><a class="name" href="/morisoba/">morisoba</a></div><h2 class="primaryname"><a href="/film/angels-egg/">Angel</a></h2><div class="js-review-body"><p>First <em>paragraph</em>.</p><p>Complete ending.</p></div></section>'
        client = FakeClient([truncated,full])
        result = reviews.fetch_letterboxd_reviews(client, 'morisoba')
        self.assertEqual(result[0]['text'], 'First paragraph.\n\nComplete ending.')
        self.assertEqual(client.urls[-1], 'https://letterboxd.com/morisoba/film/angels-egg/')
        with self.assertRaises(reviews.ReviewFailure):
            reviews.letterboxd_full_text(full.replace('/morisoba/','/someone-else/'), client.urls[-1], 'morisoba')

    def test_incomplete_and_repeated_review_pages_rejected(self):
        with self.assertRaisesRegex(reviews.ReviewFailure, 'Incomplete'):
            reviews.fetch_letterboxd_reviews(FakeClient([LB.replace('1 review','2 reviews')]), 'morisoba')
        page = LB + '<a class="next" href="/morisoba/reviews/">Older</a>'
        with self.assertRaisesRegex(reviews.ReviewFailure, 'repeated'):
            reviews.fetch_letterboxd_reviews(FakeClient([page]), 'morisoba')

    def test_blocked_or_other_author_page_rejected(self):
        for html in ['<h1>Access denied</h1>', LB.replace('data-owner="morisoba"','data-owner="someone"')]:
            with self.assertRaises(reviews.ReviewFailure):
                reviews.parse_letterboxd_reviews(html, LB_URL, 'morisoba')

    def test_mal_anime_manga_full_hidden_text_and_spoiler(self):
        batch,nxt,total = reviews.parse_mal_reviews(MAL, MAL_URL, 'ch0p1n117')
        self.assertEqual(total,2)
        self.assertIsNone(nxt)
        self.assertEqual(batch[0]['entryId'],'myanimelist:anime:32281')
        self.assertEqual(batch[1]['entryId'],'myanimelist:manga:50027')
        self.assertEqual(batch[0]['text'],'First paragraph.\n\nSecond paragraph, including the complete ending.')
        self.assertTrue(batch[0]['spoiler'])
        self.assertFalse(batch[1]['spoiler'])

    def test_mal_explicit_zero_is_distinct_from_failed_extraction(self):
        self.assertEqual(reviews.fetch_mal_reviews(FakeClient([MAL_EMPTY]), 'ch0p1n117'),[])
        for html in ['<h1>Access denied</h1>',MAL_EMPTY.replace('No reviews were found.',''),MAL_EMPTY.replace('>0<','>1<')]:
            with self.assertRaises(reviews.ReviewFailure):
                reviews.parse_mal_reviews(html,MAL_URL,'ch0p1n117')

    def test_mal_wrong_author_and_missing_full_text_rejected(self):
        for html in [MAL.replace('href="https://myanimelist.net/profile/ch0p1n117">','href="https://myanimelist.net/profile/someone">'),MAL.replace('class="js-hidden"','class="missing"')]:
            with self.assertRaises(reviews.ReviewFailure):
                reviews.parse_mal_reviews(html,MAL_URL,'ch0p1n117')

    def test_mal_count_mismatch_rejected(self):
        with self.assertRaisesRegex(reviews.ReviewFailure,'Incomplete'):
            reviews.fetch_mal_reviews(FakeClient([MAL.replace('>2</span>','>3</span>')]),'ch0p1n117')

    def test_plain_text_removes_executable_markup_keeps_literal_characters(self):
        node = reviews.BeautifulSoup('<div><p>A &lt; B &amp; <em>C</em>.</p><script>bad()</script><p>Last<br>line</p></div>','html.parser').div
        self.assertEqual(reviews.plain_text(node),'A < B & C.\n\nLast\nline')

    def test_review_only_failure_retains_whole_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'letterboxd.json'
            original = json.dumps({'entries':[], 'counts':{}, 'evidence':[], 'reviews':[{'text':'keep me'}]})
            path.write_text(original)
            with patch.object(sys,'argv',['sync','--source','letterboxd','--reviews-only','--output-dir',directory]), patch.object(sync,'fetch_letterboxd_reviews',side_effect=reviews.ReviewFailure('blocked')):
                self.assertEqual(sync.main(),1)
            self.assertEqual(path.read_text(),original)

    def test_review_update_is_idempotent_and_preserved_by_list_only_write(self):
        batch = reviews.fetch_letterboxd_reviews(FakeClient([LB]), 'morisoba')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'letterboxd.json'
            self.assertTrue(sync.write_snapshot(path,'letterboxd',[],{},[],reviews=batch))
            original = path.read_bytes()
            self.assertFalse(sync.write_snapshot(path,'letterboxd',[],{},[],reviews=batch))
            self.assertEqual(path.read_bytes(),original)
            self.assertFalse(sync.write_snapshot(path,'letterboxd',[],{},[]))
            batch[0]['text'] = 'Edited review.'
            self.assertTrue(sync.write_snapshot(path,'letterboxd',[],{},[],reviews=batch))

    def test_committed_reviews_have_unique_ids_and_source_identity(self):
        for source in sync.PROFILES:
            snapshot=json.loads((sync.ROOT/f'data/imports/{source}.json').read_text())
            ids=[r['id'] for r in snapshot.get('reviews',[])]
            self.assertEqual(len(ids),len(set(ids)))
            for review in snapshot.get('reviews',[]):
                self.assertTrue(review['entryId'].startswith(source + ':'))
                self.assertTrue(review['text'].strip())
                self.assertNotIn('_needsFullText',review)
