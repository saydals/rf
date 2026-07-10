/**
 * BLE Central helper module for Rotorflight Configurator (Cordova/APK only)
 *
 * Wraps cordova-plugin-ble-central API with MSP-over-BLE GATT profile.
 *
 * BLE 프로필은 Betaflight Configurator의 devices.js 에서 가져온 UUID 사용:
 *   - CC2541 / HM-10  (범용 BLE UART 모듈)
 *   - SpeedyBee V1/V2 (SpeedyBee BLE 어댑터)
 *   - HM-11 / Nordic NRF UART Service
 *   - DroneBridge
 */

export const BLE_SCAN_SECONDS = 8;
export const BLE_DEFAULT_MTU = 23;
export const BLE_REQUESTED_MTU = 247;

// ============== UUID 유틸리티 ==============

/**
 * UUID를 정규화하여 비교 가능한 형태로 변환
 * - 16비트 축약형(ffe0) → 전체 128비트로 확장
 * - 대소문자 무시
 */
function normalizeUuid(uuid) {
    if (!uuid) return '';
    const trimmed = uuid.trim().replace(/^0x/i, '');
    // 이미 전체 128비트 형태인 경우
    if (trimmed.includes('-')) {
        return trimmed.toLowerCase();
    }
    // 16비트 축약형 (예: ffe0) → Bluetooth Base UUID로 확장
    // 표준 Bluetooth Base UUID: 0000XXXX-0000-1000-8000-00805f9b34fb
    const padded = trimmed.padStart(4, '0').toLowerCase();
    return `0000${padded}-0000-1000-8000-00805f9b34fb`;
}

/**
 * 두 UUID가 동일한지 비교 (축약형/전체형/대소문자 무시)
 */
function uuidMatches(a, b) {
    if (!a || !b) return false;
    return normalizeUuid(a) === normalizeUuid(b);
}

/**
 * UUID 목록에서 특정 프로필 UUID와 일치하는 항목 찾기
 */
function findUuid(list, targetUuid) {
    const normalized = normalizeUuid(targetUuid);
    return list.find(function (item) {
        return normalizeUuid(item) === normalized;
    });
}

// ============== BLE 프로필 ==============

/**
 * 알려진 MSP BLE 서비스 UUID 목록
 * Betaflight configurator `src/js/protocols/devices.js` 에서 발췌
 */
export const BLE_PROFILES = [
    {
        name: 'CC2541',
        serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
        writeCharacteristic: '0000ffe1-0000-1000-8000-00805f9b34fb',
        readCharacteristic:  '0000ffe2-0000-1000-8000-00805f9b34fb',
    },
    {
        name: 'HM-10',
        serviceUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
        writeCharacteristic: '0000ffe1-0000-1000-8000-00805f9b34fb',
        readCharacteristic:  '0000ffe1-0000-1000-8000-00805f9b34fb',
    },
    {
        name: 'SpeedyBee V1',
        serviceUuid: '00001000-0000-1000-8000-00805f9b34fb',
        writeCharacteristic: '00001001-0000-1000-8000-00805f9b34fb',
        readCharacteristic:  '00001002-0000-1000-8000-00805f9b34fb',
    },
    {
        name: 'SpeedyBee V2',
        serviceUuid: '0000abf0-0000-1000-8000-00805f9b34fb',
        writeCharacteristic: '0000abf1-0000-1000-8000-00805f9b34fb',
        readCharacteristic:  '0000abf2-0000-1000-8000-00805f9b34fb',
    },
    {
        name: 'HM-11 / Nordic NRF',
        serviceUuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
        writeCharacteristic: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
        readCharacteristic:  '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    },
    {
        name: 'SpeedyBee FF00',
        serviceUuid: '0000ff00-0000-1000-8000-00805f9b34fb',
        writeCharacteristic: '0000ff01-0000-1000-8000-00805f9b34fb',
        readCharacteristic:  '0000ff02-0000-1000-8000-00805f9b34fb',
    },
    {
        serviceUuid: '0000db32-0000-1000-8000-00805f9b34fb',
        writeCharacteristic: '0000db33-0000-1000-8000-00805f9b34fb',
        readCharacteristic:  '0000db34-0000-1000-8000-00805f9b34fb',
    },
];

// 서비스 UUID 맵 (deviceId → advertised serviceUuid, scan 시점에 채워짐)
const bleDeviceServiceMap = {};

/**
 * BLE 디바이스 스캔
 * 모든 BLE 기기를 표시, advertising 서비스 UUID를 파싱하여 저장
 */
export function bleScan(seconds = BLE_SCAN_SECONDS, onDevice, onComplete, onError) {
    if (typeof ble === 'undefined' || !ble.scan) {
        if (onError) onError('BLE not available');
        if (onComplete) onComplete([]);
        return;
    }

    const devices = [];

    ble.scan([], seconds,
        function (device) {
            const exists = devices.some(d => d.id === device.id);
            if (!exists) {
                    const advertised = parseAdvertisedServiceUuid(device.advertising);
                if (advertised) {
                    bleDeviceServiceMap[device.id] = advertised;
                }
                devices.push({
                    id: device.id,
                    name: device.name || 'Unknown',
                    rssi: device.rssi,
                    advertising: device.advertising,
                    serviceUuid: advertised,
                });
                if (onDevice) onDevice(device);
            }
        },
        function (error) {
            console.error('BLE scan error:', error);
            if (onError) onError(error);
            if (onComplete) onComplete(devices);
        }
    );

    setTimeout(function () {
        try {
            ble.stopScan(function () {
                if (onComplete) onComplete(devices);
            }, function () {
                if (onComplete) onComplete(devices);
            });
        } catch (e) {
            if (onComplete) onComplete(devices);
        }
    }, (seconds + 1) * 1000);
}

// ============== BLE Advertising 데이터 파싱 ==============

/**
 * BLE advertising ArrayBuffer에서 서비스 UUID 추출
 */
function parseAdvertisedServiceUuid(advertising) {
    if (!advertising) return null;
    try {
        const data = new Uint8Array(advertising);
        let i = 0;
        while (i < data.length) {
            const len = data[i];
            if (len === 0) break;
            const type = data[i + 1];
            if (type === 0x02 || type === 0x03) {
                // 16비트 서비스 UUID (little-endian)
                for (let j = i + 2; j < i + len && j + 1 < data.length; j += 2) {
                    const uuid16 = (data[j + 1] << 8) | data[j];
                    const full = '0000' + uuid16.toString(16).padStart(4, '0') + '-0000-1000-8000-00805f9b34fb';
                    console.log(`BLE: advertised 16bit UUID: ${full}`);
                    return full;
                }
            } else if (type === 0x06 || type === 0x07) {
                // 128비트 서비스 UUID (little-endian bytes)
                if (i + 2 + 16 <= data.length) {
                    const b = data.slice(i + 2, i + 2 + 16);
                    function h(v) { return v.toString(16).padStart(2, '0'); }
                    const uuid = h(b[3])+h(b[2])+h(b[1])+h(b[0])+'-'+h(b[5])+h(b[4])+'-'+h(b[7])+h(b[6])+'-'+h(b[8])+h(b[9])+'-'+h(b[10])+h(b[11])+h(b[12])+h(b[13])+h(b[14])+h(b[15]);
                    console.log(`BLE: advertised 128bit UUID: ${uuid}`);
                    return uuid;
                }
            }
            i += len + 1;
        }
    } catch (e) {
        console.warn('BLE: failed to parse advertising data:', e);
    }
    return null;
}

// ============== 표준 GATT 서비스 UUID (제외 대상) ==============
const STANDARD_GATT_UUIDS = [
    '00001800-0000-1000-8000-00805f9b34fb',
    '00001801-0000-1000-8000-00805f9b34fb',
    '0000180a-0000-1000-8000-00805f9b34fb',
    '0000180f-0000-1000-8000-00805f9b34fb',
    '0000180d-0000-1000-8000-00805f9b34fb',
].map(normalizeUuid);

/**
 * ble.connect() 콜백의 peripheral 객체에서 TX(Write)/RX(Notify) 특성 자동 감지
 * Peripheral.java의 asJSONObject(gatt)가 생성하는 특성 배열을 파싱
 * @param {Object} peripheral - ble.connect success 콜백의 인자
 * @returns {{service, txChar, rxChar, profileName}|null}
 */
export function autoDetectProfile(peripheral) {
    if (!peripheral || !peripheral.characteristics || !peripheral.characteristics.length) {
        console.error('BLE: connect callback has no characteristics');
        return null;
    }
    console.log('BLE: characteristics from connect:', JSON.stringify(peripheral.characteristics));

    let writeChar = null;
    let notifyChar = null;

    for (const c of peripheral.characteristics) {
        const props = c.properties || [];
        const svc = normalizeUuid(c.service || '');
        if (STANDARD_GATT_UUIDS.includes(svc)) continue;

        if ((props.includes('Write') || props.includes('WriteWithoutResponse')) && !writeChar) {
            writeChar = c;
        }
        if (props.includes('Notify') && !notifyChar) {
            notifyChar = c;
        }
    }

    // WriteWithoutResponse가 없으면 Write로 폴백
    if (!writeChar) {
        for (const c of peripheral.characteristics) {
            const svc = normalizeUuid(c.service || '');
            if (STANDARD_GATT_UUIDS.includes(svc)) continue;
            if ((c.properties || []).includes('Write')) { writeChar = c; break; }
        }
    }

    if (writeChar && notifyChar) {
        console.log(`BLE: auto-detect OK: svc=${writeChar.service} tx=${writeChar.characteristic} rx=${notifyChar.characteristic}`);
        return {
            service: writeChar.service,
            txChar: writeChar.characteristic,
            rxChar: notifyChar.characteristic,
            profileName: 'AutoDetect',
        };
    }

    console.error('BLE: auto-detect failed - no matching TX/RX pair');
    return null;
}

/**
 * BLE 연결
 */
export function bleConnect(deviceId, onConnect, onDisconnect, onError) {
    if (typeof ble === 'undefined' || !ble.connect) {
        if (onError) onError('BLE not available');
        return;
    }

    let connected = false;

    ble.connect(deviceId,
        function (device) {
            connected = true;
            console.log(`BLE: connected to ${device.id || deviceId}`);
            if (onConnect) onConnect(device);
        },
        function (error) {
            if (!connected) {
                console.error(`BLE: connection failed for ${deviceId}`, error);
                if (onError) onError(error);
            } else {
                console.log(`BLE: disconnected from ${deviceId}`, error);
                if (onDisconnect) onDisconnect(error);
            }
        }
    );
}

/**
 * BLE 연결 해제
 */
export function bleDisconnect(deviceId, onDisconnect, onError) {
    if (typeof ble === 'undefined' || !ble.disconnect) {
        if (onError) onError('BLE not available');
        return;
    }

    ble.disconnect(deviceId,
        function () {
            console.log(`BLE: disconnected ${deviceId}`);
            if (onDisconnect) onDisconnect();
        },
        function (error) {
            console.error(`BLE: disconnect error ${deviceId}:`, error);
            if (onError) onError(error);
        }
    );
}

/**
 * 서비스 및 특성 검색 (연결 후 호출)
 * Betaflight devices.js의 모든 알려진 프로필을 순차적으로 시도
 */
export function bleDiscoverServices(deviceId, onSuccess, onError) {
    // BLE 서비스/특성 API 확인 (v2.0.0에서는 services()가 없을 수 있음)
    function tryKnownUuids() {
        let found = false;

        // 광고된 서비스 UUID가 있으면 먼저 시도
        const advUuid = bleDeviceServiceMap[deviceId];
        if (advUuid) {
            console.log(`BLE: using advertised UUID: ${advUuid}`);
            // 이 서비스로 시도할 TX/RX 특성 패턴
            const patterns = [
                { tx: advUuid, rx: advUuid },
                { tx: '0000ffe1-0000-1000-8000-00805f9b34fb', rx: '0000ffe1-0000-1000-8000-00805f9b34fb' },
                { tx: '0000ffe1-0000-1000-8000-00805f9b34fb', rx: '0000ffe2-0000-1000-8000-00805f9b34fb' },
                { tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', rx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e' },
                { tx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', rx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' },
            ];
            let pi = 0;
            function tryP() {
                if (found) return;
                if (pi >= patterns.length) { console.log('BLE: advertised UUID exhausted'); tryProfilesLoop(); return; }
                const p = patterns[pi++];
                console.log(`BLE: probing adv pattern ${p.tx}/${p.rx}`);
                if (ble.startNotification) {
                    ble.startNotification(deviceId, advUuid, p.rx, function(d) {
                        if (found) return; found = true;
                        console.log('BLE: adv pattern OK');
                        onSuccess({ service: advUuid, txChar: p.tx, rxChar: p.rx, profileName: 'Adv' });
                    }, function() { if (!found) tryP(); });
                    setTimeout(function() { if (!found) { try { ble.stopNotification(deviceId, advUuid, patterns[pi-1].rx, function(){}, function(){}); } catch(e) {} tryP(); } }, 2000);
                } else { onSuccess({ service: advUuid, txChar: p.tx, rxChar: p.rx, profileName: 'Adv' }); }
            }
            tryP();
        } else {
            tryProfilesLoop();
        }

        function tryProfilesLoop() {
            let index = 0;
            function tryNext() {
                if (found) return;
                if (index >= BLE_PROFILES.length) { if (!found && onError) onError('No working profile'); return; }
                const profile = BLE_PROFILES[index++];
                console.log(`BLE: trying ${profile.name}`);
                if (ble.startNotification) {
                    ble.startNotification(deviceId, profile.serviceUuid, profile.readCharacteristic,
                        function (data) { if (found) return; found = true; console.log(`BLE: ${profile.name} OK`); onSuccess({ service: profile.serviceUuid, txChar: profile.writeCharacteristic, rxChar: profile.readCharacteristic, profileName: profile.name }); },
                        function () { if (found) return; console.log(`BLE: ${profile.name} no`); tryNext(); }
                    );
                    setTimeout(function () { if (found) return; try { ble.stopNotification(deviceId, profile.serviceUuid, profile.readCharacteristic, function(){}, function(){}); } catch(e) {} console.log(`BLE: ${profile.name} timeout`); tryNext(); }, 3000);
                } else { onSuccess({ service: profile.serviceUuid, txChar: profile.writeCharacteristic, rxChar: profile.readCharacteristic, profileName: profile.name }); }
            }
            tryNext();
        }
    }

    // services() API가 있으면 먼저 시도
    if (typeof ble !== 'undefined' && typeof ble.services === 'function') {
        ble.services(deviceId,
            function (services) {
                // 기존 프로필 매칭 로직
                tryProfiles(services, 0);
            },
            function () {
                console.log('BLE: services() failed, trying direct probe');
                tryKnownUuids();
            }
        );
    } else {
        console.log('BLE: services() not available, trying direct probe');
        tryKnownUuids();
    }

    function tryProfiles(services, profileIndex) {
        if (services.length === 0) {
            tryKnownUuids();
            return;
        }
        if (profileIndex >= BLE_PROFILES.length) {
            console.log('BLE: no match. Services:', JSON.stringify(services));
            tryFallbackDetection(services, deviceId, onSuccess, onError);
            return;
        }
        const profile = BLE_PROFILES[profileIndex];
        const mspService = findUuid(services, profile.serviceUuid);
        if (mspService) {
            ble.characteristics(deviceId, mspService,
                function (characteristics) {
                    const txChar = findUuid(characteristics, profile.writeCharacteristic);
                    const rxChar = findUuid(characteristics, profile.readCharacteristic);
                    if (txChar && rxChar) {
                        console.log(`BLE: matched "${profile.name}"`);
                        if (onSuccess) onSuccess({
                            service: mspService, txChar, rxChar, profileName: profile.name,
                        });
                    } else {
                        console.log(`BLE: svc matched but chars mismatch, trying next`);
                        tryProfiles(services, profileIndex + 1);
                    }
                },
                function () { tryProfiles(services, profileIndex + 1); }
            );
        } else {
            tryProfiles(services, profileIndex + 1);
        }
    }
}

/**
 * 폴백: 첫 번째 서비스의 특성을 순서대로 TX/RX로 사용
 */
function tryFallbackDetection(services, deviceId, onSuccess, onError) {
    const targetService = services[0];

    if (!targetService) {
        if (onError) onError('No BLE service found on device');
        return;
    }

    console.log(`BLE: fallback using first service ${targetService}`);

    ble.characteristics(deviceId, targetService,
        function (characteristics) {
            if (characteristics.length === 0) {
                if (onError) onError('No characteristics found');
                return;
            }

            // TX: write 속성이 있는 특성, RX: notify 속성이 있는 특성
            // cordova-plugin-ble-central은 속성 정보를 제공하지 않으므로
            // UUID 키워드 기반 매칭 사용
            let txChar = findUuid(characteristics, '0000ffe1-0000-1000-8000-00805f9b34fb');
            let rxChar = findUuid(characteristics, '0000ffe2-0000-1000-8000-00805f9b34fb');

            if (!txChar || !rxChar) {
                // FFE1/FFE2 패턴 실패 → Nordic UART 패턴 (0002=TX, 0003=RX)
                txChar = findUuid(characteristics, '6e400003-b5a3-f393-e0a9-e50e24dcca9e');
                rxChar = findUuid(characteristics, '6e400002-b5a3-f393-e0a9-e50e24dcca9e');
            }

            if (!txChar || !rxChar) {
                // 그래도 없으면 첫 번째/두 번째 특성 사용
                txChar = characteristics[0];
                rxChar = characteristics.length > 1 ? characteristics[1] : characteristics[0];
                console.log(`BLE: fallback using char[0]=${txChar} char[1]=${rxChar}`);
            }

            if (onSuccess) onSuccess({
                service: targetService,
                txChar: txChar,
                rxChar: rxChar,
                profileName: 'Fallback',
            });
        },
        function (error) {
            if (onError) onError('Failed to get characteristics: ' + error);
        }
    );
}

/**
 * Notify 시작 (RX 데이터 수신)
 */
export function bleStartNotification(deviceId, serviceUUID, characteristicUUID, onData, onError, options) {
    if (typeof ble === 'undefined' || !ble.startNotification) {
        if (onError) onError('BLE not available');
        return;
    }

    // cordova-plugin-ble-central v2.0.0: options.emitOnRegistered=true 로 
    // CCCD 등록 완료 이벤트도 수신 (기본값 false이면 등록완료 이벤트 무시됨)
    ble.startNotification(deviceId, serviceUUID, characteristicUUID,
        function (data) {
            if (data === 'registered') {
                console.log('BLE: notification registered (CCCD enabled)');
                return;
            }
            // data는 Cordova PluginResult 객체 또는 base64 문자열
            // { CDVType: 'ArrayBuffer', data: 'XXXX' } 또는 'XXXX' (string)
            let buffer;
            if (typeof data === 'object' && data && data.CDVType === 'ArrayBuffer') {
                buffer = base64ToArrayBuffer(data.data);
            } else if (typeof data === 'string') {
                buffer = base64ToArrayBuffer(data);
            } else if (data instanceof ArrayBuffer) {
                buffer = data;
            } else {
                console.warn('BLE: unknown notification data format', typeof data);
                return;
            }
            if (onData) onData(buffer);
        },
        function (error) {
            console.error('BLE notification error:', error);
            if (onError) onError(error);
        },
        { emitOnRegistered: true }
    );
}

/**
 * Notify 중지
 */
export function bleStopNotification(deviceId, serviceUUID, characteristicUUID, onStop, onError) {
    if (typeof ble === 'undefined' || !ble.stopNotification) {
        if (onError) onError('BLE not available');
        return;
    }

    ble.stopNotification(deviceId, serviceUUID, characteristicUUID,
        function () {
            if (onStop) onStop();
        },
        function (error) {
            if (onError) onError(error);
        }
    );
}

/**
 * BLE로 데이터 쓰기 (Write Without Response)
 */
export function bleWrite(deviceId, serviceUUID, characteristicUUID, data, onSuccess, onFailure) {
    if (typeof ble === 'undefined' || !ble.writeWithoutResponse) {
        if (onFailure) onFailure('BLE not available');
        return;
    }

    const base64Data = arrayBufferToBase64(data);

    ble.writeWithoutResponse(deviceId, serviceUUID, characteristicUUID, base64Data,
        function () {
            if (onSuccess) onSuccess();
        },
        function (error) {
            console.error('BLE write error:', error);
            if (onFailure) onFailure(error);
        }
    );
}

/**
 * MTU 요청 (Android)
 */
// GATT Operation Queue — 한 번에 하나의 ble.* 호출만 허용
let gattQueue = Promise.resolve();

export function gattOp(fn) {
    gattQueue = gattQueue.then(fn).catch(e => {
        console.error('[BLE GATT]', e);
    });
    return gattQueue;
}

export function bleRequestMtu(deviceId, mtu = BLE_REQUESTED_MTU, onSuccess, onFailure) {
    if (typeof ble === 'undefined' || !ble.requestMtu) {
        if (onSuccess) onSuccess(BLE_DEFAULT_MTU);
        return;
    }

    ble.requestMtu(deviceId, mtu,
        function (negotiatedMtu) {
            console.log(`BLE: MTU negotiated to ${negotiatedMtu}`);
            if (onSuccess) onSuccess(negotiatedMtu);
        },
        function (error) {
            console.warn(`BLE: MTU request failed, using default ${BLE_DEFAULT_MTU}`, error);
            if (onSuccess) onSuccess(BLE_DEFAULT_MTU);
        }
    );
}

/**
 * BLE 사용 가능 여부 확인
 */
export function bleIsEnabled(onSuccess, onFailure) {
    if (typeof ble === 'undefined' || !ble.isEnabled) {
        if (onFailure) onFailure('BLE not available');
        return;
    }

    ble.isEnabled(
        function () { if (onSuccess) onSuccess(); },
        function (error) { if (onFailure) onFailure(error); }
    );
}

/**
 * 블루투스 설정 화면 열기
 */
export function bleShowSettings() {
    if (typeof ble !== 'undefined' && ble.showBluetoothSettings) {
        ble.showBluetoothSettings();
    }
}

// =============== 유틸리티 함수 ===============

/**
 * MSP 프레임을 MTU 크기에 맞게 분할
 */
export function fragmentMspFrame(data, mtu = BLE_DEFAULT_MTU) {
    const fragments = [];
    const view = new Uint8Array(data);
    const maxPayload = mtu - 3; // ATT 헤더 오버헤드 고려

    for (let offset = 0; offset < view.length; offset += maxPayload) {
        const chunk = view.slice(offset, offset + maxPayload);
        fragments.push(chunk.buffer);
    }

    return fragments;
}

/**
 * 수신된 BLE notify 데이터 버퍼 → MSP 프레임 재조립
 */
export function createMspReassembler(onCompleteFrame) {
    let buffer = new Uint8Array(0);

    return {
        append: function (chunk) {
            const newData = new Uint8Array(chunk);
            const combined = new Uint8Array(buffer.length + newData.length);
            combined.set(buffer);
            combined.set(newData, buffer.length);
            buffer = combined;
            this._extractFrames();
        },

        _extractFrames: function () {
            while (buffer.length >= 6) {
                if (buffer[0] !== 0x24) {
                    buffer = buffer.slice(1);
                    continue;
                }
                const type = buffer[1];
                if (type !== 0x4D && type !== 0x58) {
                    buffer = buffer.slice(1);
                    continue;
                }
                const size = (buffer[3] | (buffer[4] << 8));
                // MSP V1: $+M+dir+size(1B)+cmd(1B)+data+checksum = 6+size
                // MSP V2: $+X+dir+flag(1B)+cmd(2B)+size(2B)+data+checksum = 9+size
                let totalLen;
                if (type === 0x4D) { // V1
                    const sizeByte = buffer[3];
                    if (sizeByte === 0xFF) {
                        // JUMBO V1: size=255 → 2bytes actual size at buffer[4-5]
                        const jumboSize = (buffer[4] | (buffer[5] << 8));
                        totalLen = 8 + jumboSize; // $+M+dir+FF+size(2)+cmd(1)+data+checksum
                    } else {
                        totalLen = 6 + sizeByte; // $+M+dir+size(1)+cmd(1)+data+checksum
                    }
                } else { // V2 (0x58='X')
                    const sizeV2 = (buffer[3] | (buffer[4] << 8));
                    totalLen = 9 + sizeV2;
                }

                if (buffer.length >= totalLen) {
                    const frame = buffer.slice(0, totalLen);
                    buffer = buffer.slice(totalLen);
                    if (onCompleteFrame) {
                        onCompleteFrame(frame.buffer);
                    }
                } else {
                    break;
                }
            }
        },

        reset: function () {
            buffer = new Uint8Array(0);
        },
    };
}

// =============== Base64 <-> ArrayBuffer 변환 ===============

function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}



