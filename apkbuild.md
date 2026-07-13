# Rotorflight Configurator APK 빌드 가이드 (Cordova)

Cordova 기반 Android APK 빌드 가이드.
Capacitor/NW.js 없이 Cordova 전용으로 구성되어 있습니다.

## 필수 요구사항

| 도구        | 버전                       | 확인                                        |
| ----------- | -------------------------- | ------------------------------------------- |
| Node.js     | >= 22.0.0                  | `node --version`                            |
| pnpm        | >= 11.0.0                  | `pnpm --version`                            |
| Java JDK    | 21                         | `java -version`                             |
| Android SDK | API 35, Build Tools 35.0.0 | `ls $ANDROID_SDK_ROOT/platforms/android-35` |
| Gradle      | 8.10+                      | `gradle --version`                          |

### 환경 변수

```bash
export ANDROID_SDK_ROOT=/home/betaflight/android-sdk
export PATH=$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools
export PATH=$PATH:/home/betaflight/gradle/gradle-8.10/bin
```

## 빌드 방법

### 1. 의존성 설치 (최초 1회)

```bash
cd /home/betaflight/rfconfigurator
pnpm install --frozen-lockfile
```

### 2. APK 빌드

**릴리즈 APK (redist에 복사):**

```bash
pnpm gulp redist --platform android
```

**APK만 빌드 (redist 복사 없음):**

```bash
pnpm gulp app --platform android
```

**디버그 APK (서명 불필요):**

```bash
pnpm gulp app --platform android --debug
```

### 3. 출력 경로

```
redist/rf-cordova.apk              # 최종 APK (리네임 + redist 복사)
app/android/platforms/android/app/build/outputs/apk/release/app-release.apk
app/android/platforms/android/app/build/outputs/apk/debug/app-debug.apk
```

## 설치

```bash
adb install redist/rf-cordova.apk
```

## 빌드 프로세스

| 단계 | 태스크                       | 설명                         |
| ---- | ---------------------------- | ---------------------------- |
| 1    | `clean_app`                  | 이전 app/ 삭제               |
| 2    | `clean_bundle`               | 이전 bundle/ 삭제            |
| 3    | `bundle_vite`                | Vite로 웹 번들 생성          |
| 4    | `bundle_src`                 | 소스 리소스 복사             |
| 5    | `bundle_deps`                | 프로덕션 의존성 설치         |
| 6    | `cordova_copy_www`           | 웹 번들을 Cordova www로 복사 |
| 7    | `cordova_resources`          | 안드로이드 리소스 복사       |
| 8    | `cordova_include_www`        | www 디렉토리 설정            |
| 9    | `cordova_copy_src`           | Cordova 소스 복사            |
| 10   | `cordova_rename_src_config`  | config.xml 템플릿 적용       |
| 11   | `cordova_rename_src_package` | package.json 템플릿 적용     |
| 12   | `cordova_packagejson`        | 패키지 메타데이터 설정       |
| 13   | `cordova_configxml`          | config.xml 변수 치환         |
| 14   | `cordova_deps`               | Cordova 의존성 설치          |
| 15   | `cordova_build`              | Gradle로 APK 빌드            |

## 디렉토리 구조

```
rfconfigurator/
├── gulpfile.mjs              # 빌드 스크립트
├── vite.config.mjs           # Vite 번들러 설정
├── package.json              # 의존성
├── index.html                # 웹 진입점
├── src/                      # 소스 코드
├── cordova/                  # Cordova 템플릿
│   ├── config_template.xml   # Cordova 설정 템플릿
│   ├── package_template.json # Cordova 패키지 템플릿
│   ├── build.json            # 서명 설정
│   ├── release.jks           # 릴리즈 키스토어
│   └── plugins/              # Cordova 플러그인
├── public/                   # 정적 리소스
├── assets/android/           # Android 리소스
├── locales/                  # i18n 번역
└── libraries/                # Vendor 라이브러리
```

## 참고

- BLE가 포함된 APK를 빌드하려면 `cordova/package_template.json`에 `cordova-plugin-rfc-nordic-ble` 플러그인이 포함되어 있어야 합니다.
- APK 버전은 `package.json`의 `version` 필드로 관리됩니다.
- 릴리즈 빌드는 `cordova/build.json`의 keystore 정보로 서명됩니다.



이 문서에서 가장 중요한 사항으로 코드 수정 중 수시로 아래 내용을 기억해내고 따른다.

코드 수정 할때 주의 사항

1. 빌드가 목표가 아니라 기능 구현이 목표. 빌드 에러를 자의적으로 판단하여 수정하지 않는다.

2. 사용자의 지시 사항이 현 코드 내용에 적합하지 않으면 사용자에게 이유설명 -> 대안 제시 -> 사용자 확인 후 작업한다. 빌드 에러의 경우도 이유 -> 대안 -> 사용자 확인 후에 진행한다

3. 지시서는 정확하게 따른다. 코드위치 ( 줄 수)는 코드를 수정중이므로 빈번하게 다를 수 있다.

4. 자의적 코드 수정, 코드 적용은 금지한다.

5. 사용자가 제시한 지시문의 코드 줄이나 저장소는 틀릴수 있다. 이건 코드 내용을 보고 찾으면 된다.

   코드 저장소는 현재 작업 디렉토리이다. 만약 사용자가 저장소를 지정하며 작업을 지시한 경우 따른다.

   
