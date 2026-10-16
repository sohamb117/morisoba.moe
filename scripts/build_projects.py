#!/usr/bin/env python3
"""Render the curated public GitHub catalog. No network or third-party packages.
Run with --check in CI to verify the checked-in homepage matches the catalog.
"""
import argparse
import html
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
START, END = '<!-- PROJECTS:START -->', '<!-- PROJECTS:END -->'

def render():
    data = json.loads((ROOT / 'data/projects.json').read_text())
    blocks = []
    seen = set()
    for p in data['projects']:
        if p['repo'] in seen:
            raise ValueError('Duplicate project: ' + p['repo'])
        seen.add(p['repo'])
        for link in p['links']:
            if urlparse(link['url']).scheme != 'https' or not urlparse(link['url']).netloc:
                raise ValueError('Expected an absolute HTTPS link')
        esc = html.escape
        source = esc(p['links'][0]['url'], quote=True)
        extra = ' · '.join(f'<a href="{esc(l["url"], quote=True)}" target="_blank" rel="noopener noreferrer">{esc(l["label"])}</a>' for l in p['links'][1:])
        extra = f'<div class="project-more">{extra}</div>' if extra else ''
        blocks.append(f'''        <div class="project" id="project-{esc(p['repo'])}">
          <a href="{source}" target="_blank" rel="noopener noreferrer"><b>{esc(p['name'])}</b></a>
          <p>{esc(p['description'])}</p>{extra}
        </div>''')
    return '\n' + '\n'.join(blocks) + '\n'

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = ROOT / 'index.html'
    current = path.read_text()
    before, rest = current.split(START)
    _, after = rest.split(END)
    expected = before + START + render() + END + after
    if args.check:
        if current != expected:
            raise SystemExit('Catalog is stale; run python3 scripts/build_projects.py')
        print('Project catalog is current.')
    else:
        path.write_text(expected)
        print('Rendered project catalog.')
