# RFConfigurator — Android Bluetooth SPP 지원 구현 계획

## 1. 개요

Rotorflight Configurator Android 앱에서 **Bluetooth Classic SPP (Serial Port Profile)** 연결을 지원하도록 추가한다.

현재는 **BLE (Bluetooth Low Energy)** 만 지원 중이며, HC-05/HC-06 등 SPP 기반 블루투스 모듈은 사용할 수 없다.

---

## 2. 설계 결정 사항

| # | 항목 | 결정 |
|:--:|------|------|
| ① | Cordova 플러그인 | `cordova-plugin-bluetooth-serial` |
| ② | UI 통합 방식 | 기존 포트 드롭다운에 `spp:주소` 프리픽스로 통합 |
| ③ | 스캔 방식 | **페어링된 장치만** 표시 (`bluetoothSerial.list()`) |
| ④ | 이름 없는 장치 | 스캔 결과에서 **제외 (필터링)** |
| ⑤ | 통신 속도 | **115200 고정** |
| ⑥ | 스캔 버튼 | `SPP SCAN` / `BLE SCAN` 별도 분리 |
| ⑦ | 연결 후 초기화 | BLE와 동일하게 `exit\r\n` 전송 |
| ⑧ | 프레임 처리 | MSP 재조립 **불필요** (스트리밍, serial과 동일) |

---

## 3. 레이아웃 배치

### 3.1 현재 레이아웃 (문제점)

```
.headerbar (flexbox)
├── #logo-desktop          [Logo 240-340px]
├── #port-picker           margin-left: auto → 오른쪽 밀림
│   └── #portsinput
│       ├── [Port: ▼]
│       └── #auto-connect-and-baud
│           ├── [Auto□] (110px)
│           ├── [Baud: 115200 ▼] (80px)
│           └── [ShowAll□] (110px)
├── #ble-scan-btn          ← port-picker와 header_btns 사이에 끼어 있음
├── .header-wrapper
├── #header_btns           [Flash] [Connect]
└── #reveal_btn
```

**문제**: `#ble-scan-btn`는 headerbar의 독립 flex 아이템으로, port-picker와 header_btns 사이의 좁은 틈에 위치해 있어 추가 버튼을 나란히 넣을 공간이 부족하다.

### 3.2 개선 레이아웃

```
.headerbar (flexbox)
├── #logo-desktop          [Logo 240-340px]
├── (여백)                  flex 자연 공간
├── #wireless-scan-btns    ← 신규 (margin-left: auto + margin-right: 10px)
│   ├── [SPP SCAN]
│   └── [BLE SCAN]
├── #port-picker           (margin-left: auto 제거 → 0 또는 없음)
│   └── #portsinput
│       ├── [Port: ▼]
│       └── #auto-connect-and-baud
│           ├── [Auto□]
│           ├── [Baud: 115200 ▼]
│           └── [ShowAll□]
├── .header-wrapper
├── #header_btns           [Flash] [Connect]
└── #reveal_btn
```

**시각적 결과**:
```
[Logo]       [SPP SCAN] [BLE SCAN]  [Port ▼] [Auto□] [Baud ▼] [ShowAll□] [Status] [Flash] [Connect]
```

### 3.3 CSS 변경

- `#wireless-scan-btns`: `margin-left: auto; margin-right: 15px; display: flex; gap: 8px; align-items: center;`
- `#wireless-scan-btns a`: `display: inline-block; padding: 6px 12px; font-size: 12px;`
- 기본 상태 `display: none;` → Cordova에서 JS로 `.visible` 클래스 추가해 표시
- **기존 `#ble-scan-btn` 관련 CSS 모두 제거**

---

## 4. 코드 변경 상세

### 4.1 신규 파일

#### `src/js/spp_central.js`

```js
/**
 * SPP Central helper module for Rotorflight Configurator (Cordova/Android only)
 * 
 * cordova-plugin-bluetooth-serial 기반 Bluetooth Classic SPP 구현.
 * 시리얼 스트리밍 방식이므로 MTU 제한 없음, MSP 재조립 불필요.
 */

// SPP UUID (표준)
export const SPP_UUID = '00001101-0000-1000-8000-00805F9B34FB';

// --- bluetoothSerial 접근 ---
function getSPP() {
    if (typeof window !== 'undefined' && window.bluetoothSerial) return window.bluetoothSerial;
    return null;
}

// --- SPP 장치 검색 (페어링된 장치만) ---
export function sppScan(onComplete, onError) {
    const ssp = getSPP();
    if (!ssp) {
        if (onError) onError('bluetoothSerial plugin not available');
        return;
    }
    ssp.list(
        function (devices) {
            // 이름 없는 장치 필터링
            const filtered = devices.filter(function (d) {
                return d.name && d.name.trim().length > 0;
            });
            if (onComplete) onComplete(filtered);
        },
        function (err) {
            console.error('[spp_central] list error:', err);
            if (onComplete) onComplete([]);
        }
    );
}

// --- SPP 연결 ---
export function sppConnect(deviceAddress, onConnect, onDisconnect, onError) {
    const ssp = getSPP();
    if (!ssp) {
        if (onError) onError('bluetoothSerial plugin not available');
        return;
    }
    ssp.connect(
        deviceAddress,
        function () {
            // onConnect
            ssp.subscribeRawData(function (data) {
                // data: ArrayBuffer
                if (onConnect._onData) onConnect._onData(data);
            });
            if (onConnect) onConnect({ address: deviceAddress });
        },
        function () {
            // onDisconnect
            if (onDisconnect) onDisconnect('disconnected');
        }
    );
}

// --- SPP 연결 해제 ---
export function sppDisconnect(onSuccess, onError) {
    const ssp = getSPP();
    if (!ssp) {
        if (onError) onError('bluetoothSerial plugin not available');
        return;
    }
    ssp.disconnect(
        function () { if (onSuccess) onSuccess(); },
        function (err) { if (onError) onError(err); }
    );
}

// --- SPP 쓰기 ---
export function sppWrite(data, onSuccess, onError) {
    const ssp = getSPP();
    if (!ssp) {
        if (onError) onError('bluetoothSerial plugin not available');
        return;
    }
    // ArrayBuffer → Uint8Array → write
    ssp.write(data, 
        function () { if (onSuccess) onSuccess(); },
        function (err) { if (onError) onError(err); }
    );
}

// --- SPP 활성화 확인 ---
export function sppIsEnabled(onSuccess, onError) {
    const ssp = getSPP();
    if (!ssp) {
        if (onError) onError('bluetoothSerial plugin not available');
        return;
    }
    ssp.isEnabled(
        function () { if (onSuccess) onSuccess(); },
        function (err) { if (onError) onError(err); }
    );
}
```

### 4.2 수정 파일

#### `src/js/serial.js`

**변경 ①**: import 추가
```js
import {
    sppConnect,
    sppDisconnect,
    sppWrite,
    sppScan,
    sppIsEnabled,
} from "@/js/spp_central.js";
```

**변경 ②**: 상태 필드 추가
```js
export const serial = {
    // ... existing fields ...
    connectionType: 'serial', // 'serial' | 'tcp' | 'virtual' | 'ble' | 'spp'
    
    // SPP 전용 상태 (신규)
    sppDevice:       null,
    sppDataHandler:  null,
    cachedSPPDevices: [],
```

**변경 ③**: `connect()` 라우팅 추가
```js
connect: function (path, options, callback) {
    if (path.startsWith('ble:')) {
        self.connectBLE(path.substring(4), options, callback);
    } else if (path.startsWith('spp:')) {          // ← 신규
        self.connectSPP(path.substring(4), options, callback);
    } else if (path.startsWith('tcp://')) {
        // ... existing ...
    }
```

**변경 ④**: `connectSPP()` 함수 추가 (connectBLE 참조, 단순화)
```js
connectSPP: function (deviceAddress, options, callback) {
    const self = this;
    self.connectionType = 'spp';
    
    // SPP는 스트리밍이므로 MSP 재조립 불필요
    // raw 데이터를 onReceive로 직접 전달
    self._sppDataHandler = function (data) {
        for (let i = 0; i < self.onReceive.listeners.length; i++) {
            self.onReceive.listeners[i]({
                data: data,
                connectionType: 'spp',
            });
        }
        self.bytesReceived += data.byteLength;
    };
    
    console.log(`SPP: connecting to ${deviceAddress}`);
    
    const onConnectSPP = function (result) {
        self.connected = true;
        self.connectionId = deviceAddress;
        self.bytesReceived = 0;
        self.bytesSent = 0;
        self.failed = 0;
        
        // onData 콜백 연결
        onConnectSPP._onData = self._sppDataHandler;
        
        console.log('SPP: connected');
        GUI.log('SPP connected (115200)');
        
        // exit 명령 전송 (BLE와 동일)
        const exitCmd = new Uint8Array([0x65, 0x78, 0x69, 0x74, 0x0D, 0x0A]);
        sppWrite(exitCmd.buffer,
            function () {
                console.log('SPP: exit sent, connection ready');
                if (callback) callback({ connectionId: deviceAddress });
            },
            function () {
                if (callback) callback({ connectionId: deviceAddress });
            }
        );
    };
    
    sppConnect(
        deviceAddress,
        onConnectSPP,
        function (error) {
            // onDisconnect
            console.log(`SPP: device ${deviceAddress} disconnected`, error);
            if (self.connected) {
                self.errorHandler('disconnected', 'receive');
            }
        },
        function (error) {
            // onError
            console.error(`SPP: connect error (${deviceAddress}):`, error);
            GUI.log(`SPP connect failed: ${error}`);
            if (callback) callback(false);
        }
    );
},
```

**변경 ⑤**: `getDevices()`에 SPP 장치 포함
```js
getDevices: function (callback) {
    // Cordova 환경에서는 BLE + SPP 디바이스 포함
    if (GUI.isCordova() && (getNordicBle() || true)) {
        const allDevices = [];
        
        // BLE 장치
        if (this.cachedBLEDevices && this.cachedBLEDevices.length > 0) {
            this.cachedBLEDevices.forEach(function (device) {
                allDevices.push({
                    path: 'ble:' + device.address,
                    displayName: (device.displayName || device.name || device.address || 'Unknown') + ' [BLE]',
                });
            });
        }
        
        // SPP 장치 (신규)
        if (this.cachedSPPDevices && this.cachedSPPDevices.length > 0) {
            this.cachedSPPDevices.forEach(function (device) {
                allDevices.push({
                    path: 'spp:' + device.address,
                    displayName: (device.name || device.address || 'Unknown') + ' [SPP]',
                });
            });
        }
        
        if (allDevices.length > 0) {
            callback(allDevices);
            return;
        }
    }
    // ... existing serial device code ...
},
```

**변경 ⑥**: `scanSPPDevices()` 함수 추가
```js
scanSPPDevices: function (callback) {
    const self = this;
    sppIsEnabled(function () {
        sppScan(
            function (devices) {
                self.cachedSPPDevices = devices;
                const mapped = devices.map(function (d) {
                    return {
                        path: 'spp:' + d.address,
                        displayName: d.name + ' [SPP]',
                    };
                });
                if (callback) callback(mapped);
            },
            function (error) {
                console.error('SPP scan failed:', error);
                if (callback) callback([]);
            }
        );
    }, function (error) {
        console.warn('SPP not enabled:', error);
        if (callback) callback([]);
    });
},
```

**변경 ⑦**: `send()`에 SPP 분기 추가
```js
if (self.connectionType === 'ble') {
    // ... existing BLE send ...
} else if (self.connectionType === 'spp') {          // ← 신규
    sppWrite(data, function () {
        self.bytesSent += data.byteLength;
        if (callback) callback({ bytesSent: data.byteLength });
    });
    return;
}
```

**변경 ⑧**: `disconnect()`에 SPP 분기 추가
```js
if (self.connectionType === 'ble') {
    // ... existing ...
} else if (self.connectionType === 'spp') {          // ← 신규
    self._sppDataHandler = null;
    sppDisconnect(function () {
        console.log(`SPP: closed connection, Sent: ${self.bytesSent} bytes, Received: ${self.bytesReceived} bytes`);
        self.connectionId = false;
        if (callback) callback(true);
    }, function (error) {
        console.error(`SPP: error closing connection: ${error}`);
        self.connectionId = false;
        if (callback) callback(false);
    });
    return;
}
```

#### `src/js/port_handler.js`

**변경 ①**: `check()`에 SPP 장치 검색 추가
```js
PortHandler.check = function () {
    // ... existing ...
    if (GUI.isCordova()) {
        self.check_ble_devices();
        self.check_spp_devices();          // ← 신규
    }
```

**변경 ②**: `check_spp_devices()` 함수 추가 (check_ble_devices 참조)
```js
PortHandler.check_spp_devices = function () {
    const self = this;
    serial.getSPPDevices(function (devices) {
        // BLE와 동일한 방식으로 포트 목록에 통합
    });
};
```

**변경 ③**: `portRecognized()`에 SPP 추가
```js
function portRecognized(portName, pathSelect) {
    if (portName) {
        const isBLE = pathSelect.startsWith("ble:");
        const isSPP = pathSelect.startsWith("spp:");     // ← 신규
        // ...
        if ( ... || isBLE || isSPP) {                   // ← 수정
            return true;
        }
    }
}
```

**변경 ④**: `selectPort()`에서 SPP 연결 처리 (BLE와 동일: baudrate 무시)

#### `src/js/serial_backend.js`

**변경 ①**: SPP 스캔 버튼 UI 바인딩 추가
```js
// Cordova 환경에서 SPP + BLE 스캔 버튼 표시
if (GUI.isCordova()) {
    $('#wireless-scan-btns').addClass('visible');
}

// SPP 스캔 버튼
$('#spp-scan-btn a').on('click', function(e) {
    e.preventDefault();
    const btn = $(this);
    btn.text(i18n.getMessage('sppScanning'));
    btn.addClass('disabled');
    
    serial.scanSPPDevices(function (devices) {
        btn.text(i18n.getMessage('sppScan'));
        btn.removeClass('disabled');
        
        if (devices && devices.length > 0) {
            console.log(`SPP scan complete: ${devices.length} device(s) found`);
        } else {
            console.log('SPP scan complete: no devices found');
        }
        PortHandler.check_serial_devices();
    });
});

// BLE 스캔 버튼 (기존 코드를 #spp-scan-btn 패턴에 맞춰 조정)
$('#ble-scan-btn a').on('click', function(e) {
    // ... existing code, 버튼 ID 변경 ...
});
```

#### `index.html`

**변경 ①**: `#ble-scan-btn` 제거하고 `#wireless-scan-btns` 추가 (로고와 port-picker 사이)
```html
<div class="headerbar">
    <div id="menu_btn">...</div>
    <div id="logo-desktop"></div>
    
    <!-- 신규: SPP/BLE 스캔 버튼 (기본 숨김, Cordova에서 표시) -->
    <div id="wireless-scan-btns">
        <a href="#" class="regular-button" id="spp-scan-btn" i18n="sppScan">SPP SCAN</a>
        <a href="#" class="regular-button" id="ble-scan-btn" i18n="bleScan">BLE SCAN</a>
    </div>
    
    <div id="port-picker">...</div>
    <div class="header-wrapper">...</div>
    <div id="header_btns">...</div>
    <div id="reveal_btn">...</div>
</div>
```

**변경 ②**: 하단의 기존 `#ble-scan-btn` div 제거 (L120-122)

#### `src/css/main.css`

**변경 ①**: `#port-picker`에서 `margin-left: auto` 제거하지 않고 유지 (버튼과 포트가 함께 오른쪽으로 밀리도록)

**변경 ②**: 기존 `#ble-scan-btn` 관련 CSS 제거 (L2690-2707)

**변경 ③**: `#wireless-scan-btns` CSS 추가
```css
/* SPP/BLE 스캔 버튼 래퍼 (기본 숨김, Cordova에서 표시) */
#wireless-scan-btns {
    display: none;
    align-items: center;
    gap: 8px;
    margin-right: 15px;
}

#wireless-scan-btns.visible {
    display: flex;
}

#wireless-scan-btns a.regular-button {
    display: inline-block;
    width: auto;
    min-width: 90px;
    padding: 6px 12px;
    font-size: 12px;
    line-height: 20px;
}
```

#### `package.json`

**변경**: `cordova-plugin-bluetooth-serial` 의존성 추가

#### `app/android/config.xml`

**변경**: Android BLUETOOTH_CONNECT 권한 추가 (Android 12+ 필요)
```xml
<config-file parent="/manifest" target="AndroidManifest.xml">
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
</config-file>
```

---

## 5. SPP vs BLE 아키텍처 비교

| 항목 | BLE (기존) | SPP (추가) |
|------|-----------|-----------|
| 플러그인 | `cordova-plugin-rfc-nordic-ble` | `cordova-plugin-bluetooth-serial` |
| 전송 방식 | GATT (notify/write) | RFCOMM (serial stream) |
| MTU | 247 bytes → `fragmentMspFrame()` 분할 | 무제한 → 분할 불필요 |
| 프레임 재조립 | `createMspReassembler()` 필요 | 불필요 (raw stream 그대로) |
| 서비스 검색 | NordicBle 자동 처리 | UUID 자동 매칭 (00001101-...) |
| 권한 | BLUETOOTH, ACCESS_FINE_LOCATION | BLUETOOTH, BLUETOOTH_CONNECT (A12+) |
| 데이터 핸들러 | `receive` 이벤트 + reassembler | `subscribeRawData` 콜백 직통 |

---

## 6. 작업 파일 요약

| 파일 | 유형 | 내용 |
|------|:--:|------|
| `src/js/spp_central.js` | 신규 | SPP scan/connect/write/disconnect (약 100줄) |
| `src/js/serial.js` | 수정 | import, connectSPP, scanSPPDevices, getDevices, send, disconnect (약 +100줄) |
| `src/js/port_handler.js` | 수정 | check_spp_devices, portRecognized 확장 (약 +30줄) |
| `src/js/serial_backend.js` | 수정 | SPP 버튼 바인딩 + BLE 버튼 ID 변경 (약 +20줄, -5줄) |
| `index.html` | 수정 | #wireless-scan-btns 추가, #ble-scan-btn 제거 (약 +5줄, -3줄) |
| `src/css/main.css` | 수정 | 신규 CSS 블록, 기존 ble-scan-btn CSS 제거 (약 +20줄, -18줄) |
| `package.json` | 수정 | cordova-plugin-bluetooth-serial 추가 (+1줄) |
| `app/android/config.xml` | 수정 | BLUETOOTH_CONNECT 권한 (+3줄) |
| `locales/` | 수정 | i18n 키: sppScan, sppScanning 각 언어별 (약 +6줄/언어) |

**총 예상 코드량**: 신규 약 100줄 + 수정 약 180줄 = **~280줄**

---

## 7. 주의사항 및 리스크

| 항목 | 내용 | 대책 |
|------|------|------|
| Android 12+ 권한 | `BLUETOOTH_CONNECT` 런타임 권한 필요 | `config.xml`에 선언, 앱 최초 실행 시 OS가 권한 요청 |
| SPP UUID | 일부 중국산 모듈에서 비표준 UUID 사용 가능 | 기본 `00001101-...` 사용, 추후 설정 옵션 고려 |
| 연결 안정성 | SPP는 BLE보다 연결 끊김에 취약 | `errorHandler`에서 `disconnected` 처리 (BLE와 동일) |
| 속도 | SPP는 이론상 1Mbps까지, 실제론 115200으로 충분 | 115200 고정 → `#baud` 비활성화 (BLE와 동일 패턴) |

---

## 8. 테스트 체크리스트

- [ ] `cordova-plugin-bluetooth-serial` npm install 성공
- [ ] APK 빌드 성공
- [ ] Android 기기에서 SPP SCAN 버튼 표시됨
- [ ] HC-05/HC-06 페어링된 장치가 스캔 결과에 나타남
- [ ] 이름 없는 장치는 스캔 결과에서 제외됨
- [ ] SPP 연결 → `exit
` 전송 → MSP 통신 정상
- [ ] `dump all` / `diff all` 명령 정상 수신
- [ ] 연결 해제 정상
- [ ] BLE 연결도 기존과 동일하게 동작
- [ ] 포트 드롭다운에서 `spp:` / `ble:` 구분 표시
