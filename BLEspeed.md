# Rotorflight Configurator BLE 최적화 작업 최종 보고서

> 작성일: 2026-07-17 | 최종수정: 2026-07-17
> 적용 버전: Rotorflight Configurator 2.3.5 (Cordova APK)
> 대상: SpeedyBee Nano 3 (ESP32-C3 BLE 모듈)

---

## 1. 작업 개요

Rotorflight Configurator를 안드로이드 APK로 사용할 때,
BLE 연결 시 탭 로딩이 1분 이상 걸리는 현상 개선.

**최종 결과:** 탭 로딩 1~3초. Status 첫 진입 1분 → 3초.

---

## 2. 발견된 근본 원인 3가지

### 2.1 `_dispatch_message` callback dispatch 누락 (가장 치명적)

**파일:** `src/js/msp.svelte.js` (Svelte 기반, jQuery/Vue 아님)

MSP 응답이 도착했을 때 `obj.callback(this.dataView)`를 호출하지 않아서
`MSP.promise()`로 생성된 Promise가 영원히 resolve되지 않았다.

```js
// old: _dispatch_message
this.notify();  // FC 변수 업데이트만 함
// 콜백 없음 → Promise 영원히 대기

// fix: _dispatch_message (4f160d98)
this.notify();
// 추가된 코드:
for (let i = 0; i < this.callbacks.length; i++) {
    const cb = this.callbacks[i];
    if (cb && cb.code === responseCode && typeof cb.callback === 'function') {
        cb.callback(this.dataView);   // ← Promise resolve!
        clearTimeout(cb.timer);       // ← 재전송 중지
        this.callbacks.splice(i, 1);
    }
}
```

왜 예전에도 간신히 동작했는가:
- Svelte의 반응형 상태(`$state`, `$derived`)는 `notify()` → `mspHelper.process_data()`
  경로로 FC 변수가 업데이트되면 UI가 자동 갱신된다.
- 하지만 `load_data(load_html)` 패턴은 HTML 로딩 자체가 `.then(callback)`에
  의존적이어서 Promise 완료가 필수였다.
- `MSPShelper.process_data` 내부에 별도의 `dataHandler.callbacks` 배열이 존재하지만
  이것은 `MSP_MULTIPLE_MSP` 배치용이며, `MSP.promise()`의 `callbacks` 배열과 다르다.
- `batchSend`에 있던 5초 `Promise.race` 타임아웃이 유일한 fallback이었다.
  (7개 직렬이면 35초 + 재시도 = ~1분)

### 2.2 응답 무시 무한 재전송

**파일:** `src/js/msp.svelte.js` — `send_message()`

응답이 도착했는지 확인하지 않고 1~2초마다 무한 재전송.
FC에 중복 요청 쌓여 응답 지연 → 더 많은 재전송 악순환.

### 2.3 MTU 분할 누락

큰 MSP 프레임을 MTU 247을 넘겨 한 번에 전송 → BLE 컨트롤러 드랍.
FC는 CRC 오류로 응답 불가 → 재전송.

---

## 3. Betaflight와 차이점

`_dispatch_message` callback dispatch는 **Betaflight에도 없다.**
Betaflight의 `notify()`도 똑같이 `listener` → `process_data()`만 호출한다.

Betaflight가 문제없는 이유:
- Betaflight의 Vue 기반 탭은 FC 변수 업데이트만으로 UI가 자동 갱신된다.
- Rotorflight의 Svelte 기반 탭도 동일한 반응형 시스템을 갖추고 있지만,
  `load_data(load_html)`라는 추가 래퍼 패턴이 Promise 완료에 의존적이었다.
- 이 패턴이 HTML 템플릿 로딩과 데이터 수신을 결합시켜 Promise 미완료 시
  HTML 자체가 로딩되지 않는 문제를 일으켰다.

| 항목 | Betaflight | Rotorflight (old) |
|------|-----------|-------------------|
| 프레임워크 | **Vue.js** (최근 Svelte 전환 중) | **Svelte 5** |
| `_dispatch_message` callback | ✗ 없음 | ✗ 없음 (동일) |
| Tab 로딩 | Promise + Vue 반응형 | Promise + `load_data(load_html)` 패턴 |
| 배치 전송 | `MSP.promise()` 병렬 | `MSP.batchCodes()` / `.then()` 직렬 |

---

## 4. 작업 연대기

### Phase 0: 진단 (07-11 ~ 07-15)

| 날짜 | 작업 | 결과 |
|------|------|------|
| 07-11 | 네이티브 BLE 테스트 APK 제작 | MSP 명령 30개, 평균 **90ms** 응답 확인 |
| 07-11 | Betaflight vs Rotorflight 구조 diff | `_dispatch_message` 외 동일. **Betaflight도 callback dispatch 없음** 확인 |
| 07-12 | `evaluateJavascript` 직통 주입 | 효과 없음 — 브릿지가 병목 아님을 증명 |
| 07-13~14 | MTU 변경, ConnectionPriority 실험 | 미미한 영향, 원복 |

### Phase 1: `_dispatch_message` callback dispatch 추가 (07-16)

**커밋 `4f160d98`**
- `_dispatch_message`에 `cb.callback(this.dataView)` 추가
- 재시도: 랜덤 지터(1000~2000ms) → 2초 고정, 응답 시 중지
- MTU 분할 전송 도입 (`fragmentMspFrame`)

→ 탭 로딩: 1분 → **6초**

### Phase 2: Status 탭 직렬 → batchCodes (07-17)

**커밋 `805a013a`**
- Status 탭 `.then()` 체인(7개 직렬) → `MSP.batchCodes()` 병렬
- 7회 왕복 → 1회 배치로 단축

→ Status 첫 진입: 1분 → **6초**

### Phase 3: BLE Keepalive (07-17)

**커밋 `fff6f74a`**
- Options 페이지: 유휴 시간 기반 Keepalive (기본 15초)
- 백그라운드 체크, 연결 중 옵션 변경 시 즉시 재시작

→ 유휴 시간 후 재진입 속도 안정화

---

## 5. 성능 측정 결과

### BLE 테스트 APK (네이티브 안드로이드, WebView 없음)

```
평균 MSP 응답 시간: 87~138ms
최대: BEEPER_CONFIG 332ms
전체 30개 명령 처리: 2.7초
```

**BLE는 처음부터 충분히 빨랐다. 문제는 앱 코드였다.**

### Configurator 탭 로딩 시간

| 탭 | 개선 전 | 개선 후 | 원인 |
|-----|--------|--------|------|
| Status 첫 진입 | ~1분 | ~6초 (batchCodes 적용 후) / ~3초 (callback dispatch 이후) | 7개 직렬 `.then()` 체인 + Promise 미완료 |
| Status 재진입 | 30~60초 | 1~3초 | 캐시됨 + 정상 Promise |
| AUX / Mode | 1분+ | 1~3초 | Promise 미완료 + 무한 재전송 |
| 기타 탭 | 30~1분 | 1~3초 | 동일 |

---

## 6. 최종 성능 요약

| 항목 | 개선 전 | 개선 후 |
|------|---------|---------|
| `_dispatch_message` callback | ✗ 누락 | **✓ Promise resolve + 타이머 중지** |
| 재전송 | 1~2초 랜덤, 무한 | 2초 고정, 응답 오면 즉시 중지 |
| MTU 처리 | 분할 없음 (손실) | MTU 단위 분할 전송 |
| 탭 로딩 | 30초~1분 | 1~3초 |
| Status 첫 진입 | 1분 | 3초 |
| BLE keepalive | 없음 (유휴 시 절전) | 유휴 기반 15초 (옵션: 10/15/20/30/60/off) |
| FC 부하 | 중복 요청 다수 | 필요한 만큼만 |

---

## 7. 변경 파일 총정리

| 파일 | 변경 내용 |
|------|----------|
| `src/js/msp.svelte.js` | **핵심:** `_dispatch_message` callback dispatch 추가. 재시도 2초 고정 + 응답 시 중지 |
| `src/js/serial.js` | MTU 분할 전송, Keepalive (config import + `_startBleKeepalive`) |
| `src/js/tabs/status.js` | `.then()` × 7 → `batchCodes` 병렬 |
| `src/tabs/options.html` | Keepalive Interval 드롭다운 |
| `src/js/tabs/options.js` | Keepalive 설정 + 연결 중 변경 시 타이머 재시작 |
| `src/js/serial_backend.js` | `auto_connect` 기본값 `true` → `false` |

---

## 8. 교훈

1. **BLE는 빠르다.** 90ms 내 응답이 온다. 느린 건 항상 앱 코드였다.
2. **Promise resolve를 까먹지 마라.** 응답 도착 시 `callback(dataView)` 호출 하나가 모든 차이를 만든다.
3. **직렬은 느리다.** 여러 요청을 한 번에 보내면 N배 빨라진다.
4. **확인하지 않는 재전송은 독이다.** 응답 수신 여부를 확인하고 중지해야 한다.
5. **MTU를 넘는 데이터는 분할하라.** 안드로이드 BLE 스택이 자동 분할해주지 않는다.
6. **`notify()`만으로 Promise가 해결되지 않는다.** listener 경로는 UI 업데이트만 담당한다.
7. **프레임워크 차이가 드러나지 않던 버그를 감춘다.** Betaflight의 Vue가 동일한 버그를
   반응형 시스템으로 숨겨주고 있었고, Rotorflight의 `load_data(load_html)` 패턴은
   그 버그를 그대로 드러냈다.

---

*이 보고서는 2026년 7월 11일부터 17일까지 7일간의 BLE 최적화 작업을 정리한 문서입니다.*
