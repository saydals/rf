# 가상 FC (Test Mode FC) 연결 무반응 및 목록 소실 문제 분석과 해결 가이드

## 1. 개요 및 증상 요약

- **문제 1 (연결 무반응)**: 옵션 탭에서 '가상 FC(Virtual Test Mode)'를 활성화한 뒤, Connect 탭의 시리얼 목록에 나타난 `Test Mode FC`의 [Connect] 버튼을 눌러도 연결이 진행되지 않고 아무 반응이 없거나 실패하는 현상.
- **문제 2 (목록 소실)**: 옵션에서 가상 FC를 활성화하여 Connect 탭에 `Test Mode FC`가 보이다가도, 다른 탭으로 이동했다가 다시 Connect 탭으로 오면 `Test Mode FC`가 목록에서 사라지는 현상.

---

## 2. 근본 원인 상세 분석 (Root Cause)

### 📌 문제 1의 원인 (Connect 클릭 시 무반응)

1. **`#port` DOM 셀렉터에 `virtual` 옵션 부재 (`port_handler.js`)**

   - `PortHandler.updatePortSelect()`에서 `<option value="virtual">`을 생성하는 조건이 `if (import.meta.env.DEV)`로 제한되어 있습니다.
   - Vite 프로덕션 빌드 및 Android(Cordova APK) 환경에서는 `import.meta.env.DEV`가 `false`이므로 `#port` 드롭다운에 `virtual` 엘리먼트가 존재하지 않습니다.
   - `connect.js`의 `connectToDevice()`에서 `$('#port').val('virtual').trigger('change')`를 호출해도 해당 옵션이 없어 선택이 바뀌지 않고, `#port` 값이 이전 물리 포트나 빈 값(`'0'`)으로 남아 있게 됩니다.

2. **`handleConnectClick()`의 가상 연결 분기 진입 실패 (`serial_backend.js`)**

   - `handleConnectClick()`은 `$('#port option:selected')`의 데이터(`isVirtual`)나 `CONFIGURATOR.virtualMode`를 검사합니다.
   - `#port`에서 `virtual` 선택이 실패했거나 `CONFIGURATOR.virtualMode`가 `false`인 경우, `"virtual"`이라는 문자열을 실제 물리 시리얼 포트로 열려고 시도하다가(`serial.connectSerial("virtual")`) 즉시 오류("failed to open serial port")가 발생하고 아무런 화면 전환 없이 종료됩니다.

3. **`MSP.send_batch()` / `MSP.batchCodes()`의 가상 모드 처리 누락 (`msp.svelte.js`)**

   - 가상 연결 성공(`onOpenVirtual()`) 직후 `onConnect()`에서 `await MSP.batchCodes([...])`를 호출하여 기체 초기 상태를 일괄 요청합니다.
   - 단일 요청 함수인 `MSP.send_message()`에는 `if (CONFIGURATOR.virtualMode)` 즉시 반환 처리가 되어 있으나, **`MSP.send_batch()`에는 `CONFIGURATOR.virtualMode` 분기가 누락**되어 있습니다.
   - 결과적으로 가상 시리얼 연결 상태에서 실제 패킷 전송을 시도하고 응답이 오지 않아 20초간 타임아웃 대기 상태에 빠져 로딩 오버레이가 멈추거나 완료되지 않습니다.

---

### 📌 문제 2의 원인 (다른 탭 이동 시 `Test Mode FC` 소실)

1. **`connect.js`의 `normalizeSerial()`이 영구 설정값을 확인하지 않음**

   - `connect.js`의 `normalizeSerial()` 함수에서 가상 FC 항목 추가 조건이 다음과 같이 작성되어 있습니다:

     ```javascript
     if (CONFIGURATOR.virtualMode || $('#port option[value="virtual"]').length) {
         result.push({ path: 'virtual', name: i18n.getMessage('portsSelectVirtual'), meta: 'virtual' });
     }
     ```
   - 사용자 설정 저장소인 `config.get('virtualTestMode')`를 직접 확인하지 않고, 메모리 상의 임시 플래그인 `CONFIGURATOR.virtualMode`에만 의존합니다.

2. **연결 해제 / 리셋 시 `CONFIGURATOR.virtualMode` 강제 초기화 (`serial.js`)**

   - `serial.js`의 `disconnect()` 메서드(Line 610) 등에서 연결이 종료되거나 유휴 상태로 전환될 때 무조건 `CONFIGURATOR.virtualMode = false;`를 실행합니다.
   - 이로 인해 탭을 전환하거나 상태가 리셋되면 `CONFIGURATOR.virtualMode`가 `false`로 변하고, 1초마다 도는 `refreshInterval` 주기 갱신 시 `normalizeSerial()`에서 가상 FC 항목이 제거되어 버립니다.

3. **앱 시작 / 탭 로드 시 설정 동기화 부재**

   - 앱이 처음 시작되거나 탭이 다시 로드될 때 `config.get('virtualTestMode')` 값을 읽어서 `CONFIGURATOR.virtualMode`를 복원하는 전역 초기화 로직이 없습니다.

---

## 3. 해결 방법 (Solutions)

1. **설정값(`config.get('virtualTestMode')`)과 `CONFIGURATOR.virtualMode` 연동 보장**
   - `connect.js`, `port_handler.js`, `options.js`, `serial_backend.js`에서 가상 모드 확인 시 `config.get('virtualTestMode')`를 항상 함께 확인하도록 합니다.
2. **`PortHandler.updatePortSelect` 조건 개선**
   - `import.meta.env.DEV`뿐만 아니라 `config.get('virtualTestMode')` 또는 `CONFIGURATOR.virtualMode`가 활성화되어 있을 때도 `#port`에 `virtual` 옵션을 추가합니다.
3. **`MSP.send_batch`에 가상 모드 즉시 완료 처리 추가**
   - `CONFIGURATOR.virtualMode`가 `true`일 경우 실제 시리얼 통신을 건너뛰고 빈 결과 배열로 즉시 콜백/Promise를 resolve 하도록 분기합니다.
4. **`connectToDevice`의 가상 연결 안전성 확보**
   - `device.path === 'virtual'`일 때 `CONFIGURATOR.virtualMode = true`를 명시적으로 설정하고, `#port` 드롭다운에 `virtual` 옵션이 없으면 임시 추가한 뒤 선택하도록 합니다.
5. **연결 완료 후 Connect 탭 UI 즉시 갱신**
   - `onOpenVirtual()` 완료 시 `TABS.connect?.sync?.()` 또는 Connect 탭 상태를 즉시 갱신하여 UI에 연결됨("Connected") 상태가 바로 반영되도록 합니다.

---

## 4. 파일별 수정 상세 및 Git Diff

### ① `src/js/tabs/connect.js`

- `normalizeSerial()`에서 `config.get('virtualTestMode')` 확인
- `connectToDevice()`에서 `device.path === 'virtual'`일 때 플래그 설정 및 드롭다운 안전 처리

```diff
--- a/src/js/tabs/connect.js
+++ b/src/js/tabs/connect.js
@@ -122,6 +122,12 @@ function connectToDevice(device) {
     collapseHeader();
 
     if (device.path === 'virtual') {
+        CONFIGURATOR.virtualMode = true;
+        const $port = $('#port');
+        if (!$port.find('option[value="virtual"]').length) {
+            $port.append($('<option value="virtual" data-is-virtual="true">Virtual</option>'));
+        }
         $('#port').val('virtual').trigger('change');
     } else {
         // 'manual' + port-override accepts every transport: a raw serial path,
@@ -274,8 +280,8 @@ function normalizeSerial(list) {
         });
     });
 
-    // Virtual FC entry, shown when virtual test mode is enabled in options
-    // or when the port picker exposes it (dev builds)
-    if (CONFIGURATOR.virtualMode || $('#port option[value="virtual"]').length) {
+    // Virtual FC entry, shown when virtual test mode is enabled in options (stored in config)
+    // or when CONFIGURATOR.virtualMode is active
+    if (config.get('virtualTestMode') || CONFIGURATOR.virtualMode || $('#port option[value="virtual"]').length) {
         result.push({
             path: 'virtual',
             name: i18n.getMessage('portsSelectVirtual'),
```

---

### ② `src/js/port_handler.js`

- `updatePortSelect`에서 `config.get('virtualTestMode')` 또는 `CONFIGURATOR.virtualMode`일 때도 `virtual` 옵션 추가

```diff
--- a/src/js/port_handler.js
+++ b/src/js/port_handler.js
@@ -317,7 +317,7 @@ PortHandler.updatePortSelect = function (ports) {
         }));
     }
 
-    if (import.meta.env.DEV) {
+    if (import.meta.env.DEV || config.get('virtualTestMode') || CONFIGURATOR.virtualMode) {
         this.portPickerElement.append($("<option/>", {
            value: 'virtual',
            text: i18n.getMessage('portsSelectVirtual'),
```

---

### ③ `src/js/msp.svelte.js`

- `send_batch()` 시작 부분에 `CONFIGURATOR.virtualMode` 체크 추가

```diff
--- a/src/js/msp.svelte.js
+++ b/src/js/msp.svelte.js
@@ -465,6 +465,10 @@ export const MSP = {
     send_batch: function (requests, allCallback, progressCallback) {
         const self = this;
         if (!requests || !requests.length) {
             if (allCallback) allCallback([]);
             return true;
         }
+        if (CONFIGURATOR.virtualMode) {
+            if (allCallback) allCallback([]);
+            return true;
+        }
```

---

### ④ `src/js/tabs/options.js`

- 가상 모드 토글 시 포트 핸들러 갱신 호출로 `#port` 드롭다운과 동기화

```diff
--- a/src/js/tabs/options.js
+++ b/src/js/tabs/options.js
@@ -6,6 +6,7 @@ import { GUI } from "@/js/gui.js";
 import { i18n } from "@/js/localization.js";
 import { checkForConfiguratorUpdates, setDarkTheme } from "@/js/main.js";
 import { serial } from "@/js/serial.js";
+import { PortHandler } from "@/js/port_handler.js";
 
 import { TABS } from "./tabs.js";
 
@@ -73,6 +74,7 @@ const tab = {
         const checked = $(this).is(":checked");
         config.set({ virtualTestMode: checked });
         CONFIGURATOR.virtualMode = checked;
+        PortHandler.check_serial_devices();
       });
   },
```

---

### ⑤ `src/js/serial.js`

- `disconnect()`에서 사용자가 옵션에서 `virtualTestMode`를 켜둔 상태라면 `CONFIGURATOR.virtualMode`를 일방적으로 `false`로 덮어쓰지 않도록 수정

```diff
--- a/src/js/serial.js
+++ b/src/js/serial.js
@@ -608,7 +608,7 @@ export const serial = {
                 });
             } else {
                 self.connectionId = false;
-                CONFIGURATOR.virtualMode = false;
+                CONFIGURATOR.virtualMode = config.get('virtualTestMode') ?? false;
                 self.connectionType = false;
                 if (callback) {
                     callback(true);
```

---

### ⑥ `src/js/serial_backend.js`

- `handleConnectClick()`에서 `config.get('virtualTestMode')` 체크 및 `onOpenVirtual()` 완료 후 Connect 탭 동기화 호출

```diff
--- a/src/js/serial_backend.js
+++ b/src/js/serial_backend.js
@@ -70,7 +70,7 @@ export async function handleConnectClick() {
                     }
                 }, 15000);
 
-                if (CONFIGURATOR.virtualMode || selectedPort.data().isVirtual) {
+                if (CONFIGURATOR.virtualMode || selectedPort.data()?.isVirtual || portName === 'virtual' || config.get('virtualTestMode')) {
                     CONFIGURATOR.virtualMode = true;
                     if (selectedPort.data()?.isVirtual) {
                         CONFIGURATOR.virtualApiVersion = $('#firmware-version-dropdown :selected').val();
@@ -440,6 +440,7 @@ function onOpenVirtual() {
     update_dataflash_global();
     sensor_status(FC.CONFIG.activeSensors);
     updateTabList(FC.FEATURE_CONFIG.features);
+    TABS.connect?.sync?.();
 }
```

---

## 5. 동작 검증 절차

1. **가상 FC 활성화**:
   - `Options` 탭으로 이동하여 `가상 FC 사용 (Virtual Test Mode)` 체크박스를 ON으로 설정.
2. **목록 표시 및 탭 전환 테스트 (문제 2 검증)**:
   - `Connect` 탭으로 이동 -> Serial 연결 영역에 `Test Mode FC` 항목이 표시되는지 확인.
   - `Options`, `Help` 등 다른 탭으로 이동했다가 다시 `Connect` 탭으로 돌아왔을 때 `Test Mode FC`가 사라지지 않고 계속 유지되는지 확인.
3. **연결 동작 테스트 (문제 1 검증)**:
   - `Test Mode FC` 우측의 [Connect] 버튼을 클릭.
   - 상단 링크 바가 `Connected (VIRTUAL)` 상태로 변경되고, 센서 아이콘 및 연결 모드 탭들이 활성화되며 화면이 정상 전환되는지 확인.
   - [Disconnect] 버튼 클릭 시 정상적으로 연결 해제되고 `Test Mode FC`가 목록에 유지되는지 확인.
