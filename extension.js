import St from 'gi://St';
import GObject from 'gi://GObject';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {applyLayout, getCurrentState} from './dbus.js';

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

        // Rebuild when menu opens to detect current active layout
        this._openStateId = this.menu.connect('open-state-changed',
            (menu, isOpen) => { if (isOpen) this._buildMenu(); });
    }

    _buildMenu() {
        this.menu.removeAll();

        const layouts = this._settings.get_strv('layouts');
        const usageCounts = this._settings.get_strv('usage-counts');

        // Parse all layouts with their slot indices and usage counts
        const parsed = [];
        for (let i = 0; i < layouts.length; i++) {
            if (!layouts[i]) continue;
            try {
                const layout = JSON.parse(layouts[i]);
                const count = parseInt(usageCounts[i] || '0', 10) || 0;
                parsed.push({layout, index: i, count});
            } catch { continue; }
        }

        if (parsed.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No layouts saved');
            emptyItem.setSensitive(false);
            this.menu.addMenuItem(emptyItem);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addAction('Settings', () => this._ext.openPreferences());
            return;
        }

        // Show a placeholder while detecting active layout
        const loadingItem = new PopupMenu.PopupMenuItem('Detecting layout\u2026');
        loadingItem.setSensitive(false);
        this.menu.addMenuItem(loadingItem);

        // Async DBus call to detect current state without blocking the compositor
        getCurrentState().then(currentState => {
            this._populateMenu(parsed, currentState);
        }).catch(() => {
            this._populateMenu(parsed, null);
        });
    }

    _populateMenu(parsed, currentState) {
        this.menu.removeAll();

        // Find active layout
        let activeIndex = -1;
        if (currentState) {
            for (const {layout, index} of parsed) {
                if (this._isActiveLayout(layout, currentState)) {
                    activeIndex = index;
                    break;
                }
            }
        }

        // Active layout header (disabled, with check ornament)
        if (activeIndex >= 0) {
            const active = parsed.find(p => p.index === activeIndex);
            const activeItem = new PopupMenu.PopupMenuItem(
                active.layout.name || 'Unnamed');
            activeItem.setOrnament(PopupMenu.Ornament.CHECK);
            activeItem.setSensitive(false);
            this.menu.addMenuItem(activeItem);
        } else {
            const activeItem = new PopupMenu.PopupMenuItem(
                'Unsaved layout');
            activeItem.setSensitive(false);
            this.menu.addMenuItem(activeItem);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Available layouts (excluding active), sorted by usage count descending
        const available = parsed
            .filter(p => p.index !== activeIndex)
            .sort((a, b) => b.count - a.count);

        for (const {layout, index} of available) {
            this.menu.addAction(
                `Switch to ${layout.name || 'Unnamed'}`, () => {
                    this._applyAndTrack(layout, index);
                });
        }

        if (available.length > 0)
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addAction('Settings', () => this._ext.openPreferences());
    }

    _applyAndTrack(layout, slotIndex) {
        // Increment usage count
        const counts = this._settings.get_strv('usage-counts');
        const current = parseInt(counts[slotIndex] || '0', 10) || 0;
        counts[slotIndex] = String(current + 1);
        this._settings.set_strv('usage-counts', counts);

        applyLayout(layout).catch(e => {
            Main.notifyError('Display Modes', e.message);
        });
    }

    _isActiveLayout(layout, state) {
        if (layout.logicalMonitors.length !== state.logicalMonitors.length)
            return false;

        for (const lm of layout.logicalMonitors) {
            // Find matching logical monitor by position and properties
            const match = state.logicalMonitors.find(slm =>
                slm.x === lm.x && slm.y === lm.y &&
                Math.abs(slm.scale - lm.scale) < 0.01 &&
                slm.transform === lm.transform
            );
            if (!match) return false;

            // Check all monitors within the logical monitor
            for (const mon of lm.monitors) {
                const info = state.monitors.get(mon.connector);
                if (!info?.currentMode) return false;
                if (info.currentMode.id !== mon.mode) return false;
            }
        }
        return true;
    }

    destroy() {
        if (this._changedId) {
            this._settings.disconnect(this._changedId);
            this._changedId = null;
        }
        if (this._openStateId) {
            this.menu.disconnect(this._openStateId);
            this._openStateId = null;
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
