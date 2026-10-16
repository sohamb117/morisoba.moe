#!/usr/bin/env python3
"""Rebuild the browser catalog and complete Markdown export; no network calls."""
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
records = json.loads((DATA / 'records.json').read_text())
materials = json.loads((DATA / 'source-materials.json').read_text())
areas = json.loads((DATA / 'areas.json').read_text())
(DATA / 'catalog.js').write_text('window.ATLAS_DATA = ' + json.dumps(
    {'records': records, 'areas': areas, 'checkedAt': '2026-10-16'}, ensure_ascii=False) + ';\n')

def link(title, url):
    return '[' + str(title).replace('[', '\\[').replace(']', '\\]') + '](<' + url + '>)'

def entry(r):
    out = [f"### {r['name']} ({r['id']})", '',
           f"- Type: {r['kind']}", f"- Area: {r['ward']}", f"- Category: {r['category']}",
           '- Discovery source: ' + ' | '.join(r['discoverySources']),
           f"- Evidence status: **{r['status']}**", f"- Last checked: {r['lastChecked'] or 'Not independently checked'}",
           '- Original line(s): ' + ', '.join(map(str, r['sourceLines'])), '', r['summary'], '']
    if r.get('address'): out += ['Address: ' + r['address'], '']
    if r.get('coordinates'):
        lng, lat = r['coordinates']
        out += [f'Approximate coordinates: {lat}, {lng} (latitude, longitude).', r['geocodeNote'], '',
                link('GSI address evidence: ' + r['geocodedLabel'], r['locationSource']) +
                f" — checked {r['geocodedAt']}.", '']
    elif r['kind'] in ['place', 'event']:
        out += ['Location: no verified place pin. An area overview may be available in the viewer.', '']
    if r.get('mapLink'):out += [link('Search in Google Maps', r['mapLink']), '']
    out += ['**Evidence-supported tags**', '']
    for t in r['verifiedTags']:
        out += ['- ' + t['label'] + ': ' + ', '.join(link(f'evidence {i+1}', u) for i,u in enumerate(t['sourceUrls']))]
    if not r['verifiedTags']:out += ['None established.']
    out += ['', '**Citations**', '']
    for s in r['sources']:out += ['- ' + link(s['title'], s['url']) + ': ' + s['claim']]
    if not r['sources']:out += ['Original list only; no independent citation established.']
    if r.get('corrections'):
        out += ['', '**Editorial corrections**', '']
        for c in r['corrections']:out += ['- ' + c['reason'] + ' ' + ', '.join(link('source',u) for u in c['sourceUrls'])]
    out += ['', '**Original notes — verbatim**', '', '```text', '\n\n'.join(r['originalNotes']), '```', '']
    for l in r['links']:out += ['- ' + link(l['title'], l['url'])]
    return '\n'.join(out)

counts=collections.Counter(r['status'] for r in records)
md=['# UNDERGROUND — Japan field atlas: complete source data', '', 'Research snapshot: 2026-10-16.', '',
    f'{len(records)} destination/event records; {len(materials)} source-material and online-reference notes. '+
    f"{sum(bool(r.get('coordinates')) for r in records)} approximate address pins.", '',
    '## Reading this file', '',
    'The first bracketed label in each original bullet is its **discovery source**. It is preserved for filtering and sorting; it is not an independently verified descriptive tag. Publications and online materials are sources, not destinations. They appear in the source ledger below and are excluded from the map directory.', '',
    '**verified** means a cited source supports identity or the specifically described facts. It does not certify every original claim, opening hours, stock, future access, or exact location. **needs-recheck** marks incomplete, conflicting, historical or time-sensitive evidence. **unverified** means independent evidence was not established. **closed** requires cited closure evidence; consult the individual scope.', '',
    'Destination evidence: '+', '.join(f'{n} {k}' for k,n in sorted(counts.items()))+'.', '',
    'All plotted coordinates are approximate GSI address matches derived from cited addresses. They are not entrance-level survey points. Unresolved places do not receive invented pins. An area circle in the viewer refers to a district, not a business.', '',
    'The supplied Markdown is reproduced in full at the end. Original claims are preserved as notes even when research contradicts them. Research citations and correction notes explain those differences.', '',
    '## Destinations and events', '', '\n'.join(entry(r) for r in records), '',
    '## Source ledger — publications, online resources, reference notes', '',
    'These materials are retained as research sources and reading leads. They are not map destinations.', '',
    '\n'.join(entry(r) for r in materials), '', '## Original supplied document — all 552 lines', '',
    '````markdown', (DATA/'original.md').read_text().rstrip(), '````', '']
(DATA / 'source-data.md').write_text('\n'.join(md))
print(f'Built catalog: {len(records)} destinations; Markdown: {len(records)+len(materials)} source notes.')
