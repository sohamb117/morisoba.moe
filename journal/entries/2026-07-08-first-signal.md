---
title: first signal
date: 2026-07-08
tags: [meta]
draft: false
slug: 2026-07-08-first-signal
---

# hello

this is a placeholder entry demonstrating the journal renderer's expected markdown surface. **replace me** with a real entry, or delete both this file and its manifest.json line.

## what the renderer must handle

paragraphs of *emphasized* and **strong** text with inline `code` and [links back to /](/).

- unordered lists
- with several items

1. and ordered lists
2. rendered the same way

> blockquotes render with a left-border rule and quieter typography.

fenced code blocks:

```
raw monospace, no syntax highlighting (terminal aesthetic).
multi-line preserved.
```

---

horizontal rules split sections.

## frontmatter contract

- `title` — display name in index + entry header.
- `date` — YYYY-MM-DD, used for sort order and taxonomy display.
- `tags` — array of strings, shown in taxonomy panel.
- `draft` — boolean; `true` hides from index.
- `slug` — file basename minus `.md`, used for URL fragment and manifest cross-ref.
