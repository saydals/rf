import * as config from "@/js/config.js";
import { CONFIGURATOR } from "@/js/configurator.svelte.js";
import { serial } from "@/js/serial.js";

let packet_error = $state(0);

export const MSP = {
    symbols: {
        BEGIN: '$'.charCodeAt(0),
        PROTO_V1: 'M'.charCodeAt(0),
        PROTO_V2: 'X'.charCodeAt(0),
        FROM_MWC: '>'.charCodeAt(0),
        TO_MWC: '<'.charCodeAt(0),
        UNSUPPORTED: '!'.charCodeAt(0),
    },
    constants: {
        PROTOCOL_V1:                1,
        PROTOCOL_V2:                2,
        JUMBO_FRAME_MIN_SIZE:       255,
    },
    decoder_states: {
        IDLE:                       0,
        PROTO_IDENTIFIER:           1,
        DIRECTION_V1:               2,
        DIRECTION_V2:               3,
        FLAG_V2:                    4,
        PAYLOAD_LENGTH_V1:          5,
        PAYLOAD_LENGTH_JUMBO_LOW:   6,
        PAYLOAD_LENGTH_JUMBO_HIGH:  7,
        PAYLOAD_LENGTH_V2_LOW:      8,
        PAYLOAD_LENGTH_V2_HIGH:     9,
        CODE_V1:                    10,
        CODE_JUMBO_V1:              11,
        CODE_V2_LOW:                12,
        CODE_V2_HIGH:               13,
        PAYLOAD_V1:                 14,
        PAYLOAD_V2:                 15,
        CHECKSUM_V1:                16,
        CHECKSUM_V2:                17,
    },
    state:                      0,
    message_direction:          1,
    code:                       0,
    dataView:                   0,
    message_length_expected:    0,
    message_length_received:    0,
    message_buffer:             null,
    message_buffer_uint8_view:  null,
    message_checksum:           0,
    messageIsJumboFrame:        false,
    crcError:                   false,

    callbacks:                  [],
    get packet_error() {
        return packet_error;
    },
    set packet_error(v) {
        packet_error = v;
    },
    unsupported:                0,

    last_received_timestamp:   null,
    listeners:                  [],

    JUMBO_FRAME_SIZE_LIMIT:     255,

    SDCARD_STATE_NOT_PRESENT: 0,
    SDCARD_STATE_FATAL:       1,
    SDCARD_STATE_CARD_INIT:   2,
    SDCARD_STATE_FS_INIT:     3,
    SDCARD_STATE_READY:       4,

    read: function (readInfo) {
        if (CONFIGURATOR.virtualMode) {
            return;
        }

        const data = new Uint8Array(readInfo.data);

        for (const chunk of data) {
            switch (this.state) {
            case this.decoder_states.IDLE: // sync char 1
                if (chunk === this.symbols.BEGIN) {
                    this.state = this.decoder_states.PROTO_IDENTIFIER;
                }
                break;
            case this.decoder_states.PROTO_IDENTIFIER: // sync char 2
                switch (chunk) {
                    case this.symbols.PROTO_V1:
                        this.state = this.decoder_states.DIRECTION_V1;
                        break;
                    case this.symbols.PROTO_V2:
                        this.state = this.decoder_states.DIRECTION_V2;
                        break;
                    default:
                        console.log(`Unknown protocol char ${String.fromCharCode(chunk)}`);
                        this.state = this.decoder_states.IDLE;
                }
                break;
            case this.decoder_states.DIRECTION_V1: // direction (should be >)
            case this.decoder_states.DIRECTION_V2:
                this.unsupported = 0;
                switch (chunk) {
                    case this.symbols.FROM_MWC:
                        this.message_direction = 1;
                        break;
                    case this.symbols.TO_MWC:
                        this.message_direction = 0;
                        break;
                    case this.symbols.UNSUPPORTED:
                        this.unsupported = 1;
                        break;
                }
                this.state = this.state === this.decoder_states.DIRECTION_V1 ?
                        this.decoder_states.PAYLOAD_LENGTH_V1 :
                        this.decoder_states.FLAG_V2;
                break;
            case this.decoder_states.FLAG_V2:
                // Ignored for now
                this.state = this.decoder_states.CODE_V2_LOW;
                break;
            case this.decoder_states.PAYLOAD_LENGTH_V1:
                this.message_length_expected = chunk;

                if (this.message_length_expected === this.constants.JUMBO_FRAME_MIN_SIZE) {
                    this.state = this.decoder_states.CODE_JUMBO_V1;
                } else {
                    this._initialize_read_buffer();
                    this.state = this.decoder_states.CODE_V1;
                }

                break;
            case this.decoder_states.PAYLOAD_LENGTH_V2_LOW:
                this.message_length_expected = chunk;
                this.state = this.decoder_states.PAYLOAD_LENGTH_V2_HIGH;
                break;
            case this.decoder_states.PAYLOAD_LENGTH_V2_HIGH:
                this.message_length_expected |= chunk << 8;
                this._initialize_read_buffer();
                this.state = this.message_length_expected > 0 ?
                    this.decoder_states.PAYLOAD_V2 :
                    this.decoder_states.CHECKSUM_V2;
                break;
            case this.decoder_states.CODE_V1:
            case this.decoder_states.CODE_JUMBO_V1:
                this.code = chunk;
                if (this.message_length_expected > 0) {
                    // process payload
                    if (this.state === this.decoder_states.CODE_JUMBO_V1) {
                        this.state = this.decoder_states.PAYLOAD_LENGTH_JUMBO_LOW;
                    } else {
                        this.state = this.decoder_states.PAYLOAD_V1;
                    }
                } else {
                    // no payload
                    this.state = this.decoder_states.CHECKSUM_V1;
                }
                break;
            case this.decoder_states.CODE_V2_LOW:
                this.code = chunk;
                this.state = this.decoder_states.CODE_V2_HIGH;
                break;
            case this.decoder_states.CODE_V2_HIGH:
                this.code |= chunk << 8;
                this.state = this.decoder_states.PAYLOAD_LENGTH_V2_LOW;
                break;
            case this.decoder_states.PAYLOAD_LENGTH_JUMBO_LOW:
                this.message_length_expected = chunk;
                this.state = this.decoder_states.PAYLOAD_LENGTH_JUMBO_HIGH;
                break;
            case this.decoder_states.PAYLOAD_LENGTH_JUMBO_HIGH:
                this.message_length_expected |= chunk << 8;
                this._initialize_read_buffer();
                this.state = this.decoder_states.PAYLOAD_V1;
                break;
            case this.decoder_states.PAYLOAD_V1:
            case this.decoder_states.PAYLOAD_V2:
                this.message_buffer_uint8_view[this.message_length_received] = chunk;
                this.message_length_received++;

                if (this.message_length_received >= this.message_length_expected) {
                    this.state = this.state === this.decoder_states.PAYLOAD_V1 ?
                        this.decoder_states.CHECKSUM_V1 :
                        this.decoder_states.CHECKSUM_V2;
                }
                break;
            case this.decoder_states.CHECKSUM_V1:
                if (this.message_length_expected >= this.constants.JUMBO_FRAME_MIN_SIZE) {
                    this.message_checksum = this.constants.JUMBO_FRAME_MIN_SIZE;
                } else {
                    this.message_checksum = this.message_length_expected;
                }
                this.message_checksum ^= this.code;
                if (this.message_length_expected >= this.constants.JUMBO_FRAME_MIN_SIZE) {
                    this.message_checksum ^= this.message_length_expected & 0xFF;
                    this.message_checksum ^= (this.message_length_expected & 0xFF00) >> 8;
                }
                for (let ii = 0; ii < this.message_length_received; ii++) {
                    this.message_checksum ^= this.message_buffer_uint8_view[ii];
                }
                this._dispatch_message(chunk);
                break;
            case this.decoder_states.CHECKSUM_V2:
                this.message_checksum = 0;
                this.message_checksum = this.crc8_dvb_s2(this.message_checksum, 0); // flag
                this.message_checksum = this.crc8_dvb_s2(this.message_checksum, this.code & 0xFF);
                this.message_checksum = this.crc8_dvb_s2(this.message_checksum, (this.code & 0xFF00) >> 8);
                this.message_checksum = this.crc8_dvb_s2(this.message_checksum, this.message_length_expected & 0xFF);
                this.message_checksum = this.crc8_dvb_s2(this.message_checksum, (this.message_length_expected & 0xFF00) >> 8);
                for (let ii = 0; ii < this.message_length_received; ii++) {
                    this.message_checksum = this.crc8_dvb_s2(this.message_checksum, this.message_buffer_uint8_view[ii]);
                }
                this._dispatch_message(chunk);
                break;
            default:
                console.log(`Unknown state detected: ${this.state}`);
            }
        }
        this.last_received_timestamp = Date.now();
    },
    _initialize_read_buffer: function() {
        this.message_buffer = new ArrayBuffer(this.message_length_expected);
        this.message_buffer_uint8_view = new Uint8Array(this.message_buffer);
    },
    _dispatch_message: function(expectedChecksum) {
        const isValid = (this.message_checksum === expectedChecksum);
        if (isValid) {
            // message received, store dataview
            this.dataView = new DataView(this.message_buffer, 0, this.message_length_expected);
        } else {
            this.packet_error++;
            this.crcError = true;
            this.dataView = new DataView(new ArrayBuffer(0));
        }
        this.notify();
        // Dispatch response to pending callbacks
        const responseCode = this.code;
        for (let i = 0; i < this.callbacks.length; i++) {
            const cb = this.callbacks[i];
            if (cb && cb.code === responseCode) {
                if (!isValid) {
                    // CRC-error response: keep this callback registered so the
                    // retry machinery (send_message interval / send_batch
                    // targeted re-send) re-requests exactly this code. Resolving
                    // it here with an empty view is what made a single corrupted
                    // BLE frame look like a silent "success" while later codes
                    // in a batch were never re-sent - the root of the slow/frozen
                    // tab symptoms over BLE.
                    continue;
                }
                if (typeof cb.callback === 'function') {
                    cb.callback(this.dataView);
                }
                if (cb.timer) {
                    clearInterval(cb.timer);
                    cb.timer = null;
                }
                if (cb.timeout) {
                    clearTimeout(cb.timeout);
                    cb.timeout = null;
                }
                this.callbacks.splice(i, 1);
                i--;
            }
        }
        // Reset variables
        this.message_length_received = 0;
        this.state = 0;
        this.messageIsJumboFrame = false;
        this.crcError = false;
    },
    notify: function() {
        const self = this;
        self.listeners.forEach(function(listener) {
            listener(self);
        });
    },
    listen: function(listener) {
        if (this.listeners.indexOf(listener) == -1) {
            this.listeners.push(listener);
        }
    },
    clearListeners: function() {
        this.listeners = [];
    },
    crc8_dvb_s2: function(crc, ch) {
        crc ^= ch;
        for (let ii = 0; ii < 8; ii++) {
            if (crc & 0x80) {
                crc = ((crc << 1) & 0xFF) ^ 0xD5;
            } else {
                crc = (crc << 1) & 0xFF;
            }
        }
        return crc;
    },
    crc8_dvb_s2_data: function(data, start, end) {
        let crc = 0;
        for (let ii = start; ii < end; ii++) {
            crc = this.crc8_dvb_s2(crc, data[ii]);
        }
        return crc;
    },
    encode_message_v1: function(code, data) {
        let bufferOut;
        // always reserve 6 bytes for protocol overhead !
        if (data) {
            const size = data.length + 6;
            let checksum;

            bufferOut = new ArrayBuffer(size);
            let bufView = new Uint8Array(bufferOut);

            bufView[0] = 36; // $
            bufView[1] = 77; // M
            bufView[2] = 60; // <
            bufView[3] = data.length;
            bufView[4] = code;

            checksum = bufView[3] ^ bufView[4];

            for (let i = 0; i < data.length; i++) {
                bufView[i + 5] = data[i];

                checksum ^= bufView[i + 5];
            }

            bufView[5 + data.length] = checksum;
        } else {
            bufferOut = new ArrayBuffer(6);
            let bufView = new Uint8Array(bufferOut);

            bufView[0] = 36; // $
            bufView[1] = 77; // M
            bufView[2] = 60; // <
            bufView[3] = 0; // data length
            bufView[4] = code; // code
            bufView[5] = bufView[3] ^ bufView[4]; // checksum
        }
        return bufferOut;
    },
    encode_message_v2: function (code, data) {
        const dataLength = data ? data.length : 0;
        // 9 bytes for protocol overhead
        const bufferSize = dataLength + 9;
        const bufferOut = new ArrayBuffer(bufferSize);
        const bufView = new Uint8Array(bufferOut);
        bufView[0] = 36; // $
        bufView[1] = 88; // X
        bufView[2] = 60; // <
        bufView[3] = 0;  // flag
        bufView[4] = code & 0xFF;
        bufView[5] = (code >> 8) & 0xFF;
        bufView[6] = dataLength & 0xFF;
        bufView[7] = (dataLength >> 8) & 0xFF;
        for (let ii = 0; ii < dataLength; ii++) {
            bufView[8 + ii] = data[ii];
        }
        bufView[bufferSize - 1] = this.crc8_dvb_s2_data(bufView, 3, bufferSize - 1);
        return bufferOut;
    },
    send_message: function (code, data, callback_sent, callback_msp, doCallbackOnError) {
        if (CONFIGURATOR.virtualMode) {
            if (callback_msp) {
                callback_msp();
            }
            return;
        }

        if (code === undefined) {
            return;
        }
        let bufferOut;
        if (code <= 254) {
            bufferOut = this.encode_message_v1(code, data);
        } else {
            bufferOut = this.encode_message_v2(code, data);
        }

        const obj = {'code': code, 'requestBuffer': bufferOut, 'callback': callback_msp ? callback_msp : false, 'timer': false, 'callbackOnError': doCallbackOnError};

        let requestExists = false;
        for (const value of MSP.callbacks) {
            if (value.code === code) {
                // request already exist, we will just attach
                requestExists = true;
                break;
            }
        }

        if (!requestExists) {
            if (!serial.connected || CONFIGURATOR.cliEngineActive) {
                console.log('Cancelling MSP request');

                if (doCallbackOnError) {
                  obj.callback?.();
                }

                return;
            }

             // BLE: setInterval 기반 재전송 (transmitting 상태 확인 포함).
             // CRC로 의심되는 응답이 오면 `_dispatch_message` 가 callback 을
             // 해소하지 않으므로, 이 인터벌이 정확히 그 명령만 재전송한다.
             const retryInterval = (config.get('bleRetryInterval') ?? 2) * 1000;
             obj.timer = setInterval(function () {
                 if (!serial.connected || CONFIGURATOR.cliEngineActive) {
                     console.log('BLE retry aborted');
                     if (doCallbackOnError) obj.callback?.();
                     return;
                 }
                 if (MSP.callbacks.indexOf(obj) === -1) {
                     clearInterval(obj.timer);
                     obj.timer = null;
                     return;
                 }
                 if (serial.transmitting) {
                     return;
                 }
                 serial.send(bufferOut, false);
             }, retryInterval);
        }

        // 무한로딩 방지: 응답이 전혀 돌아오지 않으면(패킷 유실, 일부 FC 미지원
        // 명령 등) 타임아웃 후 콜백을 해제한다. `!requestExists` 여부와 무관하게
        // 등록되는 모든 콜백에 적용한다 — 부착(attach)된 콜백만 타임아웃이 없으면
        // 해당 코드가 영영 응답하지 않을 때 탭 로드가 영구히 멈출 수 있다.
        // 기본값 20초 — BLE 응답이 느린 디바이스에서도 정상 응답을 받을 수 있도록
        // 충분히 긴 값. 사용자가 옵션 탭에서 조절 가능.
        const requestTimeoutMs = (config.get('bleRequestTimeoutMs') ?? 20) * 1000;
        obj.timeout = setTimeout(function () {
            const idx = MSP.callbacks.indexOf(obj);
            if (idx === -1) return;
            MSP.callbacks.splice(idx, 1);
            if (obj.timer) { clearInterval(obj.timer); obj.timer = null; }
            console.warn('MSP request timeout (code=' + code + '), giving up');
            if (doCallbackOnError) obj.callback?.();
        }, requestTimeoutMs);

        MSP.callbacks.push(obj);

        // always send messages with data payload (even when there is a message already in the queue)
        if (data || !requestExists) {
            serial.send(bufferOut, function (sendInfo) {
                if (sendInfo.bytesSent == bufferOut.byteLength) {
                    if (callback_sent) {
                        callback_sent();
                    }
                }
            });
        }

        return true;
    },

    /**
     * Batch-send multiple MSP requests using a single BLE write.
     * Non-BLE falls back to sequential promise() calls.
     * @param {Array<{code:number, data:boolean|Uint8Array}>} requests
     * @param {Function} [allCallback] - called with results array when all complete
     * @param {Function} [progressCallback] - called as (loaded, total) after each
     *   individual response in the batch arrives
     */
    send_batch: function (requests, allCallback, progressCallback) {
        const self = this;
        if (!requests || !requests.length) {
            if (allCallback) allCallback([]);
            return true;
        }

        // Local guard for this batch invocation. Previously this was an
        // implicit global, which meant once any batch set it to `true` every
        // subsequent batch would short-circuit and never invoke
        // `allCallback`. That left callers (and the post-connect await in
        // serial_backend.js) hanging forever, so the "Wait for loading..."
        // overlay never closed.
        let allCallbackCalled = false;

        const total = requests.length;
        let loaded = 0;
        const fireProgress = function() {
            if (typeof progressCallback === 'function') {
                try {
                    progressCallback(loaded, total);
                } catch (e) {
                    console.error('MSP batch progress callback error:', e);
                }
            }
        };
        // Fire once at start so callers can render the "0/total" state.
        fireProgress();

        if (!serial.connected || serial.connectionType !== 'ble') {
            (async () => {
                const results = [];
                for (const req of requests) {
                    try {
                        const r = await self.promise(req.code, req.data || false);
                        results.push(r);
                        loaded++;
                        fireProgress();
                    } catch {
                        results.push(null);
                        loaded++;
                        fireProgress();
                    }
                }
                if (allCallbackCalled) return;
                allCallbackCalled = true;
                if (allCallback) allCallback(results);
            })();
            return true;
        }

        const promises = [];
        // Per-code pending state. Plain object (not SvelteMap): this is purely
        // internal bookkeeping for the batch, not reactive UI state.
        // code -> { code, bufferOut, obj, retries, promise }
        const batchPending = {};

        for (const req of requests) {
            const code = req.code;
            const data = req.data || false;
            const bufferOut = (code <= 254) ? self.encode_message_v1(code, data) : self.encode_message_v2(code, data);

            // Duplicate request inside the batch: share the promise of the
            // first occurrence so every caller resolves with the same value.
            if (batchPending[code]) {
                promises.push(batchPending[code].promise);
                continue;
            }

            const obj = {
                code: code,
                requestBuffer: bufferOut,
                callback: false,
                timer: false,
                callbackOnError: false,
                // Retry budget (per code). A batch must finish, so unlike
                // `send_message`'s unbounded interval we bound it.
                retries: 0,
                maxRetries: (config.get('bleBatchMaxRetries') ?? 3),
            };

            const entry = { code, bufferOut, obj, retries: 0, promise: null };
            batchPending[code] = entry;
            MSP.callbacks.push(obj);

            entry.promise = new Promise((resolve) => {
                obj.callback = function(_data) {
                    // Mark resolved (null) instead of deleting the key — the
                    // code list stays stable while entries are filtered out.
                    batchPending[code] = null;
                    loaded++;
                    fireProgress();
                    resolve(_data);
                };
            });
            promises.push(entry.promise);
        }

        // Give up on a code (retry budget exhausted or global batch timeout):
        // resolve it with an empty DataView - same semantic as send_message's
        // "give up" path - so its caller can proceed instead of hanging.
        function giveUpCode(entry) {
            batchPending[entry.code] = null;
            const idx = MSP.callbacks.indexOf(entry.obj);
            if (idx !== -1) { MSP.callbacks.splice(idx, 1); }
            if (entry.obj.timer) { clearInterval(entry.obj.timer); entry.obj.timer = null; }
            if (entry.obj.timeout) { clearTimeout(entry.obj.timeout); entry.obj.timeout = null; }
            // entry.obj.callback() performs loaded++/fireProgress()/resolve().
            entry.obj.callback(new DataView(new ArrayBuffer(0)));
        }

        function combineFrames(entries) {
            let total = 0;
            for (const e of entries) total += e.bufferOut.byteLength;
            if (total === 0) return null;
            const combined = new Uint8Array(total);
            let offset = 0;
            for (const e of entries) {
                combined.set(new Uint8Array(e.bufferOut), offset);
                offset += e.bufferOut.byteLength;
            }
            return combined;
        }

        // BLE 재전송 간격 옵션 (기본값 2초)
        const batchRetryInterval = (config.get('bleRetryInterval') ?? 2) * 1000;

        // Targeted retry loop: re-sends ONLY the codes that have not yet
        // produced a checksum-valid response. Codes that already answered are
        // never requested again.
        function batchSend() {
            if (!serial.connected || CONFIGURATOR.cliEngineActive) return;

            // Drop codes that exceeded their retry budget.
            for (const entry of Object.values(batchPending).filter(Boolean)) {
                if (entry.retries >= entry.obj.maxRetries) giveUpCode(entry);
            }

            const pendingEntries = Object.values(batchPending).filter(Boolean);
            if (!pendingEntries.length) return;

            // Rebuild the payload from ONLY the still-pending codes.
            const payload = combineFrames(pendingEntries);
            if (!payload) return;

            for (const entry of pendingEntries) entry.retries++;

            console.log('MSP batch retry: re-sending ' + payload.byteLength + 'B for codes [' +
                pendingEntries.map((e) => e.code).join(', ') + ']');
            serial.send(payload.buffer, function (sendInfo) {
                if (sendInfo.bytesSent !== payload.byteLength) {
                    console.error('BLE batch send partial: ' + sendInfo.bytesSent + '/' + payload.byteLength);
                }
            });
            setTimeout(batchSend, batchRetryInterval);
        }

        // Initial combined send: one BLE write for every code this batch owns.
        // Codes already in flight from another send_message keep their own
        // retry and are picked up by batchSend on the next tick instead.
        const firstEntries = Object.values(batchPending).filter((entry) => {
            if (!entry) return false;
            for (const value of MSP.callbacks) {
                if (value.code === entry.code && value !== entry.obj) return false;
            }
            return true;
        });
        const initialPayload = combineFrames(firstEntries);
        if (initialPayload) {
            serial.send(initialPayload.buffer, function (sendInfo) {
                if (sendInfo.bytesSent !== initialPayload.byteLength) {
                    console.error('BLE batch initial send partial: ' + sendInfo.bytesSent + '/' + initialPayload.byteLength);
                }
            });
        }
        // Start the targeted retry loop: fires every batchRetryInterval until
        // every code has answered or given up.
        setTimeout(batchSend, batchRetryInterval);

        // Guarantee the batch completes even when a code never answers on a
        // lossy link: after bleRequestTimeoutMs, every code still pending is
        // resolved empty and the batch finishes (no permanent freeze).
        const batchTimeoutMs = (config.get('bleRequestTimeoutMs') ?? 20) * 1000;
        const settleTimer = setTimeout(function() {
            for (const entry of Object.values(batchPending).filter(Boolean)) giveUpCode(entry);
        }, batchTimeoutMs);

        Promise.all(promises).then(function(results) {
            clearTimeout(settleTimer);
            if (allCallbackCalled) return;
            allCallbackCalled = true;
            if (allCallback) allCallback(results);
        }).catch(function(err) {
            console.error('MSP batch error:', err);
            if (allCallbackCalled) return;
            allCallbackCalled = true;
            if (allCallback) allCallback([]);
        });

        return true;
    },

    /**
     * Promise wrapper for send_batch.
     * @param {Array<{code:number, data:boolean|Uint8Array}>} requestSpecs
     * @param {Object} [options]
     * @param {Function} [options.onProgress] - called as (loaded, total) after
     *   each individual response in the batch arrives. Useful for showing a
     *   progress indicator while waiting for a slow link (e.g. BLE).
     * @returns {Promise<Array>}
     */
    batchCodes: function (requestSpecs, options) {
        const self = this;
        return new Promise(function(resolve) {
            self.send_batch(requestSpecs, resolve, options && options.onProgress);
        });
    },

    /**
     * resolves: {command: code, data: data, length: message_length}
     */
    promise: function(code, data) {
      const self = this;
      return new Promise(function(resolve) {
        // doCallbackOnError=true: 응답이 전혀 없어 타임아웃이 나도 resolve 하여
        // `await MSP.promise()` 가 영원히 멈추지 않도록 한다. (CRC 오류는
        // `_dispatch_message` 가 재전송으로 처리하므로 여기 도달하는 경우는
        // 사실상 '무응답'뿐이고, resolve(undefined) 는 기존 CRC-오류 성공
        // 처리와 동일하게 '무시 가능' 의미를 갖는다.)
        self.send_message(code, data, false, function(_data) {
          resolve(_data);
        }, true);
      });
    },
    callbacks_cleanup: function () {
        for (let index = 0; index < this.callbacks.length; index++) {
            clearInterval(this.callbacks[index].timer);
            clearTimeout(this.callbacks[index].timeout);
        }

        this.callbacks = [];
    },
    disconnect_cleanup: function () {
        this.state = 0; // reset packet state for "clean" initial entry (this is only required if user hot-disconnects)
        this.packet_error = 0; // reset CRC packet error counter for next session

        this.callbacks_cleanup();
    }
};
