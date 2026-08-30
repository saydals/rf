# APK 빌드 및 소스 수정 반영 가이드

Rotorflight Configurator (Android Cordova APK)에서 **소스를 고쳤는데 빌드된 APK에 반영되지 않는 현상**의 원인과 해결법, 그리고 빌드 방법을 정리한 메모.

---

## 1. 증상

- profiles 탭의 yawStopGainCW / yawStopGainCCW(CW/CCW Stop Gain) 하한값을
  src/tabs/profiles.html 에서 min="25" -> min="0" 으로 풀었는데,
  빌드된 rf-cordova.apk 에서는 여전히 25 미만을 입력할 수 없다.
- 펌웨어(FC) 쪽은 CLI로 25 미만 값을 받아들이므로 펌웨어 문제는 아니다.

---

## 2. 원인 (가장 중요)

### 2.1 APK는 src/ 가 아니라 bundle/ 복사본을 기반으로 빌드된다

APK 빌드 파이프라인:

    src/tabs/profiles.html
         |  (vite build)
         v
    bundle/src/tabs/profiles.html
         |  (cordova_copy_www)
         v
    app/android/www/src/tabs/profiles.html
         |  (cordova_build -> gradle -> aapt)
         v
    redist/rf-cordova.apk

중요: 소스(src/)를 고쳐도, vite가 bundle/ 을 재생성하고 -> cordova가 www 로 복사하고 ->
APK로 패키징하는 전 과정을 거쳐야만 반영된다.

### 2.2 하한값 제약은 HTML min 속성 하나뿐이다 (JS 클램프 없음)

값을 25 미만으로 막는 코드는 min="25" 속성뿐이며, JavaScript 쪽에는 클램프가 없다.

### 2.3 "이전 빌드 잔여물을 지우면 되는가?"

안전 장치로서는 유효하지만, 근본 원인은 아니다.
pnpm gulp redist --platform android 는 build_bundle()(vite full rebuild) ->
cordova_copy_www(전체 www 덮어쓰기) -> cordova_build(APK 재생성) 순서로
진행되므로 대부분의 경우 잔여물에 관계없이 올바르게 재생성된다.

다만, 확실히 하려면 빌드 전 make clean 을 실행할 것.

---

## 3. 빌드 방법

### 3.1 환경 요구사항

| 도구 | 버전 | 비고 |
|------|------|------|
| Node.js | 25+ (.nvmrc = v25.6.1) | Rolldown 바인딩 필요 |
| Java JDK | 21+ | |
| Android SDK | android-35/36 | build-tools 34~36 |
| Gradle | 8.10+ | PATH 또는 프로젝트 wrapper |

### 3.2 환경 변수 설정

    export PATH=/home/betaflight/node-v25/bin:/home/betaflight/gradle/bin:$PATH
    export ANDROID_HOME=/home/betaflight/android-sdk
    export ANDROID_SDK_ROOT=/home/betaflight/android-sdk
    node --version    # v25.6.1
    gradle --version  # 8.x+

### 3.3 클린 빌드 실행

    cd /home/betaflight/rfconfigurator
    make clean                    # app/ bundle/ redist/ 삭제
    pnpm install --frozen-lockfile  # (Node 버전 변경 시만)
    pnpm gulp redist --platform android

수행 단계:

1. bundle_src / bundle_deps (vite build -> bundle/ 생성)
2. cordova_copy_www (bundle/ -> app/android/www/ 복사)
3. cordova_deps (npm 의존성 설치)
4. cordova_build (cordova platform add android + gradle assembleRelease)
5. build_redist_apk (APK -> redist/ 복사)

### 3.4 Debug 빌드 (서명 없이 테스트용)

    pnpm gulp debug --platform android

---

## 4. 버전 설정 ("개발 버전" 경고 제거)

package.json 의 version 필드가 "0.0.0"이면 실행 시 개발 버전 경고가 뜬다.
릴리스 버전으로 설정 후 빌드해야 한다.

    make version SEMVER=2.3.5       # package.json 의 version 변경
    # 또는 수동: sed -i 's|"version": ".*"|"version": "2.3.5"|' package.json

버전이 "0.0.0"으로 시작하지 않으면 src/js/main.js 의 조건문을 통과하지 않아 경고가 없다.

---

## 5. 검증 방법

APK 내부 profiles.html 의 min 값 확인:

    unzip -p redist/rf-cordova.apk '*/src/tabs/profiles.html' | grep yawStopGain

APK 버전 확인:

    unzip -p redist/rf-cordova.apk '*/www/package.json' | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])"

---

## 6. 요약 (TL;DR)

1. 소스(src/) 수정만으로 APK에 반영 안 됨 -> 반드시 재빌드 필요.
2. 재빌드는 pnpm gulp redist --platform android (클린 후 권장).
3. 빌드 전에 package.json 버전을 릴리스 버전(예: 2.3.5)으로 설정할 것.
4. APK 내부가 min=0 인지 unzip 으로 직접 확인 가능.
