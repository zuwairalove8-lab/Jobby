# JOBBY on Android

- Package id: `com.jobby.app`
- Wrapper: Capacitor 8 (`@capacitor/android`)
- Web assets: bundled from `dist/` into `android/app/src/main/assets/public`
- The app loads the local bundle; it does not redirect to a hosted site.

## Debug APK via GitHub Actions

`.github/workflows/android-apk.yml` runs on pushes to `main` (paths filtered) and
on `workflow_dispatch`:

1. Node 22 + Temurin JDK 21 + Android SDK.
2. `npm ci` → `npm run build` (injects `VITE_*` repository secrets).
3. `npm run icons` → `npx cap sync android`.
4. `./gradlew assembleDebug` using the **committed** Gradle wrapper.
5. Uploads `jobby-debug-apk` (30 days).

Required repository secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Optional: `VITE_BROWSER_WORKER_URL`, `VITE_APP_ORIGIN`.

## Local build

Prerequisites: JDK 21 and Android SDK 35 with `ANDROID_HOME` set.

```bash
npm ci
npm run build
npm run icons
npx cap sync android
cd android && ./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

Open in Android Studio with `npx cap open android`. After changing web code,
re-run `npm run build && npx cap sync android` (or `npm run apk`).

## Signed release (separate from CI)

Debug APKs are unsigned and not for distribution. For a Play Store build:

1. Create a keystore once and keep it out of the repo:

   ```bash
   keytool -genkeypair -v -keystore jobby-release.keystore \
     -alias jobby -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Base64 the keystore and add repository secrets:
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
   `ANDROID_KEY_PASSWORD`.

3. In a release job (not enabled by default), decode the keystore, write
   `android/keystore.properties`, and add a `signingConfigs.release` block that
   reads those properties — never hardcode paths or passwords.

4. Build with `./gradlew bundleRelease` and upload the `.aab`.

5. Bump `versionCode`/`versionName` in `android/app/build.gradle` for every
   release.

Until those secrets exist, JOBBY intentionally ships only a debug APK.

## Behaviour notes

- `capacitor.config.ts` sets `androidScheme: 'https'`, so the WebView origin is
  `https://localhost`. Add that origin (and your hosted origins) to Supabase Auth
  redirect URLs.
- The service worker is not registered inside the native shell — the bundle is
  already local.
- Voice input uses the Web Speech API; availability depends on the WebView and
  the platform's speech service, so the microphone only renders when supported.
- Printing a CV opens the system print sheet on Android; if unavailable, CV
  Studio falls back to downloading an HTML copy.
