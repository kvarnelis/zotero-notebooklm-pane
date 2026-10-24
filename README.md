# NotebookLM Pane for Zotero

NotebookLM Pane embeds Google NotebookLM in Zotero's item pane. Keep a notebook beside an item or expand it to fill the right pane, then return to Zotero's metadata and notes when you need them.

This is an independent add-on. It does not require an AI command-line tool, a separate local server, or any other add-on from this author.

## Install

Current version: **0.4.4**. Supported target: **Zotero 9.x and 10.0.x on macOS**. No companion add-on is required.

1. Download [`zotero-notebooklm-pane.xpi`](https://github.com/kvarnelis/zotero-notebooklm-pane/releases/latest/download/zotero-notebooklm-pane.xpi) from [Releases](https://github.com/kvarnelis/zotero-notebooklm-pane/releases).
2. In Zotero, open the Add-ons Manager and choose **Install Add-on From File…**.
3. Select the XPI and restart Zotero.

After this version is installed, Zotero can check this repository's `updates.json` for future releases. Downloading and installing a newer XPI manually also works.

## Setup

Open the NotebookLM pane and sign in to Google inside it. The session is kept in Zotero across restarts. Internet access and a Google account with access to NotebookLM are required. No separate API key or command-line runtime is used.

## Use

The framed notebook button toggles the full-pane view. The compact **NotebookLM** section shows the same session alongside Zotero's metadata and notes; its expand button moves the session to the full pane. You can enable or disable either surface in **Settings → NotebookLM Pane**.

To send a PDF, right-click a Zotero item and choose **Send PDF to NotebookLM**. The add-on opens the Add sources dialog and copies the first PDF's local path. Finish the upload in NotebookLM:

1. Choose **Upload files**.
2. Press `Cmd-Shift-G`, paste the copied path, and press Enter.
3. Repeat for additional PDFs as needed.

Dragging a parent item into NotebookLM's upload dialog can also supply its PDF attachments. The attachment files must be present on this computer. Uploads go to Google's service and remain subject to NotebookLM's current limits.

## Limits

This is an embedded browser integration, not an official NotebookLM API client. Google login and interface changes can affect it. A Firefox user agent is supplied to the embedded browser for compatibility. The current implementation and upload instructions target macOS; other operating systems have not been verified.

The extracted preference tests pass. The predecessor build received Zotero 10.0.6 startup and pane-registration checks; Google sign-in and a full upload were not repeated for this standalone packaging change. This add-on is not affiliated with or endorsed by Google or Zotero.

## Build and check

Building requires a Unix shell, `zip`, and Python 3. Syntax checks and any included unit tests require Node.js. End users installing an XPI do not need these developer tools.

```sh
./scripts/build.sh
./scripts/test.sh
```

The package is written to `dist/zotero-notebooklm-pane.xpi`. The build also regenerates `updates.json` with the package's SHA-256 hash and versioned release URL. To publish an update, change the version in `manifest.json`, build and check, commit the new update manifest, and attach that exact XPI to release `v<version>`.

Keep examples synthetic. Do not commit library exports, conversations, personal configuration, or screenshots containing private material.

## License

No repository-wide license has been specified. Author attribution is retained in the add-on manifest.
