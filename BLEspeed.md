# Rotorflight Configurator BLE 최적화 작업 최종 보고서

> 작성일: 2026-07-17
> 적용 버전: Rotorflight Configurator 2.3.5 (Cordova APK)
> 대상: SpeedyBee Nano 3 (ESP32-C3 BLE 모듈)

---

## 1. 문제 정의

Rotorflight Configurator를 안드로이드 APK로 사용할 때,
BLE 연결 시 탭 로딩이 1분 이상 걸리는 현상이 발생했다.
같은 폰, 같은 FC, 같은 BLE 모듈에서 Betaflight Configurator는
정상 속도로 동작하여 더욱 의문이 컸다.

---

## 2. 작업 연대기

### Phase 0: 진단과 오해 (2026-07-11 ~ 07-15)

| 날짜 | 작업 | 결과 |
|------|------|------|
| 07-11 | BLE 테스트용 네이티브 안드로이드 APK 제작 | BLE 자체는 100ms 내 응답 확인 |
| 07-11 | Betaflight vs Rotorflight 코드 구조 비교 | 구조는 거의 동일, 차이점 없음 |
| 07-12 | `cordova.exec()` 브릿지 overhead 분석 | evaluateJavascript 직통 주입 → **효과 없음** |
| 07-13 | `requestConnectionPriority(HIGH)` 실험 | 미미한 영향 |
| 07-14 | MTU 515 → 247 fallback 문제 확인 | 원복 |

### Phase 1: 근본 원인 발견 (2026-07-15 ~ 07-16)

| 발견 | 설명 |
|------|------|
| MSP `promise()` 미완료 | MSP 응답 디코딩 후 `resolve()` 호출 누락.
  Promise가 영원히 대기 상태, 다음 요청 진행 불가 |
| 무한 재전송 구조 | 응답 도착 여부와 무관하게 타이머가 계속 재전송.
  중복 요청으로 FC 부하 가중 |
| MTU 분할 누락 | 큰 MSP 프레임(>MTU)을 그대로 전송 → BLE 스택에서 드랍 |

**핵심 커밋:** `4f160d98 fix(ble): improve BLE MSP throughput and reliability`
- MSP 응답 도착 시 `_dispatch_message`에서 콜백 호출 (Promise 완료)
- 재시도: 랜덤 지터 → 2초 고정, **응답 오면 즉시 중지**
- MTU 분할 전송: `fragmentMspFrame` 도입

### Phase 2: 탭 로딩 병렬화 (2026-07-16)

| 탭 | 개선 전 | 개선 후 | 비고 |
|-----|--------|--------|------|
| Status | 1분 (`.then()` 체인 x7 + 타임아웃) | 6초 (`batchCodes` 병렬) | `805a013a` |
| Auxiliary | 이미 `batchCodes` 사용 | 유지 | |
| 기타 탭 | `.then()` 체인 | `batchCodes`로 전환 완료 | `2fe2a0ef` |

### Phase 3: Keepalive (2026-07-17)

| 커밋 | 내용 |
|------|------|
| `24a2439b` | Options 페이지에 BLE Keepalive Interval 드롭다운 추가 |
n### Phase 0: 진단과 오해 (2026-07-11 ~ 07-15)

| 날짜 | 작업 | 결과 |
|------|------|------|
| 07-11 | BLE 테스트용 네이티브 안드로이드 APK 제작 | BLE 자체는 100ms 내 응답 확인 |
| 07-11 | Betaflight vs Rotorflight 코드 구조 비교 | `_dispatch_message` 외 동일 |
| 07-12 | `cordova.exec()` 브릿지 overhead 분석 | evaluateJavascript 직통 → **효과 없음** |
| 07-12 | Betaflight 원본 diff 분석 | **Betaflight도 `_dispatch_message`에 callback dispatch 없음** |
| 07-13~14 | MTU/ConnectionPriority 실험 | 미미, 원복 |

### Phase 1: 근본 원인 발견 (2026-07-15 ~ 07-16)

`_dispatch_message` callback dispatch가 없으면 `MSP.promise()`는 절대 resolve되지 않는다.
Betaflight도 동일한 구조지만, Vue 반응형 데이터 바인딩 덕분에 `listener` 경로(`notify()` → `process_data()`)로
FC 변수 업데이트 → 자동 UI 갱신이 가능해 탭이 정상 표시된다.
반면 Rotorflight는 jQuery 기반이라 `load_data(load_html)` 패턴이 Promise 완료에 의존적이라 치명적이었다.

**핵심 커밋:** `4f160d98 fix(ble): improve BLE MSP throughput and reliability`
- `_dispatch_message`에 callback dispatch 추가 (Promise 완료 + 타이머 해제)
- 재시도: 랜덤 지터 → 2초 고정, 응답 오면 즉시 중지
- MTU 분할 전송 도입

MTU 247을 넘는 MSP 프레임을 분할 없이 한 번에 전송.
BLE 컨트롤러가 데이터를 버리거나 손상시킴.
FC는 CRC 오류로 응답 불가 → 재전송 유발.

---

## 4. 성능 측정 결과

### BLE 테스트 APK (네이티브 안드로이드, WebView 없음)

```
평균 MSP 응답 시간: 73~138ms
최대: BEEPER_CONFIG 332ms
타임아웃: ARMING_CONFIG, MODE_RANGES_EXTRA (FC 지원 안 함)
전체 30개 명령 처리: 2.7초 (30 × 90ms)
```

**BLE 자체는 충분히 빠르다. 느린 건 앱 코드였다.**

### Configurator 탭 로딩 시간

| 탭 | 개선 전 | 개선 후 | 비고 |
|-----|--------|--------|------|
| Status (첫 진입) | ~1분 | ~6초 | batchCodes + Promise 수정 |
| Status (재진입) | 30~60초 | 1~3초 | 캐시 효과 |
| Mode (Auxiliary) | 1분+ | 1~3초 | 이미 batchCodes 사용 |
| 모든 탭 (재진입) | 30초~1분 | 1~3초 | |

---

## 5. 최종 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/js/msp.svelte.js` | Promise resolve, 재시도 2초 고정, 응답 시 중지 |
| `src/js/serial.js` | MTU 분할 전송, Keepalive, `config` import |
| `src/js/tabs/status.js` | `.then()` × 7 → `batchCodes` 병렬 |
| `src/tabs/options.html` | Keepalive Interval 드롭다운 |
| `src/js/tabs/options.js` | Keepalive 설정 저장/복원/재시작 |
| `blespeedup.md` | 작업 보고서 |

---

n## 6. 남은 이슈

| 이슈 | 상태 |
|------|------|
| Status 탭 첫 진입 | **해결됨** (keepalive + batchCodes로 3초 내) |
| BLE 유휴 시 절전 모드 진입 | **해결됨** (Keepalive, 기본 15초 유휴 기반) |
| PendingIntent lint 경고 3건 | 기능 무관, USB 케이블 연결 시 Android 12+ 크래시 가능 |
| Capacitor 이관 | 시도했으나 빈 페이지 (의존성 누락) |

---

## 7. 결론

### 진짜 병목 3가지

1. **`_dispatch_message` callback dispatch 누락** ← MSP.promise()가 영원히 resolve 안 됨
   - Betaflight도 동일한 구조이지만 Vue 반응형으로 인해 문제가 드러나지 않음
   - Rotorflight는 jQuery 기반이라 `load_data(load_html)` 패턴이 Promise에 의존적이라 치명적
2. **응답 무시 무한 재전송** ← 쓸데없는 중복 트래픽으로 FC 부하 가중
3. **MTU 분할 누락** ← 큰 프레임 손실 → 응답 불가

### 최종 성능

| 항목 | 개선 전 | 개선 후 |
|------|---------|---------|
| AUX/Mode 탭 | 1분+ | 1~3초 |
| Status 첫 진입 | 1분 | **3초 내** (keepalive 적용 후) |
| Status 재진입 | 30~60초 | 1~3초 |
| 기타 탭 | 30초~1분 | 1~3초 |
| BLE 응답 자체 | 90ms | 90ms (변화 없음, 처음부터 빠름) |

         → 15초 유휴 → Keepalive 전송 → 연결 유지
```

---

*이 보고서는 2026년 7월 11일부터 17일까지 7일간의 BLE 최적화 작업을 정리한 문서입니다.*
