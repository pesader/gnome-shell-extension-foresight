import Meta from 'gi://Meta';
import St from 'gi://St';

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

    connectSignals() {
        this._connectWorkspaceSignals();

        this._signal['workspace-switched'] = this._workspaceManager.connect('workspace-switched', () => this._workspaceSwitched());
        this._signal['overview-hidden'] = Main.overview.connect('hidden', () => this._overviewHidden());
    }

    disconnectSignals() {
        this._disconnectWorkspaceSignals();

        Main.overview.disconnect(this._signal['overview-hidden']);
        this._workspaceManager.disconnect(this._signal['workspace-switched']);
    }


    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _windowAccepted(window) {
        const acceptedWindowTypes = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG];
        if (window.is_hidden() || acceptedWindowTypes.indexOf(window.get_window_type()) === -1)
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

    async _windowRemoved(workspace, window) {
        if (workspace !== this._currentWorkspace)
            return;

        if (!this._windowAccepted(window))
            return;

        await this._sleep(this._getWindowCloseAnimationTime(window));
        this._showActivities();
    }

    _workspaceSwitched() {
        this._disconnectWorkspaceSignals();

        this._currentWorkspace = this._workspaceManager.get_active_workspace();
        this._connectWorkspaceSignals();

        if ((this._currentWorkspace.list_windows().filter(window => this._windowAccepted(window)).length > 0 || this._currentWorkspace.index() === 0) && !Main.overview.dash.showAppsButton.checked)
            this._hideActivities();
        else if (!Main.overview.visible)
            this._showActivities();
    }

    _overviewHidden() {
        this._activatedByExtension = false;
    }

    destroy() {
        this._signal = null;
        this._activatedByExtension = null;
        this._workspaceManager = null;
        this._currentWorkspace = null;
    }
}

export default class ShowApplicationViewWhenWorkspaceEmptyExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        const workspaceManager = global.workspace_manager;
        this._foresight = new Foresight(workspaceManager);
    }

    enable() {
        this._foresight.connectSignals();
    }

    disable() {
        this._foresight.disconnectSignals();
        this._foresight.destroy();
        this._foresight = null;
    }
}
