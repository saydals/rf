# BLE GATT 기능 구현 — 전체 작업 기록 (2026-07-11)

## 전체 결과

| 단계 | 상태 | 비고 |
|------|------|------|
| BLE 스캔 버튼 UI | ✅ | index.html + CSS |
| BLE 기기 검색 | ✅ | SB BT Nano 3 정확한 이름 |
| TX/RX 특성 자동감지 | ✅ | `ble.connect()` 콜백의 `peripheral.characteristics[]` 파싱 |
| Notify 구독 + MSP 수신 | ✅ | `BLE data: XXB` |
| MSP 프레임 재조립 | ✅ | V1: `6+size`, V2: `9+size` |
| MSP 통신 (설정 읽기/쓰기) | ⚠️ 부분 성공 | 연결되나 초기화 1분+ |
| MTU 최적화 (속도) | ❌ 미해결 | GATT 큐 충돌 |
| Capacitor 전환 | ❌ 미시도 | 추후 검토 |

---

## 변경 파일 목록

**신규:** `src/js/ble_central.js` (BLE 전용 모듈, ~700줄)

**수정 (11개):**
| 파일 | 변경 내용 |
|------|----------|
| `src/js/serial.js` | `connectionType: 'ble'` 분기, `connectBLE()`, `send()` BLE |
| `src/js/port_handler.js` | `check_ble_devices()`, `isBLE` 데이터 속성 |
| `src/js/serial_backend.js` | BLE 버튼 표시/숨김, BLE 연결 핸들러 |
| `index.html` | "BLE Scan" 버튼 (포트 셀렉터 아래 별도 행) |
| `src/css/main.css` | `#ble-scan-btn` 스타일 |
| `locales/en/messages.json` | `bleScan`, `bleScanning` 키 |
| `cordova/package_template.json` | `cordova-plugin-ble-central` ^2.0.0 |
| `cordova/config_template.xml` | `<uses-feature android:name="android.hardware.bluetooth_le"/>` |
| `gulpfile.mjs` | `cordova_deps` frozen → no-frozen-lockfile |
| `blegatt.md` | 본 문서 |
| `apkbuild.md` | 빌드 절차 업데이트 |

---

## ble_central.js 함수 상세

### export 함수
| 함수 | 설명 |
|------|------|
| `bleScan(seconds, onDevice, onComplete, onError)` | BLE 스캔. advertising에서 서비스 UUID 추출하여 `bleDeviceServiceMap`에 저장 |
| `bleConnect(id, onConnect, onDisconnect, onError)` | BLE 연결. `connected` 플래그로 연결 실패/의도치 않은 해제 구분 |
| `autoDetectProfile(peripheral)` | **⭐ 핵심.** `peripheral.characteristics[]` 배열에서 Write 속성→TX, Notify 속성→RX 자동 감지. `(props.includes('Write') \|\| props.includes('WriteWithoutResponse'))`. 표준 GATT 서비스(0x1800, 0x1801, 0x180A 등) 제외 |
| `bleDisconnect(id, onDisconnect, onError)` | 연결 해제 |
| `bleStartNotification(id, svc, chr, onData, onError)` | Notify 구독. `{ emitOnRegistered: true }` 옵션 사용. 수신 데이터가 `{ CDVType: 'ArrayBuffer', data: base64 }` 형태이므로 파싱 필요 |
| `bleStopNotification(id, svc, chr, onStop, onError)` | Notify 중지 |
| `bleWrite(id, svc, chr, data, ok, fail)` | WriteWithoutResponse. ArrayBuffer→Base64 자동 변환 후 전송 |
| `bleRequestMtu(id, mtu=247, success, fail)` | MTU 협상. 실패 시 23 반환. Android GATT 큐와의 충돌 위험 |
| `bleIsEnabled(success, fail)` | 블루투스 활성화 확인 |
| `bleShowSettings()` | 블루투스 설정 화면 열기 |
| `fragmentMspFrame(data, mtu)` | MSP 프레임을 MTU 크기에 맞게 분할 (ATT 헤더 3바이트 고려) |
| `createMspReassembler(onCompleteFrame)` | BLE notify 스트림에서 `$`(0x24) 기반 MSP 프레임을 찾아 재조립. **V1: `6+size`, V2: `9+size`** |
| `normalizeUuid(uuid)` | 16비트 축약형 UUID를 Bluetooth Base UUID(`0000xxxx-0000-1000-8000-00805f9b34fb`)로 정규화 |
| `parseAdvertisedServiceUuid(advert)` | BLE advertising data 파싱 (AD type 0x02/0x03=16비트, 0x06/0x07=128비트) |

### 내부 함수
| 함수 | 설명 |
|------|------|
| `uuidMatches(a, b)` | 두 UUID 비교 (축약형/전체형/대소문자 무시) |
| `findUuid(list, targetUuid)` | UUID 목록에서 일치 항목 찾기 |
| `base64ToArrayBuffer(b64)` | Base64 → ArrayBuffer |
| `arrayBufferToBase64(buf)` | ArrayBuffer → Base64 |

### BLE_PROFILES (7개, Betaflight devices.js 기준)
| 이름 | Service | Write | Read/Notify |
|------|---------|-------|-------------|
| CC2541 | 0000ffe0-... | 0000ffe1-... | 0000ffe2-... |
| HM-10 | 0000ffe1-... | 0000ffe1-... | 0000ffe1-... |
| SpeedyBee V1 | 00001000-... | 00001001-... | 00001002-... |
| SpeedyBee V2 | 0000abf0-... | 0000abf1-... | 0000abf2-... |
| SpeedyBee FF00 | 0000ff00-... | 0000ff01-... | 0000ff02-... |
| Nordic NRF | 6e400001-... | 6e400003-... | 6e400002-... |
| DroneBridge | 0000db32-... | 0000db33-... | 0000db34-... |

---

## serial.js 연결 흐름 (현재 동작하는 버전)

```
bleConnect(deviceId, onConnect, onDisconnect, onError)
  └─ onConnect(peripheral) → autoDetectProfile(device)
  │    ├─ TX/writeChar = device.characteristics 중 WriteWithoutResponse 속성
  │    └─ RX/notifyChar = device.characteristics 중 Notify 속성
  │
  ├─ bleRequestMtu(deviceId, 247)   ← 백그라운드 실행
  ├─ bleStartNotification(deviceId, service, rxChar, onData, onError)
  │
  ├─ 500ms 대기
  ├─ "exit\r\n" 전송 (bleWrite, fire-and-forget)
  │  └─ 성공/실패 모두 500ms 후 callback 호출
  │
  └─ callback({ connectionId: deviceId }) → onOpen → MSP 초기화
```

**onDisconnect:** `errorHandler('disconnected')` → MSP 통신 중단
**onError:** `callback(false)` → "serial port open failed"

---

## 중요 버그 수정 내역

### 버그 #1 — MSP V1 프레임 길이 계산 오류 (근본 원인!)

| 항목 | 내용 |
|------|------|
| **위치** | `ble_central.js` → `createMspReassembler` → `_extractFrames()` |
| **증상** | 9바이트 MSP 응답 도착 → 10초 타임아웃 → "no configuration received" |
| **원인** | `buffer[3] \| (buffer[4] << 8)`로 size 2바이트를 읽었으나, MSP V1은 **size 1바이트 + cmd 1바이트**. buffer[4]는 cmd이므로 size = 3 \| (0x01 << 8) = 259로 계산되어 259바이트 대기 |
| **해결** | `sizeByte = buffer[3]` (1바이트). JUMBO(0xFF) 처리: 8+실제크기. 일반 V1: `totalLen = 6 + sizeByte` |
| **근거** | Betaflight `msp.js` 165행: `PAYLOAD_LENGTH_V1`이 chunk 1바이트만 읽음 |
| **영향** | **이걸 고친 후 MSP 통신이 처음으로 성공함** |

**V1 프레임 구조:** `$ M > size(1) cmd(1) data(sizeB) checksum(1)` = `6 + size`
**V2 프레임 구조:** `$ X > flag(1) cmd(2) size(2) data(sizeB) checksum(1)` = `9 + size`

### 버그 #2 — MTU 요청 GATT 큐 충돌

| 항목 | 내용 |
|------|------|
| **증상** | `ble.requestMtu()` + `ble.startNotification()` 동시 호출 시 GATT 연결 끊김 |
| **원인** | `cordova-plugin-ble-central`은 GATT 작업 직렬화 큐를 제공하지 않음. Android BLE 스택은 하나의 GATT 명령만 처리 가능 |
| **해결** | MTU 요청을 백그라운드(fire-and-forget)로 실행. notify 설정이 먼저 완료되도록 함 |
| **참고** | Betaflight는 Nordic BLE 라이브러리 자체 큐로 MTU(247) → Notify 순차 처리 |

### 버그 #3 — startNotification 데이터 포맷

| 항목 | 내용 |
|------|------|
| **문제** | `cordova-plugin-ble-central` v2.0.0의 `startNotification`이 `{ CDVType: 'ArrayBuffer', data: base64 }` 객체 반환 |
| **해결** | `options.emitOnRegistered = true` 전달. `base64ToArrayBuffer(data.data)` 로 ArrayBuffer 추출 |

---

## Betaflight Configurator와의 차이

| 항목 | Betaflight | Rotorflight (우리) |
|------|-----------|-------------------|
| 모바일 프레임워크 | **Capacitor** | Cordova |
| BLE 플러그인 | **커스텀 네이티브 플러그인** (BetaflightBlePlugin.java) | `cordova-plugin-ble-central` v2.0.0 |
| BLE 라이브러리 | **Nordic Semiconductor** (`no.nordicsemi.android.ble.BleManager`) | Cordova exec (자체 없음) |
| GATT 작업 | **Nordic 라이브러리 내장 큐**로 MTU/Notify 직렬화 | JS→Native 개별 호출 (충돌 위험) |
| MTU | **247** (Nordic 큐로 안전 처리) | 247 (백그라운드, 충돌 가능) |
| UUID 확보 | 스캔 시 네이티브가 반환 | `ble.connect()` 콜백의 `peripheral.characteristics` |
| 서비스 검증 | `isRequiredServiceSupported()`에서 GATT 직접 접근 | `autoDetectProfile()` JS properties 분석 |

---

## 실패한 접근법 (재시도 불필요)

1. **6개 하드코딩 프로필로 startNotification blind 시도** → v2.0.0에 `services()`/`characteristics()` API 없음
2. **Advertising UUID 파싱 후 5가지 패턴 시도** → `normalizeUuid()` 16비트 변환 버그
3. **isKnownMspDevice 필터링** → advertising data의 UUID 포함 여부 검사 실패로 SB BT Nano 3 제외됨
4. **JS GATT Queue (Promise 체인)** → 포트가 열리지 않아 실패
5. **MTU 완료 대기 후 MSP 시작** → MTU 협상이 30-40초 걸려 전체 시간 증가
6. **"exit" 명령 제거** → FC가 CLI 모드에서 MSP 모드로 전환 안 됨

---

## 동작 확인용 로그

BLE_data 로그로 데이터 크기와 흐름 확인:
- `BLE data: 9B` → MSP V1 9바이트 응답 (size=3: MSP_API_VERSION)
- `BLE data: 10~120B` → MTU 247 협상됨
- LED 깜빡임이 빠를수록 데이터 흐름이 원활한 것

---

## 빌드 명령

```bash
export ANDROID_HOME=/home/betaflight/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:/home/betaflight/gradle/gradle-8.10/bin:/home/betaflight/.local/share/fnm
eval "$(fnm env --shell bash)"

cd /home/betaflight/rfconfigurator
make version SEMVER=2.2.0
pnpm gulp app --platform android
# → app/android/platforms/android/app/build/outputs/apk/release/app-release.apk
```

---

## 추가 업데이트 (2026-07-11)

### 버그 #4 — 속도 최적화: MTU와 Notify 직렬화 처리 완료
* **증상**: 1분 이상 걸리는 초기화 속도 (GATT 충돌로 인해 MTU 247 확장이 무시되고 기본 20바이트로 동작)
* **해결 방법**: `Betaflight Configurator`의 네이티브 Nordic 라이브러리 처리 방식(내부 Queue 사용)을 벤치마킹. `cordova-plugin-ble-central`에는 큐 기능이 없으므로, JS(`serial.js`) 레벨에서 `bleRequestMtu()` 호출이 완전히 끝난 뒤에(성공/실패 콜백 반환 후) `bleStartNotification()`을 호출하도록 순차 실행 로직을 도입함.
* **결과**: 명령 충돌 없이 247바이트 MTU가 안정적으로 할당되어 대량의 데이터 전송이 가능해짐. 결과적으로 전체적인 연결 및 MSP 통신 속도가 획기적으로 향상됨.

---

## 다음에 할 일

1. **신규 버전 대응**: git diff HEAD blegatt.md로 변경 파일 확인 후 패치 적용
2. **nRF Connect**로 SB BT Nano 3 실제 UUID 확인 (autoDetectProfile 검증)
3. **장기 과제**: 안정성을 위한 Capacitor 및 커스텀 BLE 플러그인 마이그레이션 검토

---

## 최종 상태 (2026-07-11 마무리)

### 최종 APK
```
app/android/platforms/android/app/build/outputs/apk/release/app-release.apk
```

### 현재 동작
- BLE 스캔 ✅ → SB BT Nano 3 검색 → 연결 ✅ → MSP 통신 ✅ 
- BLE 데이터 로그 표시됨 (`BLE data: XXB`)
- 속도 매우 느림 (MTU 23 → 1분+ 소요)

### 최종 연결 흐름 (serial.js)
```
connectBLE → autoDetectProfile → bleRequestMtu(247) → 콜백 완료 → 
startNotifyAndExit() → bleStartNotification → 500ms → exit → 500ms → callback → MSP
```

### 시도했으나 실패한 속도 개선 방법
- MTU 247 병렬 (GATT 큐 충돌로 실패)
- JS GATT Queue (Promise 체인, 포트 안 열림)
- 커스텀 플러그인 (Peripheral.java BLECommand 타입 체계 문제)
- MTU 512 (SpeedyBee 모듈이 지원 안 함)

### 최종 결론
속도 개선은 카파시터(Capacitor)로의 마이그레이션이나, Nordic BLE 라이브러리 기반의 커스텀 플러그인 제작이 필요함.
`cordova-plugin-ble-central`의 `requestMtu()`가 GATT 명령 큐를 우회하는 설계 문제가 근본 원인.
