# Public library imports

`data/library.json` remains the handwritten source, unchanged by the importer.
`data/imports/letterboxd.json` and `myanimelist.json` contain committed public
snapshots. The static `/library/` page combines them locally; visitors do not
need credentials, cross-origin fetches, or either service to be available.

Scope: Letterboxd `morisoba` watched films and watchlist, and MyAnimeList
`ch0p1n117` anime and manga lists across all statuses. Custom Letterboxd lists,
diary history and review text are not imported. Reviews remain accessible via
profile links. No watched dates are inferred from release years. MAL scores stay
out of 10, Letterboxd scores out of 5, and zero MAL scores mean unrated.

## Refresh

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/sync_library.py
.venv/bin/python -m unittest discover -s tests -v
node --test tests/library-data.test.cjs
```

Run on a branch, review the JSON diff, and open a PR to `main`. The manual
**Sync public library** GitHub Action does this too; it is not scheduled. GitHub
must allow Actions to create pull requests for that workflow to open its PR.
The CLI is available if that repository setting is disabled. Token-created PRs
may require a maintainer push to trigger PR CI; the sync job runs Python checks
before creating its PR. Merge follows the existing deployment process.

The importer paginates to the end, checks Letterboxd totals, rejects duplicate
pages, validates statuses/scores/progress, rate-limits requests, and retries
transient errors. A source is replaced atomically only after every list for that
source succeeds. On failure it exits nonzero and retains that source's previous
snapshot. Another source may still update locally; the Action stops before
publishing any partial run. Drops larger than 10% per shelf require inspection
and `--allow-shrink`. Empty/private/blocked responses must never silently erase
an established list. An unchanged run does not rewrite files or timestamps;
`syncedAt` is the last changed snapshot, not a claim of continuous freshness.

## Letterboxd browser fallback

Letterboxd sometimes returns HTTP 403 to scripts while public pages work in a
normal browser. Do not use the limited RSS feed as a complete film list. Open
the blocked public page normally; if it displays a login/challenge, stop and
retain the previous snapshot. On an accessible page, this read-only DOM snippet
extracts the same visible grid used by the parser:

```js
({
  url: location.href,
  retrievedAt: new Date().toISOString(),
  total: Number((document.querySelector('h1.section-heading [title]')?.getAttribute('title') ||
    document.querySelector('h1.section-heading [data-original-title]')?.getAttribute('data-original-title') ||
    document.querySelector('h1.section-heading').textContent).replace(/,/g, '').match(/\d+/)[0]),
  next: document.querySelector('a.next')?.href || null,
  rows: [...document.querySelectorAll('li.griditem')].map(row => {
    const p = row.querySelector('[data-item-slug]');
    return [p.getAttribute('data-item-slug'), p.getAttribute('data-item-name'), row.querySelector('.rating')?.textContent || ''];
  })
})
```

Save the extracted page objects in a JSON array outside the repository, then:

```sh
.venv/bin/python scripts/sync_library.py --source letterboxd --letterboxd-browser-pages /path/to/pages.json
```

This is an explicit fallback, never an automatic reuse of stale responses.
Extracts must be less than 24 hours old. Next-page paths, counts, unique IDs and
ratings are still validated. Snapshot evidence distinguishes `browser-dom`
extract hashes from HTTP response hashes. The initial snapshot used this fallback
for watched-film pages 2 and 3 (the original DOM extracts are retained in
`docs/evidence/letterboxd-browser-pages-2026-10-16.json`); all six watchlist pages and watched page 1 came
from direct public HTTP retrieval. MAL fetched each list through a terminal empty
page. The 185 watched + 141 watchlist records contain two shared films; watched
status takes precedence, resulting in 324 unique Letterboxd entries.

## Preservation and identity

`data/library-links.json` contains explicit identity links. No fuzzy title
merging is performed: remakes and translated titles cannot overwrite one
another accidentally. Handwritten fields always win on linked entries, while
all source ratings and progress remain visible in details. For example,
964 Pinocchio retains its handwritten 3/5 alongside Letterboxd's 3.5/5.
Serial Experiments Lain remains on the series shelf. Verified Your Name and
Weathering with You links join the two providers. Other identities remain
separate until explicitly linked. Source filtering matches any attached source;
status and sort use the merged entry's primary status/rating. A completed status
takes precedence across imported sources. Rating sorting normalizes scales only
for comparison. Manga has its own shelf; MAL Movie entries go under films.

## Deployment

The repository already deploys `main` to GitHub Pages via `.github/workflows/deploy.yml`.
No new hosting or server is needed. The inspected Pages URL is
https://sohamb117.github.io/morisoba.moe/ with no Pages custom domain configured.
The public https://morisoba.moe/library/ matches the repository's library design,
but its custom-domain routing/deployment is external to this repository's Pages
settings. Verify that domain after merge; do not assume a successful Pages build
proves the custom domain updated. This implementation PR does not merge or deploy
itself.
