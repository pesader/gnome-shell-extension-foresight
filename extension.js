import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WindowManager from 'resource:///org/gnome/shell/ui/windowManager.js';
import {ControlsManager} from 'resource:///org/gnome/shell/ui/overviewControls.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

let _signal = [];
let _function;

let _idle = null;

// this timeout takes into account window animation times (if enabled)
// before showing the apps overview
let _showAppsTimeout = null;

let _manager, _workspace, _monitor;

let _activatedByExtension = false;

const acceptedWindowTypes = [ Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG ];

function removeTimer()
{
    if (_showAppsTimeout == null)
        return;

    GLib.Source.remove(_showAppsTimeout);
    _showAppsTimeout = null;
}

function setTimer(interval)
{
    _showAppsTimeout = GLib.timeout_add(GLib.PRIORITY_LOW, interval, () => {
        showApps();
        return GLib.SOURCE_REMOVE;
    });
}

function windowAccepted(window)
{
    if (window.is_hidden() || acceptedWindowTypes.indexOf(window.get_window_type()) == -1)
        return false;

    return true;
}

function hideApps()
{
    // hide the overview only if we're in application view
    if (Main.overview.dash.showAppsButton.checked && _activatedByExtension)
        Main.overview.hide();

}

function showApps()
{
    if (_workspace.list_windows().filter(window => windowAccepted(window)).length == 0) {
        Main.overview.showApps();
        _activatedByExtension = true;
    }
}

function windowAdded(workspace, window)
{
    if (workspace != _workspace)
        return;

    if (!windowAccepted(window))
        return;

    hideApps();
}

function windowRemoved(workspace, window)
{
    if (workspace != _workspace)
        return;

    if (!windowAccepted(window))
        return;

    if (!St.Settings.get().enable_animations)
    {
        showApps();
        return;
    }

    removeTimer();

    setTimer(window.get_window_type() == Meta.WindowType.NORMAL ? WindowManager.DESTROY_WINDOW_ANIMATION_TIME : WindowManager.DIALOG_DESTROY_WINDOW_ANIMATION_TIME);
}

function disconnectWindowSignals()
{
    if (_signal['window-added'])
        _workspace.disconnect(_signal['window-added']);

    if (_signal['window-removed'])
        _workspace.disconnect(_signal['window-removed']);
}

function getWorkspace()
{
    _workspace = _manager.get_active_workspace();

    _signal['window-added'] = _workspace.connect('window-added', (workspace, window) => windowAdded(workspace, window));
    _signal['window-removed'] = _workspace.connect('window-removed', (workspace, window) => windowRemoved(workspace, window));
}

function checkWorkspace()
{
    disconnectWindowSignals();

    getWorkspace();

    if (!Main.overview.visible)
        showApps();
    else if (_workspace.list_windows().filter(window => windowAccepted(window)).length > 0)
        hideApps();
}

function overviewHidden()
{
    _activatedByExtension = false;
}

function appsButtonChecked()
{
    if (!Main.overview.dash.showAppsButton.checked)
        _activatedByExtension = false;
}

function animateFromOverview(callback)
{
    // the original function sets _showAppsButton.checked = false, so we need to copy it to a local variable first
    _function.apply(this, [callback]);
}

export default class ShowApplicationViewWhenWorkspaceEmptyExtension extends Extension {
    constructor(metadata)
    {
        super(metadata);
        _manager = global.screen;
        if (_manager == undefined)
            _manager = global.workspace_manager;

        _monitor = global.display.get_primary_monitor();
    }

    enable()
    {
        _function = ControlsManager.prototype.animateFromOverview;
        ControlsManager.prototype.animateFromOverview = animateFromOverview;

        getWorkspace();

        _signal['workspace-switched'] = _manager.connect('workspace-switched', checkWorkspace);
        _signal['overview-hidden'] = Main.overview.connect('hidden', overviewHidden);

        if (!Main.layoutManager._startingUp)
            return;
    }

    disable()
    {
        removeTimer();
        disconnectWindowSignals();

        Main.overview.dash.showAppsButton.disconnect('notify::checked');
        Main.overview.disconnect(_signal['overview-hidden']);
        _manager.disconnect(_signal['workspace-switched']);

        ControlsManager.prototype.animateFromOverview = _function;

        if (_idle)
        {
            GLib.Source.remove(_idle);
            _idle = null;
        }
    }
}
