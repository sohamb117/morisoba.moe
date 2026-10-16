#!/usr/bin/env python3
"""Validate coverage, provenance, evidence links, and map coordinate invariants."""
import json,re
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'data'
r=json.loads((root/'records.json').read_text())
m=json.loads((root/'source-materials.json').read_text())
allnotes=r+m
assert len({x['id'] for x in allnotes})==len(allnotes), 'Duplicate IDs'
assert all(x['kind'] in ['place','event'] for x in r), 'Source material leaked into destinations'
assert all(x['kind'] not in ['place','event'] for x in m)
lines=(root/'original.md').read_text().splitlines()
expected={i for i,line in enumerate(lines,1) if line.startswith('- ')}
covered={i for x in allnotes for i in x['sourceLines']}
assert expected==covered, f'Missing original lines: {expected-covered}'
for x in allnotes:
    assert x['status'] in ['verified','unverified','needs-recheck','closed']
    assert x['discoverySources']==list(dict.fromkeys(next(iter(re.findall(r'^- \[([^\]]+)\]',n)),'Original notes') for n in x['originalNotes']))
    assert all(n in lines for n in x['originalNotes']), x['id']
    urls={s['url'] for s in x['sources']}
    if x['status'] in ['verified','closed']: assert urls and x['lastChecked'], x['id']
    for tag in x['verifiedTags']:
        assert tag['sourceUrls'] and set(tag['sourceUrls']) <= urls, (x['id'],tag)
    if x['coordinates']:
        lon,lat=x['coordinates']
        assert 122<lon<154 and 23<lat<47, x['id']
        assert x.get('sourceAddress')==x.get('address'), x['id']
        assert x.get('locationSource','').startswith('https://msearch.gsi.go.jp/'), x['id']
        assert x['locationConfidence']=='address-block'
print(f'PASS: {len(r)} destinations, {len(m)} source notes; {len(covered)} original bullets covered; evidence and pin provenance valid.')
