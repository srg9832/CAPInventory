# CAP Inventory v0.7 — scan responsiveness and encrypted scan journal

- Camera frame freezes immediately after a confirmed barcode and capture flash displays **before** JPEG encoding.
- Photo JPEG conversion and encryption continue with visible processing/saving feedback.
- Encrypted scan events are now separate IndexedDB records rather than re-encrypting the entire CAPWATCH equipment/history database after every barcode.
- v0.6 encrypted inventory state and encrypted backups remain compatible; on first unlock, existing scan records migrate safely to the new event store.
- ZIP reimports reconcile both in-memory scans and their individual encrypted records; backup/restore and deleting false exceptions handle the new event store.
- Only code is published to GitHub. CAPWATCH ZIPs, password and inventory data remain on the phone.
- Android version 0.7.0 (versionCode 7). GitHub CI debug APK is not reliably signed with the same key as v0.6. Export an encrypted backup **before** uninstalling v0.6.

# CAP Equipment Inventory — GitHub Pages + Native Android

Two front ends, sharing exactly the same on-device inventory code:

- `site/`: installable GitHub Pages PWA (HTML/CSS/JS, Code 39 scanner). The browser version's authenticated CAPWATCH download may be blocked by the API's CORS policy. Manual ZIP picker remains available as a fallback.
- `android/`: Android Studio (Kotlin) APK project, with the same static site **bundled inside the APK** and an Android WebViewAssetLoader HTTPS interceptor for CAPWATCH. It sends **CAPID/password straight from the phone to the CAPWATCH HTTPS endpoint**, not to a proxy or GitHub. The HTTPS interceptor accepts only the single `/capwatch-api/cw` route with validated ORGID/unitOnly, refuses redirects, and streams ZIP directly into WebView memory for parsing. Both internet and camera runtime permissions included.

## Privacy

**No private CAPWATCH files, equipment database, names, passwords, photos, inventory exports or backups are included in this repository.** GitHub Pages hosts the program only. Android APK also bundles program code only; the device fetches authorized data on demand. Data in IndexedDB is protected using Web Crypto AES-GCM; the KDF derives the key from the provided eServices password without storing that password. Only the entered CAPID is retained as a property inside the encrypted vault. Offline unlock is possible using the *same password* as last used to initialize the vault, but offline unlock is not real-time CAPWATCH authentication. Changing the eServices password can make the local vault inaccessible unless exported and restored through a protected backup before changing it.

**Security caveats:** Web applications on the same GitHub Pages `username.github.io` origin can share browser storage regardless of repository path. For sensitive CAPWATCH material, use the bundled Android APK (separate app origin) or a website under a dedicated isolated hostname. PWA site must be considered a CORS-dependent demonstration until verified; never send CAPID/password through a third-party CORS proxy. APK source and behavior need review before use with actual credentials. Debug APK is not release-signed for official deployment. Confirm CAP information protection requirements.

## Native app use

1. Open `android/` in Android Studio. Let Gradle sync (JDK 17, Android SDK Platform 35) and build `:app:assembleDebug`. An unsigned-for-distribution debug APK is created under `android/app/build/outputs/apk/debug/`.
2. Alternatively, push this repository and open **Actions → Build Android APK → Run workflow**. Download the successful run's `CAP-Inventory-Android-debug` artifact. GitHub receives only **source code and compiled APK**, no inventory data or passwords.
3. Install it on Android (requires sideload permission). Start the app, supply CAPID/password + authorized ORGID. CAPWATCH ZIP is downloaded directly to the device over HTTPS, parsed locally. Grant camera permission to scan and photograph tags.
4. Use the same CAPID/password offline to unlock the encrypted local database. Create inventory sessions, select unit, and export encrypted backup/CSV with the Android file-save picker.

## GitHub Pages website

1. Create a **new dedicated repository** `CAPInventory` in your GitHub account. Do not put this project into another CAP application repository.
2. Upload this repository's `site/`, `android/`, `.github/workflows/` and `README.md` (not CAPWATCH data).
3. In Settings → Pages set Source to **GitHub Actions**. Workflow `Publish inventory website` serves `site/` at `https://USERNAME.github.io/CAPInventory/`.
4. Chrome Android: ⋮ → Install app. PWA app works offline after first load. Browser CAPWATCH authentication will work only if the CAPWATCH API permits its origin (CORS). If not, **the native Android APK** (above) provides direct authenticated access without a server.

## Technical notes

- Code 39 label example is `CAP2050354`; on a scan the barcode, photo, timestamp and result are stored inside local vault/photos stores.
- CAPWATCH datasets: `equipment.txt`, `equipment_hst.txt`; preserves each column as text. Manual ORGID-to-charter mapping, e.g. `RMR-MT-001`.
- No Supabase, backend, shared inventory or public data uploads.
- Local encrypted data is device/browser specific. Backups are needed to guard against app uninstall or browser storage eviction.

## v0.6 continuous native scanner

- ML Kit decodes offline Code 39/128, and a unique exact match against local CAPWATCH equipment is accepted on the first ML Kit read. Unknown barcode values still require repeated reads and operator confirmation.
- Camera remains active after each scan; a different tag can be read without restarting. Already-verified tags do not create duplicate inventory events or photos.
- Visual feedback: capture flash only when a JPEG photo has actually been captured; saving status while the photo and scan are encrypted and stored; verified/review notices. If encryption takes time, the camera preview remains visible but automatic reads pause until persistence completes.
- Native frame decoding uses a smaller JPEG to reduce CPU load. Saved tag photos retain the higher resolution capture.
- Local test: `node tests/continuous-scan.test.cjs`. Build APK: `cd android && gradle :app:assembleDebug` or run the GitHub Actions workflow.
