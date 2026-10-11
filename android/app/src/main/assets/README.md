# CAP Inventory — browser PWA

This folder is the static GitHub Pages site. It stores no CAPWATCH records or credentials on GitHub.

The public site can be installed from Chrome/Safari and works offline after initial loading. The barcode scanner supports Code 39 labels. Local equipment data and photographs are encrypted in IndexedDB using a key derived from the eServices password.

**Important:** GitHub Pages PWA authentication requires CORS permission from CAPWATCH, which has not been verified. Browsers may block the direct API call. The Android APK project in `../android` bundles these same site files and uses native Android HTTPS networking to CAPWATCH (avoiding browser CORS). There is no proxy/backend. Manual import of a CAPWATCH ZIP is available only as a fallback.

Offline vault unlock is not real-time CAPWATCH authentication. An eServices password change can make cached data inaccessible: export encrypted backup first. GitHub Pages apps under the same `username.github.io` hostname share a storage origin; for CAPWATCH equipment data a private native APK or an isolated domain is preferable.
