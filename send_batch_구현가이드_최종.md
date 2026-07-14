# send_batch / batchCodes 구현 가이드

> 적용 파일:
> - `src/js/msp.svelte.js` — `send_batch()` 및 `batchCodes()` 추가
> - `src/js/serial_backend.js` — `onConnect()`에서 `batchCodes` 사용
> 대상 저장소: `https://github.com/saydals/rf`

---

## 1. 변경 사항 요약

### 1.1 `src/js/msp.svelte.js`

**추가된 함수 (2개):**

| 함수 | 목적 | 호출 형태 |
|------|------|----------|
| `MSP.send_batch(requests, allCallback)` | 여러 MSP 요청을 단일 BLE write로 병합 전송 | 콜백 기반 |
| `MSP.batchCodes(requestSpecs)` | send_batch의 Promise 래퍼 | `await` 가능 |

**삽입 위치**: 기존 `MSP.promise()` 함수 뒤, `MSP.callbacks_cleanup()` 앞

### 1.2 `src/js/serial_backend.js`

**변경 위치**: `onConnect()` 함수 내 (약 574행)

**변경 내용**: 5개의 순차 `await MSP.promise(...)` 호출 → 1개의 `await MSP.batchCodes([...])` 호출

---

## 2. 핵심 설계 의사결정

### 2.1 기존 `send_message`의 `requestExists` 체크와의 충돌 방지

**기존 `send_message` 동작 (recap):**

```javascript
let requestExists = false;
for (const value of MSP.callbacks) {
    if (value.code === code) { requestExists = true; break; }
}

if (!requestExists) {
    // 재시도 타이머 설정 (3초 간격)
    obj.timer = setInterval(..., 3000);
}

MSP.callbacks.push(obj);  // 항상 push

if (data || !requestExists) {
    serial.send(bufferOut, ...);  // data가 있거나 신규 요청만 전송
}
```

→ 동일 code가 이미 큐에 있으면:
- callback obj는 push (응답 공유)
- 단, 재전송은 안 함 (기존 요청의 응답을 함께 기다림)
- `data`가 있으면 (쓰기 요청) 무조건 전송

**`send_batch` 동작 (동일 정책 유지):**

```javascript
// 각 code마다 requestExists 체크
let requestExists = false;
for (const value of MSP.callbacks) {
    if (value.code === code) { requestExists = true; break; }
}

// 신규 요청만 재시도 타이머 설정
if (!requestExists) {
    obj.timer = setInterval(..., 500);  // BLE 환경이므로 500ms
}

MSP.callbacks.push(obj);

// 전송 큐에 추가 여부 결정 (기존 정책과 동일 + 배치 내 중복 방지)
const shouldSend = (data || !requestExists) && !batchSeenCodes.has(code);
if (shouldSend) {
    toSend.push(bufferOut);
    batchSeenCodes.add(code);
}
```

→ **충돌 방지 포인트:**
1. 기존 `send_message`가 먼저 요청한 code에 대해 `send_batch`가 호출되면, `requestExists = true`가 되어 재전송하지 않고 callback만 attach
2. 반대로 `send_batch`가 먼저 요청한 code에 대해 기존 `send_message`가 호출되어도 동일하게 동작 (MSP.callbacks는 전역 배열이므로 양쪽이 공유)
3. 배치 내 동일 code 중복 전송 방지: `batchSeenCodes` Set으로 추적

### 2.2 재시도 타이머 정책

**기존:** 모든 환경에서 3000ms

**변경:** `send_batch`에서는 BLE 환경이므로 **500ms** 고정
- BLE는 응답이 200ms 이내에 와야 정상
- 3초 대기는 비정상적으로 김
- 단, `send_message`의 기존 3000ms는 그대로 유지 (BLE가 아닌 환경 호환성)

### 2.3 BLE 전용 최적화

`send_batch`는 BLE 환경에서만 단일 write 병합을 수행한다. 비-BLE 환경(USB 시리얼, TCP)에서는 자동으로 순차 `MSP.promise` 처리로 폴백한다:

```javascript
if (serial.connectionType !== 'ble') {
    (async () => {
        const results = [];
        for (const req of requests) {
            try {
                const r = await self.promise(req.code, req.data || false);
                results.push(r);
            } catch (e) {
                results.push(null);
            }
        }
        if (allCallback) allCallback(results);
    })();
    return true;
}
```

→ 동일 API로 BLE/시리얼 양쪽에서 사용 가능.

### 2.4 MTU 초과 시 폴백

MTU 515 = payload 512B. 일반적인 MSP 프레임(9~500B)은 1~5개면 512B 이내에 들어간다. 하지만 대량 배치 시 초과할 수 있어 안전장치 구현:

```javascript
if (totalLen <= maxBlePayload) {
    // 단일 BLE write
    const combined = new Uint8Array(totalLen);
    // ... 병합 후 1회 send
} else {
    // MTU 초과: 청크 분할 전송 (maxBlePayload 단위)
    // 여전히 개별 send_message보다는 효율적 (청크 수 ≤ 요청 수)
}
```

### 2.5 응답 매칭 안전성

FC가 요청 순서대로 응답하지 않아도 안전:
- `MSP.callbacks` 배열에 각 요청의 `code`와 `callback`이 저장됨
- `MSPHelper.process_data`가 응답 수신 시 `code`로 매칭하여 해당하는 모든 callback을 호출 (기존 로직, 1789~1799행)
- `send_batch`는 각 요청에 `makeCallback(i)`을 할당하여 results 배열의 올바른 인덱스에 응답을 저장

### 2.6 정리(cleanup) 안전성

`MSP.callbacks_cleanup()`이 호출되는 시나리오 (연결 끊김, `disconnect_cleanup`)에서:
- 기존: `MSP.callbacks`의 모든 obj의 `timer`를 clearInterval
- `send_batch`로 등록된 obj도 동일한 구조 (`obj.timer` 포함)이므로 자동 정리됨
- 추가 cleanup 로직 불필요

---

## 3. 적용된 코드 (전문)

### 3.1 `src/js/msp.svelte.js` — 추가 부분

`MSP.promise()` 함수 뒤에 다음 두 함수를 삽입한다.

```javascript
    /**
     * 여러 MSP 요청을 하나의 BLE write로 병합 전송 (BLE 전용 최적화).
     *
     * MTU 515 환경에서 BLE write 1회당 60~100ms 오버헤드가 발생하므로,
     * N개의 MSP 요청을 단일 BLE 패킷으로 병합하면 N-1회의 오버헤드를 제거할 수 있다.
     *
     * 동작 흐름:
     *   1. 각 요청을 MSP V1/V2 프레임으로 인코딩
     *   2. 각 code가 이미 MSP.callbacks에 있는지 확인 (requestExists 체크)
     *      - 신규 code: callback obj 등록 + 재시도 타이머 설정 + 전송 큐에 추가
     *      - 중복 code (읽기): callback obj만 등록 (재전송 X, 기존 요청의 응답을 함께 기다림)
     *      - 중복 code (쓰기, data 있음): callback obj 등록 + 전송 큐에 추가 (재시도 타이머는 기존 것 사용)
     *   3. 전송 큐의 버퍼들을 하나로 병합하여 BLE write 1회로 전송
     *   4. 응답은 MSPHelper.process_data가 code 기반으로 각 callback obj에 디스패치
     *
     * 주의:
     *   - BLE 환경에서만 효과적. USB 시리얼/TCP 환경에서는 일반 send_message와 동일하게 동작
     *   - 동일 code를 batch 내에 중복 넣지 말 것 (첫 요청만 전송되고 나머지는 무시됨)
     *   - 응답 순서는 보장되지 않지만, code 기반 매칭이므로 안전
     *
     * @param {Array<{code: number, data?: Uint8Array|false}>} requests - 병합할 요청 목록
     * @param {Function} [allCallback] - 모든 응답 도착 시 호출, results 배열 전달 (순서 = requests 순서)
     * @returns {boolean} 전송 성공 여부
     */
    send_batch: function (requests, allCallback) {
        const self = this;

        if (!requests || requests.length === 0) {
            if (allCallback) allCallback([]);
            return true;
        }

        // 연결 끊김 또는 CLI 모드 사전 체크
        if (!serial.connected || CONFIGURATOR.cliEngineActive) {
            console.log('Cancelling MSP batch request (not connected or CLI active)');
            if (allCallback) allCallback(new Array(requests.length).fill(null));
            return false;
        }

        // BLE가 아닌 환경에서는 개별 send_message 호출로 폴백 (단일 BLE write의 이점이 없음)
        if (serial.connectionType !== 'ble') {
            (async () => {
                const results = [];
                for (const req of requests) {
                    try {
                        const r = await self.promise(req.code, req.data || false);
                        results.push(r);
                    } catch (e) {
                        results.push(null);
                    }
                }
                if (allCallback) allCallback(results);
            })();
            return true;
        }

        // ── BLE 환경: 배치 전송 수행 ──

        const total = requests.length;
        const results = new Array(total).fill(null);
        let completed = 0;
        let settled = false;

        // 모든 요청이 완료(성공/실패)되면 allCallback을 1회만 호출
        function settle() {
            if (settled) return;
            completed++;
            if (completed >= total) {
                settled = true;
                if (allCallback) allCallback(results);
            }
        }

        // 각 요청별 callback 생성 (code 기반 응답 매칭)
        function makeCallback(index) {
            return function (data) {
                results[index] = data;
                settle();
            };
        }

        // 재시도 간격: BLE 500ms (기존 send_message의 3000ms 대비 6배 단축)
        const retryInterval = 500;

        // 단일 BLE write로 병합할 버퍼 목록
        const toSend = [];
        // 동일 배치 내에서 같 code 중복 전송 방지를 위한 추적
        const batchSeenCodes = new Set();

        // 1단계: 각 요청 인코딩 + callbacks 등록
        for (let i = 0; i < total; i++) {
            const req = requests[i];
            const code = req.code;
            const data = req.data || false;

            // 동일 code가 이미 MSP.callbacks에 있는지 확인 (기존 send_message의 requestExists 체크와 동일)
            let requestExists = false;
            for (const value of MSP.callbacks) {
                if (value.code === code) {
                    requestExists = true;
                    break;
                }
            }

            // 요청 버퍼 인코딩
            const bufferOut = code <= 254
                ? this.encode_message_v1(code, data)
                : this.encode_message_v2(code, data);

            // callback 객체 생성 (기존 send_message와 동일한 구조)
            const obj = {
                code: code,
                requestBuffer: bufferOut,
                callback: makeCallback(i),
                timer: false,
                callbackOnError: false,
                lastSentAt: Date.now(),
            };

            // 신규 요청인 경우에만 재시도 타이머 설정 (기존 send_message와 동일 정책)
            if (!requestExists) {
                obj.timer = setInterval(function () {
                    console.log(`MSP batch request timed-out: ${code} tab: ${GUI.active_tab}`);

                    // 연결 끊김 또는 CLI 진입 시 중단
                    if (!serial.connected || CONFIGURATOR.cliEngineActive) {
                        console.log('Cancelling MSP batch request');
                        const idx = MSP.callbacks.indexOf(obj);
                        if (idx > -1) MSP.callbacks.splice(idx, 1);
                        clearInterval(obj.timer);
                        // 해당 요청 실패 처리
                        obj.callback?.(null);
                        return;
                    }

                    // 해당 요청만 재전송 (배치 전체가 아닌)
                    serial.send(bufferOut, false);
                    obj.lastSentAt = Date.now();
                }, retryInterval);
            }

            MSP.callbacks.push(obj);

            // 전송 큐에 추가 여부 결정 (기존 send_message의 "if (data || !requestExists)"와 동일)
            // - data가 있으면 (쓰기 요청) 항상 전송
            // - data가 없고 신규 요청이면 전송
            // - data가 없고 중복 요청이면 전송 X (기존 요청의 응답을 함께 기다림)
            // - 단, 동일 배치 내에서 같 code 중복 전송 방지 (batchSeenCodes)
            const shouldSend = (data || !requestExists) && !batchSeenCodes.has(code);
            if (shouldSend) {
                toSend.push(bufferOut);
                batchSeenCodes.add(code);
            }
        }

        // 2단계: 전송할 버퍼들을 단일 BLE write로 병합
        if (toSend.length === 0) {
            // 모든 요청이 이미 큐에 있는 경우 - 응답 대기만 함 (callbacks에 의해 settle 됨)
            return true;
        }

        // 전체 크기 계산
        let totalLen = 0;
        for (const buf of toSend) totalLen += buf.byteLength;

        // BLE MTU 기반 최대 페이로드 (ATT 헤더 3B 제외)
        const maxBlePayload = Math.max((serial.bleMtu || 515) - 3, 20);

        if (totalLen <= maxBlePayload) {
            // ── 단일 BLE write로 전송 (핵심 최적화) ──
            const combined = new Uint8Array(totalLen);
            let offset = 0;
            for (const buf of toSend) {
                combined.set(new Uint8Array(buf), offset);
                offset += buf.byteLength;
            }
            serial.send(combined.buffer, false);
        } else {
            // ── MTU 초과: 청크 분할 전송 (폴백) ──
            // MTU 515 환경에서는 거의 발생하지 않지만 안전장치
            let chunkBuf = new Uint8Array(maxBlePayload);
            let chunkLen = 0;
            const flushChunk = () => {
                if (chunkLen > 0) {
                    serial.send(chunkBuf.slice(0, chunkLen).buffer, false);
                    chunkBuf = new Uint8Array(maxBlePayload);
                    chunkLen = 0;
                }
            };
            for (const buf of toSend) {
                const view = new Uint8Array(buf);
                if (chunkLen + view.byteLength > maxBlePayload) {
                    flushChunk();
                }
                chunkBuf.set(view, chunkLen);
                chunkLen += view.byteLength;
            }
            flushChunk();
        }

        return true;
    },

    /**
     * code 배열을 받아 한 번에 배치 전송하는 헬퍼 (Promise 기반).
     *
     * BLE 환경에서는 send_batch로 단일 BLE write로 병합 전송.
     * 비-BLE 환경에서는 순차 promise 처리 (기존 동작 유지).
     *
     * 사용법:
     *   const [boxNames, featureConfig, status] = await MSP.batchCodes([
     *       { code: MSPCodes.MSP_BOXNAMES },
     *       { code: MSPCodes.MSP_FEATURE_CONFIG },
     *       { code: MSPCodes.MSP_STATUS, data: someBuffer },
     *   ]);
     *
     * @param {Array<{code: number, data?: Uint8Array|false}>} requestSpecs
     * @returns {Promise<Array>} 각 요청의 응답 배열 (순서 = requestSpecs 순서)
     */
    batchCodes: function (requestSpecs) {
        const self = this;
        return new Promise(function (resolve) {
            self.send_batch(requestSpecs, function (results) {
                resolve(results);
            });
        });
    },
```

### 3.2 `src/js/serial_backend.js` — `onConnect()` 수정

**기존 코드:**

```javascript
        await new Promise((resolve) => setTimeout(resolve, 100));
        await MSP.promise(MSPCodes.MSP_BOXNAMES, false);
        await MSP.promise(MSPCodes.MSP_FEATURE_CONFIG, false);
        await MSP.promise(MSPCodes.MSP_BATTERY_CONFIG, false);
        await MSP.promise(MSPCodes.MSP_STATUS, false);
        await MSP.promise(MSPCodes.MSP_DATAFLASH_SUMMARY, false);

        if (FC.CONFIG.boardType == 0 || FC.CONFIG.boardType == 2) {
            startLiveDataRefreshTimer();
        }
```

**수정 후:**

```javascript
        await new Promise((resolve) => setTimeout(resolve, 100));

        // BLE 환경에서는 5개 MSP 요청을 단일 BLE write로 병합 전송 (send_batch)
        // - 기존: 5회 BLE write × 80ms 오버헤드 = 400ms
        // - 개선: 1회 BLE write = 80ms (320ms 단축)
        // - 비-BLE 환경(USB 시리얼/TCP)에서는 batchCodes가 내부적으로 순차 promise 처리로 폴백
        await MSP.batchCodes([
            { code: MSPCodes.MSP_BOXNAMES, data: false },
            { code: MSPCodes.MSP_FEATURE_CONFIG, data: false },
            { code: MSPCodes.MSP_BATTERY_CONFIG, data: false },
            { code: MSPCodes.MSP_STATUS, data: false },
            { code: MSPCodes.MSP_DATAFLASH_SUMMARY, data: false },
        ]);

        if (FC.CONFIG.boardType == 0 || FC.CONFIG.boardType == 2) {
            startLiveDataRefreshTimer();
        }
```

---

## 4. 동작 시나리오 분석

### 4.1 정상 시나리오 (BLE, MTU 515)

```
[onConnect 호출]
  ↓
batchCodes([
  { MSP_BOXNAMES },          // 9B (V2 헤더만)
  { MSP_FEATURE_CONFIG },    // 9B
  { MSP_BATTERY_CONFIG },    // 9B
  { MSP_STATUS },            // 9B
  { MSP_DATAFLASH_SUMMARY }, // 9B
]) 호출
  ↓
send_batch 진입:
  - 5개 모두 신규 요청 (MSP.callbacks 비어 있음)
  - 5개 모두 재시도 타이머 설정 (500ms)
  - 5개 모두 toSend에 추가
  - totalLen = 45B (≤ 512B maxBlePayload)
  - 단일 BLE write로 45B 전송
  ↓
FC가 5개 요청을 순차 처리, 5개 응답 전송 (BLE notify)
  ↓
MSPHelper.process_data가 각 응답을 code로 매칭
  - MSP_BOXNAMES 응답 → results[0] 채움, settle()
  - MSP_FEATURE_CONFIG 응답 → results[1] 채움, settle()
  - ... (순서 무관)
  ↓
5개 모두 settle → allCallback(results) 호출 → Promise resolve
  ↓
batchCodes await 완료 → onConnect 다음 코드 진행
```

**예상 소요 시간**: ~200~300ms (기존 1.5~2초 대비 5~7배 단축)

### 4.2 부분 실패 시나리오 (1개 응답 누락)

```
[5개 요청 중 MSP_BATTERY_CONFIG 응답 누락]
  ↓
- 4개 응답 정상 도착 → results[0,1,3,4] 채워짐, completed=4
- MSP_BATTERY_CONFIG obj의 재시도 타이머 500ms 후 실행
  → serial.send(bufferOut)로 재전송
  → FC 응답 → results[2] 채워짐, completed=5
  → settle → allCallback 호출
```

**안전성 포인트:**
- 4개는 이미 응답 받았으므로 화면 일부 렌더링 가능 (필요시 부분 렌더링 로직 추가 가능)
- 누락된 1개만 500ms 후 재전송 → 기존 3초 대비 6배 빠른 복구
- 재전송은 해당 요청만, 배치 전체가 아님

### 4.3 동일 code 중복 요청 시나리오

```
[MSP_STATUS가 이미 MSP.callbacks에 있는 상황에서 batchCodes 호출]
  ↓
batchCodes([{ MSP_STATUS }, { MSP_FEATURE_CONFIG }])
  ↓
- MSP_STATUS: requestExists=true → 콜백만 attach, 전송 X
  (기존 send_message가 보낸 MSP_STATUS 요청의 응답을 함께 기다림)
- MSP_FEATURE_CONFIG: requestExists=false → 신규 등록 + 전송 큐에 추가
  ↓
toSend = [MSP_FEATURE_CONFIG 버퍼]  // MSP_STATUS는 제외
  ↓
단일 BLE write로 MSP_FEATURE_CONFIG만 전송
  ↓
두 응답 모두 도착하면 각각의 callback이 settle 호출
```

→ 기존 `send_message`와 100% 호환되는 중복 처리 로직.

### 4.4 BLE가 아닌 환경 (USB 시리얼)

```
[USB 시리얼 연결 상태에서 batchCodes 호출]
  ↓
send_batch 진입 → connectionType !== 'ble' → 폴백 분기
  ↓
(async () => {
    for (const req of requests) {
        await self.promise(req.code, req.data || false);
    }
    allCallback(results);
})();
  ↓
기존 MSP.promise를 순차 호출 (기존 onConnect 동작과 동일)
```

→ USB 시리얼 환경에서는 회귀(regression) 없음.

### 4.5 MTU 초과 시나리오 (대량 배치)

```
[15개 요청 × 9B = 135B → 512B 이내: 정상]
[30개 요청 × 9B = 270B → 512B 이내: 정상]
[60개 요청 × 9B = 540B → 512B 초과: 청크 분할]
  ↓
1번째 청크: 56개 요청 = 504B (≤ 512)
2번째 청크: 4개 요청 = 36B
  ↓
2회 BLE write로 전송 (기존 60회 대비 30배 효율)
```

---

## 5. 검증 항목

### 5.1 문법 검증 (완료)

- ✅ `msp.svelte.js`: 괄호 짝 맞음, Node.js `new Function()` 파싱 통과
- ✅ `serial_backend.js`: 괄호 짝 맞음, Node.js `new Function()` 파싱 통과

### 5.2 기능 검증 (적용 후 테스트 필요)

연결 후 콘솔에서 실행:

```javascript
// 테스트 1: 단일 batch 호출
console.time('batch-5');
await MSP.batchCodes([
    { code: MSPCodes.MSP_STATUS, data: false },
    { code: MSPCodes.MSP_FEATURE_CONFIG, data: false },
    { code: MSPCodes.MSP_BATTERY_CONFIG, data: false },
    { code: MSPCodes.MSP_BOXNAMES, data: false },
    { code: MSPCodes.MSP_DATAFLASH_SUMMARY, data: false },
]);
console.timeEnd('batch-5');
// 기대: 200~400ms (기존 1.5~2초)
```

```javascript
// 테스트 2: FC가 연속 프레임을 처리하는지 확인
console.time('batch-3');
const results = await MSP.batchCodes([
    { code: MSPCodes.MSP_STATUS, data: false },
    { code: MSPCodes.MSP_STATUS, data: false },  // 동일 code (attach만)
    { code: MSPCodes.MSP_FEATURE_CONFIG, data: false },
]);
console.timeEnd('batch-3');
console.log('응답 수:', results.filter(r => r).length, '/ 3');
// 기대: 2/3 (동일 code는 1번만 응답 매칭됨, 나머지는 timeout 대기)
// 주의: 동일 code를 넣으면 결과적으로 2개만 응답 옴. 테스트 후 실사용에서는 중복 code 금지.
```

```javascript
// 테스트 3: BLE write가 1회 발생하는지 확인 (Network/Logcat)
// NordicBle 'send' 호출 카운트를 콘솔에서 추적
let sendCount = 0;
const origSend = window.NordicBle.send.bind(window.NordicBle);
window.NordicBle.send = function(...args) {
    sendCount++;
    return origSend(...args);
};

await MSP.batchCodes([
    { code: MSPCodes.MSP_BOXNAMES, data: false },
    { code: MSPCodes.MSP_FEATURE_CONFIG, data: false },
    { code: MSPCodes.MSP_BATTERY_CONFIG, data: false },
    { code: MSPCodes.MSP_STATUS, data: false },
    { code: MSPCodes.MSP_DATAFLASH_SUMMARY, data: false },
]);
console.log('BLE send 호출 횟수:', sendCount);
// 기대: 1 (단일 BLE write)
// 5가 나오면 병합이 안 된 것 → 추가 디버깅 필요
```

### 5.3 회귀 테스트

- [ ] BLE 연결 후 초기 로딩 정상 (5개 MSP 응답 수신)
- [ ] 각 탭 진입 정상 (아직 batchCodes 미적용, 기존 동작 유지)
- [ ] CLI 탭 진입/명령 전송 정상
- [ ] USB 시리얼 연결 시 기존 동작 유지 (폴백 분기 확인)
- [ ] BLE 연결 끊김 후 재연결 정상 (timer cleanup 확인)
- [ ] 동일 탭에서 connect/disconnect 반복 시 메모리 누수 없음

---

## 6. 예상 효과

### 6.1 초기 연결 로딩 (onConnect)

| 항목 | 기존 | 개선 후 | 효과 |
|------|------|---------|------|
| BLE write 호출 수 | 5회 | 1회 | 80% 감소 |
| BLE 오버헤드 시간 | 5 × 80ms = 400ms | 1 × 80ms = 80ms | 320ms 절감 |
| FC 응답 대기 | 5회 직렬 = 200~500ms | 5회 병렬 = 50~100ms | 150~400ms 절감 |
| **총 초기 로딩** | 600~900ms | 130~180ms | **~75% 단축** |

### 6.2 향후 각 탭 적용 시 (별도 작업)

각 탭의 `load_data()`에 `batchCodes` 적용 시 동일한 효과:
- 탭 진입 시 3~10개 MSP 요청 → 1회 BLE write
- 탭 전환 지연 240~800ms → 50~100ms

---

## 7. 다음 단계 제안

### 7.1 즉시 (이번 PR)

1. `msp.svelte.js`에 `send_batch` / `batchCodes` 추가 ✅
2. `serial_backend.js`의 `onConnect`에 `batchCodes` 적용 ✅
3. 테스트 1~3 수행, BLE write 호출 수가 1인지 확인
4. 초기 로딩 시간 측정 (console.time)

### 7.2 다음 PR (각 탭 적용)

각 탭의 `load_data()` 함수를 `batchCodes`로 변환:
- `src/tabs/configuration.html` 관련 JS
- `src/tabs/receiver/` JS
- `src/tabs/motors/` JS
- `src/tabs/power.html` 관련 JS
- `src/tabs/rates.html` 관련 JS
- `src/tabs/gyro/` JS
- `src/tabs/failsafe/` JS
- `src/tabs/servos.html` 관련 JS
- `src/tabs/auxiliary.html` 관련 JS

### 7.3 그 다음 (추가 최적화)

이전 가이드의 수정 #5 (ring buffer 재조립) 및 #8 (Base64 우회) 적용 검토.

---

## 8. 롤백 가이드

문제 발생 시:

1. `serial_backend.js`의 `onConnect`를 원래 5줄 `await MSP.promise(...)`로 되돌림
2. `msp.svelte.js`의 `send_batch` / `batchCodes` 함수 제거
3. `MSP.callbacks_cleanup()` 로직은 변경 없으므로 다른 코드에 영향 없음

```bash
git revert <commit-hash>
# 또는
git checkout HEAD~1 -- src/js/msp.svelte.js src/js/serial_backend.js
```
