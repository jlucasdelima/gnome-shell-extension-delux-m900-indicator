import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {initialState, notice, reduce, view} from './state.js';
import {Reader} from './reader.js';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    // onState(state, warning) gets each new state, and the low battery
    // warning to show when there is one and the setting allows it.
    _init(extension, state, onState) {
        super._init(0.0, 'DELUX M900 Pro');
        this._settings = extension.getSettings();
        this._state = state;
        this._onState = onState;

        this._box = new St.BoxLayout({style_class: 'panel-status-indicators-box'});
        this._box.add_child(new St.Icon({
            icon_name: 'input-mouse-symbolic',
            style_class: 'system-status-icon',
        }));
        this._charging = new St.Icon({style_class: 'system-status-icon', visible: false});
        this._box.add_child(this._charging);
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._label);
        this.add_child(this._box);

        this._status = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._detail = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._dpi = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._status);
        this.menu.addMenuItem(this._detail);
        this.menu.addMenuItem(this._dpi);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Settings', () => extension.openPreferences());

        this._settings.connectObject('changed', () => this._render(), this);
        this._render();

        this._reader = new Reader(message => this._onMessage(message));
        this.connect('destroy', () => {
            this._reader.stop();
            this._settings = null;
        });
        this._reader.start();
    }

    _onMessage(message) {
        const now = GLib.DateTime.new_now_local().format('%H:%M');
        const notify = this._settings.get_boolean('notify-low-battery');
        const next = reduce(this._state, message, now, {notify});
        const warning = notice(this._state, next);
        this._state = next;
        this._onState(next, warning);
        this._render();
    }

    _render() {
        const v = view(this._state, {showPercentage: this._settings.get_boolean('show-percentage')});
        this.visible = v.visible;
        this._box.opacity = v.dim ? 128 : 255;
        if (v.low)
            this._box.add_style_class_name('delux-m900-low');
        else
            this._box.remove_style_class_name('delux-m900-low');
        this._charging.visible = v.chargingIcon !== null;
        if (v.chargingIcon !== null)
            this._charging.icon_name = v.chargingIcon;
        this._label.text = v.label;
        this._label.visible = v.label !== '';
        this._status.label.text = v.status;
        this._detail.label.text = v.detail ?? '';
        this._detail.visible = v.detail !== null;
        this._dpi.label.text = v.dpi ?? '';
        this._dpi.visible = v.dpi !== null;
    }
});

export default class DeluxM900Extension extends Extension {
    enable() {
        // The state outlives disable() so that the screen lock, which
        // disables and enables extensions, does not repeat the low battery
        // notification at every unlock.
        this._state ??= initialState();
        this._indicator = new Indicator(this, this._state, (state, warning) => {
            this._state = state;
            if (state.warning === null)
                this._notification?.destroy(); // back on the cable
            else if (warning !== null)
                this._notify(warning);
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._source?.destroy();
    }

    _notify({title, body, critical}) {
        // First: a source destroys itself when its last notification goes.
        this._notification?.destroy();
        if (!this._source) {
            this._source = new MessageTray.Source({
                title: 'DELUX M900 Pro',
                iconName: 'input-mouse-symbolic',
            });
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
        const notification = new MessageTray.Notification({
            source: this._source,
            title,
            body,
            urgency: critical ? MessageTray.Urgency.CRITICAL : MessageTray.Urgency.NORMAL,
        });
        notification.connect('destroy', () => {
            if (this._notification === notification)
                this._notification = null;
        });
        this._notification = notification;
        this._source.addNotification(notification);
    }
}
