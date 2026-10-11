# CAP Inventory - Android field application

Private, offline Android equipment inventory with native CAPWATCH HTTPS downloading and local encrypted storage. For one inventory operator initially; no accounts, sync services, Supabase, or CAPWATCH data in GitHub.

## Build

Open `android/` in Android Studio (JDK 17, Android SDK 35). Build `:app:assembleDebug`, or use GitHub Actions → **Build Android APK** to download an installable test APK.

## Use

1. Install Android APK on your phone.
2. Enter your **numeric CAPID** (not email), eServices password, authorized ORGID, and operator name. CAPWATCH ZIP is fetched directly to this phone over HTTPS, with no proxy. First-run local vault is created only after the authenticated CAPWATCH response succeeds.
3. Select a unit, map ORGID to `RMR-MT-001`-style charter numbers, start an inventory, and scan Code 39 equipment tags. Each scan logs a timestamp, matching result, and encrypted image of the tag.
4. Equipment not yet scanned stays in the outstanding list. Tap an item for original CAPWATCH transaction history and inventory scan photos.
5. Export CSV and **encrypted backups**; they remain on the phone until you explicitly choose a save destination. No automatic uploads.

## Storage and security

The Android app bundles static HTML/CSS/JS privately using `WebViewAssetLoader`. The native `WebViewClient` intercepts only `/capwatch-api/cw` requests, forwards validated requests directly to `https://www.capnhq.gov/CAP.CapWatchAPI.Web/api/cw` over HTTPS with Basic authentication, and streams the response back into its locally bundled WebView. No public backend. The app accepts no redirects to protect the Authorization header.

The app uses Web Crypto AES-256-GCM and PBKDF2 (350,000 rounds) for the locally stored equipment list, history, scans and image blobs in the app WebView's private IndexedDB. The provided eServices password serves as the **local vault passphrase**; it is not stored. **Changing your eServices password does not automatically re-encrypt the vault**. Export an encrypted backup before changing your password and reinitialize the app if needed. Offline unlock checks the local passphrase, not live eServices authorization.

Android app backups are disabled; screenshots are blocked; HTTP cleartext is disallowed. Both CAPWATCH data and photos remain on the phone. However CSV exports are not encrypted—handle them carefully. Avoid sharing screenshots that show the Base64 Authorization header because it contains recoverable credentials.

This is a testing/debug build, not a CAP-certified system. Verify the direct CAPWATCH connection and actual camera functionality on your phone before depending on it in the field. No real credentials or CAPWATCH data should ever be committed to GitHub.
