/**
 * BLE Central helper module for Rotorflight Configurator (Cordova/APK only)
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 2026-07-11 — Nordic BLE 플러그인 마이그레이션
 * ──────────────────────────────────────────────────────────────────────────
 * 이 파일은 이전 cordova-plugin-ble-central 기반 구현을 대체한다.
 * 외부로 노출되는 export 시그니처는 serial.js 호환성을 위해 그대로 유지하되,
 * 내부 구현은 모두 cordova-plugin-rfc-nordic-ble (Nordic BleManager) 로 라우팅된다.
 *
 * 핵심 변경점:
 *   - bleScan / bleConnect / bleRequestMtu / bleStartNotification / bleWrite
 *     → 모두 window.NordicBle 메서드 호출로 통합
 *   - autoDetectProfile / bleDiscoverServices / tryFallbackDetection / gattOp
 *     → 삭제 (네이티브 isRequiredServiceSupported 가 처리)
 *   - bleRequestMtu → 사실상 no-op (Nordic BleBridgeManager.initialize 가 자동 처리)
 *   - bleStartNotification → 사실상 no-op (connect 시점에 이미 활성화됨)
 *   - normalizeUuid / parseAdvertisedServiceUuid / findUuid → 삭제
 *     (네이티브 플러그인이 advertising 서비스 UUID 매칭을 직접 수행)
 *
 * 유지되는 로직 (전송 계층 무관):
 *   - fragmentMspFrame()         : MTU-3 단위 분할
 *   - createMspReassembler()     : V1/V2 MSP 프레임 재조립
 *   - base64 ↔ ArrayBuffer 변환 유틸
 */

export const BLE_SCAN_SECONDS = 5;       // Nordic 플러그인: 2초 primary + 3초 fallback
export const BLE_DEFAULT_MTU = 23;
export const BLE_REQUESTED_MTU = 515;    // Nordic BleBridgeManager.initialize() 가 자동 협상

// ──────────────────────────────────────────────────────────────────────────
// NordicBle 인스턴스 접근
// ──────────────────────────────────────────────────────────────────────────
function getNordicBle() {
    // 먼저 window.NordicBle 확인 (cordova.define 콜백에서 설정됨)
    if (typeof window !== 'undefined' && window.NordicBle) return window.NordicBle;
    // cordova.plugins.nordicble 접근으로 lazy-load 트리거 시도
    try {
        if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.nordicble) {
            return cordova.plugins.nordicble;
        }
        // cordova.require로 명시적 로딩 시도 (lazy-loading 대비)
        if (typeof cordova !== 'undefined' && typeof cordova.require === 'function') {
            const mod = cordova.require("cordova-plugin-rfc-nordic-ble.NordicBle");
            if (mod) return mod;
        }
    } catch(e) {
        console.warn('[getNordicBle] Plugin loading error:', e);
    }
    return null;
}

function ensureNordicBle(onError) {
    const ble = getNordicBle();
    if (!ble) {
        const msg = 'NordicBle plugin not available — cordova-plugin-rfc-nordic-ble 이 설치되지 않았거나 deviceready 이전입니다.';
        console.error('[ble_central] ' + msg);
        if (onError) onError(msg);
        return null;
    }
    return ble;
}

// ──────────────────────────────────────────────────────────────────────────
// BLE 스캔 — NordicBle.getDevices 래핑
// ──────────────────────────────────────────────────────────────────────────
// 레거시 시그니처 호환: bleScan(seconds, onDevice, onComplete, onError)
export function bleScan(_seconds = BLE_SCAN_SECONDS, onDevice, onComplete, onError) {
    const ble = ensureNordicBle(onError);
    if (!ble) return;
    ble.getDevices()
        .then((devices) => {
            if (onComplete) onComplete(devices);
        })
        .catch((err) => {
            console.error('[ble_central] scan error:', err);
            if (onComplete) onComplete([]);
        });
}

// ──────────────────────────────────────────────────────────────────────────
// BLE 연결 — NordicBle.connect 래핑
// ──────────────────────────────────────────────────────────────────────────
// 레거시 시그니처 호환: bleConnect(deviceId, onConnect, onDisconnect, onError)
//
// Nordic 플러그인의 connect()는:
//   1. GATT 연결
//   2. isRequiredServiceSupported() — 서비스/특성 검증 (SpeedyBee fallback 포함)
//   3. initialize() — requestConnectionPriority(HIGH) + requestMtu(247) + enableNotifications() (Nordic 큐로 직렬화)
//   4. ConnectionObserver.onDeviceReady → resolve
//
// 즉, onConnect 콜백이 호출될 때 HIGH priority + MTU 247 + Notify 활성화가 모두 완료된 상태다.
export function bleConnect(deviceId, onConnect, onDisconnect, onError) {
    const ble = ensureNordicBle(onError);
    if (!ble) return;

    const address = String(deviceId || '').replace(/^ble:/i, '');
    if (!address) { if (onError) onError('bleConnect: invalid deviceId'); return; }

    // NordicBle 'disconnect' 이벤트를 onDisconnect 콜백으로 라우팅 (중복 등록 방지)
    if (!ble._rotorflightDisconnectListener) {
        ble._rotorflightDisconnectListener = true;
        ble.addEventListener('disconnect', () => {
            if (ble._rotorflightOnDisconnect) {
                try { ble._rotorflightOnDisconnect('disconnected'); }
                catch (e) { console.error('[ble_central] onDisconnect handler error:', e); }
            }
        });
    }
    ble._rotorflightOnDisconnect = onDisconnect;

    const doConnect = (device) => {
        ble.connect(device, { baudRate: 115200 })
            .then((result) => {
                if (!result || !result.success) {
                    if (onError) onError('BLE connect failed');
                    return;
                }
                // Revision Patch 2: MTU 검증 경고 (nRF Connect 실기 측정 기준)
                const negotiatedMtu = result.mtu || BLE_DEFAULT_MTU;
                if (negotiatedMtu < BLE_REQUESTED_MTU) {
                    console.warn(`[ble_central] MTU negotiated to ${negotiatedMtu} (expected ${BLE_REQUESTED_MTU}). Performance will be degraded.`);
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
            })
            .catch((err) => {
                console.error('[ble_central] connect error:', err);
                if (onError) onError(err);
            });
    };

    const cached = ble.devices && ble.devices.find((d) => d.address === address);
    if (cached) {
        doConnect(cached);
    } else {
        ble.getDevices()
            .then((devices) => {
                const found = devices.find((d) => d.address === address);
                if (!found) { if (onError) onError(`BLE device not found after rescan: ${address}`); return; }
                doConnect(found);
            })
            .catch((err) => { if (onError) onError(err); });
    }
}

// ─── BLE 연결 해제 — NordicBle.disconnect 래핑 ───
export function bleDisconnect(deviceId, onDisconnect, onError) {
    const ble = ensureNordicBle(onError);
    if (!ble) return;
    ble.disconnect()
        .then(() => { if (onDisconnect) onDisconnect(); })
        .catch((err) => {
            console.error('[ble_central] disconnect error:', err);
            if (onDisconnect) onDisconnect();
        });
}

// ─── MTU 요청 — no-op (Nordic 플러그인이 자동 처리) ───
export function bleRequestMtu(deviceId, _mtu = BLE_REQUESTED_MTU, onSuccess, _onFailure) {
    console.log('[ble_central] bleRequestMtu: no-op (Nordic plugin handles MTU automatically)');
    const ble = getNordicBle();
    const negotiatedMtu = (ble && ble.negotiatedMtu) || BLE_REQUESTED_MTU;
    if (onSuccess) onSuccess(negotiatedMtu);
}

// ─── Notify 구독 — no-op (Nordic 플러그인이 자동 처리) ───
export function bleStartNotification(_deviceId, _serviceUUID, _characteristicUUID, _onData, _onError, _options) {
    console.log('[ble_central] bleStartNotification: no-op (Nordic plugin enables notifications during connect())');
}

// ─── Notify 중지 — no-op ───
export function bleStopNotification(_deviceId, _serviceUUID, _characteristicUUID, onStop, _onError) {
    console.log('[ble_central] bleStopNotification: no-op (handled by disconnect)');
    if (onStop) onStop();
}

// ─── 데이터 쓰기 — NordicBle.send 래핑 ───
let writeRequestId = 0;
export function bleWrite(deviceId, serviceUUID, characteristicUUID, data, onSuccess, onFailure) {
    const ble = ensureNordicBle(onFailure);
    if (!ble) return;
    const requestId = `ble_${++writeRequestId}`;
    ble.send(data, requestId)
        .then((result) => {
            if (onSuccess) onSuccess(result);
        })
        .catch((err) => {
            console.error('[ble_central] write error:', err);
            if (onFailure) onFailure(err);
        });
}

// ─── BLE 활성화 확인 — NordicBle.requestPermission 간접 확인 ───
export function bleIsEnabled(onSuccess, onFailure) {
    const ble = getNordicBle();
    if (!ble) { if (onFailure) onFailure('NordicBle plugin not available'); return; }
    ble.requestPermission()
        .then((result) => {
            if (result && result.granted) { if (onSuccess) onSuccess(); }
            else { if (onFailure) onFailure('BLE permission not granted'); }
        })
        .catch((err) => { if (onFailure) onFailure(err); });
}

export function bleShowSettings() {
    console.warn('[ble_central] bleShowSettings: not implemented in Nordic plugin');
}

// ─── GATT Operation Queue — 더 이상 불필요 (Nordic 큐가 대체) ───
export function gattOp(fn) {
    try { return Promise.resolve(fn()); }
    catch (e) { return Promise.reject(e); }
}

// ─── MSP 프레임 분할 (전송 계층 무관 — 그대로 유지) ───
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

// ─── MSP 프레임 재조립 (전송 계층 무관 — 그대로 유지) ───
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
                if (buffer[0] !== 0x24) { buffer = buffer.slice(1); continue; }
                const type = buffer[1];
                if (type !== 0x4D && type !== 0x58) { buffer = buffer.slice(1); continue; }
                let totalLen;
                if (type === 0x4D) { // V1
                    const sizeByte = buffer[3];
                    if (sizeByte === 0xFF) {
                        if (buffer.length >= 9) {
                            const size16 = buffer[4] | (buffer[5] << 8);
                            totalLen = 8 + size16;
                        } else break;
                    } else {
                        totalLen = 6 + sizeByte;
                    }
                } else { // V2
                    if (buffer.length >= 9) {
                        const size16 = buffer[6] | (buffer[7] << 8);
                        totalLen = 9 + size16;
                    } else break;
                }
                if (buffer.length >= totalLen) {
                    const frame = buffer.slice(0, totalLen);
                    buffer = buffer.slice(totalLen);
                    onCompleteFrame(frame.buffer);
                } else break;
            }
        },
        reset: function () { buffer = new Uint8Array(0); },
    };
}

// ─── Base64 ↔ ArrayBuffer 변환 (레거시 호환) ───
export function base64ToArrayBuffer(base64) {
    if (!base64) return new ArrayBuffer(0);
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes.buffer;
}

export function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

// ─── autoDetectProfile / bleDiscoverServices — deprecated no-op 스텁 ───
export function autoDetectProfile(peripheral) {
    console.warn('[ble_central] autoDetectProfile: deprecated — Nordic plugin handles profile detection');
    if (!peripheral) return null;
    if (peripheral.serviceUuid && peripheral.writeCharacteristic && peripheral.notifyCharacteristic) {
        return {
            service: peripheral.serviceUuid,
            txChar: peripheral.writeCharacteristic,
            rxChar: peripheral.notifyCharacteristic,
            profileName: 'NordicAuto',
        };
    }
    return null;
}

export function bleDiscoverServices(_deviceId, onSuccess, _onError) {
    console.warn('[ble_central] bleDiscoverServices: deprecated — Nordic plugin handles service discovery');
    if (onSuccess) onSuccess({ profileName: 'NordicAuto' });
}
