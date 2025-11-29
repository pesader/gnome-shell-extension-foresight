import Meta from 'gi://Meta';
import St from 'gi://St';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Animation durations from GNOME Shell source
// Source: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/windowManager.js#L32-33
const DESTROY_WINDOW_ANIMATION_TIME = 150;
const DIALOG_DESTROY_WINDOW_ANIMATION_TIME = 100;

// Window types that should trigger overview behavior
const VALID_WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
];

// Patterns for temporary windows that should not trigger overview behavior
const TEMPORARY_WINDOW_PATTERNS = [
    // DBeaver splash screens
    {
        title: 'Progress Information',
        wmClass: 'DBeaver',
        appId: 'io.dbeaver.DBeaver.Community',
    },
    {
        title: 'DBeaver',
        wmClass: 'java',
        appId: 'io.dbeaver.DBeaver.Community',
    },
    // Steam splash and login screens
    {
        title: 'Steam',
        wmClass: null,
        appId: 'com.valvesoftware.Steam',
    },
    {
        title: 'Sign in to Steam',
        wmClass: 'steam',
        appId: 'com.valvesoftware.Steam',
    },
    {
        title: 'Launching...',
        wmClass: 'steam',
        appId: 'com.valvesoftware.Steam',
    },
    // Discord updater
    {
        title: 'Discord Updater',
        wmClass: 'discord',
        appId: 'com.discordapp.Discord',
    },
    // LibreOffice splash screen
    {
        titleRegex: /^LibreOffice \d+\.\d+$/,
        wmClass: 'soffice',
        appId: 'org.libreoffice.LibreOffice',
    },
];

class Foresight {
    constructor(workspaceManager) {
        this._signals = {};
        this._overviewActivatedByForesight = false;
        this._workspaceManager = workspaceManager;
        this._currentWorkspace = this._workspaceManager.get_active_workspace();
        this._closeAnimationTimeout = null;
        this._mutterSettings = Gio.Settings.new('org.gnome.mutter');

        this._connectSignals();
    }

    // ==================== Signal Management ====================

    _connectSignals() {
        this._connectWorkspaceSignals();

        this._signals.workspaceSwitched = this._workspaceManager.connect('workspace-switched', () =>
            this._onWorkspaceSwitched()
        );

        this._signals.overviewHidden = Main.overview.connect(
            'hidden',
            () => (this._overviewActivatedByForesight = false)
        );
    }

    _disconnectSignals() {
        this._disconnectWorkspaceSignals();

        if (this._signals.overviewHidden) Main.overview.disconnect(this._signals.overviewHidden);

        if (this._signals.workspaceSwitched)
            this._workspaceManager.disconnect(this._signals.workspaceSwitched);
    }

    _connectWorkspaceSignals() {
        this._signals.windowRemoved = this._currentWorkspace.connect(
            'window-removed',
            (workspace, window) => this._onWindowRemoved(workspace, window)
        );

        this._signals.windowAdded = this._currentWorkspace.connect(
            'window-added',
            (workspace, window) => this._onWindowAdded(workspace, window)
        );
    }

    _disconnectWorkspaceSignals() {
        if (this._signals.windowRemoved) {
            this._currentWorkspace.disconnect(this._signals.windowRemoved);
            this._signals.windowRemoved = null;
        }

        if (this._signals.windowAdded) {
            this._currentWorkspace.disconnect(this._signals.windowAdded);
            this._signals.windowAdded = null;
        }
    }

    // ==================== Event Handlers ====================

    _onWindowAdded(workspace, window) {
        // Ignore windows not on current workspace
        if (workspace !== this._currentWorkspace) return;

        // Ignore invalid or temporary windows
        if (!this._isValidWindow(window, true) || this._isTemporaryWindow(window)) return;

        // Hide overview when a new window appears (if we activated it)
        if (Main.overview.visible) this._hideOverview();
    }

    _onWindowRemoved(workspace, window) {
        // Ignore windows not on current workspace
        if (workspace !== this._currentWorkspace) return;

        // Ignore invalid or temporary windows
        if (!this._isValidWindow(window) || this._isTemporaryWindow(window)) return;

        // Wait for close animation, then show overview if workspace is empty
        const closeAnimationDuration = this._getWindowCloseAnimationTime(window);
        this._closeAnimationTimeout = this._createCancellableTimeout(closeAnimationDuration);
        this._closeAnimationTimeout.promise.then(() => {
            if (!this._workspaceHasValidWindows()) this._showOverview();
        });
    }

    _onWorkspaceSwitched() {
        // Reconnect signals to the new active workspace
        this._disconnectWorkspaceSignals();
        this._currentWorkspace = this._workspaceManager.get_active_workspace();
        this._connectWorkspaceSignals();

        // Show or hide overview based on workspace state
        if (this._workspaceHasValidWindows() && !this._isAppGridVisible()) this._hideOverview();
        else if (!Main.overview.visible) this._showOverview();
    }

    // ==================== Helper Methods ====================

    _workspaceHasValidWindows() {
        return this._currentWorkspace.list_windows().some(window => this._isValidWindow(window));
    }

    _isAppGridVisible() {
        return Main.overview.dash.showAppsButton.checked;
    }

    _showOverview() {
        Main.overview.show();
        this._overviewActivatedByForesight = true;
    }

    _hideOverview() {
        if (this._overviewActivatedByForesight) Main.overview.hide();
    }

    _isValidWindow(window, isBeingAdded = false) {
        // Check if window type is valid
        if (!VALID_WINDOW_TYPES.includes(window.get_window_type())) return false;

        // Skip hidden windows (except when first added, due to shortcut quirk)
        if (!isBeingAdded && window.is_hidden()) return false;

        // If workspaces are limited to primary monitor, skip secondary monitor windows
        const isWorkspacesOnPrimaryOnly = this._mutterSettings.get_boolean(
            'workspaces-only-on-primary'
        );
        if (isWorkspacesOnPrimaryOnly && !window.is_on_primary_monitor()) return false;

        return true;
    }

    _isTemporaryWindow(window) {
        const title = window.get_title();
        const wmClass = window.get_wm_class();
        const appId = window.get_sandboxed_app_id();

        return this._matchesTemporaryWindowPattern(title, wmClass, appId);
    }

    _matchesTemporaryWindowPattern(title, wmClass, appId) {
        return TEMPORARY_WINDOW_PATTERNS.some(windowPattern => {
            // Check title (exact match or regex)
            const titleMatches = windowPattern.titleRegex
                ? windowPattern.titleRegex.test(title)
                : title === windowPattern.title;

            // Check wmClass (exact match or null pattern)
            const wmClassMatches = wmClass === windowPattern.wmClass;

            // Check appId (exact match or null allowed)
            const appIdMatches = appId === windowPattern.appId || appId === null;

            return titleMatches && wmClassMatches && appIdMatches;
        });
    }

    _getWindowCloseAnimationTime(window) {
        if (!St.Settings.get().enable_animations) return 0;

        return window.get_window_type() === Meta.WindowType.NORMAL
            ? DESTROY_WINDOW_ANIMATION_TIME
            : DIALOG_DESTROY_WINDOW_ANIMATION_TIME;
    }

    _createCancellableTimeout(ms) {
        let timeoutId;

        return {
            promise: new Promise(resolve => {
                timeoutId = setTimeout(resolve, ms);
            }),
            cancel: () => clearTimeout(timeoutId),
        };
    }

    // ==================== Lifecycle ====================

    destroy() {
        this._disconnectSignals();

        if (this._closeAnimationTimeout) this._closeAnimationTimeout.cancel();

        // Clean up all references
        this._signals = null;
        this._overviewActivatedByForesight = null;
        this._workspaceManager = null;
        this._currentWorkspace = null;
        this._closeAnimationTimeout = null;
        this._mutterSettings = null;
    }
}

export default class ForesightExtension extends Extension {
    enable() {
        this._foresight = new Foresight(global.workspace_manager);
    }

    disable() {
        this._foresight.destroy();
        this._foresight = null;
    }
}
