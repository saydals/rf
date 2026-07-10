# Rotorflight Configurator APK 빌드 가이드

## 빌드 개요

이 프로젝트는 Cordova 기반 안드로이드 APK 빌드를 지원한다. 빌드 시스템은 Gulp를 사용하며, 아래 명령으로 디버그/릴리즈 APK를 생성할 수 있다.

## 필수 요구사항

### 1. Node.js (>= 24.0.0)
- 권장: `fnm` (Fast Node Manager) 사용
- `.nvmrc` 참고: `v25.6.1`

```bash
# fnm 설치
curl -fsSL https://fnm.vercel.app/install | bash

# Node.js 설치 및 사용
fnm install 25.6.1
fnm use 25.6.1
```

### 2. pnpm (>= 11.0.0)

```bash
npm install -g pnpm@11
```

### 3. Java JDK (21 이상)
- OpenJDK 21 권장
- `javac`가 PATH에 있어야 함

```bash
java -version  # 확인
javac -version  # 확인
```

### 4. Android SDK
- 최소 SDK: 24 (Android 7.0)
- 타겟 SDK: 35 (Android 15)
- 컴파일 SDK: 35
- 빌드 툴: 35.0.0

```bash
# Android SDK 경로 설정
export ANDROID_HOME=/home/betaflight/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
```

### 5. Gradle (8.x)
- cordova-android 14.x와 호환되는 Gradle 버전 필요
- Gradle 8.10 권장

```bash
# Gradle 설치 (예: /home/betaflight/gradle/)
cd /tmp
curl -fsSL https://services.gradle.org/distributions/gradle-8.10-bin.zip -o gradle.zip
mkdir -p /home/betaflight/gradle
unzip -q gradle.zip -d /home/betaflight/gradle
export PATH=/home/betaflight/gradle/gradle-8.10/bin:$PATH
```

### 6. Android SDK 라이선스 수락

```bash
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

## 빌드 환경 변수 설정

매 빌드 전에 다음 환경 변수를 설정해야 한다:

```bash
# Node.js/fnm
export PATH="/home/betaflight/.local/share/fnm:$PATH"
eval "$(fnm env --shell bash)"

# Android SDK
export ANDROID_HOME=/home/betaflight/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# Gradle
export PATH=/home/betaflight/gradle/gradle-8.10/bin:$PATH
```

## 의존성 설치 (최초 1회 / 패키지 변경 시)

```bash
cd /home/betaflight/rfconfigurator
pnpm install --frozen-lockfile
```

## APK 빌드 명령

### 디버그 APK (서명 불필요, adb install 용)

```bash
cd /home/betaflight/rfconfigurator
make android
```

또는

```bash
pnpm gulp debug --platform android
```

출력 경로:
```
app/android/platforms/android/app/build/outputs/apk/debug/app-debug.apk
```

### 릴리즈 APK (서명 포함, 배포 용)

릴리즈 빌드는 `build.json`의 keystore 정보로 서명된다:

```bash
pnpm gulp app --platform android
```

출력 경로:
```
app/android/platforms/android/app/build/outputs/apk/release/app-release.apk
```

> ⚠️ `pnpm gulp build --platform android` 명령은 존재하지 않는다. `build` 대신 `app` 태스크를 사용한다.

## 디바이스에 설치

```bash
adb install app/android/platforms/android/app/build/outputs/apk/debug/app-debug.apk
adb install app/android/platforms/android/app/build/outputs/apk/release/app-release.apk
```

> 디바이스가 연결되지 않은 상태에서 `make android` 실행 시 `run_debug_cordova` 태스크는 실패하지만, **APK 자체는 정상 생성**된다. 별도로 `adb install`로 설치하면 된다.

## 빌드 프로세스 상세

`make android` (디버그)은 다음 단계를 순차적으로 실행한다:

| 단계 | 태스크 | 설명 |
|------|--------|------|
| 1 | `set_debug_flavor` | 디버그 플래그 설정 |
| 2 | `clean_app` | 이전 빌드 정리 |
| 3 | `clean_bundle` | 번들 정리 |
| 4 | `bundle_vite` | Vite로 웹 번들 생성 |
| 5 | `bundle_src` | 소스 리소스 복사 |
| 6 | `bundle_deps` | 프로덕션 의존성 설치 |
| 7 | `cordova_copy_www` | 웹 번들을 Cordova www로 복사 |
| 8 | `cordova_resources` | 안드로이드 리소스 복사 |
| 9 | `cordova_include_www` | Cordova 스크립트 포함 |
| 10 | `cordova_copy_src` | Cordova 소스 복사 |
| 11 | `cordova_rename_src_config` | config.xml 이름 변경 |
| 12 | `cordova_rename_src_package` | package.json 이름 변경 |
| 13 | `cordova_packagejson` | 패키지 정보 주입 |
| 14 | `cordova_configxml` | config.xml 템플릿 변수 치환 |
| 15 | `cordova_deps` | Cordova 의존성 설치 |
| 16 | `cordova_build` | Gradle로 APK 빌드 |
| 17 | `run_debug_cordova` | 디바이스에 설치 시도 (옵션) |

릴리즈 빌드(`pnpm gulp app --platform android`)는 위 단계 중 `set_debug_flavor`가 제외되며, Gradle이 `cdvBuildRelease` 태스크를 실행한다.

## 알려진 이슈 및 해결

### 1. versionCode가 0으로 설정되는 문제

**증상:**
```
FAILURE: Build failed with an exception.
> android.defaultConfig.versionCode is set to 0, but it should be a positive integer.
```

**해결:** `gulpfile.mjs`의 `cordova_build` 함수에서 `--versionCode`를 Gradle에 직접 전달:
```javascript
await cordova.build({
  platforms: ["android"],
  options: {
    release: context.target.flavor !== "debug",
    buildConfig: "build.json",
    argv: ["--versionCode", "13"],
  },
});
```
빌드 명령행에 `-PcdvVersionCode=13`이 자동 추가된다.

### 2. Gradle 미설치 문제

**증상:**
```
Could not find an installed version of Gradle either in Android Studio,
or on your system to install the gradle wrapper.
```

**해결:** 시스템에 Gradle을 별도 설치하고 PATH에 추가한다. (상단 "필수 요구사항" 참고)

### 3. cordova_deps frozen lockfile 실패

**증상:**
```
Error: Command failed: pnpm install --prod --frozen-lockfile --node-linker=hoisted
```

**원인:** `app/android/pnpm-lock.yaml`이 `cordova/package_template.json`의 변경사항을 반영하지 못함

**해결 방법 A (사전 준비):**
```bash
cd app/android
pnpm install --no-frozen-lockfile --node-linker=hoisted
```

**해결 방법 B (gulpfile 수정):**
`gulpfile.mjs`의 `cordova_deps` 함수에서 `--frozen-lockfile`을 `--no-frozen-lockfile`로 변경:
```javascript
// before
"pnpm install --prod --frozen-lockfile --node-linker=hoisted"
// after
"pnpm install --prod --no-frozen-lockfile --node-linker=hoisted"
```

### 4. Android Manifest merger 충돌

**증상:**
```
Manifest merger failed with multiple errors, see logs
```

**원인:** `cordova/config_template.xml`에 BLE 권한을 명시적으로 선언했는데,
`cordova-plugin-ble-central` v2.0.0이 자체적으로 동일 권한을 추가하여 중복 충돌 발생.

**해결:** `config_template.xml`에서는 BLE 권한을 선언하지 않는다.
플러그인이 다음 권한을 자동으로 처리하므로 명시적 선언이 불필요:
- `android.permission.BLUETOOTH` (maxSdkVersion 30)
- `android.permission.BLUETOOTH_ADMIN` (maxSdkVersion 30)
- `android.permission.ACCESS_FINE_LOCATION` (maxSdkVersion 30)
- `android.permission.ACCESS_COARSE_LOCATION` (maxSdkVersion 28)
- `android.permission.BLUETOOTH_SCAN` (usesPermissionFlags="neverForLocation")
- `android.permission.BLUETOOTH_CONNECT`

`<uses-feature android:name="android.hardware.bluetooth_le">` 만 선언하면 된다.

### 5. nopt TypeError: args.slice is not a function

**증상:** `cordova.build()` 호출 시 발생

**해결:** `argv`를 객체가 아닌 **배열 형태**로 전달:
```javascript
argv: ["--versionCode", "13"]   // ✅ 배열
// argv: { versionCode: 13 }     // ❌ 객체 (TypeError 발생)
```

### 6. run_debug_cordova 실패 (디바이스 미연결)

**증상:** `make android` 마지막 단계에서 `run_debug_cordova`가 실패하지만, 앞선 `cordova_build`는 성공함

**해결:** APK는 정상 생성되었으므로 무시. 별도로 `adb install` 실행:
```bash
adb install app/android/platforms/android/app/build/outputs/apk/debug/app-debug.apk
```

## BLE 빌드 참고사항

BLE GATT 기능이 포함된 APK를 빌드할 때의 특이사항:

- `cordova/package_template.json`에 `cordova-plugin-ble-central` 추가 필수
- `cordova/config_template.xml`에 `<uses-feature android:name="android.hardware.bluetooth_le" />` 추가 필수
- BLE 권한은 플러그인이 자동 처리하므로 템플릿에 중복 선언 금지
- `app/android/` 디렉토리의 lockfile도 함께 업데이트 필요

## 릴리즈 서명 설정

`app/android/build.json`:
```json
{
  "android": {
    "release": {
      "keystore": "release.jks",
      "storePassword": "rotorflight",
      "alias": "rotorflight",
      "password" : "rotorflight",
      "packageType": "apk"
    }
  }
}
```

릴리즈 빌드는 keystore가 없으면 실패하므로, 개발 중에는 디버그 빌드(`make android`)를 권장.

## 버전 관리

APK 버전은 `package.json`의 `version` 필드로 관리된다. 빌드 전 올바른 버전을 설정해야 한다.

```bash
# 버전 설정
make version SEMVER=2.2.0

# 또는 직접 package.json 수정
sed -i 's|"version": *".*"|"version": "2.2.0"|' package.json
```

### version 0.0.0 문제

`version`이 `0.0.0`이면 앱 실행 시 다음과 같은 개발 버전 경고가 표시된다:
```
You are using a development version of the Rotorflight Configurator.
```

이는 `src/js/main.js:418`에서 `CONFIGURATOR.version.startsWith("0.0.0")` 검사를 수행하기 때문.
실제 릴리즈/테스트 시에는 반드시 적절한 버전(`2.2.0`, `2.3.0` 등)을 설정 후 빌드할 것.

## 참고 파일

- `Makefile` - 빌드 타겟 정의
- `gulpfile.mjs` - 빌드 파이프라인 정의
- `cordova/config_template.xml` - Cordova 앱 설정 템플릿
- `cordova/package_template.json` - Cordova 패키지 의존성
- `cordova/build.json` - 안드로이드 빌드/서명 설정
