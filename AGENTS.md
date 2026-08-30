# AGENTS.md

## Workflow conventions

- After any source change (src/), always rebuild the Android APK so the user can install and verify. The APK is the only way to test changes (it is built from `bundle/`, not `src/` directly).
  - Build command (run from repo root):
    - `export PATH="/home/betaflight/node-v25/bin:/home/betaflight/gradle/bin:/mnt/c/Users/5600G/AppData/Roaming/npm:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"`
    - `export ANDROID_HOME=/home/betaflight/android-sdk`
    - `export ANDROID_SDK_ROOT=/home/betaflight/android-sdk`
    - `pnpm gulp redist --platform android`  (the `redist` task already runs clean steps internally)
  - The gradle path is `/home/betaflight/gradle/bin` (NOT `gradle-8.10/bin`).
  - Do NOT reference `$PATH` in `export` lines — the inherited PATH contains parentheses (`Program Files (x86)`) that break shell `eval`. Use an explicit absolute PATH list.
  - Verify the result APK at `redist/rf-cordova.apk` (version should be a real release like `2.3.5`, not `0.0.0`).
- See `apkbuild.md` for the full APK build/verify guide.
