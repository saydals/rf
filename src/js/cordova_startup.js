import * as config from "@/js/config.js";
import { cordovaChromeapi } from "@/js/cordova_chromeapi.js";
import { appReady } from "@/js/main.js";

export const cordovaUI = {
    uiZoom: 1,
    canChangeUI: true,
    screenWidth: 0,
    screenHeight: 0,
    init: async function() {
        const self = this;
        self.screenWidth = $(window).width();
        self.screenHeight = $(window).height();
        let length;
        if (self.screenWidth > self.screenHeight) {
            length = self.screenWidth;
        } else {
            length = self.screenHeight;
        }
        if (length < 1024) {
            self.uiZoom = length/1024;
        }
        if (self.screenWidth > 575 && self.screenHeight > 575) {
            self.canChangeUI = false;
        }

        if (config.get('cordovaForceComputerUI') === undefined) {
            config.set({'cordovaForceComputerUI': true});
        }
        self.set();
    },
    set: function() {
        if (this.screenWidth > 575 && this.screenHeight > 575) {
            // Tablet/landscape-native: respect OS auto-rotate.
            window.screen.orientation.unlock();
        } else {
            // Phones: lock the activity to a full-sensor rotation in all
            // four orientations. Unlike the default 'any' (UNSPECIFIED),
            // FULL_SENSOR ignores the OS auto-rotate toggle, so flipping
            // the device 180° rotates the UI in both portrait and
            // landscape — matching the behaviour the user expects when
            // they turn the phone upside-down.
            window.screen.orientation.lock('allSensor');
        }
        if (config.get('cordovaForceComputerUI')) {
            $('body').css('zoom', this.uiZoom);
        } else {
            $('body').css('zoom', 1);
        }
        this.applyVerticalIconScale();
    },
    applyVerticalIconScale: function() {
        const scale = parseFloat(config.get('verticalViewIconSize') ?? 1);
        const clamped = Math.min(Math.max(scale, 1), 3);
        document.documentElement.style.setProperty('--vertical-icon-scale', clamped);
    },
};

export const cordovaApp = {
    initialize: function() {
        this.bindEvents();
    },
    bindEvents: function() {
        document.addEventListener('deviceready', this.onDeviceReady, false);
    },
    onDeviceReady: function() {
        $('.open_firmware_flasher').hide();
        cordovaUI.init();
        navigator.splashscreen.hide();
        cordovaChromeapi.init();
        appReady();
    },
};
