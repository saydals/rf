/**
 * SPP Central helper module for Rotorflight Configurator (Cordova/Android only)
 *
 * cordova-plugin-bluetooth-serial 기반 Bluetooth Classic SPP 구현.
 * 시리얼 스트리밍 방식이므로 MTU 제한 없음, MSP 재조립 불필요.
 *
 * ★ 스캔(scan) 개념 없음 — 안드로이드에 이미 페어링된 장치를 목록으로 보여줌.
 */

// SPP UUID (표준)
export const SPP_UUID = '00001101-0000-1000-8000-00805F9B34FB';

const SPP_LIST_TIMEOUT = 5000; // 5초 타임아웃

// --- bluetoothSerial 접근 ---
function getSPP() {
    // cordova-plugin-bluetooth-serial: window.bluetoothSerial 또는 cordova.plugins.bluetoothSerial
    if (typeof window !== 'undefined' && window.bluetoothSerial) return window.bluetoothSerial;
    try {
        if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.bluetoothSerial) {
            return cordova.plugins.bluetoothSerial;
        }
    } catch(e) {
        console.warn('[spp_central] Plugin access error:', e);
    }
    return null;
}

// --- 페어링된 SPP 장치 목록 조회 (scan 아님) ---
export function sppList(onComplete, onError) {
    const ssp = getSPP();
    if (!ssp) {
        console.error('[spp_central] bluetoothSerial plugin not available');
        if (onError) onError('bluetoothSerial plugin not available');
        return;
    }

    // Android 12+ 런타임 권한 확인 (cordova-plugin-permission)
    function doList() {
        // 타임아웃 처리
        let timedOut = false;
        const timer = setTimeout(function () {
            timedOut = true;
            console.warn('[spp_central] list() timed out after ' + SPP_LIST_TIMEOUT + 'ms');
            if (onError) onError('list() timed out');
        }, SPP_LIST_TIMEOUT);

        ssp.list(
            function (devices) {
                if (timedOut) return;
                clearTimeout(timer);
                const filtered = devices.filter(function (d) {
                    const name = d.name || '';
                    return name.trim().length > 0;
                });
                console.log('[spp_central] list() returned ' + filtered.length + ' device(s)');
                if (onComplete) onComplete(filtered);
            },
            function (err) {
                if (timedOut) return;
                clearTimeout(timer);
                console.error('[spp_central] list() error:', err);
                if (onError) onError(err || 'list() failed');
            }
        );
    }

    // 권한 체크 및 요청
    try {
        if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.permission) {
            const perm = cordova.plugins.permission;
            const PERM_BT_CONNECT = 'android.permission.BLUETOOTH_CONNECT';
            const PERM_BT_SCAN = 'android.permission.BLUETOOTH_SCAN';

            perm.hasPermission(PERM_BT_CONNECT, function(hasPermission) {
                if (hasPermission) {
                    doList();
                } else {
                    // BLUETOOTH_CONNECT 권한 요청 (Android 12+)
                    perm.requestPermission(PERM_BT_CONNECT, function(status) {
                        if (status.hasPermission) {
                            doList();
                        } else {
                            console.warn('[spp_central] BLUETOOTH_CONNECT permission denied');
                            if (onError) onError('BLUETOOTH_CONNECT permission denied');
                        }
                    }, function(err) {
                        console.error('[spp_central] permission request error:', err);
                        // 권한 요청 실패해도 일단 시도
                        doList();
                    });
                }
            }, function(err) {
                console.warn('[spp_central] hasPermission error:', err);
                doList();
            });
        } else {
            doList();
        }
    } catch(e) {
        console.warn('[spp_central] Permission API error:', e);
        doList();
    }
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
