import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {CRITICAL_LEVEL, LOW_LEVEL} from './state.js';

export default class DeluxM900Preferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();
        const group = new Adw.PreferencesGroup();
        for (const [key, title, subtitle] of [
            ['show-percentage', 'Show Percentage', 'Next to the mouse icon in the top bar'],
            ['notify-low-battery', 'Low Battery Notification',
                `At ${LOW_LEVEL}% and again at ${CRITICAL_LEVEL}%`],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            window._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        }
        const page = new Adw.PreferencesPage();
        page.add(group);
        window.add(page);
    }
}
