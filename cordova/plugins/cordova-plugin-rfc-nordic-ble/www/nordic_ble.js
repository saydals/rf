/**
 * cordova-plugin-rfc-nordic-ble — JavaScript bridge
 *
 * Drop-in high-level wrapper around the Nordic-BLE-based native plugin.
 *
 * Why this exists:
 *   cordova-plugin-ble-central has no GATT request queue, so requestMtu(247)
 *   silently races with startNotification() on Android's single-operation BLE
 *   stack and the MTU negotiation gets dropped — leaving us at ATT_MTU=23,
 *   fragmenting every MSP response into 20-byte chunks, and taking 1+ minute
 *   to load the configurator's first page.
 *
 *   This plugin replaces it with a native Nordic BleManager whose internal
 *   Request queue serializes MTU negotiation, notification enable, and writes.
 *
 * Public API:
 *   const ble = window.NordicBle;
 *   await ble.requestPermission();
 *   const devices = await ble.getDevices();
 *   await ble.connect(device, { baudRate: 115200 });
 *   ble.addEventListener('receive',    e => handleMspData(e.detail));
 *   ble.addEventListener('disconnect', e => handleDisconnect());
 *   await ble.send(uint8Array.buffer);
 *   await ble.disconnect();
 */

const SERVICE_UUIDS = [
    '0000ffe0-0000-1000-8000-00805f9b34fb', // CC2541
    '00001101-0000-1000-8000-00805f9b34fb', // HC-05
    '0000ffe1-0000-1000-8000-00805f9b34fb', // HM-10
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // HM-11 / Nordic NRF UART
    '00001000-0000-1000-8000-00805f9b34fb', // SpeedyBee V1
    '0000abf0-0000-1000-8000-00805f9b34fb', // SpeedyBee V2
    '000000ff-0000-1000-8000-00805f9b34fb', // SpeedyBee FF00
    '0000db32-0000-1000-8000-00805f9b34fb', // DroneBridge
];

function base64ToUint8Array(b64) {
    if (!b64) return new Uint8Array(0);
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function uint8ArrayToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function execAsync(service, action, args) {
    return new Promise((resolve, reject) => {
        if (typeof cordova === 'undefined' || !cordova.exec) {
            reject(new Error('Cordova is not available'));
            return;
        }
        cordova.exec(
            (result) => resolve(result),
            (err) => reject(typeof err === 'string' ? new Error(err) : err),
            service, action, args || []
        );
    });
}


// Simple EventEmitter (EventTarget not available in all WebViews)
class EventEmitter {
    constructor() { this._listeners = {}; }
    addEventListener(type, handler) {
        if (!this._listeners[type]) this._listeners[type] = [];
        this._listeners[type].push(handler);
    }
    removeEventListener(type, handler) {
        const list = this._listeners[type];
        if (list) {
            const idx = list.indexOf(handler);
            if (idx >= 0) list.splice(idx, 1);
        }
    }
    dispatchEvent(event) {
        const list = this._listeners[event.type];
        if (list) list.forEach(h => h(event));
    }
}

class NordicBle extends EventEmitter {
    constructor() {
        super();
        this.connected = false;
        this.connectionId = null;
        this.devices = [];
        this.bitrate = 115200;
        this.bytesSent = 0;
        this.bytesReceived = 0;
        this.negotiatedMtu = 23;
        this.currentDevice = null;

        if (typeof cordova !== 'undefined' && cordova.exec) {
            cordova.exec(
                (event) => {
                    if (!event || !event.type) return;
                    let detail;
                    switch (event.type) {
                        case 'dataReceived':
                            detail = base64ToUint8Array(event.data);
                            this.bytesReceived += detail.byteLength;
                            this.dispatchEvent(new CustomEvent('receive', { detail }));
                            break;
                        case 'connected':
                            detail = { address: event.address };
                            this.dispatchEvent(new CustomEvent('connected', { detail }));
                            break;
                        case 'disconnected':
                            detail = { address: event.address, reason: event.reason };
                            this.connected = false;
                            this.connectionId = null;
                            this.dispatchEvent(new CustomEvent('disconnect', { detail }));
                            break;
                        default:
                            this.dispatchEvent(new CustomEvent(event.type, { detail: event }));
                    }
                },
                (err) => console.error('[NordicBle] event listener registration failed', err),
                'NordicBle', 'registerEventListener', []
            );
        } else {
            console.warn('[NordicBle] Cordova is not available; plugin will be inert');
        }
    }

    async requestPermission() {
        return execAsync('NordicBle', 'requestPermission', []);
    }

    async getDevices(serviceUuids) {
        const opts = { serviceUuids: serviceUuids && serviceUuids.length ? serviceUuids : SERVICE_UUIDS };
        const result = await execAsync('NordicBle', 'getDevices', [opts]);
        const devices = (result && result.devices) || [];
        this.devices = devices.map((d) => ({
            path: `bluetooth-${d.address}`,
            displayName: d.name || d.address,
            vendorId: 0, productId: 0,
            address: d.address,
            serviceUuid: d.serviceUuid,
            writeCharacteristic: d.writeCharacteristic,
            notifyCharacteristic: d.notifyCharacteristic,
            rssi: d.rssi,
        }));
        return this.devices;
    }

    async requestPermissionDevice() {
        const devices = await this.getDevices();
        return devices[0] || null;
    }

    async connect(deviceOrPath, options) {
        let device = deviceOrPath;
        if (typeof deviceOrPath === 'string') {
            if (!this.devices.length) await this.getDevices();
            device = this.devices.find((d) => d.path === deviceOrPath);
            if (!device) throw new Error(`NordicBle: device not found for path ${deviceOrPath}`);
        }
        if (!device || !device.address) throw new Error('NordicBle: invalid device argument');

        const result = await execAsync('NordicBle', 'connect', [{
            address: device.address,
            serviceUuid: device.serviceUuid,
            writeCharacteristic: device.writeCharacteristic,
            notifyCharacteristic: device.notifyCharacteristic,
        }]);

        const success = !!(result && result.success);
        this.connected = success;
        this.connectionId = success ? device.path : null;
        this.currentDevice = success ? device : null;
        this.negotiatedMtu = (result && result.mtu) || 23;
        this.bytesSent = 0;
        this.bytesReceived = 0;
        this.bitrate = (options && options.baudRate) || 115200;
        this.dispatchEvent(new CustomEvent('connect', { detail: success }));
        return result;
    }

    async disconnect() {
        if (!this.connected) return { success: true };
        try {
            return await execAsync('NordicBle', 'disconnect', []);
        } finally {
            this.connected = false;
            this.connectionId = null;
            this.currentDevice = null;
            this.dispatchEvent(new CustomEvent('disconnect', { detail: true }));
        }
    }

    async send(data, callback) {
        if (!this.connected) {
            const r = { bytesSent: 0 };
            if (callback) callback(r);
            return r;
        }
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const payload = uint8ArrayToBase64(bytes);
        try {
            const result = await execAsync('NordicBle', 'send', [{ data: payload }]);
            const bytesSent = (result && result.bytesSent) || bytes.byteLength;
            this.bytesSent += bytesSent;
            if (callback) callback({ bytesSent });
            return { bytesSent };
        } catch (err) {
            console.error('[NordicBle] send failed', err);
            if (callback) callback({ bytesSent: 0 });
            throw err;
        }
    }

    getConnectedPort() {
        if (!this.connectionId) return null;
        return this.devices.find((d) => d.path === this.connectionId) || this.currentDevice;
    }
}

const nordicBleInstance = new NordicBle();
module.exports = nordicBleInstance;
if (typeof window !== 'undefined') {
    window.NordicBle = nordicBleInstance;
}
