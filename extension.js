import St from 'gi://St';
import GObject from 'gi://GObject';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {applyLayout} from './dbus.js';

const DisplayModes = GObject.registerClass(
class DisplayModes extends PanelMenu.Button {
    _init(ext) {
        super._init(0.0, 'Display Modes');

        this._ext = ext;
        this._settings = ext.getSettings();

        const icon = new St.Icon({
            icon_name: 'preferences-desktop-display-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        this._buildMenu();
        this._changedId = this._settings.connect('changed::layouts',
            () => this._buildMenu());
    }

    _buildMenu() {
        this.menu.removeAll();

        const layouts = this._settings.get_strv('layouts');
        let hasLayouts = false;

        for (const json of layouts) {
            if (!json) continue;
            let layout;
            try { layout = JSON.parse(json); } catch { continue; }

            hasLayouts = true;
            this.menu.addAction(layout.name || 'Unnamed', () => {
                applyLayout(layout).catch(e => {
                    Main.notifyError('Display Modes', e.message);
                });
            });
        }

        if (hasLayouts)
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addAction('Settings', () => this._ext.openPreferences());
    }

    destroy() {
        if (this._changedId) {
            this._settings.disconnect(this._changedId);
            this._changedId = null;
        }
        super.destroy();
    }
});

export default class DisplayModesExtension extends Extension {
    enable() {
        this._indicator = new DisplayModes(this);
        Main.panel.addToStatusArea('display-modes', this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
