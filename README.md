# morisoba.moe

Static portfolio. Preview with `python3 -m http.server 8000`.

## Projects

Choir's original `p-console` window now contains a compact list of 12 public projects, each with a name, short description, and source link. It retains its original 300px width, position, tilt, titlebar, controls, CRT material, and green text. Text increases from 9px to 10px, with 11px project names. The list scrolls within the window, which opens by default on desktop and mobile. No search, cards, or desktop rearrangement is added.

`data/projects.json` records the public projects checked against GitHub on 2026-10-16. Flytrain maps to `fruit-fly-heaven`; Eigenfish maps to `eigenself`. To regenerate the static list:

```sh
python3 scripts/build_projects.py
python3 scripts/build_projects.py --check
```

## Resume

Work has one PDF download in its titlebar. Experience entries link to the matching HTML resume sections. The unchanged supplied `Soham_Bhattacharya_CV_-_SWE(5).pdf` is stored as `resume/Soham-Bhattacharya-CV.pdf`. The HTML includes the CV's experience, research, education, patents, writing, awards, and skills, with grammar and punctuation cleanup.

PDF SHA-256: `f4d2ada919b73a32a0c0d072059ce3e86aa25b077678487ab2e9dd39591cd1c0`.

## Deployment

The checked-in GitHub Pages workflow publishes on main. A separate Cloudflare Workers integration also runs on this branch. During verification, the branch's homepage appeared on morisoba.moe while `/resume/` still served the old version, even after reload and a cache-busting query. A green Cloudflare build check alone does not establish that all routes have updated. The branch remains available in PR #3; verify both the homepage and resume route after release.
