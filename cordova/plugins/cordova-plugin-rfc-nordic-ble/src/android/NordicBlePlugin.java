package org.rotorflight.ble;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Base64;
import android.util.Log;
import android.util.SparseArray;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PermissionHelper;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import no.nordicsemi.android.ble.BleManager;
import no.nordicsemi.android.ble.observer.ConnectionObserver;
import no.nordicsemi.android.ble.WriteRequest;
import no.nordicsemi.android.ble.data.Data;
import no.nordicsemi.android.support.v18.scanner.BluetoothLeScannerCompat;
import no.nordicsemi.android.support.v18.scanner.ScanCallback;
import no.nordicsemi.android.support.v18.scanner.ScanResult;
import no.nordicsemi.android.support.v18.scanner.ScanSettings;

/**
 * Cordova plugin bridging JavaScript to the Nordic Android BLE Library.
 *
 * Direct port of Betaflight Configurator's BetaflightBlePlugin.java (Capacitor).
 */
public class NordicBlePlugin extends CordovaPlugin {

    private static final String TAG = "NordicBle";

    private static final long SCAN_DURATION_MS = 2_000L;
    private static final long FALLBACK_SCAN_DURATION_MS = 3_000L;

    // Known BLE MSP device profiles (from BFC)
    private static final String SERVICE_CC2541 = "0000ffe0-0000-1000-8000-00805f9b34fb";
    private static final String WRITE_CC2541   = "0000ffe1-0000-1000-8000-00805f9b34fb";
    private static final String NOTIFY_CC2541  = "0000ffe2-0000-1000-8000-00805f9b34fb";

    private static final String SERVICE_HC05 = "00001101-0000-1000-8000-00805f9b34fb";
    private static final String WRITE_HC05   = "00001101-0000-1000-8000-00805f9b34fb";
    private static final String NOTIFY_HC05  = "00001101-0000-1000-8000-00805f9b34fb";

    private static final String SERVICE_HM10 = "0000ffe1-0000-1000-8000-00805f9b34fb";
    private static final String WRITE_HM10   = "0000ffe1-0000-1000-8000-00805f9b34fb";
    private static final String NOTIFY_HM10  = "0000ffe1-0000-1000-8000-00805f9b34fb";

    private static final String SERVICE_NORDIC_NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
    private static final String NOTIFY_NORDIC_NUS  = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
    private static final String WRITE_NORDIC_NUS   = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

    private static final String SERVICE_DRONEBRIDGE = "0000db32-0000-1000-8000-00805f9b34fb";
    private static final String WRITE_DRONEBRIDGE   = "0000db33-0000-1000-8000-00805f9b34fb";
    private static final String NOTIFY_DRONEBRIDGE  = "0000db34-0000-1000-8000-00805f9b34fb";

    private static final String SERVICE_SPEEDYBEE_FF00 = "000000ff-0000-1000-8000-00805f9b34fb";
    private static final String WRITE_SPEEDYBEE_FF00   = "0000ff01-0000-1000-8000-00805f9b34fb";
    private static final String NOTIFY_SPEEDYBEE_FF00  = "0000ff02-0000-1000-8000-00805f9b34fb";

    private static final String SERVICE_SPEEDYBEE_V2 = "0000abf0-0000-1000-8000-00805f9b34fb";
    private static final String WRITE_SPEEDYBEE_V2   = "0000abf1-0000-1000-8000-00805f9b34fb";
    private static final String NOTIFY_SPEEDYBEE_V2  = "0000abf2-0000-1000-8000-00805f9b34fb";

    private static final String SERVICE_SPEEDYBEE_V1 = "00001000-0000-1000-8000-00805f9b34fb";
    private static final String WRITE_SPEEDYBEE_V1   = "00001001-0000-1000-8000-00805f9b34fb";
    private static final String NOTIFY_SPEEDYBEE_V1  = "00001002-0000-1000-8000-00805f9b34fb";

    private static final UUID UUID_SPEEDYBEE_FF00 = UUID.fromString(SERVICE_SPEEDYBEE_FF00);
    private static final UUID UUID_SPEEDYBEE_V2 = UUID.fromString(SERVICE_SPEEDYBEE_V2);
    private static final UUID UUID_SPEEDYBEE_V1 = UUID.fromString(SERVICE_SPEEDYBEE_V1);

    private static final Map<String, KnownDevice> KNOWN_DEVICES = new HashMap<>();

    static {
        addDevice("CC2541",         SERVICE_CC2541,         WRITE_CC2541,         NOTIFY_CC2541);
        addDevice("HC-05",          SERVICE_HC05,           WRITE_HC05,           NOTIFY_HC05);
        addDevice("HM-10",          SERVICE_HM10,           WRITE_HM10,           NOTIFY_HM10);
        addDevice("HM-11",          SERVICE_NORDIC_NUS,     NOTIFY_NORDIC_NUS,    WRITE_NORDIC_NUS);
        addDevice("Nordic NRF",     SERVICE_NORDIC_NUS,     NOTIFY_NORDIC_NUS,    WRITE_NORDIC_NUS);
        addDevice("SpeedyBee V1",   SERVICE_SPEEDYBEE_V1,   WRITE_SPEEDYBEE_V1,   NOTIFY_SPEEDYBEE_V1);
        addDevice("SpeedyBee V2",   SERVICE_SPEEDYBEE_V2,   WRITE_SPEEDYBEE_V2,   NOTIFY_SPEEDYBEE_V2);
        addDevice("SpeedyBee FF00", SERVICE_SPEEDYBEE_FF00, WRITE_SPEEDYBEE_FF00, NOTIFY_SPEEDYBEE_FF00);
        addDevice("DroneBridge",    SERVICE_DRONEBRIDGE,    WRITE_DRONEBRIDGE,    NOTIFY_DRONEBRIDGE);
    }

    private static void addDevice(String name, String service, String write, String notify) {
        KnownDevice device = new KnownDevice(name, service, write, notify);
        KNOWN_DEVICES.put(service.toLowerCase(), device);
    }

    // Plugin instance state
    private static final int DESIRED_MTU = 247;

    private static final int REQUEST_BLE_PERMISSIONS = 84021;
    private static final String[] PERMISSIONS_S_PLUS = {
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_CONNECT,
    };
    private static final String[] PERMISSIONS_LEGACY = {
            Manifest.permission.ACCESS_COARSE_LOCATION,
    };

    private BluetoothAdapter adapter;
    private BluetoothLeScannerCompat scanner;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, DiscoveredDevice> discoveredDevices = new HashMap<>();
    private final Set<String> loggedUnknownAddresses = new HashSet<>();
    private boolean scanning = false;
    private boolean fallbackScan = false;
    private List<UUID> requestedServices = new ArrayList<>();

    private BleBridgeManager bleManager;
    private String connectedAddress;
    private CallbackContext eventCallback;
    private String pendingAction;
    private JSONArray pendingArgs;
    private CallbackContext pendingCallback;

    @Override
    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
    }

    @Override
    public void onDestroy() {
        stopScan();
        try {
            if (bleManager != null) {
                bleManager.close();
                bleManager = null;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error closing BLE manager", e);
        }
        super.onDestroy();
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext)
            throws JSONException {
        if (action == null) return false;
        switch (action) {
            case "getDevices":              return handleGetDevices(args, callbackContext);
            case "connect":                 Log.i(TAG, "execute: connect"); return handleConnect(args, callbackContext);
            case "disconnect":              return handleDisconnect(args, callbackContext);
            case "send":                    return handleSend(args, callbackContext);
            case "registerEventListener":   return handleRegisterEventListener(args, callbackContext);
            case "requestPermission":       return handleRequestPermission(args, callbackContext);
            default:                        return false;
        }
    }

    // getDevices
    private boolean handleGetDevices(JSONArray args, CallbackContext callbackContext) {
        if (!hasBlePermissions()) {
            pendingAction = "getDevices";
            pendingArgs = args;
            pendingCallback = callbackContext;
            requestBlePermissions();
            return true;
        }
        return performGetDevices(args, callbackContext);
    }

    private boolean performGetDevices(JSONArray args, CallbackContext callbackContext) {
        Context context = cordova.getContext();
        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            callbackContext.error("Bluetooth adapter is disabled");
            return true;
        }
        scanner = BluetoothLeScannerCompat.getScanner();
        discoveredDevices.clear();
        loggedUnknownAddresses.clear();
        scanning = true;
        requestedServices.clear();
        try {
            JSONObject opts = args.optJSONObject(0);
            if (opts != null) {
                JSONArray arr = opts.optJSONArray("serviceUuids");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        String s = arr.optString(i, null);
                        if (s == null) continue;
                        try { requestedServices.add(UUID.fromString(s.toLowerCase())); }
                        catch (IllegalArgumentException ignored) { }
                    }
                }
            }
        } catch (Exception ignored) { }
        if (requestedServices.isEmpty()) {
            for (String service : KNOWN_DEVICES.keySet()) {
                requestedServices.add(UUID.fromString(service));
            }
        }
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();
        try {
            scanner.startScan(null, settings, scanCallback);
            handler.postDelayed(() -> finishScan(callbackContext, false), SCAN_DURATION_MS);
        } catch (SecurityException se) {
            scanning = false;
            callbackContext.error("BLE scan permission denied: " + se.getMessage());
        }
        return true;
    }

    private void finishScan(CallbackContext callbackContext, boolean fromFallback) {
        stopScan();
        if (discoveredDevices.isEmpty() && !fromFallback) {
            startFallbackScan(callbackContext);
            return;
        }
        JSONArray devices = new JSONArray();
        for (DiscoveredDevice d : discoveredDevices.values()) {
            JSONObject obj = new JSONObject();
            try {
                obj.put("address", d.address);
                obj.put("name", d.name);
                obj.put("rssi", d.rssi);
                obj.put("serviceUuid", d.profile.serviceUuid);
                obj.put("writeCharacteristic", d.profile.writeUuid);
                obj.put("notifyCharacteristic", d.profile.notifyUuid);
                devices.put(obj);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to serialize discovered device", e);
            }
        }
        JSONObject result = new JSONObject();
        try {
            result.put("devices", devices);
            callbackContext.success(result);
        } catch (JSONException e) {
            callbackContext.error("Failed to serialize scan result");
        }
    }

    private void startFallbackScan(CallbackContext callbackContext) {
        if (scanner == null) {
            callbackContext.error("Bluetooth LE scanner unavailable");
            return;
        }
        fallbackScan = true;
        scanning = true;
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();
        try {
            scanner.startScan(null, settings, fallbackScanCallback);
            handler.postDelayed(() -> finishScan(callbackContext, true), FALLBACK_SCAN_DURATION_MS);
        } catch (SecurityException se) {
            scanning = false;
            callbackContext.error("BLE fallback scan permission denied: " + se.getMessage());
        }
    }

    // connect
    private boolean handleConnect(JSONArray args, CallbackContext callbackContext) {
        if (!hasBlePermissions()) {
            pendingAction = "connect";
            pendingArgs = args;
            pendingCallback = callbackContext;
            requestBlePermissions();
            return true;
        }
        return performConnect(args, callbackContext);
    }

    private boolean performConnect(JSONArray args, CallbackContext callbackContext) {
        Log.i(TAG, "performConnect called");
        JSONObject opts = args.optJSONObject(0);
        if (opts == null) { callbackContext.error("connect options are required"); return true; }
        String address       = opts.optString("address", null);
        String serviceUuid   = opts.optString("serviceUuid", null);
        String writeUuid     = opts.optString("writeCharacteristic", null);
        String notifyUuid    = opts.optString("notifyCharacteristic", null);
        if (address == null || serviceUuid == null || writeUuid == null || notifyUuid == null) {
            callbackContext.error("address, serviceUuid, writeCharacteristic, and notifyCharacteristic are required");
            return true;
        }
        BluetoothManager manager = (BluetoothManager) cordova.getContext()
                .getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = manager.getAdapter();
        if (adapter == null) { callbackContext.error("Bluetooth adapter unavailable"); return true; }
        BluetoothDevice device = adapter.getRemoteDevice(address);
        if (device == null) { callbackContext.error("Device not found: " + address); return true; }
        KnownDevice profile = KNOWN_DEVICES.getOrDefault(serviceUuid.toLowerCase(),
                new KnownDevice("Unknown", serviceUuid, writeUuid, notifyUuid));
        if (bleManager != null) {
            try { bleManager.close(); } catch (Exception ignored) { }
            bleManager = null;
        }
        connectedAddress = null;
        bleManager = new BleBridgeManager(cordova.getContext(), this, profile);
        bleManager.setConnectionObserver(new ConnectionObserver() {
            @Override public void onDeviceConnecting(@NonNull BluetoothDevice d) { }
            @Override
            public void onDeviceConnected(@NonNull BluetoothDevice d) {
                connectedAddress = d.getAddress();
                emitEvent("connected", evt -> evt.put("address", connectedAddress));
            }
            @Override
            public void onDeviceFailedToConnect(@NonNull BluetoothDevice d, int reason) {
                connectedAddress = null;
                callbackContext.error("Connection failed: " + reason);
            }
            @Override
            public void onDeviceReady(@NonNull BluetoothDevice d) {
                JSONObject res = new JSONObject();
                try {
                    res.put("success", true);
                    res.put("address", d.getAddress());
                    res.put("mtu", bleManager.getNegotiatedMtu());
                } catch (JSONException e) { Log.e(TAG, "connect result serialization failed", e); }
                callbackContext.success(res);
            }
            @Override public void onDeviceDisconnecting(@NonNull BluetoothDevice d) { }
            @Override
            public void onDeviceDisconnected(@NonNull BluetoothDevice d, int reason) {
                connectedAddress = null;
                emitEvent("disconnected", evt -> {
                    try {
                        evt.put("address", d.getAddress());
                        evt.put("reason", reason);
                    } catch (JSONException e) { Log.e(TAG, "disconnected event serialization failed", e); }
                });
            }
        });
        bleManager.connect(device)
                .useAutoConnect(false)
                .timeout(15_000)
                .fail((dev, status) -> {
                    connectedAddress = null;
                    callbackContext.error("Connection failed: " + status);
                })
                .enqueue();
        return true;
    }

    // disconnect
    private boolean handleDisconnect(JSONArray args, CallbackContext callbackContext) {
        if (bleManager == null || !bleManager.isConnected()) {
            JSONObject result = new JSONObject();
            try { result.put("success", true); } catch (JSONException ignored) { }
            callbackContext.success(result);
            return true;
        }
        bleManager.disconnect()
                .timeout(5_000)
                .done(device -> {
                    connectedAddress = null;
                    JSONObject res = new JSONObject();
                    try { res.put("success", true); } catch (JSONException ignored) { }
                    callbackContext.success(res);
                })
                .fail((device, status) -> {
                    connectedAddress = null;
                    callbackContext.error("Disconnect failed: " + status);
                })
                .enqueue();
        return true;
    }

    // send
    private boolean handleSend(JSONArray args, CallbackContext callbackContext) {
        if (bleManager == null || !bleManager.isConnected()) {
            callbackContext.error("Not connected");
            return true;
        }
        JSONObject opts = args.optJSONObject(0);
        if (opts == null) { callbackContext.error("send options are required"); return true; }
        String b64 = opts.optString("data", null);
        if (b64 == null || b64.isEmpty()) { callbackContext.error("data is required"); return true; }
        byte[] payload = Base64.decode(b64, Base64.NO_WRAP);
        WriteRequest request = bleManager.send(payload);
        if (request == null) { callbackContext.error("Not ready to send data"); return true; }
        request
                .done(device -> {
                    JSONObject res = new JSONObject();
                    try { res.put("bytesSent", payload.length); } catch (JSONException ignored) { }
                    callbackContext.success(res);
                })
                .fail((device, status) -> callbackContext.error("Send failed: " + status))
                .enqueue();
        return true;
    }

    // registerEventListener
    private boolean handleRegisterEventListener(JSONArray args, CallbackContext callbackContext) {
        this.eventCallback = callbackContext;
        PluginResult keepAlive = new PluginResult(PluginResult.Status.NO_RESULT);
        keepAlive.setKeepCallback(true);
        callbackContext.sendPluginResult(keepAlive);
        return true;
    }

    // requestPermission
    private boolean handleRequestPermission(JSONArray args, CallbackContext callbackContext) {
        if (hasBlePermissions()) {
            JSONObject res = new JSONObject();
            try { res.put("granted", true); } catch (JSONException ignored) { }
            callbackContext.success(res);
            return true;
        }
        pendingAction = "requestPermission";
        pendingArgs = args;
        pendingCallback = callbackContext;
        requestBlePermissions();
        return true;
    }

    // Permission handling
    private boolean hasBlePermissions() {
        Context context = cordova.getContext();
        if (context == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN)
                        == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT)
                        == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestBlePermissions() {
        String[] perms = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? PERMISSIONS_S_PLUS : PERMISSIONS_LEGACY;
        PermissionHelper.requestPermissions(this, REQUEST_BLE_PERMISSIONS, perms);
    }

    @Override
    public void onRequestPermissionResult(int requestCode, String[] permissions, int[] grantResults)
            throws JSONException {
        if (requestCode != REQUEST_BLE_PERMISSIONS) return;
        String action = pendingAction;
        JSONArray args = pendingArgs;
        CallbackContext cb = pendingCallback;
        pendingAction = null; pendingArgs = null; pendingCallback = null;
        if (!hasBlePermissions()) {
            if (cb != null) {
                if ("requestPermission".equals(action)) {
                    JSONObject res = new JSONObject();
                    try { res.put("granted", false); } catch (JSONException ignored) { }
                    cb.success(res);
                } else {
                    cb.error("Bluetooth permission denied");
                }
            }
            return;
        }
        if (action == null || cb == null) return;
        switch (action) {
            case "getDevices":        performGetDevices(args, cb); break;
            case "connect":           performConnect(args, cb); break;
            case "requestPermission": {
                JSONObject res = new JSONObject();
                try { res.put("granted", true); } catch (JSONException ignored) { }
                cb.success(res);
                break;
            }
            default: cb.error("No pending action handler for: " + action);
        }
    }

    // Event emission
    private interface EventBuilder { void build(JSONObject evt) throws JSONException; }

    private void emitEvent(String type, EventBuilder builder) {
        if (eventCallback == null) {
            Log.w(TAG, "Event " + type + " emitted but no JS listener is registered");
            return;
        }
        JSONObject evt = new JSONObject();
        try {
            evt.put("type", type);
            builder.build(evt);
        } catch (JSONException e) {
            Log.e(TAG, "Event serialization failed for " + type, e);
            return;
        }
        PluginResult result = new PluginResult(PluginResult.Status.OK, evt);
        result.setKeepCallback(true);
        eventCallback.sendPluginResult(result);
    }

    void handleNotification(Data data) {
        if (data == null || data.getValue() == null) return;
        byte[] bytes = data.getValue();
        String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
        emitEvent("dataReceived", evt -> evt.put("data", b64));
    }

    // Scanner
    private void stopScan() {
        if (scanner != null && scanning) {
            try {
                scanner.stopScan(scanCallback);
                scanner.stopScan(fallbackScanCallback);
            } catch (Exception ignored) { }
        }
        scanning = false; fallbackScan = false;
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override public void onScanResult(int callbackType, ScanResult result) { handleResult(result, false); }
        @Override public void onBatchScanResults(List<ScanResult> results) {
            for (ScanResult r : results) handleResult(r, false);
        }
        @Override public void onScanFailed(int errorCode) { Log.e(TAG, "BLE scan failed: " + errorCode); }
    };

    private final ScanCallback fallbackScanCallback = new ScanCallback() {
        @Override public void onScanResult(int callbackType, ScanResult result) { handleResult(result, true); }
        @Override public void onBatchScanResults(List<ScanResult> results) {
            for (ScanResult r : results) handleResult(r, true);
        }
        @Override public void onScanFailed(int errorCode) { Log.e(TAG, "Fallback BLE scan failed: " + errorCode); }
    };

    private void handleResult(ScanResult result, boolean allowNameMatch) {
        if (result == null || result.getDevice() == null) return;
        BluetoothDevice device = result.getDevice();
        String address = device.getAddress();

        // name: ScanRecord > getDevice().getName() > address
        String name = null;
        if (result.getScanRecord() != null) {
            name = result.getScanRecord().getDeviceName();
        }
        if (name == null || name.isEmpty()) {
            name = device.getName();
        }
        if (name == null || name.isEmpty()) {
            name = address;
        }

        DiscoveredDevice cached = discoveredDevices.get(address);
        if (cached != null) { cached.rssi = result.getRssi(); return; }

        KnownDevice profile = findProfileForResult(result, allowNameMatch);
        if (profile != null) {
            DiscoveredDevice d = new DiscoveredDevice(address, name, result.getRssi(), profile);
            discoveredDevices.put(address, d);
        } else {
            KnownDevice generic = new KnownDevice(name, "", "", "");
            DiscoveredDevice d = new DiscoveredDevice(address, name, result.getRssi(), generic);
            discoveredDevices.put(address, d);
            if (!loggedUnknownAddresses.contains(address)) {
                logUnknownResult(result);
                loggedUnknownAddresses.add(address);
            }
        }
    }

    private KnownDevice findProfileForResult(ScanResult result, boolean allowNameMatch) {
        if (result.getScanRecord() != null && result.getScanRecord().getServiceUuids() != null) {
            for (ParcelUuid uuid : result.getScanRecord().getServiceUuids()) {
                if (uuid == null) continue;
                UUID service = uuid.getUuid();
                if (service == null) continue;
                if (!requestedServices.isEmpty() && requestedServices.contains(service)) {
                    KnownDevice p = KNOWN_DEVICES.get(service.toString().toLowerCase());
                    if (p != null) return p;
                }
                KnownDevice known = KNOWN_DEVICES.get(service.toString().toLowerCase());
                if (known != null) return known;
            }
        }
        if (allowNameMatch) {
            String advertisedName = result.getDevice().getName();
            if (advertisedName != null) {
                String name = advertisedName.toLowerCase();
                for (KnownDevice deviceProfile : KNOWN_DEVICES.values()) {
                    if (deviceProfile.name != null && name.contains(deviceProfile.name.toLowerCase())) {
                        return deviceProfile;
                    }
                }
            }
        }
        return null;
    }

    private void logUnknownResult(ScanResult result) {
        String address = result.getDevice().getAddress();
        String name = result.getDevice().getName();
        List<String> services = new ArrayList<>();
        if (result.getScanRecord() != null && result.getScanRecord().getServiceUuids() != null) {
            for (ParcelUuid uuid : result.getScanRecord().getServiceUuids()) {
                if (uuid != null && uuid.getUuid() != null) services.add(uuid.getUuid().toString());
            }
        }
        Log.d(TAG, "Unknown BLE adv addr=" + address + " name=" + name
                + " rssi=" + result.getRssi() + " services=" + services);
    }

    // Inner classes
    private static class DiscoveredDevice {
        final String address; final String name; int rssi; final KnownDevice profile;
        DiscoveredDevice(String address, String name, int rssi, KnownDevice profile) {
            this.address = address; this.name = name; this.rssi = rssi; this.profile = profile;
        }
    }

    private static class KnownDevice {
        final String name; final String serviceUuid; final String writeUuid; final String notifyUuid;
        KnownDevice(String name, String serviceUuid, String writeUuid, String notifyUuid) {
            this.name = name; this.serviceUuid = serviceUuid; this.writeUuid = writeUuid; this.notifyUuid = notifyUuid;
        }
    }

    // BleBridgeManager — COPIED VERBATIM FROM BFC (with Revision Patch 1: requestConnectionPriority)
    private static class BleBridgeManager extends BleManager {
        private final NordicBlePlugin plugin;
        private UUID serviceUuid;
        private UUID writeUuid;
        private UUID notifyUuid;
        private String profileName;
        private int negotiatedMtu = 23;
        private BluetoothGattCharacteristic writeCharacteristic;
        private BluetoothGattCharacteristic notifyCharacteristic;

        BleBridgeManager(@NonNull Context context, NordicBlePlugin plugin, KnownDevice profile) {
            super(context);
            this.plugin = plugin;
            this.serviceUuid = UUID.fromString(profile.serviceUuid);
            this.writeUuid = UUID.fromString(profile.writeUuid);
            this.notifyUuid = UUID.fromString(profile.notifyUuid);
            this.profileName = profile.name;
        }

        int getNegotiatedMtu() { return negotiatedMtu; }

        @NonNull
        @Override
        protected BleManagerGattCallback getGattCallback() {
            return new ManagerGattCallback();
        }

        private class ManagerGattCallback extends BleManagerGattCallback {
            private BluetoothGattService chooseSpeedyBeeFallback(BluetoothGatt gatt) {
                if (gatt.getService(UUID_SPEEDYBEE_FF00) != null) return gatt.getService(UUID_SPEEDYBEE_FF00);
                if (gatt.getService(UUID_SPEEDYBEE_V2) != null) return gatt.getService(UUID_SPEEDYBEE_V2);
                return gatt.getService(UUID_SPEEDYBEE_V1);
            }

            @Override
            protected boolean isRequiredServiceSupported(@NonNull BluetoothGatt gatt) {
                Log.d(TAG, "Validating GATT services for " + gatt.getDevice().getAddress());
                BluetoothGattService service = gatt.getService(serviceUuid);
                if (service == null) {
                    BluetoothGattService fallback = chooseSpeedyBeeFallback(gatt);
                    if (fallback == null) {
                        Log.w(TAG, "Service " + serviceUuid + " missing on " + gatt.getDevice().getAddress());
                        return false;
                    }
                    KnownDevice alt = KNOWN_DEVICES.get(fallback.getUuid().toString().toLowerCase());
                    if (alt == null) {
                        Log.w(TAG, "Fallback service " + fallback.getUuid()
                                + " not in KNOWN_DEVICES on " + gatt.getDevice().getAddress());
                        return false;
                    }
                    Log.i(TAG, "Switching to fallback profile " + alt.name
                            + " service=" + alt.serviceUuid + " for " + gatt.getDevice().getAddress());
                    serviceUuid = UUID.fromString(alt.serviceUuid);
                    writeUuid = UUID.fromString(alt.writeUuid);
                    notifyUuid = UUID.fromString(alt.notifyUuid);
                    profileName = alt.name;
                    service = fallback;
                }
                writeCharacteristic = service.getCharacteristic(writeUuid);
                notifyCharacteristic = service.getCharacteristic(notifyUuid);
                if (notifyCharacteristic != null
                        && (notifyCharacteristic.getProperties()
                                & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) {
                    setNotificationCallback(notifyCharacteristic).with((device, data) -> plugin.handleNotification(data));
                }
                if (writeCharacteristic != null
                        && (writeCharacteristic.getProperties()
                                & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) {
                    writeCharacteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                }
                return writeCharacteristic != null && notifyCharacteristic != null;
            }

            @Override
            protected void initialize() {
                // Revision Patch 1: Three operations go through Nordic's internal Request queue.
                // Order matters (verified by nRF Connect macro Qqqqq.xml):
                //   1. requestConnectionPriority(HIGH) — drop interval from 37.5ms to 15ms
                //   2. requestMtu(247) — increase payload from 20B to 244B
                //   3. enableNotifications — start receiving MSP responses
                requestConnectionPriority(
                        android.bluetooth.BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                        .done(device -> Log.i(TAG, "Connection priority set to HIGH for " + profileName))
                        .fail((device, status) -> Log.w(TAG, "Connection priority HIGH failed: " + status))
                        .enqueue();

                requestMtu(DESIRED_MTU)
                        .with((device, mtu) -> {
                            negotiatedMtu = mtu;
                            Log.i(TAG, "MTU negotiated to " + mtu + " for " + profileName);
                        })
                        .fail((device, status) -> Log.w(TAG, "MTU request failed with status " + status))
                        .enqueue();

                if (notifyCharacteristic != null) {
                    enableNotifications(notifyCharacteristic).enqueue();
                }
            }

            @Override
            protected void onServicesInvalidated() {
                writeCharacteristic = null;
                notifyCharacteristic = null;
            }
        }

        WriteRequest send(byte[] data) {
            if (writeCharacteristic == null) return null;
            return writeCharacteristic(writeCharacteristic, data);
        }
    }
}
