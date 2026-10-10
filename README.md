# CAP Equipment Inventory — PWA (GitHub Pages)

Installable, offline-capable Civil Air Patrol equipment inventory website. This repository contains **application code only**: no CAPWATCH datasets, passwords, equipment records, scans, inventory reports, photos, or backups.

## App

- Installs from `https://srg9832.github.io/CAPInventory/` using Chrome > Install app / Add to Home Screen (or iOS Safari > Share > Add to Home Screen).
- Authenticates to CAPWATCH directly from device via HTTPS **only if CAPWATCH permits browser CORS access**. GitHub Pages cannot override CAPWATCH's cross-origin restrictions. This direct login is **not yet proven functional**.
- Adds an experimental direct CAPWATCH browser navigation as an alternative when CORS blocks JavaScript requests. Browser navigation itself is not subject to CORS. If the CAPWATCH API responds with an HTTP Basic authentication challenge and ZIP, the user can save it to the device, then select it inside the app. This is **not yet verified** against a CAPWATCH login and it is not automatic importing.
- Has device-only ZIP picker fallback. The ZIP is parsed locally in memory. No CAPWATCH data is sent to GitHub, a proxy, or any server.
- Saves local encrypted equipment records, inventory history and scanned tag photos in IndexedDB (PBKDF2 SHA-256 + AES-256-GCM). Never stores the eServices password. The password used at initial local setup also unlocks the same vault offline.
- Scans Code 39 barcode labels with the phone camera; records a photo, timestamp, matched/not-scanned status and local history. Includes manual input and CSV/encrypted backup.
- Uses `equipment.txt` and `equipment_hst.txt` as text fields, preserving identifiers exactly. Org IDs mapped manually to charter numbers.

## Security limitations

- The login source is delivered from a **public GitHub Pages origin**. Your `srg9832.github.io` pages share the same browser origin and may share browser storage with other repo sites in that domain. **A dedicated custom domain for this inventory app is strongly advised** before real CAPWATCH credentials or sensitive data.
- Encryption protects records at rest, but the active app can access decrypted records after login; a compromised app origin/device/browser could expose them.
- Offline PIN/password unlock isn't live eServices verification; the app cannot confirm current permissions offline.
- Changing your eServices password makes the previous local vault password invalid, unless you retain the old password or restore an encrypted backup.
- Removing the installed app or clearing website data can delete local inventory records. Export encrypted backups regularly. CSV export is **unencrypted**; handle it as CAPWATCH-sensitive information.

## Direct CAPWATCH networking

Browser request is sent only to `https://www.capnhq.gov/CAP.CapWatchAPI.Web/api/cw?ORGID=…&unitOnly=…`, using a request Authorization header. The website cannot bypass the API's CORS policy or run PowerShell. **Do not enter real credentials until the deployed site and CORS behavior are verified and the CAPWATCH information-security requirements are satisfied.**

## Development

This is a static website (`index.html`, `app.js`, `scanner.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/` and vendored JSZip 3.10.1 under `vendor/`). Serve with HTTPS to enable camera and service worker features. JSZip is licensed under MIT/GPLv3; attribution is at `vendor/jszip_LICENSE.md`.