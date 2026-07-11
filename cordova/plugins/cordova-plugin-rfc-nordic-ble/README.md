# cordova-plugin-rfc-nordic-ble

Nordic BLE Library based Cordova plugin for Rotorflight Configurator.

Provides queued GATT operations (requestMtu + enableNotifications + write) via `no.nordicsemi.android:ble`, eliminating the GATT-queue race condition that makes `cordova-plugin-ble-central` unusably slow for MSP traffic.

## Supported Devices

- CC2541, HC-05, HM-10, HM-11
- Nordic NRF UART Service
- SpeedyBee V1, V2, FF00
- DroneBridge

## Key Features

- **GATT Request Queue** — Nordic `BleManager` serializes all GATT operations
- **MTU 247** — negotiated during connect handshake
- **Connection Priority HIGH** — 15ms connection interval (2.5× faster than default 37.5ms)
- **Auto Profile Detection** — Service UUID matching with SpeedyBee fallback

## Migration from cordova-plugin-ble-central

This plugin replaces `cordova-plugin-ble-central`. The JS API is different — see `www/nordic_ble.js` for the EventTarget-based API.

## References

- [Nordic Android BLE Library](https://github.com/NordicSemiconductor/Android-BLE-Library)
- RFC `blegatt.md` — migration history and root cause analysis
