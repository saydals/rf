# Bottom Toolbar (Save / Revert) — Tab Page Reference

이 문서는 세로뷰(portrait view)를 포함한 모든 탭 페이지에서, 탭 내용이 변경되었을 때 하단에 표시되는 **Save / Revert 툴바**의 동작을 탭별로 상세히 정리한 것이다.

문제 : 세로뷰에서는 아이콘바가 하단에 자리하는데 아래 툴바를 덮어서 툴바가 보이지 않아 사용 불가.

해결책 : 툴바 출현을 각 탭페이지 하단 기준이 아닌 아이콘바 기준 상단에 붙여서 출현하게 한다.

참고사항 : 세로뷰 페이지는 하단에 여백이 많은 편이다.

주의사항 : 아이콘은 옵션에서 1 1.5 2 2.5 3 배의 크기로 조절할수 있다. 아이콘바 세로 높이가 바뀌어도

아이콘바 위에 툴바가 나타나야한다.

1차 작업  : 

이 문서를 참고하여 세로뷰일때만 각 툴바를 아이콘바 위에 출현하게 하는 코드 수정을 한다. 

이 문서의 후반부에 코드 수정 하는 방법을 따르면 된다.

의문 사항이나 의외의 사항 발견시 사용자에게 알리고 사용자에게 해결할수 있는 다양한 방법을 제시하여

고르게 한다.

2차 작업 : 지금 해야할 일로 제일 하단에 해야할 일 로 기록했다.

---

## 1. 두 가지 툴바 시스템

이 앱에는 **공존하는 두 가지 툴바 구현체**가 있다:

| 시스템                     | 사용 탭                                                                                                                         | 메커니즘                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Legacy jQuery**          | `auxiliary`, `beepers`, `blackbox`, `cli`, `configuration`, `gps`, `led_strip`, `mixer`, `power`, `profiles`, `rates`, `servos` | 각 탭 HTML 내 `<div class="content_toolbar">` 가 있으며, 탭 루트 `<div>` 에 `toolbar_hidden` CSS 클래스를 토글하여 표시/숨김 |
| **Svelte `Page` 컴포넌트** | `failsafe`, `governor`, `gyro`, `receiver`, `motors`                                                                            | `<Page toolbar={showToolbar && toolbar}>` 로 반응형 스니펫 전달; `showToolbar` 가 true 일 때만 툴바 렌더링                   |

`firmware_flasher` 도 `<div class="content_toolbar">` 를 가지고 있으나, 이는 **영구 표시**이며 dirty-state 기반 Save/Revert 툴바가 아니다.

---

## 2. 툴바 표시/숨김 조건 (공통)

### CSS — `src/css/main.css`

```css
.toolbar_hidden .content_wrapper {
    height: calc(100% - 40px) !important;
}
.toolbar_hidden .content_toolbar {
    display: none !important;
}
```

탭이 초기화될 때 `toolbar_hidden` 클래스가 추가되어 툴바가 숨겨진 상태로 시작한다. 사용자가 폼 값을 변경하면 `setDirty()` (또는 `setChanged()`) 가 호출되어 해당 클래스가 제거되고 툴바가 나타난다.

### 탭 초기화 패턴 (예: rates.js)

```javascript
function process_html() {
    data_to_form();
    $('.tab-rates').addClass('toolbar_hidden'); // 초기: 툴바 숨김
    self.isDirty = false;
    self.isChanged = false;

    function setChanged() {
        if (!self.isChanged) {
            self.isDirty = true;
            self.isChanged = true;
            $('.tab-rates').removeClass('toolbar_hidden'); // 툴바 표시
            $('#copyProfile').addClass('disabled');
        }
    }

    function setDirty() {
        if (!self.isDirty) {
            self.isDirty = true;
            $('.tab-rates').removeClass('toolbar_hidden'); // 툴바 표시
        }
    }
}
```

---

## 3. 탭별 툴바 상세

### 3.1 Rates (`src/js/tabs/rates.js`)

**툴바 HTML** (`src/tabs/rates.html` 328–335줄):

```html
<div class="content_toolbar">
    <div class="btn revert_btn"><a class="revert" href="#" i18n="buttonRevert"></a></div>
    <div class="btn save_btn"><a class="save" href="#" i18n="buttonSave"></a></div>
</div>
```

**버튼:**

| 버튼   | i18n 키        | 동작                                            |
| ------ | -------------- | ----------------------------------------------- |
| Save   | `buttonSave`   | `form_to_data()` → `save_data()` (EEPROM_WRITE) |
| Revert | `buttonRevert` | `revert_data()` (프로필 데이터 원상복구)        |

**Dirty 추적:**

- `isDirty` + `isChanged` 2단계 플래그 사용
- `setChanged()` 는 `isChanged=true` + 프로필 복사 버튼 비활성화까지 처리
- `setDirty()` 는 `isDirty=true` + 툴바 표시만 처리

**변경 감지 트리거:** `.subtab-rates` (PID, Rate Profile 서브탭) 의 change 이벤트

---

### 3.2 Profiles (`src/js/tabs/profiles.js`)

**툴바 HTML** — Rates 와 동일 구조 (Save + Revert)

**버튼:**

| 버튼   | 동작                                            |
| ------ | ----------------------------------------------- |
| Save   | `form_to_data()` → `save_data()` (EEPROM_WRITE) |
| Revert | `revert_data()` (프로필 데이터 원상복구)        |

**Dirty 추적:** Rates 와 동일한 2단계 (`isDirty` + `isChanged`)

**변경 감지 트리거:** `.tab-container .tabName` 클릭 (다른 프로필 선택시)

---

### 3.3 Configuration (`src/js/tabs/configuration.js`)

**툴바 HTML** — Save + Revert

**버튼:**

| 버튼   | 동작                                                              |
| ------ | ----------------------------------------------------------------- |
| Save   | `updateConfig()` + `save_data()`                                  |
| Revert | **No-op** (FC 객체 내 데이터이므로 재전송만 필요, 별도 복구 없음) |

**변경 감지 트리거:** `.content_wrapper` 내 change 이벤트

---

### 3.4 Mixer (`src/js/tabs/mixer.js`)

**툴바 HTML** — 상황에 따라 Save / Save-and-Reboot이 전환됨

**버튼:**

| 버튼            | 동작                                                |
| --------------- | --------------------------------------------------- |
| Save            | `save_data()` (needSave 일 때만)                    |
| Save and Reboot | `save_data()` + `MSP_SET_REBOOT` (needReboot 일 때) |
| Revert          | `revert_data()` (MIXER_CONFIG 복구)                 |

**확장된 Dirty 플래그:**

```javascript
isDirty: false,
needSave: false,
needReboot: false,
MIXER_CONFIG_dirty: false,
MIXER_INPUT1_dirty: false,
MIXER_INPUT2_dirty: false,
MIXER_INPUT3_dirty: false,
MIXER_INPUT4_dirty: false,
MIXER_RULES_dirty: false,
```

**버튼 전환 로직:**
```javascript
$('.save_btn').toggle(!self.needReboot); // needReboot 시 Save 숨김

```
**변경 감지 트리거:** 믹서 입력값 변경

---

### 3.5 Power (`src/js/tabs/power.js`)

**툴바 HTML** — Save + Save-and-Reboot (동시 존재, 상황에 따라 표시 전환)

**버튼:**
| 버튼 | 동작 |
|------|------|
| Save | `save_data()` |
| Save and Reboot | `save_data()` + `MSP_SET_REBOOT` |
| Revert | `revertData()` + `send_data()` |

**확장된 Dirty 플래그:**
```javascript
isDirty: false,
needReboot: false,
```

**버튼 전환:** `saveButton.hide()` / `saveButton.show()` 로 needReboot 상태에 따라 전환

---

### 3.6 Servos (`src/js/tabs/servos.js`)

**툴바 HTML** — Save + Save-and-Reboot (동시 존재, 상황에 따라 전환)

**버튼:**

| 버튼            | 동작                                                       |
| --------------- | ---------------------------------------------------------- |
| Save            | `sendServoConfigurations()`                                |
| Save and Reboot | `sendServoConfigurations()` + `MSP_SET_REBOOT`             |
| Revert          | `FC.SERVO_CONFIG = prevConfig` (캐시된 이전 설정으로 복원) |

**확장된 Dirty 플래그:**

```javascript
isDirty: false,
needReboot: false,
```

---

### 3.7 Blackbox (`src/js/tabs/blackbox.js`)

**툴바 HTML** (`src/tabs/blackbox.html` 207–214줄):

```html
<div class="content_toolbar">
    <div class="btn revert_btn"><a class="revert" href="#" i18n="buttonRevert"></a></div>
    <div class="btn reboot_btn"><a class="reboot" href="#" i18n="buttonSaveReboot"></a></div>
</div>
```

**버튼:**

| 버튼            | i18n 키            | 동작                                                |
| --------------- | ------------------ | --------------------------------------------------- |
| Revert          | `buttonRevert`     | No-op                                               |
| Save and Reboot | `buttonSaveReboot` | `form_to_data()` → `save_data()` → `MSP_SET_REBOOT` |

**특징:** 일반 Save 버튼이 없다. 모든 변경사항은 항상 리부트와 함께 저장된다.

---

### 3.8 GPS (`src/js/tabs/gps.js`)

**툴바 HTML** — Save + Revert

**버튼:**

| 버튼   | 동작                                                |
| ------ | --------------------------------------------------- |
| Save   | `save_data()` + `MSP_SET_REBOOT` (항상 리부트 포함) |
| Revert | No-op                                               |

**특징:** 일반 Save가 없고, 저장 시 항상 리부트가 발생한다.

---

### 3.9 LED Strip (`src/js/tabs/led_strip.js`)

**툴바 HTML** — Save + Revert

**버튼:**

| 버튼   | 동작                         |
| ------ | ---------------------------- |
| Save   | `save_data()` + EEPROM_WRITE |
| Revert | No-op                        |

**변경 감지 트리거:** number inputs, `.funcClear`, `.funcClearAll` 등

---

### 3.10 Auxiliary (`src/js/tabs/auxiliary.js`)

**툴바 HTML** — Save + Revert

**버튼:**

| 버튼   | 동작                         |
| ------ | ---------------------------- |
| Save   | `save_data()` + EEPROM_WRITE |
| Revert | No-op (`callback?.()`)       |

**변경 감지 트리거:** `.modes` change 이벤트

---

### 3.11 Beepers (`src/js/tabs/beepers.js`)

**툴바 HTML** — Save + Revert

**버튼:**

| 버튼   | 동작                         |
| ------ | ---------------------------- |
| Save   | `save_data()` + EEPROM_WRITE |
| Revert | No-op                        |

**변경 감지 트리거:** `.content_wrapper` change 이벤트

---

### 3.12 CLI (`src/js/tabs/cli.js`)

**툴바 HTML** (`src/tabs/cli.html` 24–37줄):

```html
<div class="content_toolbar xs-compressed">
    <div class="btn save_btn"><a class="save" href="#" i18n="cliSaveToFileBtn"></a></div>
    <div class="btn save_btn"><a class="load" href="#" i18n="cliLoadFromFileBtn"></a></div>
    <div class="btn save_btn"><a class="clear" href="#" i18n="cliClearOutputHistoryBtn"></a></div>
    <div class="btn save_btn"><a class="copy" href="#" i18n="cliCopyToClipboardBtn"></a></div>
</div>
<div class="toolbar_expand_btn" nbrow="2"><em class="fas fa-ellipsis-h"></em></div>
```

**특징:**

- dirty-state 와 무관하게 **항상 표시** (`xs-compressed` 클래스)
- Save / Revert 툴바가 아니다. CLI 파일/클립보드 작업 버튼이다
- `toolbar_expand_btn` 으로 접었다 펼 수 있음 (`nbrow="2"`)

---

## 4. Svelte 탭 (Page 컴포넌트 기반)

모든 Svelte 탭은 `src/components/Page.svelte` 의 `toolbar` 슬롯을 사용한다.

### Page.svelte 툴바 렌더링 로직 (`src/components/Page.svelte`)

```svelte
<script>
  let { children, loading = false, header, toolbar } = $props();
</script>

<div class="container">
  <div class="wrapper">
    <header class="header">{@render header?.()}</header>
    <main>
      {#if loading}
        <div class="loading">...</div>
      {:else}
        <div class="content">{@render children?.()}</div>
      {/if}
    </main>
  </div>
  {#if toolbar}
    <div class="toolbar">
      {@render toolbar?.()}
    </div>
  {/if}
</div>
```

### 4.1 공통 Dirty 추적 패턴

```javascript
function snapshotState() {
    return $state.snapshot({
      [FC_OBJECT_KEY]: FC.[OBJECT_KEY],
      features: FC.FEATURE_CONFIG.features.bitfield,
    });
}

let changes = $derived.by(() => {
    if (!initialState) { return []; }
    return diff(initialState, snapshotState());
});
let showToolbar = $derived(!loading && changes.length > 0);
```

- `microdiff` 라이브러리로 snapshot 비교
- `changes.length > 0` 일 때 `showToolbar = true`
- `isDirty()` 함수 export 되어 jQuery 탭 전환 가드에서 사용

### 4.2 Failsafe (`src/tabs/failsafe/Failsafe.svelte`)

**툴바 버튼:**

| 버튼            | 동작                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Revert          | `Object.assign(FC.RX_CONFIG, initialState.RX_CONFIG)` + `Object.assign(FC.RXFAIL_CONFIG, initialState.RXFAIL_CONFIG)` |
| Save and Reboot | `MSP_SET_RX_CONFIG` + EEPROM_WRITE + `MSP_SET_REBOOT` + `reinitialiseConnection()`                                    |

### 4.3 Governor (`src/tabs/governor/Governor.svelte`)

**툴바 버튼:**

| 버튼            | 동작                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| Revert          | `Object.assign(FC.GOVERNOR, initialState.GOVERNOR)`                                      |
| Save and Reboot | `MSP_SET_GOVERNOR_CONFIG` + EEPROM_WRITE + `MSP_SET_REBOOT` + `reinitialiseConnection()` |

### 4.4 Gyro (`src/tabs/gyro/Gyro.svelte`)

**툴바 버튼:**

| 버튼            | 동작                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| Revert          | `Object.assign(FC.FILTER_CONFIG, initialState.FILTER_CONFIG)`                          |
| Save and Reboot | `MSP_SET_FILTER_CONFIG` + EEPROM_WRITE + `MSP_SET_REBOOT` + `reinitialiseConnection()` |

**특수 조건:** RPM notch 필터가 너무 많이 선택된 경우 Save 버튼이 비활성화된다.

### 4.5 Receiver (`src/tabs/receiver/Receiver.svelte`)

**툴바 버튼:**

| 버튼            | 동작                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| Revert          | `Object.assign(FC.RX_CONFIG, initialState.RX_CONFIG)` + `Object.assign(FC.RX_MAP, initialState.RX_MAP)` |
| Save and Reboot | `MSP_SET_RX_MAP` + `MSP_SET_RX_CONFIG` + EEPROM_WRITE + `MSP_SET_REBOOT` + `reinitialiseConnection()`   |

### 4.6 Motors (`src/tabs/motors/Motors.svelte`)

**툴바 버튼:**

| 버튼            | 동작                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Revert          | `Object.assign(FC.MOTOR_CONFIG, initialState.MOTOR_CONFIG)` + `Object.assign(FC.ESC_SENSOR_CONFIG, initialState.ESC_SENSOR_CONFIG)` |
| Save and Reboot | `MSP_SET_MOTOR_CONFIG` + `MSP_SET_ESC_SENSOR_CONFIG` + EEPROM_WRITE + `MSP_SET_REBOOT` + `reinitialiseConnection()`                 |

---

## 5. 세로뷰(Portrait View)에서의 툴바 배치

### 탭 바 (`src/css/main.css` 1342–1499줄)

```css
@media all and (orientation: portrait) {
    .tab_container {
        position: fixed;
        z-index: 2000;
        top: auto; left: 0; right: 0; bottom: 0;
        height: calc(var(--vertical-icon-scale, 1) * 48px + env(safe-area-inset-bottom, 0px));
    }

    #tabs {
        display: flex;
        flex-direction: row;
        height: calc(var(--vertical-icon-scale, 1) * 48px);
        overflow-x: auto;
        overflow-y: hidden;
    }

    #tab-content-container {
        height: calc(100% - 56px - calc(var(--vertical-icon-scale, 1) * 48px) - env(safe-area-inset-bottom, 0px));
    }
}
```

세로뷰에서는 탭 바가 하단에 고정되고, 아이콘만 표시된다. `.content_toolbar` 는 탭 바보다 위에 떠야 하므로:

```css
.toolbar_fixed_bottom .content_toolbar { z-index: 2001; }
```

아이콘 크기는 `--vertical-icon-scale` CSS 변수로 제어되며, 옵션 탭에서 변경 가능하다 (`src/js/tabs/options.js` 190–207줄).

---

## 6. 탭 전환 시 Dirty 가드

`src/js/gui.js` 293–308줄:

```javascript
GuiControl.prototype.tab_switch_allowed = function (callback) {
    if (this.current_tab) {
        if (this.current_tab.exit) {
            this.current_tab.exit(callback);
        } else if (this.current_tab.isDirty) {
            showTabExitDialog(this.current_tab, callback); // → 즉시 revert
        } else {
            callback?.();
        }
    } else {
        callback?.();
    }
};
```

**주의:** `dialogTabExit` 다이얼로그가 `index.html` 347–357줄에 정의되어 있으나, 실제로는 사용되지 않는다. `showTabExitDialog` (`src/js/main.js` 621줄) 는 확인 다이얼로그를 띄우지 않고 바로 `tab.revert(callback)` 를 호출한다. 즉 **변경사항이 있는 탭을 떠나면 자동으로 revert 된다.**

---

## 7. 연결 해제 시 Dirty 초기화

`src/js/serial_backend.js` 246–250줄:

```javascript
// 모든 탭의 isDirty 초기화
for (const tab of Object.values(TABS)) {
    if (tab.isDirty !== undefined) {
        tab.isDirty = false;
    }
}
```

시리얼 연결이 끊어지면 모든 탭의 dirty 상태가 리셋된다.

---

## 8. 툴바 버튼 비교표

| 탭                | Save              | Save and Reboot | Revert            | 비고                        |
| ----------------- | ----------------- | --------------- | ----------------- | --------------------------- |
| auxiliary         | O (EEPROM_WRITE)  | —               | No-op             |                             |
| beepers           | O (EEPROM_WRITE)  | —               | No-op             |                             |
| blackbox          | —                 | O               | No-op             | 일반 Save 없음              |
| cli               | 항상 표시 (4버튼) | —               | —                 | dirty와 무관, xs-compressed |
| configuration     | O                 | —               | No-op             |                             |
| failsafe (Svelte) | —                 | O               | O (snapshot 복원) |                             |
| governor (Svelte) | —                 | O               | O (snapshot 복원) |                             |
| gyro (Svelte)     | —                 | O               | O (snapshot 복원) | RPM 조건부 비활성화         |
| gps               | O (+리부트)       | —               | No-op             | 저장시 항상 리부트          |
| led_strip         | O (EEPROM_WRITE)  | —               | No-op             |                             |
| mixer             | O / O+리부트      | O+리부트        | O (캐시복원)      | needReboot에 따라 전환      |
| motors (Svelte)   | —                 | O               | O (snapshot 복원) |                             |
| power             | O / O+리부트      | O+리부트        | O (캐시복원)      | needReboot에 따라 전환      |
| profiles          | O (EEPROM_WRITE)  | —               | O (캐시복원)      | 2단계 dirty                 |
| rates             | O (EEPROM_WRITE)  | —               | O (캐시복원)      | 2단계 dirty                 |
| receiver (Svelte) | —                 | O               | O (snapshot 복원) |                             |
| servos            | O / O+리부트      | O+리부트        | O (캐시복원)      | needReboot에 따라 전환      |

---

## 9. i18n 키 목록 (`locales/en/messages.json`)

```json
"buttonSave":           { "message": "Save" },
"buttonSaveReboot":     { "message": "Save and Reboot" },
"buttonRevert":         { "message": "Revert" },
"cliSaveToFileBtn":     { "message": "Save to file" },
"cliLoadFromFileBtn":   { "message": "Load from file" },
"cliClearOutputHistoryBtn": { "message": "Clear output history" },
"cliCopyToClipboardBtn": { "message": "Copy to clipboard" }
```

---

## 10. 관련 파일 인덱스

| 파일                         | 역할                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `src/components/Page.svelte` | Svelte 탭 공통 Page 컴포넌트 (toolbar 슬롯)                        |
| `src/js/gui.js`              | `tab_switch_allowed()` — 탭 전환 dirty 가드                        |
| `src/js/main.js`             | 탭 클릭 핸들러, `showTabExitDialog()`                              |
| `src/js/serial_backend.js`   | 연결 해제 시 모든 탭 isDirty 리셋                                  |
| `src/css/main.css`           | `.toolbar_hidden`, `.toolbar_fixed_bottom`, 세로뷰 portrait 스타일 |
| `index.html`                 | `dialogTabExit` 다이얼로그 정의 (미사용)                           |
| `src/js/tabs/*.js`           | 각 탭별 setDirty / save / revert 로직                              |
| `src/tabs/*.html`            | 각 탭별 content_toolbar HTML                                       |
| `src/tabs/*/**.svelte`       | Svelte 탭의 toolbar snippet + showToolbar 로직                     |

---

## 11. 세로뷰(Portrait) 툴바 수정 지시문

### 11.1 문제 요약

- 세로뷰에서 `.tab_container` (아이콘바)가 `position: fixed; bottom: 0`으로 화면 하단에 고정된다.
- 아이콘바 높이는 `calc(var(--vertical-icon-scale, 1) * 48px + env(safe-area-inset-bottom, 0px))` 으로 옵션(1/1.5/2/2.5/3배)에 따라 가변적이다.
- **Legacy 탭:** `.toolbar_fixed_bottom .content_toolbar`가 `position: absolute; bottom: 0`이므로 아이콘바 뒤에 가려진다.
- **Svelte 탭:** `Page.svelte`의 `.toolbar`가 grid 레이아웃의 맨 아래에 위치하므로 역시 아이콘바에 가려진다.
- **가로뷰(Landscape)는 변경하지 않는다.** 아이콘바가 왼쪽에 있으므로 기존 하단 툴바가 정상 동작한다.

### 11.2 수정 파일 목록

| 파일                         | 수정 내용                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `src/css/main.css`           | `@media (orientation: portrait)` 블록 내에 Legacy 툴바 `bottom` 오프셋 추가     |
| `src/components/Page.svelte` | `<style>` 블록에 portrait 미디어쿼리 추가하여 Svelte 툴바 `padding-bottom` 적용 |

### 11.3 수정 내용 상세

---

#### 11.3.1 Legacy 탭 툴바 — `src/css/main.css`

**기존 코드** (1471–1475줄, portrait 미디어쿼리 내부):

```css
    /* In portrait the bottom tab bar is an icon strip, so the tab toolbar
       must sit above it instead of sharing the same z-index. */
    .toolbar_fixed_bottom .content_toolbar {
        z-index: 2001;
    }
```

**수정 후:**

```css
    /* In portrait the bottom tab bar is an icon strip, so the tab toolbar
       must sit above it instead of sharing the same z-index. */
    .toolbar_fixed_bottom .content_toolbar {
        z-index: 2001;
        position: fixed;
        bottom: calc(var(--vertical-icon-scale, 1) * 48px + env(safe-area-inset-bottom, 0px));
        left: 0;
        right: 0;
    }
```

**설명:**

- `position: fixed`로 변경하여 아이콘바와 동일한 좌표계(뷰포트 기준)에서 배치한다.
- `bottom` 값을 아이콘바 높이와 동일하게 설정하여 아이콘바 바로 위에 붙인다.
- `--vertical-icon-scale` 변수를 참조하므로 아이콘 크기가 바뀌어도 자동으로 따라간다.
- `left: 0; right: 0`으로 화면 전체 너비를 차지하도록 한다 (가로뷰에서 `left`가 사이드바 너비만큼이었으나, portrait에서는 사이드바가 없으므로 0).
- 기존 `position: absolute; bottom: 0` (2229–2234줄)은 portrait 미디어쿼리 **밖**에 있으므로 portrait에서 이 규칙이 오버라이드된다.

---

#### 11.3.2 Legacy 탭 content_wrapper 높이 보정 — `src/css/main.css`

portrait 미디어쿼리 내에 다음 규칙을 추가한다. 기존 `.toolbar_fixed_bottom .content_wrapper` 는 일반(landscape) 용이며 높이에서 90px(상단 헤더 + 툴바)을 빼지만, portrait에서는 아이콘바와 fixed 툴바 높이를 고려해야 한다.

**추가 코드** (portrait 미디어쿼리 블록 내, 11.3.1 바로 아래):

```css
    .toolbar_fixed_bottom .content_wrapper {
        /* portrait: 아이콘바+툴바가 fixed이므로 content_wrapper는
           탭 콘텐츠 영역 전체를 사용할 수 있다. 
           툴바가 fixed로 떠 있으므로 absolute 시절의 90px 보정은 불필요. */
        height: calc(100% - 40px) !important;
    }
```

**설명:**

- 가로뷰에서 `height: calc(100% - 90px)` (2224줄) 은 absolute 툴바 높이(50px)를 빼기 위한 것이었다.
- portrait에서 툴바가 `fixed`로 전환되면 content_wrapper 밖으로 나가므로 그 공간을 빼줄 필요가 없다.
- `!important`를 써서 2224줄의 기본 규칙과 2849줄의 중복 규칙을 오버라이드한다.

---

#### 11.3.3 CLI 툴바 (xs-compressed) — `src/css/main.css`

CLI 탭의 `xs-compressed` 툴바는 dirty-state와 무관하게 항상 표시되는 특수 케이스이다. 동일한 portrait 미디어쿼리 내에서 처리한다.

**추가 코드** (portrait 미디어쿼리 블록 내):

```css
    .toolbar_fixed_bottom .content_toolbar.xs-compressed {
        position: fixed;
        bottom: calc(var(--vertical-icon-scale, 1) * 48px + env(safe-area-inset-bottom, 0px));
        left: 0;
        right: 0;
        z-index: 2001;
    }

    .toolbar_expand_btn {
        /* portrait에서 expand 버튼도 fixed 위치로 이동 */
        position: fixed;
        bottom: calc(var(--vertical-icon-scale, 1) * 48px + env(safe-area-inset-bottom, 0px) + 15px);
        z-index: 2002;
    }
```

**설명:**

- xs-compressed 툴바는 11.3.1의 `.content_toolbar` 규칙을 상속하므로 사실상 같은 위치에 배치된다. 이 규칙은 명시적 확인용이다.
- `.toolbar_expand_btn`(CLI에서 접기/펼치기)도 fixed 좌표로 이동시켜 아이콘바 위 적절한 위치에 배치한다.

---

#### 11.3.4 Svelte 탭 툴바 — `src/components/Page.svelte`

Page.svelte의 `<style>` 블록 하단, `</style>` 바로 앞에 다음 미디어쿼리를 추가한다.

**추가 코드:**

```scss
  @media all and (orientation: portrait) {
    .toolbar {
      position: fixed;
      bottom: calc(var(--vertical-icon-scale, 1) * 48px + env(safe-area-inset-bottom, 0px));
      left: 0;
      right: 0;
      z-index: 2001;
    }
  }
```

**설명:**

- Svelte의 scoped CSS는 해당 컴포넌트 내부에서만 적용되므로 글로벌 CSS 충돌 없다.
- Legacy 툴바와 동일한 `bottom` 계산식을 사용하여 아이콘바 바로 위에 배치한다.
- `z-index: 2001`로 아이콘바(z-index: 2000) 위에 렌더링한다.
- 기존 `.toolbar`의 `bottom: 0; left: 0` 속성은 그대로 두되, portrait에서 오버라이드된다.
- `width: 100%`는 기존 규칙에 있으므로 `left: 0; right: 0`과 결합하면 전체 너비를 차지한다.

### 11.4 가로뷰(Landscape) 영향 없음 확인

- 모든 수정은 `@media all and (orientation: portrait)` 미디어쿼리 안에서만 적용된다.
- 가로뷰에서는 기존 CSS 규칙이 그대로 적용된다:
  - `.toolbar_fixed_bottom .content_toolbar { position: absolute; bottom: 0; }` (2229–2234줄)
  - `Page.svelte .toolbar { bottom: 0; }` (84–105줄)

### 11.5 아이콘 크기 변경 대응 확인

- `--vertical-icon-scale` CSS 변수는 `cordova_startup.js` → `applyVerticalIconScale()`에서 `document.documentElement.style.setProperty()`로 설정된다.
- 모든 `bottom` 계산식이 `var(--vertical-icon-scale, 1) * 48px`을 참조하므로, 아이콘 크기가 1~3배로 변경되어도 툴바가 자동으로 아이콘바 위에 위치한다.
- 기본값 `1`이 CSS 변수 fallback으로 지정되어 있어 변수가 미설정인 경우에도 안전하다.

### 11.6 수정 요약 (3개 파일, CSS만 변경)

```
src/css/main.css          — portrait 미디어쿼리 내 4개 규칙 추가/수정
src/components/Page.svelte — <style> 블록에 portrait 미디어쿼리 1개 추가
```

JS 변경은 필요 없다. 모든 수정은 CSS 미디어쿼리만으로 해결된다.

특이 사항 : 

위 수정을 거쳤는데도 다음 탭들은 이전과 같이 가려진다.

밝은 테마에서 가려지지 않는 툴바는 흰색 바탕에 위아래 여백이 비슷한 중앙에 위치한 버튼으로 보이고

가려져 안보이는 툴바는 약간 회색 바탕에 버튼이 아래쪽에 가깝게 붙어 위치한다.

해결되지 않은 탭 페이지 리스트 

configuration
presets
power
servos
mixer
Rates
profiles
modes ( = axillary)
adjustments
LED strip
Beepers
GPS
Blackbox

해야할 일 :

원인을 분석해서 해결되지 않은 탭 페이지의 툴바가 아이콘에 가려지지 않게 

다른 해결된 탭페이지 처럼 작동하게 하라.

1. 순서 - 원인을 분석해 사용자에게 제시한다. 다음 단계 진행 묻기

2. 해결책 찾기 - 해결 방법을 사용자에게 제시한다. 다음 단계 진행 묻기

3. 사용자가 코드 수정을 지시하면 코드를 수정하고 위에 적힌 리스트 하나도 빼지 말고 13개 탭 모두 수정한다.
