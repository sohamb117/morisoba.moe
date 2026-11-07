# morisoba connections

Reads your signed-in X or Instagram session when you click its connect button. Sends only `auth_token` + `ct0` (X), or `sessionid` (Instagram), to the corresponding authenticated `https://morisoba.moe/api/control/{provider}/connection` endpoint. The control plane stores the session encrypted and uses its private server adapter. Raw credentials are never saved in extension storage, placed in the DOM, copied to the clipboard, or logged.

## Chrome / Chromium

Load this directory through `chrome://extensions` → Developer mode → Load unpacked. The default manifest is the Chrome build.

## Firefox / LibreWolf

Use the Firefox package, whose `manifest.json` is generated from `manifest.firefox.json`. For a temporary development install, open `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → choose that `manifest.json`. Temporary installations disappear when the browser restarts. Persistent Firefox distribution requires Mozilla signing; this package has not been signed or published.

## Safari (Mac)

Use the Safari package. In Safari Settings → Advanced, enable “Show features for web developers” if the Developer tab is not visible. Then Developer → Add Temporary Extension → select the unpacked Safari folder (or ZIP), and approve the unsigned-extension prompt. Enable the extension and allow it on morisoba.moe. Grant X or Instagram access when clicking its connect button.

Safari removes a temporary extension after 24 hours or when Safari quits. A persistent signed app requires full Xcode and signing setup; only Command Line Tools are installed on this Mac. No unsigned-extension setting has been enabled automatically.

Apple instructions: https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension

## Updating

Version 0.1.2 resolves Safari cookie stores from open tab IDs and includes a named-cookie fallback. Replace the old extension folder with this build, then use Safari Settings → Extensions → Reload for the temporary extension (or remove and re-add it). Grant the requested website access and reload the service and control-plane tabs.

## Connect

1. Sign in to `morisoba.moe/control/` and X or Instagram in the same browser profile. Refresh the control-plane tab after installing the extension.
2. Open the extension and click **connect x** or **connect instagram**. Grant access to that service when prompted. The extension does not need access to other sites.
3. Optionally enable **keep sessions connected** to check for changed session cookies while a signed-in control-plane tab is open. Only providers you have explicitly connected are eligible. Disable this checkbox to stop background synchronization.

The extension stores only the enabled-provider list, the automatic-sync preference, and one-way session fingerprints used to avoid repeated uploads. It selects the cookie store belonging to the open service tab and sends the session only to a control-plane tab in the same store. It does not scan unrelated profiles. It does not bypass account checks. A service may reject a valid browser session on the server adapter; extraction alone does not prove that feeds or messages work. Safari 18 or later supports the required HttpOnly cookie access; Safari 26.3 is installed on this Mac. Safari cookie-change events are not relied on; automatic sync uses the five-minute alarm and control-plane sign-in notification.

Validation: mocked browser-API and content-script checks; no real account cookies were read and no real account connection was tested. Install-time permissions and live session acceptance still need browser verification.
