import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Source: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/windowManager.js?ref_type=heads#L34-35
const DESTROY_WINDOW_ANIMATION_TIME = 150;
const DIALOG_DESTROY_WINDOW_ANIMATION_TIME = 100;

const interfaceSettings = new Gio.Settings({schema: 'org.gnome.desktop.interface'});

let _signal = [];

let _idle = null;

// this timeout takes into account window animation times (if enabled)
// before showing the apps overview
let _showAppsTimeout = null;

let _manager, _workspace;

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
        showActivities();
        return GLib.SOURCE_REMOVE;
    });
}

function windowAccepted(window)
{
    if (window.is_hidden() || acceptedWindowTypes.indexOf(window.get_window_type()) == -1)
        return false;

    return true;
}

function hideActivities()
{
    if (_activatedByExtension){
        Main.overview.hide();
    }
}

function showActivities()
{
    if (_workspace.list_windows().filter(window => windowAccepted(window)).length == 0){
        Main.overview.show();
        _activatedByExtension = true;
    }
}

function getWindowCloseAnimationTime(window)
{
    let animationTime;

    if (!interfaceSettings.get_boolean('enable-animations'))
        animationTime = 0;
    else if (window.get_window_type() == Meta.WindowType.NORMAL)
        animationTime = DESTROY_WINDOW_ANIMATION_TIME
    else
        animationTime = DIALOG_DESTROY_WINDOW_ANIMATION_TIME

    return animationTime;
}

function windowRemoved(workspace, window)
{
    if (workspace != _workspace)
        return;

    if (!windowAccepted(window))
        return;

    if (!St.Settings.get().enable_animations)
    {
        showActivities();
        return;
    }

    removeTimer();

    setTimer(getWindowCloseAnimationTime(window));
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

    _signal['window-removed'] = _workspace.connect('window-removed', (workspace, window) => windowRemoved(workspace, window));
}

function checkWorkspace()
{
    disconnectWindowSignals();

    getWorkspace();

    if (_workspace.list_windows().filter(window => windowAccepted(window)).length > 0 && !Main.overview.dash.showAppsButton.checked)
        hideActivities();
    else if (!Main.overview.visible)
        showActivities();
}

function overviewHidden()
{
    _activatedByExtension = false;
}

export default class ShowApplicationViewWhenWorkspaceEmptyExtension extends Extension {
    constructor(metadata)
    {
        super(metadata);
        _manager = global.screen;
        if (_manager == undefined)
            _manager = global.workspace_manager;
    }

    enable()
    {
        _activatedByExtension = false;
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

        Main.overview.disconnect(_signal['overview-hidden']);
        _manager.disconnect(_signal['workspace-switched']);

        if (_idle)
        {
            GLib.Source.remove(_idle);
            _idle = null;
        }
    }
}
