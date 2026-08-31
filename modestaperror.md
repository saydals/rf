# Mode 탭 BLE BOX 행/이름 누락 조사 보고서

작성일: 2026-09-01  
상태: 조사 결과 기록. 실장비 BLE 재현 로그가 없어 원인은 아직 확정되지 않음.

## 1. 증상과 현재 결론

BLE로 연결하면 Mode 탭에서 BOX 행 또는 BOX 이름이 보이지 않는 문제가 기존 수정 후에도 계속 발생한다. SPP 동작은 보존해야 한다.

현재까지 확인된 사실:

1. Rotorflight firmware는 `MSP_BOXNAMES`를 세미콜론(`;`)으로 구분한 ASCII 문자열로 응답한다.
2. `MSP_BOXNAMES`와 `MSP_BOXIDS`는 active box만 직렬화하며, 두 응답은 같은 active box 순서를 사용한다.
3. BOX 이름 응답은 255바이트 이상일 수 있어 MSP V1 Jumbo frame이 될 수 있다. Rotorflight 소스에는 약 307바이트 응답에 대한 설명이 있다.
4. Mode 탭은 `FC.AUX_CONFIG` 길이만큼 행을 만들고 각 행의 mode ID를 `FC.AUX_CONFIG_IDS[index]`에서 가져온다.
5. 이름 응답, ID 응답, 또는 두 배열의 인덱스 정렬이 실패하면 행이 없거나 이름/링크가 잘못 표시될 수 있다.
6. 현재 코드에는 BLE typed-array view 범위 보존, V1 Jumbo 재조립, CRC 오류 재시도, batch 요청 등의 방어 코드가 있지만 실장비에서 응답이 실제로 어떻게 도착하는지는 확인하지 못했다.

현재 가장 중요한 미확인 지점은 **BLE에서 MSP_BOXNAMES/BOXIDS 응답이 수신·재조립·CRC 검증·callback dispatch까지 도달하는지**이다. 단순히 Mode 탭의 `batchCodes()`와 순차 Promise 중 어느 방식을 사용하는지만으로는 문제가 설명되지 않는다.

---

## 2. 관련 명령과 firmware 데이터 형식

Rotorflight 헤더: `/home/betaflight/rotorflight/src/main/msp/msp_protocol.h`

| MSP 명령 | ID | 요청 payload | 응답 형식 |
|---|---:|---|---|
| `MSP_MODE_RANGES` | 34 | 없음 | 4바이트 레코드 반복 |
| `MSP_BOXNAMES` | 116 | page 1바이트, 생략 시 page 0 | `name;name;...;` ASCII |
| `MSP_BOXIDS` | 119 | page 1바이트, 생략 시 page 0 | permanent ID 1바이트 반복 |
| `MSP_MODE_RANGES_EXTRA` | 238 | 없음 | count 1바이트 + 3바이트 레코드 반복 |

### 2.1 BOX 목록

파일: `/home/betaflight/rotorflight/src/main/msp/msp_box.c`

- `boxes[]`에는 box ID, 표시 이름, permanent ID가 정의되어 있다.
- `activeBoxIds` bitmask는 기능/센서/빌드 옵션에 따라 startup 시 계산된다.
- `serializeBoxReply()`는 active box만 순회한다.
- 한 page에는 최대 32개의 active box가 들어간다.
- page 시작 위치는 `page * 32`이다.
- 이름 serializer는 각 이름 뒤에 `';'`를 기록한다.
- ID serializer는 각 box의 `permanentId` 한 바이트를 기록한다.
- 따라서 BOXNAMES의 이름 순서와 BOXIDS의 ID 순서는 동일한 active-box 순서여야 한다.

실제 dispatch는 `/home/betaflight/rotorflight/src/main/msp/msp.c`의 `mspFcProcessOutCommandWithArg()`에서 수행한다. 요청 payload가 없으면 page 0을 사용하고, payload가 있으면 첫 byte를 page 번호로 사용한다.

### 2.2 Mode range 형식

파일: `/home/betaflight/rotorflight/src/main/msp/msp.c`

`MSP_MODE_RANGES`는 각 mode activation condition에 대해 다음 4바이트를 보낸다.

```text
permanentId, auxChannelIndex, startStep, endStep
```

`MSP_MODE_RANGES_EXTRA`는 다음 형식이다.

```text
count,
permanentId, modeLogic, linkedTo,
permanentId, modeLogic, linkedTo,
...
```

두 응답 모두 `MAX_MODE_ACTIVATION_CONDITION_COUNT` 슬롯을 기준으로 firmware가 직렬화한다. 빈 슬롯도 응답에 포함될 수 있으므로 단순히 box 개수와 mode range 개수가 같다고 가정하면 안 된다.

---

## 3. Firmware MSP 수신·응답 처리

관련 파일:

- `/home/betaflight/rotorflight/src/main/msp/msp_serial.c`
- `/home/betaflight/rotorflight/src/main/msp/msp_serial.h`
- `/home/betaflight/rotorflight/src/main/msp/msp.c`

### 3.1 수신 parser와 frame 형식

`mspSerialProcessReceivedData()`는 byte stream을 해석한다.

- `$M<` 또는 `$X<`: host가 보낸 MSP V1/V2 request
- `$M>` 또는 `$X>`: firmware가 보낸 response
- V1은 size/cmd/payload/checksum을 사용한다.
- V2 native는 flags/cmd/16-bit size/payload/CRC8-DVB-S2를 사용한다.
- V1 response payload가 255바이트 이상이면 V1 Jumbo 형식이 된다.

Firmware의 V1 Jumbo response는 다음 구조다.

```text
$ M > 0xFF command payloadSizeLow payloadSizeHigh payload checksum
```

V1 checksum에는 일반 header, Jumbo size, payload가 포함된다.

### 3.2 합쳐진 요청 처리

컨피규레이터의 BLE batch는 여러 MSP request frame을 하나의 BLE write에 이어 붙일 수 있다. Firmware의 `mspSerialProcess()`는 한 scheduler 호출에서 완성된 command 하나를 처리한 뒤 `break`한다. 수신 serial buffer에 남은 다음 frame은 다음 호출에서 처리된다.

따라서 합본 frame을 firmware가 항상 하나만 처리하는 것은 아니다. 그러나 BLE bridge/native plugin이 한 번의 write에서 합쳐진 frame을 모두 firmware UART로 전달하지 않거나 write 크기를 제한하면 뒤쪽 요청이 유실될 수 있다.

### 3.3 응답 buffer

파일: `/home/betaflight/rotorflight/src/main/msp/msp_serial.h`

현재 소스는 다음 설정을 사용한다.

```c
#define MSP_PORT_OUTBUF_SIZE_MIN 768
```

주석상 `MSP_BOXNAMES`는 약 307바이트, `MSP_ADJUSTMENT_RANGES`는 약 597바이트까지 고려한다. 따라서 BOXNAMES 자체가 현재 소스의 출력 buffer를 초과하는 것은 주된 원인으로 보이지 않는다. 단, 실제 장착 firmware가 이 소스와 동일한 revision/configuration인지 확인해야 한다.

---

## 4. Configurator의 연결 및 수신 경로

관련 파일:

- `/home/betaflight/rfconfigurator/src/js/msp/MSPConnector.js`
- `/home/betaflight/rfconfigurator/src/js/serial_backend.js`
- `/home/betaflight/rfconfigurator/src/js/serial.js`
- `/home/betaflight/rfconfigurator/src/js/ble_central.js`

### 4.1 공통 초기화

연결 후 공통 흐름은 다음과 같다.

```text
serial.connect()
  -> serial.onReceive.addListener(read_serial)
  -> MSP.listen(mspHelper.process_data)
  -> MSP.promise(MSP_API_VERSION)
  -> 기타 초기 configuration 요청
  -> 탭 진입
```

`read_serial(info)`는 CLI가 아니면 `MSP.read(info)`를 호출한다.

### 4.2 SPP

SPP는 RFCOMM serial stream으로 취급된다. 수신 데이터는 `read_serial()`에 전달되고 `MSP.read()`가 byte stream을 이어서 파싱한다. 한 read에 여러 frame이 들어오거나 frame이 잘려 들어와도 parser state가 유지되면 처리할 수 있다.

`MSP.batchCodes()`도 non-BLE에서는 request를 순차적으로 `MSP.promise()` 처리하도록 fallback한다. 따라서 이번 변경의 batch 적용은 SPP 전송 방식을 합본 write로 바꾸지 않는다.

### 4.3 BLE 수신

현재 경로는 다음과 같다.

```text
NordicBle receive event
  -> serial._bleReceiveHandler(e.detail)
  -> createMspReassembler().append(fragment)
  -> complete MSP frame callback
  -> serial.onReceive listeners
  -> read_serial(info)
  -> MSP.read(info)
```

BLE notification은 fragment 단위로 도착할 수 있다. `createMspReassembler()`는 buffer에 fragment를 추가하고 `$M`/`$X` header, payload length, checksum/CRC까지 모인 뒤 complete frame만 listener에 넘긴다.

현재 `serial.js`는 typed-array view의 `byteOffset`/`byteLength`를 유지해서 append한다. native plugin이 큰 backing buffer의 일부 view를 넘기는 경우 `.buffer` 전체를 사용하면 실제 notification 밖의 byte가 섞일 수 있기 때문이다.

### 4.4 BLE 송신과 batch

`MSP.batchCodes()`의 BLE 동작은 다음과 같다.

1. 각 request를 callback에 등록한다.
2. request frame들을 `combineFrames()`로 이어 붙인다.
3. 합쳐진 buffer를 한 번의 `serial.send()`로 보낸다.
4. 응답 callback이 완료된 code는 pending에서 제거한다.
5. 응답하지 않은 code만 주기적으로 targeted retry한다.
6. timeout에 도달하면 빈 `DataView`로 promise를 종료한다.

이 구현은 SPP와 BLE의 동작을 분리한다. BLE plugin의 실제 write semantics가 여러 MSP frame 합본을 완전히 전달하는지는 실장비 확인이 필요하다.

---

## 5. Mode 탭과 응답 parser

파일: `/home/betaflight/rfconfigurator/src/js/tabs/auxiliary.js`

현재 `load_data()`는 다음 네 요청을 batch로 보낸다.

```js
MSP.batchCodes([
    { code: MSPCodes.MSP_BOXNAMES, data: new Uint8Array([0]) },
    { code: MSPCodes.MSP_BOXIDS, data: new Uint8Array([0]) },
    { code: MSPCodes.MSP_MODE_RANGES, data: false },
    { code: MSPCodes.MSP_MODE_RANGES_EXTRA, data: false },
]).then(() => callback?.());
```

이 네 명령은 firmware에서 독립적으로 처리되므로 순서 의존성은 없다. 다만 모든 response callback이 resolve되면 HTML을 로드한다. 실패한 요청도 batch timeout 후 빈 DataView로 resolve될 수 있으므로, 현재 UI 흐름은 통신 실패를 명시적으로 표시하지 않고 진행할 수 있다.

파일: `/home/betaflight/rfconfigurator/src/js/msp/MSPHelper.js`

- `MSP_BOXNAMES`: payload 전체를 읽고 `;` 기준으로 문자열 배열을 만든다.
- 마지막 delimiter가 없어도 마지막 이름을 추가한다.
- 이름이 하나도 없으면 기존 `FC.AUX_CONFIG`를 유지한다.
- `MSP_BOXIDS`: payload의 모든 byte를 `FC.AUX_CONFIG_IDS`에 저장한다.
- `MSP_MODE_RANGES`: payload를 4바이트 단위로 읽는다.
- `MSP_MODE_RANGES_EXTRA`: 첫 byte를 count로 읽고 각 entry를 3바이트로 읽는다.

Mode 화면의 핵심 관계는 다음과 같다.

```text
FC.AUX_CONFIG[index]       -> 표시 이름
FC.AUX_CONFIG_IDS[index]   -> permanent mode ID
FC.MODE_RANGES[].id        -> range와 연결할 permanent ID
FC.MODE_RANGES_EXTRA[].id  -> logic/link와 연결할 permanent ID
```

Mode 행 생성은 `FC.AUX_CONFIG`를 기준으로 한다. `FC.AUX_CONFIG_IDS`가 짧으면 link option value가 `undefined`가 될 수 있다. 이름/ID 배열의 개수가 다르면 행 누락보다는 link 및 range 연결 이상으로 이어질 수 있으므로 두 길이를 반드시 확인해야 한다.

---

## 6. 기존 수정으로 해소되지 않은 가능성

### A. 합본 BLE write가 plugin/bridge에서 완전하게 전달되지 않음

`MSP.batchCodes()`는 여러 frame을 한 buffer로 연결한다. native plugin이 하나의 write만 허용하거나 payload를 잘라내면 첫 번째 응답만 오고 뒤의 BOXIDS 또는 mode range request가 누락될 수 있다.

### B. BOXNAMES Jumbo frame header 파싱 실패

현재 reassembler는 V1 Jumbo에서 `0xFF` size byte 뒤의 16-bit size를 사용한다. 이후 `MSP.read()`도 Jumbo size를 별도로 읽어야 한다. 어느 한 단계라도 Jumbo header를 일반 V1 size로 처리하면 payload가 잘리거나 다음 frame과 합쳐진다.

### C. response code callback 매칭 문제

`MSP._dispatch_message()`는 response code와 pending callback code가 같을 때 callback을 완료한다. post-connect 초기 batch가 `MSP_BOXNAMES`를 요청하고 Mode 탭 진입 batch가 다시 요청하는 경우 두 요청이 겹치는지 확인해야 한다. 같은 code의 동시 pending callback ownership은 실장비 로그로 확인해야 한다.

### D. BOXNAMES와 BOXIDS 개수 불일치

정상 firmware라면 두 배열 개수가 같아야 한다. 하나만 empty/partial response로 처리되면 다음 상태가 가능하다.

```text
FC.AUX_CONFIG.length     > 0
FC.AUX_CONFIG_IDS.length == 0 또는 더 짧음
```

### E. timeout 후 빈 응답으로 UI 진행

batch timeout은 빈 DataView로 promise를 종료한다. 따라서 Mode HTML은 열리지만 배열은 비어 있고, “응답 없음”과 “정상적으로 BOX가 0개”를 UI에서 구분하지 않는다.

---

## 7. 다음 실장비 검증에서 반드시 수집할 로그

### Configurator 송신

- connection type (`ble` 또는 `spp`)
- `MSP.batchCodes()` request code 목록
- 각 frame byte length
- 합본 write 전체 byte length
- 합본 안의 frame 시작 offset 및 code
- native BLE plugin에 전달된 실제 byte length
- 실제 notification fragment 개수와 각 fragment length

### Configurator 수신/파싱

- event의 실제 JS 타입
- `byteLength`, `byteOffset`, backing buffer length
- reassembler buffer length 변화
- complete frame raw header
- response code
- V1/V2/Jumbo 여부
- 선언 payload length와 실제 payload length
- checksum/CRC expected 및 calculated 값
- `MSP.packet_error`
- callback이 매칭된 code
- callback 후 `FC.AUX_CONFIG.length`
- callback 후 `FC.AUX_CONFIG_IDS.length`
- `FC.MODE_RANGES.length`
- `FC.MODE_RANGES_EXTRA.length`

### Firmware/링크

- firmware가 실제로 받은 command code 순서
- 각 command request payload length 및 page 값
- 생성한 response payload length
- 선택된 MSP version
- Jumbo 여부
- TX buffer free 상태 또는 `mspSerialSendFrame()` 반환값

최소 로그 예시는 다음과 같다.

```text
TX codes=[116,119,34,238], bytes=...
RX frame code=116 jumbo=true payload=... crc=ok
RX frame code=119 jumbo=false payload=... crc=ok
MODE state names=... ids=... ranges=... extras=...
```

---

## 8. 현재 판단

소스 정합성만 보면 다음은 정상이다.

- command ID
- page 0 요청 형식
- firmware의 semicolon BOX name 형식과 configurator parser
- firmware의 BOX name/ID 순서 규칙
- Mode range 레코드 크기
- SPP의 순차 batch fallback
- BLE typed-array view 범위를 보존하는 reassembler 입력

실장비에서 아직 확인되지 않은 것은 다음이다.

- 합본 BLE write가 네 개 command 모두 firmware까지 전달되는지
- Jumbo BOXNAMES response가 complete frame으로 재조립되는지
- 응답 CRC가 통과하는지
- callback code 매칭이 정확한지
- `FC.AUX_CONFIG`와 `FC.AUX_CONFIG_IDS`가 같은 개수인지
- Mode tab에서 실제 DOM 생성 직전 배열 값이 무엇인지

따라서 다음 작업은 추가적인 추측성 parser 변경보다 위 로그를 삽입해 **어느 단계에서 데이터가 사라지는지**를 확인하는 것이 우선이다.
