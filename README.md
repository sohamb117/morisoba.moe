# morisoba.moe

Static portfolio with a draggable desktop, a searchable projects window, and an HTML resume. No runtime framework, GitHub API request, or build service is required.

## Preview

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`, then choose Personal for the desktop or Business for the resume. `/#p-projects` opens the projects window directly. Work contains both the readable resume and a downloadable PDF.

## Update projects

`data/projects.json` is the curated public-project catalog. It was verified against `sohamb117`'s public GitHub repositories and READMEs on 2026-10-16. Edit it, then run:

```sh
python3 scripts/build_projects.py
python3 scripts/build_projects.py --check
```

The script writes the marked catalog block in `index.html`; the generated HTML is committed so projects do not depend on a client-side request. Search runs locally through `shared/projects.js`. The Pages workflow checks that the generated content is current before deployment.

The requested names map to these sources:

- ArenaBench: `sohamb117/arenabench`
- Pokeweb: `sohamb117/pokeweb`; native ports: `sohamb117/gen4recomp`
- Sokaris: `sohamb117/sokaris`, with a link to `sokaris-playground`
- Flytrain: the shared training console documented by `sohamb117/fruit-fly-heaven`
- npx morisoba: `sohamb117/npx-morisoba`
- Eigenfish: `sohamb117/eigenself` (`eigenself.html` and repository description)

Additional selected projects: love-canvas, OMP Pet, Dream-State Learning, Geoshader, and Greenhouse. Routine forks, private repositories, and old exercises are omitted. Project descriptions describe the public implementations without treating research goals as established results.

## Resume source

`resume/index.html` transcribes the supplied `Soham_Bhattacharya_CV_-_SWE(5).pdf`, with punctuation and grammar cleanup. Dates, metrics, education status, project claims, patents, writing, awards, and skills come from that CV. The PDF download at `resume/Soham-Bhattacharya-CV.pdf` is an unchanged copy of the attachment.

PDF SHA-256: `f4d2ada919b73a32a0c0d072059ce3e86aa25b077678487ab2e9dd39591cd1c0`.

## Layout and verification

Home-specific styles live in `shared/portfolio.css`. Wide, tall viewports retain draggable windows. At 1100px wide or below, or 780px tall or below, windows use document flow; phones use one column. Other sections retain their existing breakpoint. The same default panels remain closed across resizing, while Projects stays open.

Verified locally in the browser at 1440×900, 1280×800, 1024×768, 390×844, and 320×740:

- Default Projects visibility, search by name, empty search results, clearing search.
- Minimize/expand and close/dock/restore on desktop; close/restore on phone.
- Mobile-to-desktop reflow, no horizontal overflow in project content.
- Work-to-resume and resume-to-projects navigation.
- Resume layout on desktop and phone; PDF download with matching SHA-256.
- No browser warning/error logs during the checked flows.

Also checked generated-catalog consistency, JavaScript syntax, duplicate HTML IDs, all local link/fragment targets on home and resume, and `git diff --check`.

## Deployment

`.github/workflows/deploy.yml` deploys the repository root to GitHub Pages on a push to `main` or a manual workflow dispatch. The update branch does not deploy automatically. Merge it into `main` to publish through the existing workflow.
