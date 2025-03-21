import Meta from 'gi://Meta';
import St from 'gi://St';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Source: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/windowManager.js?ref_type=heads#L34-35
const DESTROY_WINDOW_ANIMATION_TIME = 150;
const DIALOG_DESTROY_WINDOW_ANIMATION_TIME = 100;

class Foresight {
    constructor(workspaceManager) {
        this._signal = [];
        this._activatedByExtension = false;
        this._workspaceManager = workspaceManager;
        this._currentWorkspace = this._workspaceManager.get_active_workspace();
        this._timeout = null;
        this._mutterSettings = Gio.Settings.new('org.gnome.mutter');

        // Connect signals
        this._connectSignals();
    }

    _connectWorkspaceSignals() {
        this._signal['window-removed'] = this._currentWorkspace.connect(
            'window-removed',
            (workspace, window) => this._windowRemoved(workspace, window)
        );
    }

    _disconnectWorkspaceSignals() {
        if (this._signal['window-removed'])
            this._currentWorkspace.disconnect(this._signal['window-removed']);
    }

    _connectSignals() {
        this._connectWorkspaceSignals();

        this._signal['workspace-switched'] = this._workspaceManager.connect('workspace-switched', () => this._workspaceSwitched());
        this._signal['overview-hidden'] = Main.overview.connect('hidden', () => this._overviewHidden());
    }

    _disconnectSignals() {
        this._disconnectWorkspaceSignals();

        Main.overview.disconnect(this._signal['overview-hidden']);
        this._workspaceManager.disconnect(this._signal['workspace-switched']);
    }


    _sleep(ms) {
        let timeoutId;
        const promise = new Promise(resolve => {
            timeoutId = setTimeout(resolve, ms);
        });

        return {
            promise,
            cancel: () => clearTimeout(timeoutId),
        };
    }

    _windowAccepted(window) {
        const acceptedWindowTypes = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG];
        if (window.is_hidden() || acceptedWindowTypes.indexOf(window.get_window_type()) === -1 || (!window.is_on_primary_monitor() && this._mutterSettings.get_boolean('workspaces-only-on-primary')))
            return false;

        return true;
    }

    _hideActivities() {
        if (this._activatedByExtension)
            Main.overview.hide();
    }

    _showActivities() {
        if (this._currentWorkspace.list_windows().filter(window => this._windowAccepted(window)).length === 0) {
            Main.overview.show();
            this._activatedByExtension = true;
        }
    }

    _getWindowCloseAnimationTime(window) {
        let animationTime;

        // If animations are disabled, then the animation time is zero
        if (!St.Settings.get().enable_animations)
            animationTime = 0;

        // Otherwise, the animation time depends on the type of window
        else if (window.get_window_type() === Meta.WindowType.NORMAL)
            animationTime = DESTROY_WINDOW_ANIMATION_TIME;
        else
            animationTime = DIALOG_DESTROY_WINDOW_ANIMATION_TIME;

        return animationTime;
    }

    _matchLibreOfficeVersion(str) {
        return /^LibreOffice \d+\.\d+$/.test(str);
    }

    _isTemporaryWindow(window) {
        if (
            this._matchLibreOfficeVersion(window.title) &&
            window.get_wm_class() === 'soffice' &&
            (
                window.get_sandboxed_app_id() === 'org.libreoffice.LibreOffice' ||
                window.get_sandboxed_app_id() === null
            )
        )
            return true;

        const temporaryWindows = [
            {
                'title': 'Progress Information',
                'wmClass': 'DBeaver',
                'sandboxedAppId': 'io.dbeaver.DBeaver.Community',
            },
            {
                'title': 'DBeaver',
                'wmClass': 'java',
                'sandboxedAppId': 'io.dbeaver.DBeaver.Community',
            },
            {
                'title': 'Steam',
                'wmClass': null,
                'sandboxedAppId': 'com.valvesoftware.Steam',
            },
            {
                'title': 'Sign in to Steam',
                'wmClass': 'steam',
                'sandboxedAppId': 'com.valvesoftware.Steam',
            },
            {
                'title': 'Launching...',
                'wmClass': 'steam',
                'sandboxedAppId': 'com.valvesoftware.Steam',
            },
            {
                'title': 'Discord Updater',
                'wmClass': 'discord',
                'sandboxedAppId': 'com.discordapp.Discord',
            },
        ];
        for (const temporaryWindow of temporaryWindows) {
            if (
                window.get_title() === temporaryWindow['title'] &&
                window.get_wm_class() === temporaryWindow['wmClass'] &&
                (
                    window.get_sandboxed_app_id() === temporaryWindow['sandboxedAppId'] ||
                    window.get_sandboxed_app_id() === null
                )
            )
                return true;
        }
        return false;
    }

    _windowRemoved(workspace, window) {
        if (workspace !== this._currentWorkspace)
            return;

        if (!this._windowAccepted(window))
            return;

        if (this._isTemporaryWindow(window))
            return;

        this._timeout = this._sleep(this._getWindowCloseAnimationTime(window));
        this._timeout.promise.then(() => this._showActivities());
    }

    _workspaceSwitched() {
        this._disconnectWorkspaceSignals();

        this._currentWorkspace = this._workspaceManager.get_active_workspace();
        this._connectWorkspaceSignals();

        if ((this._currentWorkspace.list_windows().filter(window => this._windowAccepted(window)).length > 0) && !Main.overview.dash.showAppsButton.checked)
            this._hideActivities();
        else if (!Main.overview.visible)
            this._showActivities();
    }

    _overviewHidden() {
        this._activatedByExtension = false;
    }

    destroy() {
        this._disconnectSignals();

        if (this._timeout)
            this._timeout.cancel();

        this._signal = null;
        this._activatedByExtension = null;
        this._workspaceManager = null;
        this._currentWorkspace = null;
        this._timeout = null;
        this._mutterSettings = null;
    }
}

export default class ShowApplicationViewWhenWorkspaceEmptyExtension extends Extension {
    enable() {
        const workspaceManager = global.workspace_manager;
        this._foresight = new Foresight(workspaceManager);
    }

    disable() {
        this._foresight.destroy();
        this._foresight = null;
    }
}
