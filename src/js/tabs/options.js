import { DarkTheme } from "@/js/DarkTheme.js";
import * as config from "@/js/config.js";
import { GUI } from "@/js/gui.js";
import { i18n } from "@/js/localization.js";
import { checkForConfiguratorUpdates, setDarkTheme } from "@/js/main.js";
import { serial } from "@/js/serial.js";

import { TABS } from "./tabs.js";

const tab = {
  tabName: "options",

  initialize(callback) {
    $("#content").load("/src/tabs/options.html", () => {
      i18n.localizePage();

      this.initUserLanguage();
      this.initRememberLastTab();
      this.initCheckForConfiguratorUnstableVersions();
      this.initAutoConnectConnectionTimeout();
      this.initCordovaForceComputerUI();
      this.initDarkTheme();
      this.initBleKeepalive();
      this.initBleRetryInterval();
      this.initBleRequestTimeout();
      this.initBleBatchMaxRetries();
      this.rememberLastSelectedBoard();
      this.showAdvancedFirmwareOpts();
      this.initAllowVerticalView();
      this.initVerticalViewIconSize();
      this.initHideConnectedTabs();
      this.initExpertMode();

      GUI.content_ready(callback);
    });
  },

  cleanup(callback) {
    callback?.();
  },

  initUserLanguage() {
    const select = $("#opt-user-language");
    const supported = i18n.getLanguagesAvailables();
    const current = i18n.selectedLanguage ?? 'DEFAULT';

    const options = [
      { value: 'DEFAULT', label: i18n.getMessage('language_default_pretty') },
      ...supported.map((lng) => ({
        value: lng,
        label: i18n.getMessage(`language_${lng}`),
      })),
    ];

    select.empty();
    options.forEach((opt) => {
      select.append($('<option></option>').attr('value', opt.value).text(opt.label));
    });
    select.val(current);

    select.on("change", function () {
      i18n.changeLanguage($(this).val());
      i18n.localizePage(true);
    });
  },

  initRememberLastTab() {
    $("#opt-remember-last-tab")
      .prop("checked", config.get("rememberLastTab") ?? true)
      .on("change", function () {
        config.set({ rememberLastTab: $(this).is(":checked") });
      })
      .trigger("change");
  },

  rememberLastSelectedBoard() {
    $("#opt-remember-last-board")
      .prop("checked", config.get("rememberLastSelectedBoard") ?? false)
      .on("change", function () {
        config.set({ rememberLastSelectedBoard: $(this).is(":checked") });
      });
  },

  showAdvancedFirmwareOpts() {
    $("#opt-show-advanced-firmware-opts")
      .prop("checked", config.get("showAdvancedFirmwareOpts") ?? false)
      .on("change", function () {
        config.set({ showAdvancedFirmwareOpts: $(this).is(":checked") });
      });
  },

  initCheckForConfiguratorUnstableVersions() {
    $("#opt-check-unstable-versions")
      .prop(
        "checked",
        config.get("checkForConfiguratorUnstableVersions") ?? true,
      )
      .on("change", function () {
        config.set({
          checkForConfiguratorUnstableVersions: $(this).is(":checked"),
        });
        checkForConfiguratorUpdates();
      });
  },

  initAutoConnectConnectionTimeout() {
    $("#opt-connection-timeout")
      .val(config.get("connectionTimeout") ?? 100)
      .on("change", function () {
        config.set({ connectionTimeout: parseInt($(this).val()) });
      });
  },

  initCordovaForceComputerUI() {
    $("#opt-cordova-force-computer-ui")
      .prop("checked", config.get("cordovaForceComputerUI") ?? false)
      .on("change", function () {
        const checked = $(this).is(":checked");
        config.set({ cordovaForceComputerUI: checked });
        globalThis.cordovaUI?.set?.();
      })
      .closest(".field")
      .toggle(GUI.isCordova() && globalThis.cordovaUI.canChangeUI);
  },

  initDarkTheme() {
    $("#opt-dark-theme")
      .val(DarkTheme.configEnabled)
      .on("change", function () {
        const value = parseInt($(this).val());

        config.set({ darkTheme: value });
        setDarkTheme(value);
      });
  },

  initBleKeepalive() {
    $("#opt-ble-keepalive")
      .val(config.get("bleKeepalive") ?? 15)
      .on("change", function () {
        const val = parseInt($(this).val());
        config.set({ bleKeepalive: val });
        // 연결되어 있으면 타이머 재시작
        if (typeof serial !== 'undefined' && serial.connected && serial.connectionType === 'ble') {
          serial._startBleKeepalive();
        }
      });
  },

  initBleRetryInterval() {
    $("#opt-ble-retry-interval")
      .val(config.get("bleRetryInterval") ?? 2)
      .on("change", function () {
        const val = parseInt($(this).val());
        config.set({ bleRetryInterval: val });
      });
  },

  initBleRequestTimeout() {
    $("#opt-ble-request-timeout")
      .val(config.get("bleRequestTimeoutMs") ?? 20)
      .on("change", function () {
        const val = parseInt($(this).val());
        config.set({ bleRequestTimeoutMs: val });
      });
  },

  initBleBatchMaxRetries() {
    $("#opt-ble-batch-max-retries")
      .val(config.get("bleBatchMaxRetries") ?? 3)
      .on("change", function () {
        const val = parseInt($(this).val());
        config.set({ bleBatchMaxRetries: val });
      });
  },

  initAllowVerticalView() {
    $("#opt-allow-vertical-view")
      .prop("checked", config.get("allowVerticalView") ?? false)
      .on("change", function () {
        const checked = $(this).is(":checked");
        config.set({ allowVerticalView: checked });
        globalThis.cordovaUI?.set?.();
      });
  },

  initVerticalViewIconSize() {
    const select = $("#opt-vertical-icon-size");
    const current = config.get("verticalViewIconSize") ?? 1;

    select.val(current);

    select.on("change", function () {
      const scale = parseFloat($(this).val());
      config.set({ verticalViewIconSize: scale });
      globalThis.cordovaUI?.applyVerticalIconScale?.(scale);
    });
  },

  initHideConnectedTabs() {
    const hidden = config.get("hiddenConnectedTabs") || [];
    const container = $("#hide-connected-tabs-list");
    container.empty();
    const hideableNames = [];
    const tabLabelMap = {};

    $("#tabs ul.mode-connected li, #tabs ul.mode-connected-cli li").each(
      function () {
        const classes = $(this).attr("class").split(/\s+/);
        classes.forEach((cls) => {
          if (cls.startsWith("tab_")) {
            const name = cls.substring(4);
            if (name !== "connect" && name !== "options") {
              hideableNames.push(name);
              const i18nKey = $(this).find("a").attr("i18n");
              if (i18nKey) {
                tabLabelMap[name] = i18nKey;
              }
            }
          }
        });
      },
    );

    hideableNames.forEach((name) => {
      const i18nKey = tabLabelMap[name];
      const label = i18nKey ? i18n.getMessage(i18nKey) : name;

      const $field = $('<div class="field"></div>');
      const checkboxId = "hide-tab-" + name;
      const $checkbox = $('<input type="checkbox" class="toggle">')
        .attr("id", checkboxId)
        .prop("checked", !hidden.includes(name))
        .on("change", () => {
          const currentHidden = config.get("hiddenConnectedTabs") || [];
          const newHidden = currentHidden.filter((t) => t !== name);
          if (!$("#" + checkboxId).is(":checked")) {
            newHidden.push(name);
          }
          config.set({ hiddenConnectedTabs: newHidden });
        });

      $field.append($("<div></div>").append($checkbox));
      $field.append(
        $('<label></label>').attr("for", checkboxId).text(label),
      );
      container.append($field);
    });
  },

  initExpertMode() {
    $("#opt-expert-mode")
      .prop("checked", config.get("expertMode") ?? false)
      .on("change", function () {
        const checked = $(this).is(":checked");
        config.set({ expertMode: checked });
        // Keep the headerbar checkbox and CONFIGURATOR.expertMode in sync
        $("#expert-mode input").prop("checked", checked).trigger("change");
      });
  },
};

TABS[tab.tabName] = tab;

if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule && GUI.active_tab === tab.tabName) {
      TABS[tab.tabName].initialize();
    }
  });

  import.meta.hot.dispose(() => {
    tab.cleanup();
  });
}
