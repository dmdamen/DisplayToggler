import St from 'gi://St';
import GObject from 'gi://GObject';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DisplayModes = GObject.registerClass(
class DisplayModes extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Display Modes');

        const icon = new St.Icon({
            icon_name: 'preferences-desktop-display-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        this.menu.addAction('hello, world!', () => {});
    }
});

export default class DisplayModesExtension {
    _indicator = null;

    enable() {
        this._indicator = new DisplayModes();
        Main.panel.addToStatusArea('display-modes', this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
