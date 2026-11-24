import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {initialState, reduce, view} from './state.js';
import {Reader} from './reader.js';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'DELUX M900 Pro');

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
        this.menu.addMenuItem(this._status);
        this.menu.addMenuItem(this._detail);

        this._state = initialState();
        this._render();

        this._reader = new Reader(message => {
            const now = GLib.DateTime.new_now_local().format('%H:%M');
            this._state = reduce(this._state, message, now);
            this._render();
        });
        this.connect('destroy', () => this._reader.stop());
        this._reader.start();
    }

    _render() {
        const v = view(this._state);
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
    }
});

export default class DeluxMouseBatteryExtension extends Extension {
    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
