import { CONFIGURATOR } from "@/js/configurator.svelte.js";
import { FC } from "@/js/fc.svelte.js";
import { GUI } from "@/js/gui.js";
import { i18n } from "@/js/localization.js";
import { checkChromeRuntimeError } from "@/js/utils/common.js";
import {
    bleConnect,
    bleDisconnect,
    bleWrite,
    bleScan,
    bleIsEnabled,
    fragmentMspFrame,
    createMspReassembler,
    BLE_DEFAULT_MTU,
    BLE_REQUESTED_MTU,
} from "@/js/ble_central.js";
import {
    sppConnect,
    sppDisconnect,
    sppWrite,
    sppList,
    sppIsEnabled,
} from "@/js/spp_central.js";

// NordicBle 인스턴스 접근 (cordova-plugin-rfc-nordic-ble)
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

export const serial = {
    connected:      false,
    connectionId:   false,
    openCanceled:   false,
    bitrate:        0,
    bytesReceived:  0,
    bytesSent:      0,
    failed:         0,
    connectionType: 'serial', // 'serial' or 'tcp' or 'virtual' or 'ble' or 'spp'
    connectionIP:   '127.0.0.1',
    connectionPort: 5761,

    // BLE 전용 상태
    bleDevice:       null,     // 연결된 BLE 디바이스 객체
    bleServiceUUID:  null,     // 발견된 MSP 서비스 UUID
    bleTxCharUUID:   null,     // TX 특성 UUID
    bleRxCharUUID:   null,     // RX 특성 UUID
    bleMtu:          BLE_DEFAULT_MTU,  // 협상된 MTU
    bleRxBuffer:     null,     // MSP 프레임 재조립기

    // SPP 전용 상태 (신규)
    sppDevice:       null,     // 연결된 SPP 디바이스 객체
    sppDataHandler:  null,     // SPP 데이터 핸들러
    cachedSPPDevices: [],      // 캐시된 SPP 장치 목록

    transmitting:   false,
    outputBuffer:   [],

    connect: function (path, options, callback) {
        const self = this;
        const testUrl = path.match(/^tcp:\/\/([A-Za-z0-9.-]+)(?::(\d+))?$/);
        if (testUrl) {
            self.connectTcp(testUrl[1], testUrl[2], options, callback);
        } else if (path === 'virtual') {
            self.connectVirtual(callback);
        } else if (path.startsWith('ble:')) {
            const deviceId = path.substring(4);
            self.connectBLE(deviceId, options, callback);
        } else if (path.startsWith('spp:')) {
            const deviceAddress = path.substring(4);
            self.connectSPP(deviceAddress, options, callback);
        } else {
            self.connectSerial(path, options, callback);
        }
    },
    connectSerial: function (path, options, callback) {
        const self = this;
        self.connectionType = 'serial';

        chrome.serial.connect(path, options, function (connectionInfo) {
            if (connectionInfo && !self.openCanceled && !checkChromeRuntimeError()) {
                self.connected = true;
                self.connectionId = connectionInfo.connectionId;
                self.bitrate = connectionInfo.bitrate;
                self.bytesReceived = 0;
                self.bytesSent = 0;
                self.failed = 0;

                self.onReceive.addListener(function log_bytesReceived(info) {
                    self.bytesReceived += info.data.byteLength;
                });

                self.onReceiveError.addListener(function watch_for_on_receive_errors(info) {
                    switch (info.error) {
                        case 'system_error': // we might be able to recover from this one
                            if (!self.failed++) {
                                chrome.serial.setPaused(self.connectionId, false, function () {
                                    self.getInfo(function (getInfo) {
                                        if (getInfo) {
                                            if (!getInfo.paused) {
                                                console.log(`${self.connectionType}: connection recovered from last onReceiveError`);
                                                self.failed = 0;
                                            } else {
                                                console.log(`${self.connectionType}: connection did not recover from last onReceiveError, disconnecting`);
                                                GUI.log(i18n.getMessage('serialUnrecoverable'));
                                                self.errorHandler(getInfo.error, 'receive');
                                            }
                                        } else {
                                            checkChromeRuntimeError();
                                        }
                                    });
                                });
                            }
                            break;

                        case 'overrun':
                            // wait 50 ms and attempt recovery
                            self.error = info.error;
                            setTimeout(function() {
                                chrome.serial.setPaused(info.connectionId, false, function() {
                                    self.getInfo(function (_info) {
                                        if (_info) {
                                            if (_info.paused) {
                                                // assume unrecoverable, disconnect
                                                console.log(`${self.connectionType}: connection did not recover from ${self.error} condition, disconnecting`);
                                                GUI.log(i18n.getMessage('serialUnrecoverable'));
                                                self.errorHandler(_info.error, 'receive');
                                            }
                                            else {
                                                console.log(`${self.connectionType}: connection recovered from ${self.error} condition`);
                                            }
                                        }
                                    });
                                });
                            }, 50);
                            break;

                        case 'timeout':
                            // No data has been received for receiveTimeout milliseconds.
                            // We will do nothing.
                            break;

                        case 'frame_error':
                            GUI.log(i18n.getMessage('serialErrorFrameError'));
                            self.errorHandler(info.error, 'receive');
                            break;
                        case 'parity_error':
                            GUI.log(i18n.getMessage('serialErrorParityError'));
                            self.errorHandler(info.error, 'receive');
                            break;
                        case 'break': // This seems to be the error that is thrown under NW.js in Windows when the device reboots after typing 'exit' in CLI
                        case 'disconnected':
                        case 'device_lost':
                        default:
                            self.errorHandler(info.error, 'receive');
                            break;
                    }
                });

                console.log(`${self.connectionType}: connection opened with ID: ${connectionInfo.connectionId} , Baud: ${connectionInfo.bitrate}`);

                if (callback) {
                    callback(connectionInfo);
                }

            } else {

                if (connectionInfo && self.openCanceled) {
                    // connection opened, but this connect sequence was canceled
                    // we will disconnect without triggering any callbacks
                    self.connectionId = connectionInfo.connectionId;
                    console.log(`${self.connectionType}: connection opened with ID: ${connectionInfo.connectionId} , but request was canceled, disconnecting`);

                    // some bluetooth dongles/dongle drivers really doesn't like to be closed instantly, adding a small delay
                    setTimeout(function initialization() {
                        self.openCanceled = false;
                        self.disconnect(function resetUI() {
                            console.log(`${self.connectionType}: connect sequence was cancelled, disconnecting...`);
                        });
                    }, 150);
                } else if (self.openCanceled) {
                    // connection didn't open and sequence was canceled, so we will do nothing
                    console.log(`${self.connectionType}: connection didn't open and request was canceled`);
                    self.openCanceled = false;
                } else {
                    console.log(`${self.connectionType}: failed to open serial port`);
                }
                if (callback) {
                    callback(false);
                }
            }
        });
    },
    connectTcp: function (ip, port, options, callback) {
        const self = this;
        self.connectionIP = ip;
        self.connectionPort = port || 5761;
        self.connectionPort = parseInt(self.connectionPort);
        self.connectionType = 'tcp';

        chrome.sockets.tcp.create({
            persistent: false,
            name: 'Rotorflight',
            bufferSize: 65535,
        }, function(createInfo) {
            if (createInfo && !self.openCanceled || !checkChromeRuntimeError()) {
                self.connectionId = createInfo.socketId;
                self.bitrate = 115200; // fake
                self.bytesReceived = 0;
                self.bytesSent = 0;
                self.failed = 0;

                chrome.sockets.tcp.connect(createInfo.socketId, self.connectionIP, self.connectionPort, function (result) {
                    if (result === 0 || !checkChromeRuntimeError()) {
                        chrome.sockets.tcp.setNoDelay(createInfo.socketId, true, function (noDelayResult) {
                            if (noDelayResult === 0 || !checkChromeRuntimeError()) {
                                self.onReceive.addListener(function log_bytesReceived(info) {
                                    self.bytesReceived += info.data.byteLength;
                                });
                                self.onReceiveError.addListener(function watch_for_on_receive_errors(info) {
                                    if (info.socketId !== self.connectionId) return;

                                    if (self.connectionType === 'tcp' && info.resultCode < 0) {
                                        self.errorHandler(info.resultCode, 'receive');
                                    }
                                });
                                self.connected = true;
                                console.log(`${self.connectionType}: connection opened with ID ${createInfo.socketId} , url: ${self.connectionIP}:${self.connectionPort}`);
                                if (callback) {
                                    callback(createInfo);
                                }
                            }
                        });
                    } else {
                        console.log(`${self.connectionType}: failed to connect with result ${result}`);
                        if (callback) {
                            callback(false);
                        }
                    }
                });
            }
        });
    },
    connectVirtual: function (callback) {
        const self = this;
        self.connectionType = 'virtual';

        if (!self.openCanceled) {
            self.connected = true;
            self.connectionId = 'virtual';
            self.bitrate = 115200;
            self.bytesReceived = 0;
            self.bytesSent = 0;
            self.failed = 0;

            callback?.();
        }
    },
    connectBLE: function (deviceId, options, callback) {
        const self = this;
        self.connectionType = 'ble';
        self.bleRxBuffer = createMspReassembler(function (frame) {
            for (let i = 0; i < self.onReceive.listeners.length; i++) {
                try {
                    self.onReceive.listeners[i]({
                        data: frame,
                        connectionType: 'ble',
                    });
                } catch (e) {
                    console.error('BLE onReceive listener error:', e);
                }
            }
            self.bytesReceived += frame.byteLength;
        });

        console.log(`BLE: connecting to deviceId=${deviceId}`);
        const nordicBle = getNordicBle();
        if (!nordicBle) {
            console.error('BLE: NordicBle plugin not available for connect');
            if (callback) callback(false);
            return;
        }

        self._bleReceiveHandler = function (e) {
            const data = e.detail;
            if (data && data.byteLength > 0) {
                if (CONFIGURATOR.cliEngineActive) {
                    // CLI mode: bypass MSP reassembler, send raw data directly to listeners
                    for (let i = 0; i < self.onReceive.listeners.length; i++) {
                        self.onReceive.listeners[i]({
                            data: data,
                            connectionType: 'ble',
                        });
                    }
                } else {
                    // MSP mode: use reassembler as normal
                    if (self.bleRxBuffer) self.bleRxBuffer.append(data.buffer);
                }
            }
        };
        nordicBle.addEventListener('receive', self._bleReceiveHandler);

        bleConnect(deviceId,
            function (peripheral) {
                if (self.openCanceled) {
                    self.connectBLECleanup();
                    if (callback) callback(false);
                    return;
                }

                self.connected = true;
                self.connectionId = deviceId;
                self.bleDevice = peripheral;
                self.bytesReceived = 0;
                self.bytesSent = 0;
                self.failed = 0;

                self.bleServiceUUID = peripheral.serviceUuid;
                self.bleTxCharUUID  = peripheral.writeCharacteristic;
                self.bleRxCharUUID  = peripheral.notifyCharacteristic;
                self.bleMtu         = peripheral.mtu || BLE_REQUESTED_MTU;

                console.log(`BLE: connected, MTU=${self.bleMtu}, svc=${self.bleServiceUUID}`);
                // Revision Patch 3: MTU 상태 로그 개선
                if (self.bleMtu < BLE_REQUESTED_MTU) {
                    GUI.log(`BLE connected (MTU ${self.bleMtu} WARNING - expected 247, performance degraded)`);
                } else {
                    GUI.log(`BLE connected (MTU ${self.bleMtu}, HIGH priority)`);
                }

                const exitCmd = new Uint8Array([0x65, 0x78, 0x69, 0x74, 0x0D, 0x0A]);
                bleWrite(deviceId, self.bleServiceUUID, self.bleTxCharUUID, exitCmd.buffer,
                    function () {
                        console.log('BLE: exit sent, connection ready');
                        if (callback) callback({ connectionId: deviceId });
                    },
                    function () {
                        if (callback) callback({ connectionId: deviceId });
                    }
                );
            },
            function (error) {
                console.log(`BLE: device ${deviceId} disconnected`, error);
                if (self.connected) {
                    self.errorHandler('disconnected', 'receive');
                }
            },
            function (error) {
                console.error(`BLE: connect error (deviceId=${deviceId}):`, error);
                GUI.log(`BLE connect failed: ${error}`);
                if (callback) callback(false);
            }
        );
    },

    /**
     * BLE 연결 정리 (notify 중지, 재조립기 해제)
     */
    connectBLECleanup: function () {
        const self = this;
        if (self.bleRxBuffer) {
            self.bleRxBuffer.reset();
            self.bleRxBuffer = null;
        }
        // NordicBle 'receive' 이벤트 리스너 제거
        const nordicBle = getNordicBle();
        if (nordicBle && self._bleReceiveHandler) {
            try { nordicBle.removeEventListener('receive', self._bleReceiveHandler); }
            catch (e) { console.warn('BLE: failed to remove receive listener:', e); }
            self._bleReceiveHandler = null;
        }
        self.bleDevice = null;
        self.bleServiceUUID = null;
        self.bleTxCharUUID = null;
        self.bleRxCharUUID = null;
        self.bleMtu = BLE_DEFAULT_MTU;
    },

    connectSPP: function (deviceAddress, options, callback) {
        const self = this;
        self.connectionType = 'spp';

        self._sppDataHandler = function (data) {
            self.bytesReceived += data.byteLength;
            for (let i = 0; i < self.onReceive.listeners.length; i++) {
                self.onReceive.listeners[i]({
                    data: data,
                    connectionType: 'spp',
                });
            }
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

    disconnect: function (callback) {
        const self = this;
        self.connected = false;
        self.emptyOutputBuffer();

        if (self.connectionId) {
            // remove listeners
            for (let i = (self.onReceive.listeners.length - 1); i >= 0; i--) {
                self.onReceive.removeListener(self.onReceive.listeners[i]);
            }

            for (let i = (self.onReceiveError.listeners.length - 1); i >= 0; i--) {
                self.onReceiveError.removeListener(self.onReceiveError.listeners[i]);
            }
            if (self.connectionType === 'ble') {
                // BLE 연결 해제
                self.connectBLECleanup();
                bleDisconnect(self.connectionId, function () {
                    console.log(`${self.connectionType}: closed connection with device: ${self.connectionId}, Sent: ${self.bytesSent} bytes, Received: ${self.bytesReceived} bytes`);
                    self.connectionId = false;
                    if (callback) callback(true);
                }, function (error) {
                    console.error(`${self.connectionType}: error closing connection: ${error}`);
                    self.connectionId = false;
                    if (callback) callback(false);
                });
                return;
            } else if (self.connectionType === 'spp') {
                // SPP 연결 해제
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
            } else if (self.connectionType !== 'virtual') {
                if (self.connectionType === 'tcp') {
                    chrome.sockets.tcp.disconnect(self.connectionId, function () {
                        checkChromeRuntimeError();
                        console.log(`${self.connectionType}: disconnecting socket.`);
                    });
                }

                const disconnectFn = (self.connectionType === 'serial') ? chrome.serial.disconnect : chrome.sockets.tcp.close;
                disconnectFn(self.connectionId, function (result) {
                    checkChromeRuntimeError();

                    result = result || self.connectionType === 'tcp';
                    console.log(`${self.connectionType}: ${result ? 'closed' : 'failed to close'} connection with ID: ${self.connectionId}, Sent: ${self.bytesSent} bytes, Received: ${self.bytesReceived} bytes`);

                    self.connectionId = false;
                    self.bitrate = 0;

                    if (callback) callback(result);
                });
            } else {
                self.connectionId = false;
                CONFIGURATOR.virtualMode = false;
                self.connectionType = false;
                if (callback) {
                    callback(true);
                }
            }
        } else {
            // connection wasn't opened, so we won't try to close anything
            // instead we will rise canceled flag which will prevent connect from continueing further after being canceled
            self.openCanceled = true;
        }
    },
    getDevices: function (callback) {
        // Cordova 환경에서는 BLE 디바이스도 포함
        if (GUI.isCordova() && getNordicBle()) {
            // BLE 디바이스 스캔 결과도 포함 (직전 스캔 결과가 cachedBLEDevices에 있음)
            if (this.cachedBLEDevices && this.cachedBLEDevices.length > 0) {
                const allDevices = [];
                // 시리얼 장치는 사용 불가 (Cordova에서는 chrome.serial 없음)
                // BLE 장치 반환
                this.cachedBLEDevices.forEach(function (device) {
                    allDevices.push({
                        path: 'ble:' + device.address,
                        displayName: (device.displayName || device.name || device.address || 'Unknown') + (device.serviceUuid ? ' [BLE]' : ' [BLE?]'),
                    });
                });
                // SPP 장치도 포함
                if (this.cachedSPPDevices && this.cachedSPPDevices.length > 0) {
                    this.cachedSPPDevices.forEach(function (device) {
                        allDevices.push({
                            path: 'spp:' + device.address,
                            displayName: device.name + ' [SPP]',
                        });
                    });
                }
                callback(allDevices);
                return;
            }
        }

        // Cordova 환경이지만 BLE 결과가 없는 경우에도 SPP 장치는 포함
        if (GUI.isCordova()) {
            if (this.cachedSPPDevices && this.cachedSPPDevices.length > 0) {
                const sppDevices = [];
                this.cachedSPPDevices.forEach(function (device) {
                    sppDevices.push({
                        path: 'spp:' + device.address,
                        displayName: device.name + ' [SPP]',
                    });
                });
                callback(sppDevices);
                return;
            }
        }

        // 기본 시리얼 장치 목록
        if (typeof chrome !== 'undefined' && chrome.serial && chrome.serial.getDevices) {
            chrome.serial.getDevices(function (devices_array) {
                const devices = [];
                devices_array.forEach(function (device) {
                    devices.push({
                                  path: device.path,
                                  displayName: device.displayName,
                                 });
                });

                callback(devices);
            });
        } else {
            callback([]);
        }
    },

    /**
     * BLE 디바이스 스캔 결과 캐시 (getDevices에서 사용)
     */
    cachedBLEDevices: [],

    /**
     * BLE 전용 스캔 함수 (port_handler에서 호출)
     */
    scanBLEDevices: function (callback) {
        const self = this;
        bleIsEnabled(function () {
            bleScan(8,
                null, // onDevice - 실시간 표시 불필요
                function (devices) {
                    self.cachedBLEDevices = devices;
                    const mapped = devices.map(function (d) {
                        return {
                            path: 'ble:' + d.address,
                            displayName: (d.displayName || d.name || d.address || 'Unknown') + (d.serviceUuid ? ' [BLE]' : ' [BLE?]'),
                        };
                    });
                    if (callback) callback(mapped);
                },
                function (error) {
                    console.error('BLE scan failed:', error);
                    if (callback) callback([]);
                }
            );
        }, function (error) {
            console.warn('BLE is not enabled:', error);
            if (callback) callback([]);
        });
    },

    /**
     * SPP 장치 목록 조회 (port_handler에서 호출)
     * 페어링된 Bluetooth Classic 장치를 bluetoothSerial.list()로 조회
     */
    listSPPDevices: function (callback) {
        const self = this;
        sppIsEnabled(function () {
            sppList(
                function (devices) {
                    self.cachedSPPDevices = devices;
                    const mapped = devices.map(function (d) {
                        return {
                            path: 'spp:' + d.address,
                            displayName: d.name + ' [SPP]',
                            address: d.address,
                            name: d.name,
                        };
                    });
                    if (callback) callback(mapped);
                },
                function (error) {
                    console.error('SPP list failed:', error);
                    if (callback) callback([], error || 'list failed');
                }
            );
        }, function (error) {
            console.warn('SPP is not enabled:', error);
            if (callback) callback([], error || 'bluetooth not enabled');
        });
    },
    getInfo: function (callback) {
        const chromeType = (this.connectionType === 'serial') ? chrome.serial : chrome.sockets.tcp;
        chromeType.getInfo(this.connectionId, callback);
    },
    send: function (data, callback) {
        const self = this;
        self.outputBuffer.push({'data': data, 'callback': callback});
        function _send() {
            const _data = self.outputBuffer[0].data;
            const _callback = self.outputBuffer[0].callback;

            if (!self.connected) {
                console.log(`${self.connectionType}: attempting to send when disconnected`);
                if (_callback) {
                    _callback({
                        bytesSent: 0,
                        error: 'undefined',
                    });
                }
                return;
            }

            if (self.connectionType === 'ble') {
                // BLE 전송: MTU 단편화
                const fragments = fragmentMspFrame(_data, self.bleMtu);
                let sentCount = 0;
                const totalBytes = _data.byteLength;

                function sendNextFragment() {
                    if (sentCount >= fragments.length) {
                        // 모든 프래그먼트 전송 완료
                        self.bytesSent += totalBytes;
                        if (_callback) {
                            _callback({ bytesSent: totalBytes });
                        }
                        self.outputBuffer.shift();
                        if (self.outputBuffer.length) {
                            _send();
                        } else {
                            self.transmitting = false;
                        }
                        return;
                    }

                    bleWrite(self.connectionId, self.bleServiceUUID, self.bleTxCharUUID,
                        fragments[sentCount],
                        function () {
                            sentCount++;
                            sendNextFragment();
                        },
                        function (error) {
                            console.error('BLE send error:', error);
                            if (_callback) {
                                _callback({ bytesSent: 0, error: error });
                            }
                            self.outputBuffer.shift();
                            if (self.outputBuffer.length) {
                                _send();
                            } else {
                                self.transmitting = false;
                            }
                        }
                    );
                }

                sendNextFragment();
            } else if (self.connectionType === 'spp') {
                // SPP 전송: MTU 제한 없음, 그대로 전송
                sppWrite(_data,
                    function () {
                        self.bytesSent += _data.byteLength;
                        if (_callback) {
                            _callback({ bytesSent: _data.byteLength });
                        }
                        self.outputBuffer.shift();
                        if (self.outputBuffer.length) {
                            _send();
                        } else {
                            self.transmitting = false;
                        }
                    },
                    function (error) {
                        console.error('SPP send error:', error);
                        if (_callback) {
                            _callback({ bytesSent: 0, error: error });
                        }
                        self.outputBuffer.shift();
                        if (self.outputBuffer.length) {
                            _send();
                        } else {
                            self.transmitting = false;
                        }
                    }
                );
            } else {
                const sendFn = (self.connectionType === 'serial') ? chrome.serial.send : chrome.sockets.tcp.send;
                sendFn(self.connectionId, _data, function (sendInfo) {
                    checkChromeRuntimeError();

                    if (sendInfo === undefined) {
                        console.log('undefined send error');
                        if (_callback) {
                            _callback({
                                bytesSent: 0,
                                error: 'undefined',
                            });
                        }
                        return;
                    }

                    if (self.connectionType === 'tcp' && sendInfo.resultCode < 0) {
                        self.errorHandler(sendInfo.resultCode, 'send');
                        return;
                    }

                    self.bytesSent += sendInfo.bytesSent;

                    if (_callback) {
                        _callback(sendInfo);
                    }

                    self.outputBuffer.shift();

                    if (self.outputBuffer.length) {
                        if (self.outputBuffer.length > 100) {
                            let counter = 0;
                            while (self.outputBuffer.length > 100) {
                                self.outputBuffer.pop();
                                counter++;
                            }
                            console.log(`${self.connectionType}: send buffer overflowing, dropped: ${counter}`);
                        }
                        _send();
                    } else {
                        self.transmitting = false;
                    }
                });
            }
        }

        if (!self.transmitting) {
            self.transmitting = true;
            _send();
        }
    },
    onReceive: {
        listeners: [],

        addListener: function (function_reference) {
            // BLE, SPP: chrome API 없이 리스너만 저장 (데이터는 notification/subscribe에서 직접 전달)
            if (serial.connectionType !== 'ble' && serial.connectionType !== 'spp') {
                const chromeType = (serial.connectionType === 'serial') ? chrome.serial : chrome.sockets.tcp;
                if (chromeType && chromeType.onReceive) {
                    chromeType.onReceive.addListener(function_reference);
                }
            }
            this.listeners.push(function_reference);
        },
        removeListener: function (function_reference) {
            if (serial.connectionType !== 'ble' && serial.connectionType !== 'spp') {
                const chromeType = (serial.connectionType === 'serial') ? chrome.serial : chrome.sockets.tcp;
                for (let i = (this.listeners.length - 1); i >= 0; i--) {
                    if (this.listeners[i] == function_reference) {
                        if (chromeType && chromeType.onReceive) {
                            chromeType.onReceive.removeListener(function_reference);
                        }
                        this.listeners.splice(i, 1);
                        break;
                    }
                }
            } else {
                for (let i = (this.listeners.length - 1); i >= 0; i--) {
                    if (this.listeners[i] == function_reference) {
                        this.listeners.splice(i, 1);
                        break;
                    }
                }
            }
        }
    },
    onReceiveError: {
        listeners: [],

        addListener: function (function_reference) {
            if (serial.connectionType !== 'ble' && serial.connectionType !== 'spp') {
                const chromeType = (serial.connectionType === 'serial') ? chrome.serial : chrome.sockets.tcp;
                if (chromeType && chromeType.onReceiveError) {
                    chromeType.onReceiveError.addListener(function_reference);
                }
            }
            this.listeners.push(function_reference);
        },
        removeListener: function (function_reference) {
            if (serial.connectionType !== 'ble' && serial.connectionType !== 'spp') {
                const chromeType = (serial.connectionType === 'serial') ? chrome.serial : chrome.sockets.tcp;
                for (let i = (this.listeners.length - 1); i >= 0; i--) {
                    if (this.listeners[i] == function_reference) {
                        if (chromeType && chromeType.onReceiveError) {
                            chromeType.onReceiveError.removeListener(function_reference);
                        }
                        this.listeners.splice(i, 1);
                        break;
                    }
                }
            } else {
                for (let i = (this.listeners.length - 1); i >= 0; i--) {
                    if (this.listeners[i] == function_reference) {
                        this.listeners.splice(i, 1);
                        break;
                    }
                }
            }
        }
    },
    emptyOutputBuffer: function () {
        this.outputBuffer = [];
        this.transmitting = false;
    },
    errorHandler: function (result, direction) {
        const self = this;

        self.connected = false;
        FC.CONFIG.armingDisabled = false;

        let message = 'error: UNDEFINED';
        if (self.connectionType === 'tcp') {
            switch (result){
                case -15:
                    // connection is lost, cannot write to it anymore, preventing further disconnect attempts
                    message = 'error: ERR_SOCKET_NOT_CONNECTED';
                    console.log(`${self.connectionType}: ${direction} ${message}: ${result}`);
                    self.connectionId = false;
                    return;
                case -21:
                    message = 'error: NETWORK_CHANGED';
                    break;
                case -100:
                    message = 'error: CONNECTION_CLOSED';
                    break;
                case -102:
                    message = 'error: CONNECTION_REFUSED';
                    break;
                case -105:
                    message = 'error: NAME_NOT_RESOLVED';
                    break;
                case -106:
                    message = 'error: INTERNET_DISCONNECTED';
                    break;
                case -109:
                    message = 'error: ADDRESS_UNREACHABLE';
                    break;
            }
        }
        console.log(`${self.connectionType}: ${direction} ${message}: ${result}`);

        if (GUI.connected_to || GUI.connecting_to) {
            $('a.connect').click();
        } else {
            self.disconnect();
        }
    },
};
