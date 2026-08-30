/**
 * "Wait for loading..." overlay shown after FC connection while the initial
 * batch of MSP requests is in flight. Dismissed by the user tapping anywhere,
 * or programmatically by hideLoadingPopup().
 *
 * Notes:
 *   - The overlay is intentionally *delayed*: it only appears if the awaited
 *     batch is still in flight 1.5s after the caller asked for it. On a fast
 *     link (USB/Serial/SPP) the data finishes well before then, so the user
 *     never sees a flash. On slow BLE it serves its purpose as a reassurance
 *     that data is still arriving.
 *   - No auto-dismiss timeout: real BLE responses can take tens of seconds
 *     and we want the user to be sure the data is fully loaded before the
 *     overlay goes away. The overlay is closed explicitly by the caller once
 *     the awaited batch resolves.
 *   - A single overlay element is reused across connect/disconnect cycles.
 *   - The overlay shows only a spinner + label now (no progress bar/text).
 *     updateProgress() is kept for API compatibility but is a no-op.
 */
const LOADING_POPUP_ID = 'loading-popup-overlay';
const SHOW_DELAY_MS = 1500;

// Pending show state. We schedule the visible toggle with setTimeout, but if
// the caller hides the popup before that fires we need to cancel.
let pendingShowTimer = null;

function ensureLoadingPopup() {
    let popup = document.getElementById(LOADING_POPUP_ID);
    if (popup) {
        return popup;
    }
    popup = document.createElement('div');
    popup.id = LOADING_POPUP_ID;
    popup.className = 'loading-popup-overlay';
    popup.innerHTML = `
        <div class="loading-popup-content">
            <div class="loading-popup-spinner" aria-hidden="true"></div>
            <div class="loading-popup-message">Wait for loading...</div>
        </div>
    `;
    // Dismiss on any user interaction (touch/click anywhere on the overlay)
    popup.addEventListener('click', hideLoadingPopup, { passive: true });
    popup.addEventListener('touchstart', hideLoadingPopup, { passive: true });
    document.body.appendChild(popup);
    return popup;
}

/**
 * Request the overlay. It will not actually become visible until SHOW_DELAY_MS
 * has passed and the awaited batch is still in flight. If the batch resolves
 * before then (typical on USB/Serial/SPP) the overlay is never shown.
 */
export function showLoadingPopup() {
    // If a previous request is still pending, cancel it so we don't leak timers.
    if (pendingShowTimer !== null) {
        clearTimeout(pendingShowTimer);
        pendingShowTimer = null;
    }

    // Pre-build the DOM element so the click/touch handlers are wired up even
    // if the overlay never ends up visible.
    ensureLoadingPopup();

    pendingShowTimer = setTimeout(function() {
        pendingShowTimer = null;
        const popup = document.getElementById(LOADING_POPUP_ID);
        if (!popup) return;
        popup.classList.remove('loading-popup-hidden');
        popup.classList.add('loading-popup-visible');
    }, SHOW_DELAY_MS);
}

export function hideLoadingPopup() {
    if (pendingShowTimer !== null) {
        clearTimeout(pendingShowTimer);
        pendingShowTimer = null;
    }
    const popup = document.getElementById(LOADING_POPUP_ID);
    if (!popup) {
        return;
    }
    popup.classList.remove('loading-popup-visible');
    popup.classList.add('loading-popup-hidden');
}

export function isLoadingPopupVisible() {
    if (pendingShowTimer !== null) return false;  // delayed, not yet visible
    const popup = document.getElementById(LOADING_POPUP_ID);
    return !!(popup && popup.classList.contains('loading-popup-visible'));
}

/**
 * Kept for API compatibility with the existing call sites. The overlay no
 * longer renders a progress UI (we only show a spinner + label), so this is
 * intentionally a no-op. Callers can keep calling it without changes.
 */
export function updateProgress(_loaded, _total) {
    // no-op
}
