import { CONFIGURATOR } from "@/js/configurator.svelte.js";
import { GUI } from "@/js/gui.js";
import { i18n } from "@/js/localization.js";
import { serial } from "@/js/serial.js";
import { DarkTheme } from "@/js/DarkTheme.js";
import { setDarkTheme } from "@/js/main.js";

import * as config from "@/js/config.js";

import { TABS } from "./tabs.js";

const SENSOR_ICON_CLASSES = ['gyroicon', 'accicon', 'magicon', 'baroicon', 'gpsicon'];

const KINDS = ['serial', 'spp', 'ble'];

// Live state of the three device lists shown in the tab.
const devices = { serial: [], spp: [], ble: [] };
const scanning = { serial: false, spp: false, ble: false };
const stateText = { serial: '', spp: '', ble: '' };

/* ------------------------------------------------------------------ *
 *  Connection history
 * ------------------------------------------------------------------ */

const CONNECTION_HISTORY_KEY = 'deviceConnectionHistory';

function loadConnectionHistory() {
    try {
        return config.get(CONNECTION_HISTORY_KEY) || { lastConnectedPath: null, counts: {} };
    } catch {
        return { lastConnectedPath: null, counts: {} };
    }
}

function saveConnectionHistory(history) {
    try {
        config.set({ [CONNECTION_HISTORY_KEY]: history });
    } catch {
        // localStorage may be unavailable; ignore silently.
    }
}

function getConnectionHistory() {
    return loadConnectionHistory();
}

function recordConnection(path) {
    const history = loadConnectionHistory();
    history.lastConnectedPath = path;
    history.counts[path] = (history.counts[path] || 0) + 1;
    saveConnectionHistory(history);
}

function sortDevices(list) {
    const history = getConnectionHistory();
    return list.slice().sort((a, b) => {
        const aLast = history.lastConnectedPath === a.path ? 1 : 0;
        const bLast = history.lastConnectedPath === b.path ? 1 : 0;
        if (aLast !== bLast) return bLast - aLast;

        const aCount = history.counts[a.path] || 0;
        const bCount = history.counts[b.path] || 0;
        if (aCount !== bCount) return bCount - aCount;

        return 0;
    });
}

let sensorObserver = null;
let logObserver = null;
let refreshInterval = null;
let bleScanTimeout = null;
let lastLinkSignature = null;

const tab = {
    tabName: 'connect',
};

/* ------------------------------------------------------------------ *
 *  Connection helpers
 *
 *  The whole application drives connect/disconnect through the hidden
 *  '.connect_controls a.connect' element (see index.html), so this tab
 *  only feeds it a port and clicks it.
 * ------------------------------------------------------------------ */

function mainConnectButton() {
    return $('div.connect_controls a.connect');
}

function isConnected() {
    return !!CONFIGURATOR.connectionValid;
}

function isConnecting() {
    return !!GUI.connecting_to && !CONFIGURATOR.connectionValid;
}

function isBusy() {
    return GUI.connect_lock || isConnecting();
}

function activePath() {
    return String(GUI.connected_to || GUI.connecting_to || '');
}

function isDeviceConnected(path) {
    return isConnected() && activePath() === String(path);
}

function isDeviceConnecting(path) {
    return isConnecting() && activePath() === String(path);
}

function connectToDevice(device) {
    if (isBusy() || isConnected()) {
        return;
    }

    collapseHeader();

    if (device.path === 'virtual') {
        $('#port').val('virtual').trigger('change');
    } else {
        // 'manual' + port-override accepts every transport: a raw serial path,
        // 'spp:<address>' and 'ble:<address>' (see serial.connect).
        $('#port-override').val(device.path).trigger('change');
        $('#port').val('manual').trigger('change');
    }

    GUI.log(i18n.getMessage('connecting'));
    recordConnection(device.path);
    mainConnectButton().data('clicks', false).trigger('click');
}

function disconnectLink() {
    if (!isConnected() && !GUI.connected_to && !GUI.connecting_to) {
        return;
    }
    // Keep the toggle state of the hidden button in sync with reality: an
    // auto-connect can leave its internal 'clicks' flag behind.
    mainConnectButton().data('clicks', true).trigger('click');
}

// Re-export disconnectLink so other tabs (e.g. CLI) can break the current
// connection without having to reimplement the click-on-hidden-button dance.
export { disconnectLink };

/* ------------------------------------------------------------------ *
 *  Device lists
 * ------------------------------------------------------------------ */

function setSectionState(kind, text, mode) {
    stateText[kind] = text || '';
    $(`#${kind}-state`).text(stateText[kind]);
    $(`#${kind}-dot`)
        .toggleClass('scanning', mode === 'scanning')
        .toggleClass('connected', mode === 'connected')
        .toggleClass('error', mode === 'error');
    const $btn = $(`#${kind}-scan-btn`);
    $btn.toggleClass('scanning', !!scanning[kind]);
    $btn.find('span').text(scanning[kind]
        ? i18n.getMessage('connectScanning')
        : i18n.getMessage('connectScan'));
}

function refreshSectionState(kind) {
    if (scanning[kind]) {
        setSectionState(kind, i18n.getMessage('connectScanning'), 'scanning');
        return;
    }
    const list = devices[kind];
    const connectedHere = list.some((d) => isDeviceConnected(d.path));
    if (connectedHere) {
        setSectionState(kind, i18n.getMessage('connectStateConnected'), 'connected');
    } else {
        setSectionState(kind, i18n.getMessage('connectStateFound', [list.length]), null);
    }
}

function emptyMessage(kind) {
    switch (kind) {
        case 'serial':
            return i18n.getMessage('connectEmptySerial');
        case 'spp':
            return i18n.getMessage('connectEmptySpp');
        default:
            return i18n.getMessage('connectEmptyBle');
    }
}

function renderList(kind) {
    const $list = $(`#${kind}-device-list`);
    if (!$list.length) {
        return;
    }

    $list.empty();

    const connected = isConnected();
    const busy = isBusy();

    const list = sortDevices(devices[kind]);
    if (!list.length) {
        $list.append($('<li class="device-empty"></li>').text(emptyMessage(kind)));
        refreshSectionState(kind);
        return;
    }

    list.forEach((device) => {
        const thisConnected = isDeviceConnected(device.path);
        const thisConnecting = isDeviceConnecting(device.path);
        const $item = $('<li class="device-item"></li>')
            .toggleClass('connected', thisConnected)
            .toggleClass('connecting', thisConnecting);

        const $info = $('<div class="device-info"></div>');
        $info.append($('<div class="device-name"></div>').text(device.name));
        $info.append($('<div class="device-meta"></div>').text(device.meta || device.path));
        $item.append($info);

        const $btn = $('<a href="#" class="device-btn"></a>');
        if (thisConnecting) {
            $btn.addClass('connecting')
                .text(i18n.getMessage('connectingButton') ?? 'Connecting...')
                .on('click', function (e) {
                    e.preventDefault();
                });
        } else if (thisConnected) {
            $btn.addClass('device-btn-disconnect')
                .text(i18n.getMessage('disconnect'))
                .on('click', function (e) {
                    e.preventDefault();
                    disconnectLink();
                });
        } else {
            $btn.text(i18n.getMessage('connect'))
                .toggleClass('disabled', connected || busy)
                .on('click', function (e) {
                    e.preventDefault();
                    connectToDevice(device);
                });
        }
        $item.append($btn);
        $list.append($item);
    });

    refreshSectionState(kind);
}

function renderAllLists() {
    KINDS.forEach(renderList);
}

/* ------------------------------------------------------------------ *
 *  Scanning
 * ------------------------------------------------------------------ */

function normalizeSerial(list) {
    const result = [];
    (list || []).forEach((device) => {
        const path = device.path;
        // BLE/SPP devices are merged into serial.getDevices() on Android, but
        // they get their own section here.
        if (!path || path.startsWith('ble:') || path.startsWith('spp:')) {
            return;
        }
        result.push({
            path: path,
            name: (device.displayName || path).replace(/\s*\[(BLE|SPP)\??]\s*/g, '').trim() || path,
            meta: path,
        });
    });

    // Virtual FC entry, only offered when the port picker exposes it (dev builds)
    if ($('#port option[value="virtual"]').length) {
        result.push({
            path: 'virtual',
            name: i18n.getMessage('portsSelectVirtual'),
            meta: 'virtual',
        });
    }

    return result;
}

function normalizeSpp(list, error) {
    if (error || !Array.isArray(list)) {
        return [];
    }
    return list.map((device) => {
        const address = device.address || (device.path || '').replace(/^spp:/, '');
        return {
            path: `spp:${address}`,
            name: (device.name || device.displayName || address || 'Unknown').replace('[SPP]', '').trim(),
            meta: address,
        };
    }).filter((device) => device.path !== 'spp:');
}

function normalizeBle(list) {
    const cached = serial.cachedBLEDevices || [];
    return (list || [])
        .map((device) => {
            const address = device.address || (device.path || '').replace(/^ble:/, '');
            const raw = cached.find((c) => c.address === address) || {};
            const rssi = (raw.rssi !== undefined && raw.rssi !== null) ? ` · ${raw.rssi} dBm` : '';
            return {
                path: `ble:${address}`,
                name: (raw.name || raw.displayName || device.displayName || address || 'Unknown')
                    .replace(/\s*\[BLE\??]\s*/g, '').trim(),
                meta: `${address}${rssi}`,
            };
        })
        .filter((device) => device.path !== 'ble:' && device.name && device.name.trim() !== '');
}

function collapseHeader() {
    // The user has started the connect flow: collapse the headerbar for the
    // rest of the session. It only returns on a fresh app launch.
    $('body').addClass('fc-header-collapsed');
}

function _scanSerialInternal(callback) {
    scanning.serial = true;
    refreshSectionState('serial');
    serial.getDevices(function (list) {
        scanning.serial = false;
        devices.serial = normalizeSerial(list);
        renderList('serial');
        callback?.();
    });
}

function scanSerial(callback) {
    collapseHeader();
    _scanSerialInternal(callback);
}

function _scanSppInternal() {
    if (scanning.spp || !serial.listSPPDevices) {
        return;
    }
    scanning.spp = true;
    refreshSectionState('spp');
    serial.listSPPDevices(function (list, error) {
        scanning.spp = false;
        const result = normalizeSpp(list, error);
        if (!error) {
            devices.spp = result;
            renderList('spp');
        }
        if (error && !result.length) {
            setSectionState('spp', i18n.getMessage('connectStateError', [error]), 'error');
        }
    });
}

function scanSpp() {
    collapseHeader();
    _scanSppInternal();
}

function _scanBleInternal() {
    if (scanning.ble || !serial.scanBLEDevices) {
        return;
    }
    scanning.ble = true;
    refreshSectionState('ble');
    serial.scanBLEDevices(function (list) {
        scanning.ble = false;
        devices.ble = normalizeBle(list);
        renderList('ble');
    });
    // The native scan has its own timeout; make sure the button never gets stuck.
    clearTimeout(bleScanTimeout);
    bleScanTimeout = setTimeout(function () {
        if (scanning.ble) {
            scanning.ble = false;
            refreshSectionState('ble');
        }
    }, 15000);
}

function scanBle() {
    collapseHeader();
    _scanBleInternal();
}

/* ------------------------------------------------------------------ *
 *  Header mirrors (link bar, sensors, expert mode, log)
 * ------------------------------------------------------------------ */

function updateLinkBar() {
    const connected = isConnected();
    const connecting = isConnecting();
    const path = activePath();
    const type = connected ? String(serial.connectionType || '').toUpperCase() : '';
    const name = connectedDeviceName(path);

    const $bar = $('#connect-linkbar');
    $bar.toggleClass('connected', connected).toggleClass('connecting', connecting);

    let text;
    if (connected) {
        text = i18n.getMessage('connectLinkConnected', [type ? `${name} (${type})` : name]);
    } else if (connecting) {
        text = i18n.getMessage('connectLinkConnecting', [name]);
    } else {
        text = i18n.getMessage('connectLinkDisconnected');
    }
    $('#connect-link-text').text(text);

    const $btn = $('#connect-disconnect-btn');
    $btn.removeClass('connecting device-btn-disconnect');

    if (connected) {
        $btn.removeClass('hidden');
        $btn.addClass('device-btn-disconnect');
        $btn.find('span').text(i18n.getMessage('disconnect'));
    } else if (connecting) {
        $btn.removeClass('hidden');
        $btn.addClass('connecting');
        $btn.find('span').text(i18n.getMessage('connectingButton') ?? 'Connecting...');
    } else {
        $btn.removeClass('hidden');
        $btn.find('span').text(i18n.getMessage('connect'));
    }
}

function connectedDeviceName(path) {
    if (!path) {
        return '';
    }
    for (const kind of KINDS) {
        const device = devices[kind].find((d) => d.path === path);
        if (device) {
            return device.name;
        }
    }
    return path;
}

function updateBaud() {
    const $src = $('#baud');
    const $dst = $('#connect-baud');
    if (!$src.length || !$dst.length) {
        return;
    }
    $dst.val(String($src.val()));
    $dst.prop('disabled', !!$src.prop('disabled'));
}

function updateThemeButton() {
    const isDark = DarkTheme.configEnabled === 0;
    const $icon = $('#connect-theme-icon');
    $icon.toggleClass('fa-sun', isDark).toggleClass('fa-moon', !isDark);
}

function mirrorSensors() {
    const $main = $('div#sensor-status');
    if (!$main.length) {
        return;
    }
    SENSOR_ICON_CLASSES.forEach(function (cls) {
        const active = $(`.${cls}`, $main).hasClass('active');
        $(`#sensor-status-tab .${cls}`).toggleClass('active', active);
    });
}

function mirrorLog() {
    const source = $('#log .wrapper');
    const target = $('#log-tab .wrapper');
    if (!source.length || !target.length) {
        return;
    }
    target.html(source.html());
    const el = target.get(0);
    el.scrollTop = el.scrollHeight;
}

/**
 * Periodic sync: the connection state is owned by serial_backend, so poll it
 * and only re-render when something actually changed.
 */
function syncState() {
    updateBaud();

    const signature = [
        CONFIGURATOR.connectionValid,
        GUI.connecting_to,
        GUI.connected_to,
        GUI.connect_lock,
        serial.connectionType,
    ].join('|');

    if (signature !== lastLinkSignature) {
        lastLinkSignature = signature;
        renderAllLists();
        updateLinkBar();
    }
}

/* ------------------------------------------------------------------ *
 *  Tab lifecycle
 * ------------------------------------------------------------------ */

tab.initialize = function (callback) {
    $('#content').load("/src/tabs/connect.html", function () {
        i18n.localizePage();

        // Baud rate picker mirrors the (now hidden) header one.
        const $baudSrc = $('#baud');
        const $baudDst = $('#connect-baud');
        $baudSrc.find('option').each(function () {
            $baudDst.append($('<option></option>').val(this.value).text(this.textContent));
        });
        $baudDst.on('change', function () {
            $('#baud').val(this.value);
        });

        $('#connect-theme-btn').on('click', function (e) {
            e.preventDefault();
            const current = DarkTheme.configEnabled;
            const next = current === 0 ? 1 : 0;
            config.set({ darkTheme: next });
            setDarkTheme(next);
            updateThemeButton();
        });

        $('#connect-exit-btn').on('click', function (e) {
            e.preventDefault();
            // Close the app (Cordova/Android). window.close() is the desktop
            // fallback; the browser may refuse it, which is acceptable there.
            if (GUI.isCordova() && navigator.app && typeof navigator.app.exitApp === 'function') {
                navigator.app.exitApp();
            } else {
                window.close();
            }
        });

        $('#connect-disconnect-btn').on('click', function (e) {
            e.preventDefault();
            disconnectLink();
        });

        $('#serial-scan-btn').on('click', function (e) {
            e.preventDefault();
            scanSerial();
        });

        $('#spp-scan-btn').on('click', function (e) {
            e.preventDefault();
            scanSpp();
        });

        $('#ble-scan-btn').on('click', function (e) {
            e.preventDefault();
            scanBle();
        });

        $('#connect-log-toggle').on('click', function (e) {
            e.preventDefault();
            const $log = $('#log-tab').toggleClass('expanded');
            const expanded = $log.hasClass('expanded');
            $(this).find('span').text(i18n.getMessage(expanded ? 'logActionHide' : 'logActionShow'));
            $(this).find('em').toggleClass('fa-angle-down', !expanded).toggleClass('fa-angle-up', expanded);
            mirrorLog();
        });

        // Keep already known devices (e.g. after a reconnect) and refresh.
        devices.spp = normalizeSpp(serial.cachedSPPDevices || []);
        devices.ble = normalizeBle((serial.cachedBLEDevices || []).map((d) => ({ address: d.address })));

        renderAllLists();
        updateLinkBar();
        updateBaud();
        mirrorSensors();
        mirrorLog();

        _scanSerialInternal();
        if (GUI.isCordova()) {
            _scanSppInternal();
        }

        const sensorNode = $('div#sensor-status').get(0);
        if (sensorNode) {
            sensorObserver = new MutationObserver(mirrorSensors);
            sensorObserver.observe(sensorNode, { attributes: true, subtree: true, attributeFilter: ['class'] });
        }

        const logNode = $('#log .wrapper').get(0);
        if (logNode) {
            logObserver = new MutationObserver(mirrorLog);
            logObserver.observe(logNode, { childList: true, subtree: true, characterData: true });
        }

        refreshInterval = setInterval(function () {
            syncState();
            if (!scanning.serial && !CONFIGURATOR.connectionValid && !GUI.connecting_to && serial.connectionType !== 'ble') {
                serial.getDevices(function (list) {
                    const next = normalizeSerial(list);
                    if (JSON.stringify(next) !== JSON.stringify(devices.serial)) {
                        devices.serial = next;
                        renderList('serial');
                        updateLinkBar();
                    }
                });
            }
            if (!scanning.spp && GUI.isCordova() && !CONFIGURATOR.connectionValid && !GUI.connecting_to) {
                const next = normalizeSpp(serial.cachedSPPDevices || []);
                if (JSON.stringify(next) !== JSON.stringify(devices.spp)) {
                    devices.spp = next;
                    renderList('spp');
                    updateLinkBar();
                }
            }
        }, 1000);

        GUI.content_ready(callback);
    });
};

tab.cleanup = function (callback) {
    if (sensorObserver) {
        sensorObserver.disconnect();
        sensorObserver = null;
    }
    if (logObserver) {
        logObserver.disconnect();
        logObserver = null;
    }
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    if (bleScanTimeout) {
        clearTimeout(bleScanTimeout);
        bleScanTimeout = null;
    }
    KINDS.forEach((kind) => {
        scanning[kind] = false;
    });
    lastLinkSignature = null;

    callback?.();
};

tab.sync = function () {
    syncState();
    mirrorSensors();
};

TABS[tab.tabName] = tab;

if (import.meta.hot) {
    import.meta.hot.accept((newModule) => {
        if (newModule && window.GUI && window.GUI.active_tab === tab.tabName) {
            TABS[tab.tabName].initialize();
        }
    });

    import.meta.hot.dispose(() => {
        tab.cleanup();
    });
}
