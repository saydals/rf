# SB BT Nano 3 실기 측정 결과 & 마이그레이션 전략 수정
# SB BT Nano 3 Real-Device Measurement Results & Migration Strategy Revision

> **Document Purpose / 문서 목적:**
> 사용자가 nRF Connect 앱으로 SpeedyBee BT Nano 3 모듈의 실제 GATT 구조와 동작 시퀀스를 측정한 로그(`Log 2026-07-11 14_41_35.txt`)와 매크로 정의(`Qqqqq.xml`)를 분석하고, 이전 마이그레이션 명세서(`RFC_Nordic_BLE_Migration_Spec.md`)에서 누락된 점을 식별하여 수정 전략을 제시한다.
>
> The user measured the actual GATT structure and operational sequence of the SpeedyBee BT Nano 3 module using the nRF Connect app. This document analyses the log and macro files, identifies gaps in the previous migration spec, and proposes a revised strategy.

> **Language / 언어:** Korean + English / 한글 + 영어
> **Date / 작성일:** 2026-07-11
> **Source files / 소스 파일:**
> - `/home/z/my-project/upload/Qqqqq.xml` (nRF Connect macro definition)
> - `/home/z/my-project/upload/Log 2026-07-11 14_41_35.txt` (nRF Connect session log, 455 lines)

---

## Table of Contents / 목차

1. [Source File Overview / 소스 파일 개요](#1-source-file-overview--소스-파일-개요)
2. [Discovery 1: GATT Structure / 발견 1: GATT 구조](#2-discovery-1-gatt-structure--발견-1-gatt-구조)
3. [Discovery 2: Operational Sequence / 발견 2: 동작 시퀀스](#3-discovery-2-operational-sequence--발견-2-동작-시퀀스)
4. [Discovery 3: Timing Measurements / 발견 3: 타이밍 측정](#4-discovery-3-timing-measurements--발견-3-타이밍-측정)
5. [Discovery 4: MSP Frame Verification / 발견 4: MSP 프레임 검증](#5-discovery-4-msp-frame-verification--발견-4-msp-프레임-검증)
6. [Gap Analysis: What the Migration Spec Missed / 갭 분석: 명세서가 놓친 것](#6-gap-analysis-what-the-migration-spec-missed--갭-분석-명세서가-놓친-것)
7. [Revised Strategy / 수정 전략](#7-revised-strategy--수정-전략)
8. [Concrete Code Patch / 구체 코드 패치](#8-concrete-code-patch--구체-코드-패치)
9. [Updated Verification Plan / 수정된 검증 계획](#9-updated-verification-plan--수정된-검증-계획)
10. [Summary / 요약](#10-summary--요약)

---

## 1. Source File Overview / 소스 파일 개요

### 1.1 `Qqqqq.xml` — nRF Connect Macro Definition

This is an nRF Connect "macro" — a recorded sequence of BLE operations that can be replayed against a device. The user recorded a working session that successfully communicates with the SB BT Nano 3 and exported it as this XML.

이것은 nRF Connect의 "매크로"다 — 디바이스에 대해 재생 가능한 BLE 오퍼레이션 시퀀스를 기록한 것. 사용자가 SB BT Nano 3와 정상 통신하는 세션을 기록하고 이 XML로 내보냈다.

**Macro structure (47 lines) / 매크로 구조 (47줄):**
1. Service/characteristic assertions (lines 2-10)
2. The "working sequence" repeated 3 times (lines 11-46):
   - sleep 300ms → requestConnectionPriority(HIGH) → sleep 300ms → requestMtu(247) → sleep 300ms → writeDescriptor (enable notify) → sleep 300ms → write (MSP request) → waitForNotification → readRssi

### 1.2 `Log 2026-07-11 14_41_35.txt` — Session Log

Full nRF Connect session log, 455 lines, spanning 14:38:19 to 14:41:07 (~2 minutes 48 seconds).

Key phases / 핵심 단계:
- **14:38:19-20:** Initial connection + service discovery (line 1-30)
- **14:38:41-43:** First macro execution (line 31-55) — full handshake + first MSP round-trip
- **14:40:07-41:07:** 8 more macro repetitions at irregular intervals (manual triggers)

---

## 2. Discovery 1: GATT Structure / 발견 1: GATT 구조

### 2.1 Discovered Service Tree / 발견된 서비스 트리

From log lines 13-26, nRF Connect discovered these services after `gatt.discoverServices()`:

로그 13-26행에서, nRF Connect는 `gatt.discoverServices()` 후 다음 서비스들을 발견했다:

```
Generic Attribute (0x1801)
└─ Service Changed [I] (0x2A05)
   └─ Client Characteristic Configuration (0x2902)

Generic Access (0x1800)
├─ Device Name [R] (0x2A00)
├─ Appearance [R] (0x2A01)
└─ Central Address Resolution [R] (0x2AA6)

Unknown Service (0000abf0-0000-1000-8000-00805f9b34fb)   ← SpeedyBee V2
├─ Unknown Characteristic [R WNR] (0000abf1-...)          ← TX (Write Without Response)
├─ Unknown Characteristic [N R]   (0000abf2-...)          ← RX (Notify)
│  └─ Client Characteristic Configuration (0x2902)
├─ Unknown Characteristic [R WNR] (0000abf3-...)          ← ★ EXTRA (unused)
└─ Unknown Characteristic [N R]   (0000abf4-...)          ← ★ EXTRA (unused)
   └─ Client Characteristic Configuration (0x2902)
```

### 2.2 Verification Against Our Plugin / 우리 플러그인과의 검증

Our `KNOWN_DEVICES` table in `NordicBlePlugin.java`:

우리 플러그인의 `KNOWN_DEVICES` 테이블:

| Field / 필드 | Our Plugin / 우리 플러그인 | SB BT Nano 3 Actual / 실제 | Match / 일치 |
|---|---|---|---|
| Service UUID | `0000abf0-...` | `0000abf0-...` | ✅ |
| Write (TX) Char | `0000abf1-...` | `0000abf1-...` | ✅ |
| Notify (RX) Char | `0000abf2-...` | `0000abf2-...` | ✅ |
| TX Properties | `WRITE_WITHOUT_RESPONSE` | `R WNR` (Read + WriteWithoutResponse) | ✅ |
| RX Properties | `NOTIFY` | `N R` (Notify + Read) | ✅ |
| RX has CCCD | Required | Yes (0x2902) | ✅ |

**Conclusion / 결론:** Our SpeedyBee V2 profile entry is **100% correct**. The `isRequiredServiceSupported()` method in our `BleBridgeManager` will find the service and characteristics without any modification.

우리의 SpeedyBee V2 프로필 항목은 **100% 정확**하다. `BleBridgeManager`의 `isRequiredServiceSupported()`가 서비스와 특성을 수정 없이 찾을 수 있다.

### 2.3 Newly Discovered: Extra Characteristics abf3/abf4 / 새 발견: 추가 특성 abf3/abf4

The SB BT Nano 3 exposes **two additional characteristics** under the same service:

SB BT Nano 3는 같은 서비스 아래 **두 개의 추가 특성**을 노출한다:

- `0000abf3-...` — `R WNR` (Read + Write Without Response)
- `0000abf4-...` — `N R` (Notify + Read) with CCCD

**Purpose unknown / 용도 불명.** Possibly:
- A second UART channel for OTA firmware updates
- A diagnostic/control channel
- SpeedyBee app's proprietary extension

**Impact on our plugin / 우리 플러그인에 미치는 영향:** None. Our `isRequiredServiceSupported()` only looks for `abf1` and `abf2`, so the extra characteristics are ignored. No action needed.

**영향 없음.** 우리의 `isRequiredServiceSupported()`는 `abf1`과 `abf2`만 찾으므로 추가 특성은 무시된다. 조치 불필요.

### 2.4 Advertising vs GATT — No Mismatch / 광고 vs GATT — 불일치 없음

The macro's `<assert-service uuid="0000abf0-...">` succeeds immediately, meaning the advertised service UUID matches the GATT service UUID. This means:

매크로의 `<assert-service uuid="0000abf0-...">`가 즉시 성공한다. 즉 광고된 서비스 UUID가 GATT 서비스 UUID와 일치한다. 이는 다음을 의미한다:

- **Our `chooseSpeedyBeeFallback()` logic is NOT needed for this device** — the primary profile matches on the first try.
- **이 디바이스에는 `chooseSpeedyBeeFallback()` 로직이 필요 없다** — 기본 프로필이 첫 시도에 일치한다.

However, we should KEEP the fallback logic because other SpeedyBee module variants (V1, FF00) may behave differently. The fallback is harmless when the primary matches.

다만, 다른 SpeedyBee 모듈 변형(V1, FF00)은 다르게 동작할 수 있으므로 폴백 로직은 유지해야 한다. 기본이 일치할 때 폴백은 무해하다.

---

## 3. Discovery 2: Operational Sequence / 발견 2: 동작 시퀀스

### 3.1 The Working Sequence (from Qqqqq.xml) / 작동 시퀀스 (Qqqqq.xml에서)

The macro reveals the **exact order of operations** that nRF Connect uses to successfully communicate with the SB BT Nano 3:

매크로는 nRF Connect가 SB BT Nano 3와 정상 통신하기 위해 사용하는 **정확한 오퍼레이션 순서**를 보여준다:

```
Step 1:  sleep 300ms                                          (stabilization)
Step 2:  requestConnectionPriority(HIGH)                      ← ★ CRITICAL
Step 3:  sleep 300ms
Step 4:  requestMtu(247)                                      ← MTU negotiation
Step 5:  sleep 300ms
Step 6:  writeDescriptor(CCCD of abf2, value=0x0100)          ← Enable notifications
Step 7:  sleep 300ms
Step 8:  writeCharacteristic(abf1, MSP_API_VERSION request)   ← Send MSP command
Step 9:  waitForNotification(abf2)                            ← Receive MSP response
Step 10: readRssi                                             (optional)
```

### 3.2 Critical Finding: `requestConnectionPriority(HIGH)` / 중대 발견: `requestConnectionPriority(HIGH)`

**This is the most important discovery.** The macro explicitly calls `requestConnectionPriority(HIGH)` BEFORE `requestMtu(247)`. Our migration spec and BFC's original `BetaflightBlePlugin.java` both **omit this step**.

**이것이 가장 중요한 발견이다.** 매크로는 `requestMtu(247)` 이전에 명시적으로 `requestConnectionPriority(HIGH)`를 호출한다. 우리의 마이그레이션 명세서와 BFC의 원본 `BetaflightBlePlugin.java` 둘 다 **이 단계를 생략한다**.

**What `requestConnectionPriority(HIGH)` does / `requestConnectionPriority(HIGH)`가 하는 일:**

From log line 32-34:
```
V  14:38:42.218  Requesting connection priority: HIGH (11.25–15ms, 0, 20s)...
D  14:38:42.218  gatt.requestConnectionPriority(HIGH)
I  14:38:42.698  Connection parameters updated (interval: 15.0ms, latency: 0, timeout: 5000ms)
```

- **Before HIGH:** Connection interval = 37.5ms (line 30) — Android default after service discovery
- **After HIGH:** Connection interval = 15.0ms — 2.5× faster

BLE connection interval is the time between GATT events. A 37.5ms interval means the FC can only push a notification every 37.5ms; a 15ms interval means every 15ms. For a 5KB MSP page load:

BLE 연결 간격은 GATT 이벤트 사이의 시간이다. 37.5ms 간격은 FC가 37.5ms마다만 notify를 보낼 수 있다는 뜻; 15ms 간격은 15ms마다 가능. 5KB MSP 페이지 로드의 경우:

| Connection Interval / 연결 간격 | Notifications per second / 초당 notify | Time for 20 notifications (5KB @ 244B) / 20번 notify 시간 |
|---|---|---|
| 37.5ms (default) | ~27 | 750ms |
| 15ms (HIGH) | ~67 | 300ms |

So `requestConnectionPriority(HIGH)` provides an additional **2.5× speedup** on top of MTU 247.

따라서 `requestConnectionPriority(HIGH)`는 MTU 247 위에 추가로 **2.5배 속도 향상**을 제공한다.

### 3.3 The 300ms Sleeps — Are They Needed? / 300ms sleep — 필요한가?

The macro has `sleep 300ms` between every operation. This is nRF Connect's conservative default to avoid GATT queue collisions on poorly-behaved devices.

매크로는 모든 오퍼레이션 사이에 `sleep 300ms`를 둔다. 이것은 nRF Connect가 동작이 불안정한 디바이스에서 GATT 큐 충돌을 피하기 위한 보수적 기본값이다.

**For our plugin / 우리 플러그인의 경우:**
- We use Nordic's `BleManager` internal queue, which serialises operations automatically.
- The 300ms sleeps are **NOT needed** — Nordic's queue handles timing.
- Nordic queue가 오퍼레이션을 자동으로 직렬화하므로 300ms sleep은 **불필요**하다.

**Evidence / 증거:** Look at the actual GATT operation durations in the log:

로그에서 실제 GATT 오퍼레이션 지속 시간을 보면:

| Operation / 오퍼레이션 | Duration / 지속 시간 |
|---|---|
| requestConnectionPriority(HIGH) | ~480ms (first time), ~180ms (subsequent) |
| requestMtu(247) | ~40ms |
| writeDescriptor (CCCD) | ~37ms |
| writeCharacteristic | ~6ms |
| Notification round-trip | ~34ms |

The 300ms sleeps are 7-50× longer than the actual operations. Nordic's queue will advance to the next operation as soon as the previous one completes, saving ~1.2 seconds per connect cycle (4 × 300ms).

300ms sleep은 실제 오퍼레이션보다 7-50배 길다. Nordic 큐는 이전 오퍼레이션이 완료되는 즉시 다음으로 진행하므로 연결 주기당 ~1.2초(4 × 300ms)를 절약한다.

---

## 4. Discovery 3: Timing Measurements / 발견 3: 타이밍 측정

### 4.1 Initial Connection Handshake / 초기 연결 핸드셰이크

From log lines 3-12:

| Step / 단계 | Start / 시작 | End / 종료 | Duration / 소요 |
|---|---|---|---|
| `connectGatt` | 14:38:19.392 | 14:38:19.534 | **142ms** |
| `discoverServices` | 14:38:19.547 | 14:38:20.168 | **621ms** |
| Service tree printout | 14:38:20.168 | 14:38:20.181 | 13ms |
| Initial `setCharacteristicNotification` (abf2, abf4, 2a05) | 14:38:20.181 | 14:38:20.187 | 6ms |

**Total initial handshake: ~782ms** (before any macro runs)

### 4.2 First Macro Execution (Full Sequence) / 첫 매크로 실행 (전체 시퀀스)

From log lines 31-55 (14:38:41.917 to 14:38:43.752):

| Step / 단계 | Start / 시작 | End / 종료 | Duration / 소요 |
|---|---|---|---|
| wait(300) | 14:38:41.917 | 14:38:42.218 | 301ms |
| requestConnectionPriority(HIGH) | 14:38:42.218 | 14:38:42.698 | **480ms** |
| wait(300) | 14:38:42.700 | 14:38:43.002 | 302ms |
| requestMtu(247) | 14:38:43.002 | 14:38:43.042 | **40ms** |
| wait(300) | 14:38:43.043 | 14:38:43.350 | 307ms |
| writeDescriptor (enable notify) | 14:38:43.350 | 14:38:43.387 | **37ms** |
| wait(300) | 14:38:43.402 | 14:38:43.708 | 306ms |
| writeCharacteristic (MSP request) | 14:38:43.708 | 14:38:43.714 | **6ms** |
| Notification received (MSP response) | 14:38:43.714 | 14:38:43.748 | **34ms** |
| readRssi | 14:38:43.749 | 14:38:43.752 | 3ms |

**Totals / 합계:**
- With 300ms sleeps (as macro ran): **1831ms**
- Without 300ms sleeps (Nordic queue): **600ms** (savings: 1231ms)
- Pure GATT operation time: **597ms**
- MSP round-trip alone: **40ms** (write 6ms + notify 34ms)

### 4.3 Steady-State MSP Round-Trip / 정상 상태 MSP 왕복

From the 8 subsequent macro executions (14:40:07 to 14:41:07), the MSP round-trip times:

8번의 후속 매크로 실행(14:40:07 ~ 14:41:07)에서 MSP 왕복 시간:

| Macro # | writeCharacteristic time / 쓰기 시각 | notification received time / notify 수신 시각 | Round-trip / 왕복 |
|---|---|---|---|
| 2 | 14:40:09.284 | 14:40:09.337 | **53ms** |
| 3 | 14:40:10.858 | 14:40:10.899 | **41ms** |
| 4 | 14:40:12.400 | 14:40:12.443 | **43ms** |
| 5 | 14:40:19.325 | 14:40:19.373 | **48ms** |
| 6 | 14:40:20.880 | 14:40:20.931 | **51ms** |
| 7 | 14:40:26.872 | 14:40:26.917 | **45ms** |
| 8 | 14:40:28.451 | 14:40:28.493 | **42ms** |
| 9 | 14:40:33.442 | 14:40:33.473 | **31ms** |
| 10 | 14:40:56.950 | 14:40:56.977 | **27ms** |
| 11 | 14:40:58.506 | 14:40:58.551 | **45ms** |
| 12 | 14:41:00.050 | 14:41:00.082 | **32ms** |
| 13 | 14:41:01.597 | 14:41:01.649 | **52ms** |
| 14 | 14:41:03.120 | 14:41:03.171 | **51ms** |
| 15 | 14:41:04.642 | 14:41:04.672 | **30ms** |
| 16 | 14:41:07.641 | 14:41:07.671 | **30ms** |

**Statistics / 통계:**
- Min / 최소: 27ms
- Max / 최대: 53ms
- Average / 평균: ~41ms
- Median / 중앙값: ~43ms

### 4.4 RSSI Measurements / RSSI 측정

All RSSI readings across the session:

세션 전체의 RSSI 판독값:

| Range / 범위 | Count / 횟수 |
|---|---|
| -57 dBm | 1 |
| -58 dBm | 3 |
| -59 dBm | 4 |
| -60 dBm | 2 |
| -61 dBm | 6 |
| -62 dBm | 2 |
| -64 dBm | 2 |

**Range / 범위:** -57 to -64 dBm (average ~-60 dBm) → **excellent signal strength / 신호 강도 양호**

### 4.5 Stability Verification / 안정성 검증

- **Zero disconnects** during the ~2:48 session
- **Zero GATT errors** (all operations returned status 0)
- **MTU 247 negotiated successfully on every attempt** (9/9 success rate)
- All 15 MSP_API_VERSION requests received correct responses
- 세션 ~2:48 동안 **단절 0건**
- **GATT 에러 0건** (모든 오퍼레이션이 status 0 반환)
- **MTU 247이 매 시도마다 성공적으로 협상됨** (9/9 성공률)
- 15개 MSP_API_VERSION 요청 모두 올바른 응답 수신

---

## 5. Discovery 4: MSP Frame Verification / 발견 4: MSP 프레임 검증

### 5.1 Request Frame: `0x244D3C000101` / 요청 프레임

The macro sends this 6-byte frame to `abf1`:

매크로는 이 6바이트 프레임을 `abf1`로 보낸다:

| Byte / 바이트 | Hex | ASCII | Meaning / 의미 |
|---|---|---|---|
| 0 | 0x24 | `$` | MSP sentinel / 센티널 |
| 1 | 0x4D | `M` | MSP V1 marker / V1 마커 |
| 2 | 0x3C | `<` | Direction: configurator → FC (request) / 방향: 요청 |
| 3 | 0x00 | — | Payload size: 0 bytes / 페이로드 크기: 0바이트 |
| 4 | 0x01 | — | Command: MSP_API_VERSION (0x01) / 명령: MSP_API_VERSION |
| 5 | 0x01 | — | Checksum: 0x00 XOR 0x01 = 0x01 / 체크섬 |

**This is a standard MSP V1 frame.** Our `fragmentMspFrame()` will pass it through as a single fragment (6 bytes << MTU 247 - 3 = 244 bytes).

**이것은 표준 MSP V1 프레임이다.** 우리의 `fragmentMspFrame()`은 이것을 단일 프래그먼트로 통과시킨다 (6바이트 << MTU 247 - 3 = 244바이트).

### 5.2 Response Frame: `0x244D3E0301000C0907` / 응답 프레임

The notification delivers this 9-byte frame from `abf2`:

notify로 `abf2`에서 이 9바이트 프레임이 전달된다:

| Byte / 바이트 | Hex | ASCII | Meaning / 의미 |
|---|---|---|---|
| 0 | 0x24 | `$` | MSP sentinel / 센티널 |
| 1 | 0x4D | `M` | MSP V1 marker / V1 마커 |
| 2 | 0x3E | `>` | Direction: FC → configurator (response) / 방향: 응답 |
| 3 | 0x03 | — | Payload size: 3 bytes / 페이로드 크기: 3바이트 |
| 4 | 0x01 | — | Command: MSP_API_VERSION (0x01) / 명령: MSP_API_VERSION |
| 5 | 0x00 | — | data[0]: protocol version = 0 (MSP1) / 프로토콜 버전 |
| 6 | 0x0C | — | data[1]: API major = 12 / API 메이저 |
| 7 | 0x09 | — | data[2]: API minor = 9 / API 마이너 |
| 8 | 0x07 | — | Checksum: 0x03 XOR 0x01 XOR 0x00 XOR 0x0C XOR 0x09 = 0x07 / 체크섬 |

**Checksum verification / 체크섬 검증:**
```
0x03 = 00000011
0x01 = 00000001  → 00000010
0x00 = 00000000  → 00000010
0x0C = 00001100  → 00001110
0x09 = 00001001  → 00000111 = 0x07 ✓
```

**Total length / 총 길이:** 6 + 3 = 9 bytes (matches MSP V1 formula: `6 + size`)

### 5.3 Reassembler Compatibility / 재조립기 호환성

Our `createMspReassembler()` in `ble_central.js` handles this frame correctly:

우리의 `createMspReassembler()`는 이 프레임을 올바르게 처리한다:

```javascript
// V1 path in _extractFrames():
if (type === 0x4D) { // V1
    const sizeByte = buffer[3];           // 0x03
    if (sizeByte === 0xFF) { ... }        // not JUMBO, skip
    else {
        totalLen = 6 + sizeByte;          // 6 + 3 = 9 ✓
    }
}
```

**Conclusion / 결론:** Our reassembler is correct. The frame will be extracted as a complete 9-byte MSP frame and dispatched to `onCompleteFrame`.

우리의 재조립기는 정확하다. 프레임이 완전한 9바이트 MSP 프레임으로 추출되어 `onCompleteFrame`로 전달된다.

### 5.4 FC Identification / FC 식별

The response `protocol=0, major=12, minor=9` indicates:
- MSP protocol version 1 (not 2)
- API version 12.9

This is the **Rotorflight** MSP version (Rotorflight uses MSP1 with extended commands). The FC is responding correctly to MSP_API_VERSION.

응답 `protocol=0, major=12, minor=9`는 다음을 나타낸다:
- MSP 프로토콜 버전 1 (2가 아님)
- API 버전 12.9

이것은 **Rotorflight** MSP 버전이다 (Rotorflight는 확장 명령과 함께 MSP1을 사용). FC가 MSP_API_VERSION에 올바르게 응답하고 있다.

---

## 6. Gap Analysis: What the Migration Spec Missed / 갭 분석: 명세서가 놓친 것

### 6.1 Gap #1: `requestConnectionPriority(HIGH)` Missing / 갭 #1: `requestConnectionPriority(HIGH)` 누락

**Severity / 심각도:** ★★★★★ (Critical / 중대)

**Description / 설명:**
Our `BleBridgeManager.initialize()` (and BFC's original) only does:

우리의 `BleBridgeManager.initialize()`(와 BFC 원본)는 다음만 수행한다:

```java
@Override
protected void initialize() {
    requestMtu(DESIRED_MTU)
        .with(...)
        .fail(...)
        .enqueue();
    if (notifyCharacteristic != null) {
        enableNotifications(notifyCharacteristic).enqueue();
    }
}
```

**Missing / 누락:** `requestConnectionPriority(HIGH)` before `requestMtu(247)`.

**Impact / 영향:** Without HIGH priority, the connection interval stays at the Android default (37.5ms or worse). This means:
- Maximum ~27 notifications per second
- A 5KB page load needs ~20 notifications at MTU 247 → 750ms minimum
- With HIGH priority (15ms): ~67 notifications/sec → 300ms for same load
- HIGH priority가 없으면 연결 간격이 Android 기본값(37.5ms 이상)에 머문다. 이는 다음을 의미한다:
  - 초당 최대 ~27 notify
  - 5KB 페이지 로드는 MTU 247에서 ~20 notify 필요 → 최소 750ms
  - HIGH priority(15ms)면: 초당 ~67 notify → 같은 부하에 300ms

**Speed cost of this gap / 이 갭의 속도 비용:** ~2.5× slower notification throughput.

### 6.2 Gap #2: No Verification of Actual MTU in JS / 갭 #2: JS에서 실제 MTU 검증 부재

**Severity / 심각도:** ★★★☆☆ (Medium / 중간)

**Description / 설명:**
Our `bleConnect()` adapter in `ble_central.js` receives `result.mtu` from the native plugin, but never verifies it is 247. If MTU negotiation silently fails and returns 23 (as happened with `cordova-plugin-ble-central`), the JS side would not detect it.

우리의 `ble_central.js`에 있는 `bleConnect()` 어댑터는 네이티브 플러그인에서 `result.mtu`를 받지만, 이것이 247인지 검증하지 않는다. MTU 협상이 조용히 실패하고 23을 반환하면(`cordova-plugin-ble-central`에서 발생했던 것처럼), JS 쪽은 이를 감지하지 못한다.

**Impact / 영향:** If a future regression or a different BLE module causes MTU 247 to fail, the user will experience slowness with no error message.

**Fix / 수정:** Add a warning log when `mtu < 247` and update the UI to show the negotiated MTU.

### 6.3 Gap #3: `exit\r\n` May Not Be Needed / 갭 #3: `exit\r\n`이 불필요할 수 있음

**Severity / 심별도:** ★★☆☆☆ (Low / 낮음)

**Description / 설명:**
Our `serial.js connectBLE()` sends `"exit\r\n"` after connect to force the FC out of CLI mode. However, the nRF Connect macro successfully exchanges MSP frames **without any `exit` command** — the FC responded to MSP_API_VERSION immediately.

우리의 `serial.js connectBLE()`는 연결 후 `"exit\r\n"`을 보내 FC를 CLI 모드에서 빠져나오게 한다. 그러나 nRF Connect 매크로는 **`exit` 명령 없이도** MSP 프레임을 성공적으로 교환했다 — FC가 MSP_API_VERSION에 즉시 응답했다.

**Possible explanations / 가능한 설명:**
1. Rotorflight FC boots directly into MSP mode (unlike Betaflight which may boot into CLI)
2. The SpeedyBee module does not inject a CLI entry command
3. The specific FC firmware tested does not have CLI auto-entry

**Impact / 영향:** The `exit\r\n` is harmless (the FC just ignores unknown CLI input when in MSP mode), but it adds a 6-byte write that takes ~6ms. Not a real problem, but unnecessary for Rotorflight.

**Recommendation / 권고:** Keep the `exit\r\n` for safety (it's needed for some FC configurations), but make it non-blocking (already done in our current code).

### 6.4 Gap #4: No Connection Parameter Display / 갭 #4: 연결 파라미터 표시 부재

**Severity / 심각도:** ★☆☆☆☆ (Cosmetic / 미용적)

**Description / 설명:**
The log shows useful diagnostic info — connection interval, latency, timeout — but our plugin does not expose these to JS. For debugging, it would be helpful to surface them.

로그에 유용한 진단 정보(연결 간격, 레이턴시, 타임아웃)가 표시되지만, 우리 플러그인은 이것들을 JS에 노출하지 않는다. 디버깅을 위해 표시하면 유용할 것이다.

---

## 7. Revised Strategy / 수정 전략

### 7.1 Strategy Summary / 전략 요약

Based on the gap analysis, the migration strategy is revised as follows:

갭 분석을 기반으로 마이그레이션 전략을 다음과 같이 수정한다:

| # | Change / 변경 | Priority / 우선순위 | Effort / 노력 |
|---|---|---|---|
| 1 | Add `requestConnectionPriority(HIGH)` to `BleBridgeManager.initialize()` | ★★★★★ | 5 min |
| 2 | Add MTU validation warning in JS `bleConnect()` | ★★★☆☆ | 5 min |
| 3 | (Optional) Add `requestConnectionPriority(HIGH)` re-request periodically | ★★☆☆☆ | 10 min |
| 4 | (Optional) Surface connection parameters to JS for debugging | ★☆☆☆☆ | 15 min |

**Total additional effort / 추가 노력 합계:** 15-35 minutes

### 7.2 Why This Works / 이것이 작동하는 이유

The nRF Connect macro proves that the SB BT Nano 3 supports:

nRF Connect 매크로는 SB BT Nano 3가 다음을 지원함을 증명한다:

1. ✅ MTU 247 (9/9 successful negotiations)
2. ✅ Connection priority HIGH (immediate interval drop to 15ms)
3. ✅ Notify on abf2 with CCCD write
4. ✅ WriteWithoutResponse on abf1
5. ✅ MSP V1 framing (request 6 bytes, response 9 bytes)
6. ✅ Stable connection for 2+ minutes with zero disconnects
7. ✅ ~40ms average MSP round-trip at HIGH priority + MTU 247

By adding `requestConnectionPriority(HIGH)` to our `BleBridgeManager.initialize()`, we replicate the nRF Connect macro's working sequence inside Nordic's queue. The Nordic queue handles serialization (no 300ms sleeps needed), so our connect handshake will be:

`BleBridgeManager.initialize()`에 `requestConnectionPriority(HIGH)`를 추가하면, nRF Connect 매크로의 작동 시퀀스를 Nordic 큐 안에서 재현한다. Nordic 큐가 직렬화를 처리하므로(300ms sleep 불필요) 우리의 연결 핸드셰이크는 다음과 같다:

```
connect → discoverServices → isRequiredServiceSupported → initialize():
  1. requestConnectionPriority(HIGH).enqueue()    ← NEW / 신규
  2. requestMtu(247).enqueue()
  3. enableNotifications(abf2).enqueue()
→ onDeviceReady → JS callback → send "exit\r\n" → MSP traffic begins
```

**Expected total handshake time / 예상 총 핸드셰이크 시간:**
- connectGatt: ~150ms
- discoverServices: ~620ms
- requestConnectionPriority: ~200ms (Nordic queue, no sleep)
- requestMtu: ~40ms
- enableNotifications: ~40ms
- "exit\r\n" write: ~10ms
- **Total: ~1060ms** (vs nRF Connect macro's 1831ms with sleeps)

### 7.3 Expected First-Page Load Time / 예상 첫 페이지 로드 시간

A typical Rotorflight configurator first-page load fetches ~3-5 KB of MSP data (API_VERSION, FC_VARIANT, FC_VERSION, BUILD_INFO, STATUS, BOXNAMES, etc.) across ~10-15 MSP commands.

일반적인 Rotorflight 설정자 첫 페이지 로드는 ~10-15개 MSP 명령에 걸쳐 ~3-5 KB의 MSP 데이터(API_VERSION, FC_VARIANT, FC_VERSION, BUILD_INFO, STATUS, BOXNAMES 등)를 가져온다.

**With MTU 247 + HIGH priority (15ms interval) / MTU 247 + HIGH priority(15ms 간격):**
- Each MSP response: 1-2 fragments (244 bytes per fragment)
- Each fragment round-trip: ~40ms (write + notify)
- 15 commands × 2 fragments × 40ms = **1200ms** (optimistic, serial)
- With Nordic queue parallelism and FC processing: **realistically 2-4 seconds**

**Compare to old (MTU 23, default 37.5ms interval) / 이전(MTU 23, 기본 37.5ms 간격) 비교:**
- Each MSP response: 5-25 fragments (20 bytes per fragment)
- 15 commands × 15 fragments avg × 75ms = **16+ seconds** (this is why it felt like 1 minute)

**Expected speedup / 예상 속도 향상: 10-15×**

---

## 8. Concrete Code Patch / 구체 코드 패치

### 8.1 Patch 1: Add `requestConnectionPriority(HIGH)` to `BleBridgeManager.initialize()` / 패치 1: `BleBridgeManager.initialize()`에 `requestConnectionPriority(HIGH)` 추가

**File / 파일:** `rfc/cordova/plugins/cordova-plugin-rfc-nordic-ble/src/android/NordicBlePlugin.java`

**Find (around line 960-980):**

```java
            @Override
            protected void initialize() {
                // Both operations go through Nordic's internal Request queue,
                // so they execute strictly sequentially on the Android BLE stack.
                requestMtu(DESIRED_MTU)
                        .with((device, mtu) -> {
                            negotiatedMtu = mtu;
                            Log.i(TAG, "MTU negotiated to " + mtu + " for " + profileName);
                        })
                        .fail((device, status) -> Log.w(TAG, "MTU request failed with status " + status))
                        .enqueue();

                if (notifyCharacteristic != null) {
                    enableNotifications(notifyCharacteristic).enqueue();
                }
            }
```

**Replace with:**

```java
            @Override
            protected void initialize() {
                // Three operations go through Nordic's internal Request queue,
                // so they execute strictly sequentially on the Android BLE stack.
                //
                // Order matters (verified by nRF Connect macro Qqqqq.xml):
                //   1. requestConnectionPriority(HIGH) — drop interval from
                //      Android default 37.5ms to 15ms (2.5× faster notifications)
                //   2. requestMtu(247) — increase payload from 20B to 244B
                //   3. enableNotifications(abf2) — start receiving MSP responses
                //
                // Without step 1, notification throughput is capped at ~27/sec
                // (37.5ms interval). With HIGH priority, it rises to ~67/sec
                // (15ms interval), giving 2.5× additional speedup on top of MTU 247.

                requestConnectionPriority(
                        android.bluetooth.BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                        .done(device -> Log.i(TAG, "Connection priority set to HIGH for " + profileName))
                        .fail((device, status) -> Log.w(TAG, "Connection priority HIGH failed: " + status))
                        .enqueue();

                requestMtu(DESIRED_MTU)
                        .with((device, mtu) -> {
                            negotiatedMtu = mtu;
                            Log.i(TAG, "MTU negotiated to " + mtu + " for " + profileName);
                        })
                        .fail((device, status) -> Log.w(TAG, "MTU request failed with status " + status))
                        .enqueue();

                if (notifyCharacteristic != null) {
                    enableNotifications(notifyCharacteristic).enqueue();
                }
            }
```

**Notes / 참고:**
- `BluetoothGatt.CONNECTION_PRIORITY_HIGH` is a constant (= 0) defined in Android's `BluetoothGatt` class. It corresponds to interval 7.5-15ms, latency 0, timeout 20s (per log line 32).
- `BluetoothGatt.CONNECTION_PRIORITY_HIGH`는 Android의 `BluetoothGatt` 클래스에 정의된 상수(= 0)다. 이는 간격 7.5-15ms, 레이턴시 0, 타임아웃 20s에 해당한다(로그 32행 참조).
- Nordic's `BleManager.requestConnectionPriority()` accepts this same constant.
- Nordic의 `BleManager.requestConnectionPriority()`는 같은 상수를 받는다.
- The `.done()` and `.fail()` callbacks are for logging only — they don't block the queue.
- `.done()`과 `.fail()` 콜백은 로깅용이며 큐를 막지 않는다.

### 8.2 Patch 2: Add MTU Validation Warning in JS / 패치 2: JS에 MTU 검증 경고 추가

**File / 파일:** `rfc/src/js/ble_central.js`

**Find (in `bleConnect` function, the `doConnect` callback):**

```javascript
                const peripheral = {
                    id: address,
                    address: address,
                    name: (device && device.displayName) || 'Unknown',
                    serviceUuid: (device && device.serviceUuid) || null,
                    writeCharacteristic: (device && device.writeCharacteristic) || null,
                    notifyCharacteristic: (device && device.notifyCharacteristic) || null,
                    mtu: result.mtu || BLE_REQUESTED_MTU,
                };
                if (onConnect) onConnect(peripheral);
```

**Replace with:**

```javascript
                const negotiatedMtu = result.mtu || BLE_DEFAULT_MTU;

                // MTU 검증 — nRF Connect 실기 측정에서 MTU 247이 100% 성공했으므로,
                // 247 미만이면 경고. (cordova-plugin-ble-central의 조용한 실패 방지)
                // MTU validation — nRF Connect real-device test showed MTU 247
                // succeeds 100% of the time; warn if lower. (Prevents the silent
                // failure mode that plagued cordova-plugin-ble-central.)
                if (negotiatedMtu < BLE_REQUESTED_MTU) {
                    console.warn(`[ble_central] MTU ${negotiatedMtu} < requested ${BLE_REQUESTED_MTU} — performance will be degraded. FC BLE module may not support MTU 247.`);
                } else {
                    console.log(`[ble_central] MTU ${negotiatedMtu} OK`);
                }

                const peripheral = {
                    id: address,
                    address: address,
                    name: (device && device.displayName) || 'Unknown',
                    serviceUuid: (device && device.serviceUuid) || null,
                    writeCharacteristic: (device && device.writeCharacteristic) || null,
                    notifyCharacteristic: (device && device.notifyCharacteristic) || null,
                    mtu: negotiatedMtu,
                };
                if (onConnect) onConnect(peripheral);
```

### 8.3 Patch 3: Add MTU Display in `serial.js connectBLE` / 패치 3: `serial.js connectBLE`에 MTU 표시 추가

**File / 파일:** `rfc/src/js/serial.js`

**Find (in `connectBLE` onConnect callback, after `self.bleMtu = peripheral.mtu || BLE_REQUESTED_MTU;`):**

```javascript
                console.log(`BLE: connected, MTU=${self.bleMtu}, svc=${self.bleServiceUUID}, tx=${self.bleTxCharUUID}, rx=${self.bleRxCharUUID}`);
                GUI.log(`BLE connected (MTU ${self.bleMtu})`);
```

**Replace with:**

```javascript
                console.log(`BLE: connected, MTU=${self.bleMtu}, svc=${self.bleServiceUUID}, tx=${self.bleTxCharUUID}, rx=${self.bleRxCharUUID}`);

                // MTU가 247 미만이면 UI에 경고 표시 (nRF Connect 실기 검증 기준)
                // Warn in UI if MTU is below 247 (based on nRF Connect real-device verification)
                if (self.bleMtu < BLE_REQUESTED_MTU) {
                    GUI.log(`BLE connected (MTU ${self.bleMtu} ⚠ — expected 247, performance degraded)`);
                } else {
                    GUI.log(`BLE connected (MTU ${self.bleMtu}, HIGH priority)`);
                }
```

### 8.4 Patch 4 (Optional): Periodic Connection Priority Re-request / 패치 4 (선택): 주기적 연결 우선순위 재요청

**Purpose / 목적:** Android may downgrade connection priority to BALANCED (30ms interval) after a period of inactivity. Re-requesting HIGH every 30 seconds during active MSP traffic prevents this.

Android는 일정 시간 비활성 후 연결 우선순위를 BALANCED(30ms 간격)로 다운그레이드할 수 있다. 활성 MSP 트래픽 중 30초마다 HIGH를 재요청하면 이를 방지한다.

**File / 파일:** `rfc/cordova/plugins/cordova-plugin-rfc-nordic-ble/src/android/NordicBlePlugin.java`

**Add a new Cordova action / 새 Cordova 액션 추가:**

In the `execute()` method's switch statement, add:

`execute()` 메서드의 switch 문에 다음을 추가:

```java
            case "requestHighPriority":  return handleRequestHighPriority(args, callbackContext);
```

Add the handler method / 핸들러 메서드 추가:

```java
    /**
     * Re-request CONNECTION_PRIORITY_HIGH. Call this every ~30 seconds during
     * active MSP traffic to prevent Android from downgrading to BALANCED.
     *
     * 활성 MSP 트래픽 중 Android가 BALANCED로 다운그레이드하지 못하도록
     * ~30초마다 호출하라.
     */
    private boolean handleRequestHighPriority(JSONArray args, CallbackContext callbackContext) {
        if (bleManager == null || !bleManager.isConnected()) {
            callbackContext.error("Not connected");
            return true;
        }
        bleManager.requestConnectionPriority(
                android.bluetooth.BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                .done(device -> {
                    JSONObject res = new JSONObject();
                    try { res.put("success", true); } catch (JSONException ignored) { }
                    callbackContext.success(res);
                })
                .fail((device, status) -> callbackContext.error("Priority request failed: " + status))
                .enqueue();
        return true;
    }
```

**JS side (`nordic_ble.js`) — add method / JS 쪽 (`nordic_ble.js`) — 메서드 추가:**

```javascript
    async requestHighPriority() {
        return execAsync('NordicBle', 'requestHighPriority', []);
    }
```

**Usage in `serial.js` (optional, in the MSP polling loop) / `serial.js`에서 사용 (선택, MSP 폴링 루프에서):**

```javascript
// Every 30 seconds during active connection:
// 활성 연결 중 30초마다:
if (self.connectionType === 'ble' && self.connected) {
    const nordicBle = getNordicBle();
    if (nordicBle) nordicBle.requestHighPriority().catch(() => {});
}
```

---

## 9. Updated Verification Plan / 수정된 검증 계획

### 9.1 Updated Logcat Expectations / 수정된 Logcat 예상

After applying Patches 1-3, the logcat during BLE connect should show:

패치 1-3 적용 후, BLE 연결 중 logcat은 다음을 표시해야 한다:

```
D NordicBle: Validating GATT services for 34:85:18:15:57:26
I NordicBle: Connection priority set to HIGH for SpeedyBee V2
I NordicBle: MTU negotiated to 247 for SpeedyBee V2
D NordicBle: (enableNotifications completes silently)
```

Then in the JS console:

그 다음 JS 콘솔에서:

```
[ble_central] MTU 247 OK
BLE: connected, MTU=247, svc=0000abf0-..., tx=0000abf1-..., rx=0000abf2-...
BLE connected (MTU 247, HIGH priority)
```

### 9.2 Updated Pass Criteria / 수정된 합격 기준

| Metric / 지표 | Old Spec Target / 이전 명세 목표 | Revised Target / 수정 목표 | Rationale / 근거 |
|---|---|---|---|
| First-page load / 첫 페이지 로드 | < 3 seconds | **< 2 seconds** | nRF Connect measured 40ms MSP round-trip; 15 commands × 2 fragments × 40ms = 1.2s theoretical |
| BLE handshake / BLE 핸드셰이크 | < 1 second | **< 1.5 seconds** | discoverServices alone takes 620ms; + HIGH + MTU + notify = ~900ms |
| MSP round-trip / MSP 왕복 | (not specified) | **< 60ms** | nRF Connect measured 27-53ms |
| MTU / MTU | 247 | **247** (must log "MTU 247 OK") | 9/9 success in nRF Connect test |
| Connection interval / 연결 간격 | (not specified) | **15ms** (HIGH) | Verified in nRF Connect log line 34 |
| Stability / 안정성 | 0 disconnects in 10 min | **0 disconnects in 10 min** | nRF Connect: 0 disconnects in 2:48 |

### 9.3 A/B Comparison Test / A/B 비교 테스트

To verify Patch 1 (`requestConnectionPriority(HIGH)`) actually helps, run the configurator twice:

패치 1(`requestConnectionPriority(HIGH)`)이 실제로 도움이 되는지 검증하기 위해 설정자를 두 번 실행하라:

1. **Build A / 빌드 A:** Plugin WITHOUT Patch 1 (original `initialize()` with only MTU + notify)
   패치 1 없는 플러그인 (MTU + notify만 있는 원본 `initialize()`)
2. **Build B / 빌드 B:** Plugin WITH Patch 1 (HIGH priority + MTU + notify)
   패치 1 있는 플러그인 (HIGH priority + MTU + notify)

Measure first-page load time for each. Expected:

각각의 첫 페이지 로드 시간을 측정하라. 예상:

| Build / 빌드 | Connection Interval / 연결 간격 | Expected Load Time / 예상 로드 시간 |
|---|---|---|
| A (no HIGH) | 37.5ms | 2-4 seconds |
| B (HIGH) | 15ms | 1-2 seconds |

If Build A is already fast enough (< 3s), Patch 1 is optional. If Build A is slow, Patch 1 is essential.

빌드 A가 이미 충분히 빠르면(< 3초) 패치 1은 선택사항이다. 빌드 A가 느리면 패치 1은 필수다.

### 9.4 Long-Session Stability Test / 장기 세션 안정성 테스트

After applying the patches, run a 30-minute stability test:

패치 적용 후 30분 안정성 테스트를 실행하라:

1. Connect to SB BT Nano 3
2. Navigate through all configurator tabs (Setup, Ports, PID, Receiver, etc.)
3. Leave idle for 5 minutes
4. Return to Setup tab and verify MSP data still flows
5. Repeat for 30 minutes total

**Pass criteria / 합격 기준:**
- Zero disconnects
- No "MTU changed to 23" log lines (would indicate MTU was re-negotiated down)
- All tab switches complete in < 3 seconds

---

## 10. Summary / 요약

### 10.1 Key Findings / 핵심 발견

1. **GATT structure verified / GATT 구조 검증됨:** Our `KNOWN_DEVICES` SpeedyBee V2 entry (service `abf0`, TX `abf1`, RX `abf2`) is 100% correct.
   우리의 `KNOWN_DEVICES` SpeedyBee V2 항목(service `abf0`, TX `abf1`, RX `abf2`)이 100% 정확하다.

2. **MTU 247 works / MTU 247 작동함:** SB BT Nano 3 supports MTU 247 reliably (9/9 success in nRF Connect test). The Nordic plugin's queued `requestMtu(247)` will succeed.
   SB BT Nano 3는 MTU 247을 안정적으로 지원한다(nRF Connect 테스트에서 9/9 성공). Nordic 플러그인의 큐된 `requestMtu(247)`이 성공할 것이다.

3. **`requestConnectionPriority(HIGH)` is the missing piece / `requestConnectionPriority(HIGH)`가 누락된 조각:** This drops the connection interval from 37.5ms to 15ms, providing 2.5× faster notification throughput. Both BFC's original plugin and our migration spec omitted it.
   이것이 연결 간격을 37.5ms에서 15ms로 낮춰 notify 처리량을 2.5배 높인다. BFC 원본 플러그인과 우리의 마이그레이션 명세서 둘 다 이것을 생략했다.

4. **MSP framing verified / MSP 프레이밍 검증됨:** The request `0x244D3C000101` and response `0x244D3E0301000C0907` are standard MSP V1 frames that our `createMspReassembler()` handles correctly.
   요청 `0x244D3C000101`과 응답 `0x244D3E0301000C0907`은 우리의 `createMspReassembler()`가 올바르게 처리하는 표준 MSP V1 프레임이다.

5. **Performance baseline established / 성능 기준선 확립:** At MTU 247 + HIGH priority, MSP round-trip is 27-53ms (average 41ms). This sets the theoretical minimum for first-page load at ~1.2 seconds (15 commands × 2 fragments × 40ms).
   MTU 247 + HIGH priority에서 MSP 왕복은 27-53ms(평균 41ms)다. 이는 첫 페이지 로드의 이론적 최솟값을 ~1.2초(15 명령 × 2 프래그먼트 × 40ms)로 설정한다.

6. **Stability confirmed / 안정성 확인됨:** Zero disconnects, zero GATT errors, consistent RSSI (-57 to -64 dBm) over a 2:48 session.
   2:48 세션 동안 단절 0건, GATT 에러 0건, 일관된 RSSI(-57 ~ -64 dBm).

### 10.2 Required Patches / 필수 패치

| Patch / 패치 | File / 파일 | Priority / 우선순위 | Status / 상태 |
|---|---|---|---|
| 1. Add `requestConnectionPriority(HIGH)` to `initialize()` | `NordicBlePlugin.java` | ★★★★★ | Required / 필수 |
| 2. MTU validation warning in JS | `ble_central.js` | ★★★☆☆ | Recommended / 권장 |
| 3. MTU display in `serial.js` | `serial.js` | ★★★☆☆ | Recommended / 권장 |
| 4. Periodic HIGH re-request | `NordicBlePlugin.java` + `nordic_ble.js` + `serial.js` | ★★☆☆☆ | Optional / 선택 |

### 10.3 Next Steps / 다음 단계

1. **Apply Patch 1** (5 minutes) — add `requestConnectionPriority(HIGH)` to `BleBridgeManager.initialize()`.
2. **Apply Patches 2-3** (10 minutes) — add MTU validation and display.
3. **Build & install** — `pnpm gulp app --platform android` + `adb install -r`.
4. **Real-device test** — connect to SB BT Nano 3, verify logcat shows "Connection priority set to HIGH" + "MTU negotiated to 247", measure first-page load time.
5. **If load time is still > 3 seconds**, apply Patch 4 (periodic HIGH re-request) and re-test.
6. **Update `RFC_Nordic_BLE_Migration_Spec.md`** — incorporate the patches from this document into the main spec.

### 10.4 Confidence Level / 신뢰도

**High / 높음.** The nRF Connect log is ground-truth evidence of how the SB BT Nano 3 actually behaves. Our plugin's `BleBridgeManager` uses the same Nordic `BleManager` API as nRF Connect, so replicating the macro's sequence (minus the conservative 300ms sleeps) will produce equivalent or better results.

nRF Connect 로그는 SB BT Nano 3가 실제로 어떻게 동작하는지에 대한 ground-truth 증거다. 우리 플러그인의 `BleBridgeManager`는 nRF Connect와 같은 Nordic `BleManager` API를 사용하므로, 매크로의 시퀀스(보수적인 300ms sleep 제외)를 재현하면 동등하거나 더 나은 결과를 얻을 것이다.

---

**End of Document / 문서 끝**

*This document supplements `RFC_Nordic_BLE_Migration_Spec.md`. Apply the patches from Section 8 to the files created by the main spec before building.*

*이 문서는 `RFC_Nordic_BLE_Migration_Spec.md`를 보완한다. 빌드 전에 본 문서 8절의 패치를 메인 명세서가 생성한 파일에 적용하라.*
