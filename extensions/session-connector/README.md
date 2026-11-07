# morisoba connections

Reads your signed-in X or Instagram session when you click its connect button. Sends only `auth_token` + `ct0` (X), or `sessionid` (Instagram), to the corresponding authenticated `https://morisoba.moe/api/control/{provider}/connection` endpoint. The control plane stores the session encrypted and uses its private server adapter. Raw credentials are never saved in extension storage, placed in the DOM, copied to the clipboard, or logged.

## Chrome / Chromium

Load this directory through `chrome://extensions` → Developer mode → Load unpacked. The default manifest is the Chrome build.

## Firefox / LibreWolf

Use the Firefox package, whose `manifest.json` is generated from `manifest.firefox.json`. For a temporary development install, open `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → choose that `manifest.json`. Temporary installations disappear when the browser restarts. Persistent Firefox distribution requires Mozilla signing; this package has not been signed or published.

## Connect

1. Sign in to `morisoba.moe/control/` and X or Instagram in the same browser's default profile. Refresh the control-plane tab after installing the extension.
2. Open the extension and click **connect x** or **connect instagram**. Grant access to that service when prompted. The extension does not need access to other sites.
3. Optionally enable **keep sessions connected** to check for changed session cookies while a signed-in control-plane tab is open. Only providers you have explicitly connected are eligible. Disable this checkbox to stop background synchronization.

The extension stores only the enabled-provider list, the automatic-sync preference, and one-way session fingerprints used to avoid repeated uploads. It cannot read cookies in another browser/profile or Firefox container. It does not bypass account checks. A service may reject a valid browser session on the server adapter; extraction alone does not prove that feeds or messages work. Safari is not packaged.

Validation: mocked browser-API and content-script checks; no real account cookies were read and no real account connection was tested. Install-time permissions and live session acceptance still need browser verification.
