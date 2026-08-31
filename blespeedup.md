# BLE Speed-Up — Patch Analysis & Roll-out Plan

> **커밋**: `e40aa2e` — *Important BLE speed increase: per-code retry for corrupted MSP frames + batched tab loading + reassembler resync guard*
>
> 작업 하기 전 이 커밋 내용을 상세 분석하여 속도 증가를 위한 정확한 패치 방법을 알아낸다.
> **저자 노트**: 이 문서는 **코드 수정 없이** 패치를 분석한 결과 보고서와, 아직 패치가 적용되지 않은 탭으로의 적용 계획을 담고 있다. 자체적으로는 편집 가능한 설계 메모이며, 구현은 별도 PR/커밋으로 진행한다.

---

## 1. 문제 정의 (사용자 관찰)

| 증상                 | 관찰 위치         | 정량                                                     |
| -------------------- | ----------------- | -------------------------------------------------------- |
| BLE 탭 로드가 느리다 | 모든 connected 탭 | 명령 1개당 라운드트립 ~수십~수백 ms                      |
| 가끔 영구히 멈춘다   | 동일              | 응답이 돌아오지 않아 “Wait for loading…” 오버레이 미해제 |
| CLI `dump`는 빠르다  | `cli` 탭          | 명령 1회 → 텍스트 스트림 1회 수신                        |
| 깨진 글자 ~1%        | `cli` 탭 표시     | 물리 링크 잡음 (BLE MTU 단편화 환경)                     |

핵심 차이: **CLI는 “요청 1회 → 연속 응답” 의 단방향 스트림이고, MSP는 “요청 N회 → 응답 N회” 의 양방향 왕복**이다. BLE에서 N왕복은 N×지연을 그대로 곱한다. 게다가 1% 손상이 응답에 섞여 들어오면 MSP는 “CRC 실패 = 빈 성공” 으로 처리해 **재전송이 일어나지 않아 데이터가 조용히 비어버리고, 후속 코드가 유실되면 다음 시도에서 재조립기가 캐스케이드 역동기로 더 큰 손실**을 일으킨다.

---

## 2. 패치 4종 — 정확한 변경 내역

### 2.1 `[msp.svelte.js] _dispatch_message()` — CRC 실패를 “성공”으로 처리하지 않음

| 항목          | 변경 전                                             | 변경 후                                                                                                         |
| ------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| CRC 불일치 시 | `dataView = new DataView(0)` + `cb.callback(empty)` | `packet_error++`, `crcError = true`, **콜백 호출 없음** (`continue`)                                            |
| 콜백 상태     | 즉시 resolve (빈 데이터)                            | **pending 유지** → 재전송 메커니즘(`send_message` 인터벌 / `send_batch` targeted re-send)이 그 코드만 다시 요청 |
| 이점          | (현상: 빈 값으로 silent success)                    | 깨진 MSP 프레임 1개로 인해 데이터가 비는 일이 사라짐, 재전송이 “있는 그대로” 동작                               |

핵심 라인:

```js
if (!isValid) {
    // CRC-error response: keep this callback registered so the
    // retry machinery (send_message interval / send_batch
    // targeted re-send) re-requests exactly this code.
    continue;
}
```

이 한 변경이 4개 패치의 전제 조건이다. 없으면 아래 2.2·2.3의 재전송이 “이미 끝난 일” 이 되어 발동하지 않는다.

---

### 2.2 `[msp.svelte.js] send_batch()` — 코드별 targeted 재전송 (BLE 핵심)

| 단계               | 동작                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1) 초기 전송       | 요청 N개를 단일 합본 버퍼로 만들어 **단 1회 BLE write** → N 라운드트립을 1회로 축소                                                                                   |
| 2) 응답 수신       | `batchPending[code]` 가 응답하는 순서대로 `null` 로 마킹                                                                                                              |
| 3) 재전송 트리거   | `setTimeout(batchSend, batchRetryInterval)` — `bleRetryInterval`(기본 2s)마다 1회                                                                                     |
| 4) Targeted 재전송 | `batchPending` 에서 **아직 응답하지 않은 코드만** 골라 `combineFrames()` 로 다시 합본 1회 write                                                                       |
| 5) 종료 조건       | (a) 모든 코드 응답 / (b) 코드당 `bleBatchMaxRetries`(기본 3) 도달 → `giveUpCode()` 로 `empty DataView` resolve / (c) 전 배치 타임아웃 `bleRequestTimeoutMs`(기본 20s) |
| 6) 일괄 종료       | `Promise.all(promises).then(allCallback)` — `settleTimer` 클리어 후 일괄 콜백 호출                                                                                    |

추가 동시 수정:

- `allCallbackCalled` 가 함수 스코프 지역으로 격리됨 (전역 가드가 아니게 됨) → 직전 배치가 끝나지 않은 상태에서 다음 배치가 발사되어도 두 콜백이 **각각 한 번씩** 호출됨. 직전엔 한쪽이 영구히 무시되어 오버레이가 닫히지 않음.
- 배치 내 **중복 코드는 promise 공유** — `MSP.callbacks` 에 중복 push 하지 않음, progress `loaded++` 중복 카운트 방지.
- **재전송 시 “이미 응답한 코드는 절대 재요청하지 않는다”** (BLE 대역폭/FC 부하 동시 절감).

---

### 2.3 `[msp.svelte.js] send_message()` & `promise()` — 무한로딩 방지

| 변경                                                                | 의도                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `setTimeout(requestTimeoutMs)` 가 `!requestExists` 분기 밖으로 이동 | **부착(attach)된 콜백도 타임아웃 보유** — 콜백이 있어 응답이 안 오면 타임아웃이 강제 해제 |
| `MSP.promise()` 가 `doCallbackOnError=true` 로 `send_message` 호출  | 무응답 시 `resolve(undefined)` → `await` 가 영구히 멈추지 않음                            |
| 기본 20s 타임아웃                                                   | 사용자가 옵션 탭에서 `5~60s` 조절 가능                                                    |

CLI 활성화 시 재전송 인터벌이 즉시 `clearInterval` 되고 콜백이 해소되도록 보존(`CONFIGURATOR.cliEngineActive` 분기).

---

### 2.4 `[ble_central.js] createMspReassembler()` — 캐스케이드 역동기 차단

```js
const MAX_MSP_FRAME_SIZE = 8192;
…
if (totalLen > MAX_MSP_FRAME_SIZE) {
    // length byte corrupted -> drop 1 byte and re-sync
    console.warn('[MSP REASSEMBLER] implausible frame length ' + totalLen + ' - resyncing');
    buffer = buffer.slice(1);
    continue;
}
```

배경: BLE 잡음으로 length 바이트가 0xFF, 0xFE, 0x80 등으로 오염되면, 재조립기는 그 “터무니없이 큰 프레임” 의 payload 가 도착할 때까지 **이후 도착하는 모든 정상 프레임을 흡수**한다. 한 번 길이가 어긋나면 **수 KB 의 후속 데이터가 한꺼번에 사라지는** 연쇄 유실이 발생. 상한(8KB, FC가 실제로 보내는 최대치보다 한참 위) 으로 잘라 1바이트씩 리싱크 → **오염 길이를 만나도 정상 흐름을 회복**한다.

---

## 3. 적용된 탭 (현재 상태)

`grep -n 'MSP\.batch\|MSP\.send_batch' src/js/tabs/*.js` 결과, **아래 5개 탭**이 패치를 활용 중이다:

| #   | 탭            | 파일                               | 적용 방식                                             | 효과                                |
| --- | ------------- | ---------------------------------- | ----------------------------------------------------- | ----------------------------------- |
| 1   | auxiliary     | `src/js/tabs/auxiliary.js:32`      | `MSP.batchCodes([…])`                                 | 주기 갱신 명령 묶음 처리            |
| 2   | configuration | `src/js/tabs/configuration.js:328` | `await MSP.batchCodes(requests)` + 후속 `MSP.promise` | 탭 진입 시 1회 일괄 로드            |
| 3   | power         | `src/js/tabs/power.js:90`          | `await MSP.batchCodes(requests)`                      | 배터리/전원 설정 일괄 로드          |
| 4   | setup         | `src/js/tabs/setup.js:21`          | `MSP.batchCodes([…])`                                 | 최초 연결 시 FC 기본 정보 일괄 로드 |
| 5   | status        | `src/js/tabs/status.js:96`         | `MSP.batchCodes([…])`                                 | 상태/센서 정보 일괄 로드            |

옵션 탭(`src/tabs/options.html`, `src/js/tabs/options.js`)에는 사용자 조절용 BLE 옵션 4종 추가:

- `bleKeepalive` (기본 15s)
- `bleRetryInterval` (기본 2s)
- `bleRequestTimeoutMs` (기본 20s)
- `bleBatchMaxRetries` (기본 3)

---

## 4. 패치 미적용 탭 (적용 후보)

탭 진입/주기 호출에서 여전히 **순차 `MSP.promise().then()`** 체인을 사용한다. BLE에서는 각 `await` 마다 라운드트립 대기가 누적되므로 가장 개선 폭이 큰 영역이다. ( 빈 번호는 필요없는 탭이라 삭제함 )

| #   | 탭          | 파일                                 | 사용 명령 수 (load) | 비고                                                |
| --- | ----------- | ------------------------------------ | ------------------- | --------------------------------------------------- |
| 1   | profiles    | `src/js/tabs/profiles.js:67-75`      | **9**               | PID/Rescue/Governor/Sensor/Battery 등 — 가장 무거움 |
|     |             |                                      |                     |                                                     |
| 3   | servos      | `src/js/tabs/servos.js:36-40`        | **5**               | 다중 서보 설정 일괄                                 |
| 4   | rates       | `src/js/tabs/rates.js:266-269`       | **4**               | RC/믹서 의존성 있음                                 |
| 5   | mixer       | `src/js/tabs/mixer.js:61-66`         | **5**               | 입력/룰/오버라이드                                  |
|     |             |                                      |                     |                                                     |
|     |             |                                      |                     |                                                     |
|     |             |                                      |                     |                                                     |
| 9   | adjustments | `src/js/tabs/adjustments.js:133-135` | **3**               |                                                     |
|     |             |                                      |                     |                                                     |

> 저장 경로(`MSP_EEPROM_WRITE`, `MSP_SET_*`)는 응답을 반드시 순차로 기다려야 하므로 **건드리지 않는다**. 패치 적용 대상은 **`load_data` (탭 진입 시점)** 한정.

---

## 5. 적용 계획 (코드 수정 미수행, 설계 단계)

### 5.1 변환 패턴 (공통)

**변경 전** (대표 예: `profiles.js`):

```js
function load_data(callback) {
    Promise.resolve(true)
        .then(() => MSP.promise(MSPCodes.MSP_STATUS))
        .then(() => MSP.promise(MSPCodes.MSP_FEATURE_CONFIG))
        .then(() => MSP.promise(MSPCodes.MSP_PID_TUNING))
        …
        .then(callback);
}
```

**변경 후**:

```js
function load_data(callback) {
    MSP.batchCodes([
        { code: MSPCodes.MSP_STATUS },
        { code: MSPCodes.MSP_FEATURE_CONFIG },
        { code: MSPCodes.MSP_PID_TUNING },
        …
    ]).then(() => callback());
}
```

원칙:

1. `load_data()` 의 `MSP.promise()` 체인만 `MSP.batchCodes()` 로 교체.
2. `save_data()` 는 손대지 않음 (쓰기 순서·응답 의존성 유지).
3. **콜백에서 다음 promise 의 입력으로 사용하는 경우** (예: 첫 응답의 `length` 로 다음 `MSP.promise(MSPCodes.MSP_xxx, payload)` 의 payload 를 만드는 패턴) 는 batchCodes 적용 불가 — 그런 의존 체인이 있는지 사전 grep으로 확인하고, 의존성이 있으면 그대로 두거나 의존 부분 직전에서 split.
4. **`.then(() => MSP.promise(MSP_SELECT_SETTING, [self.savedProfile + self.RATE_PROFILE_MASK]))`** 처럼 `data` 가 **JS 변수**인 경우 batchCodes는 정적 `data: Uint8Array | false` 만 받으므로 — 옵션 A: `Uint8Array.from([...])` 변환, 옵션 B: 의존이므로 그대로 유지. (대부분 profile 선택은 **사용자 액션** 시점이므로 batch 영역 밖)
