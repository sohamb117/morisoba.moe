# Shared cursors and selection sounds

Every document loads `shared/cursors.css?v=2` and `shared/ui-sound.js?v=2`, including Mimorigasaka. Default and actionable hover use the vintage arrow; reading text and editable fields use the I-beam. Drag/resize/disabled roles retain their custom sprites. Cursor lists end in `none` rather than a native OS cursor; all referenced sprites ship with the site.

Use `.ui-sound-select` or `data-ui-sound="select"` for a new selection control, and `.ui-sound-nav` or `data-ui-sound="nav"` for a programmatic page-launch control. Ordinary page links are automatic. JavaScript navigation uses `MorisobaUI.navigate(url, {replace, newTab})`. `data-ui-sound="off"` opts out, and `MorisobaUI.setMuted(true)` persists the sound preference.

Panel buttons, dock restore buttons, tabs, disclosures and existing directory/reader selectors are handled in window capture, before close animations intercept the click. Only trusted user clicks trigger delegated audio, so delayed close-animation replay and boot-time panel setup remain silent. The shared cooldown also deduplicates direct and delegated calls. Maximize/restore handles double-click and Escape separately.

The homepage Log Out button reloads the homepage path without its query or fragment. This resets loaders, animation loops, panel layout, dock and entry choice. Focus returns to Business; the desktop is inert while the entry dialog is shown. This homepage environment choice is separate from Mimorigasaka authentication, whose Account → Sign out control revokes its session.

## Restoration regression

Mimorigasaka was deployed from `feature/mimorigasaka` while PR #8 remained open. A later deployment from main omitted the page, Worker routes and D1 binding. The restoration merges that feature history into current main and retains the existing database ID. `tests/deployment-routes.test.cjs` guards the shell, routes, binding and cursor assets; `tests/ui-sound.test.cjs` covers sound deduplication, synthetic replay, disabled/muted controls and navigation semantics.
