import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';
import GObject from 'gi://GObject';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {applyLayout, getCurrentState} from './dbus.js';

const ICON_WIDTH = 36;
const ICON_HEIGHT = 20;

const LayoutIcon = GObject.registerClass(
class LayoutIcon extends St.DrawingArea {
    _init(layout, connectorPositions) {
        super._init({
            width: ICON_WIDTH,
            height: ICON_HEIGHT,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._layout = layout;
        this._connectorPositions = connectorPositions;
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const layout = this._layout;

        // Compute logical bounds of each active monitor
        // Prefer connectorPositions (canonical physical position) so the icon
        // always shows the true physical arrangement, even when the layout
        // repositions a lone active monitor to x=0.
        const rects = [];
        for (const lm of layout.logicalMonitors) {
            for (const mon of lm.monitors) {
                const ref = this._connectorPositions?.get(mon.connector);
                if (ref) {
                    rects.push({x: ref.x, y: ref.y, w: ref.w, h: ref.h});
                } else {
                    let w = mon.width / lm.scale;
                    let h = mon.height / lm.scale;
                    if (lm.transform % 2 === 1)
                        [w, h] = [h, w];
                    rects.push({x: lm.x, y: lm.y, w, h});
                }
            }
        }

        const disabledCount = layout.disabledMonitors?.length ?? 0;

        if (rects.length === 0 && disabledCount === 0) {
            cr.$dispose();
            return;
        }

        // Build rects for disabled monitors using reference positions
        const disabledRects = [];
        if (disabledCount > 0) {
            for (const mon of layout.disabledMonitors) {
                const ref = this._connectorPositions?.get(mon.connector);
                if (ref) {
                    disabledRects.push({x: ref.x, y: ref.y, w: ref.w, h: ref.h});
                    continue;
                }
                // Fallback: stack to the right of known rects
                const allSoFar = [...rects, ...disabledRects];
                let dw = 1920 * 0.6, dh = 1080 * 0.6;
                let startX = 0, centerY = dh / 2;
                if (allSoFar.length > 0) {
                    dw = allSoFar.reduce((s, r) => s + r.w, 0) / allSoFar.length * 0.6;
                    dh = allSoFar.reduce((s, r) => s + r.h, 0) / allSoFar.length * 0.6;
                    let maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    for (const r of allSoFar) {
                        maxX = Math.max(maxX, r.x + r.w);
                        minY = Math.min(minY, r.y);
                        maxY = Math.max(maxY, r.y + r.h);
                    }
                    startX = maxX + dw * 0.3;
                    centerY = (minY + maxY) / 2;
                }
                disabledRects.push({
                    x: startX, y: centerY - dh / 2, w: dw, h: dh,
                });
            }
        }

        // Bounding box over all rects
        const allRects = [...rects, ...disabledRects];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const r of allRects) {
            minX = Math.min(minX, r.x);
            minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.w);
            maxY = Math.max(maxY, r.y + r.h);
        }
        const totalW = maxX - minX;
        const totalH = maxY - minY;

        // Scale to fit with padding for stroke
        const pad = 1.5;
        const drawW = ICON_WIDTH - pad * 2;
        const drawH = ICON_HEIGHT - pad * 2;
        const scale = Math.min(drawW / totalW, drawH / totalH);

        // Center offset
        const offX = pad + (drawW - totalW * scale) / 2;
        const offY = pad + (drawH - totalH * scale) / 2;

        // Theme foreground color
        const fg = this.get_theme_node().get_foreground_color();
        const inset = 0.5;

        // Draw active monitors as solid stroked rectangles
        cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, fg.alpha / 255);
        cr.setLineWidth(1);
        for (const r of rects) {
            const rx = offX + (r.x - minX) * scale + inset;
            const ry = offY + (r.y - minY) * scale + inset;
            const rw = r.w * scale - inset * 2;
            const rh = r.h * scale - inset * 2;
            cr.rectangle(rx, ry, rw, rh);
        }
        cr.stroke();

        // Draw disabled monitors: dimmed rectangle with X
        if (disabledRects.length > 0) {
            cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255,
                (fg.alpha / 255) * 0.4);
            cr.setLineWidth(1);
            for (const r of disabledRects) {
                const rx = offX + (r.x - minX) * scale + inset;
                const ry = offY + (r.y - minY) * scale + inset;
                const rw = r.w * scale - inset * 2;
                const rh = r.h * scale - inset * 2;
                cr.rectangle(rx, ry, rw, rh);
                cr.stroke();
                cr.moveTo(rx, ry);
                cr.lineTo(rx + rw, ry + rh);
                cr.moveTo(rx + rw, ry);
                cr.lineTo(rx, ry + rh);
                cr.stroke();
            }
        }

        cr.$dispose();
    }
});

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

        // Build reference positions for all connectors from saved layouts
        // Prefer layouts with more active monitors (the "all on" layout)
        const connectorPositions = new Map();
        const bySize = [...parsed].sort((a, b) =>
            b.layout.logicalMonitors.length - a.layout.logicalMonitors.length);
        for (const {layout} of bySize) {
            for (const lm of layout.logicalMonitors) {
                for (const mon of lm.monitors) {
                    if (!connectorPositions.has(mon.connector)) {
                        let w = mon.width / lm.scale;
                        let h = mon.height / lm.scale;
                        if (lm.transform % 2 === 1)
                            [w, h] = [h, w];
                        connectorPositions.set(mon.connector,
                            {x: lm.x, y: lm.y, w, h});
                    }
                }
            }
        }

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

        // Active layout header (non-interactive, checkmark after name)
        if (activeIndex >= 0) {
            const active = parsed.find(p => p.index === activeIndex);
            const activeItem = new PopupMenu.PopupMenuItem(
                `${active.layout.name || 'Unnamed'} \u2714`);
            activeItem.setSensitive(false);
            const activeIcon = new LayoutIcon(active.layout, connectorPositions);
            activeItem.insert_child_below(activeIcon, activeItem.label);
            activeIcon.set_opacity(255);
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
            const item = this.menu.addAction(
                `Switch to ${layout.name || 'Unnamed'}`, () => {
                    this._applyAndTrack(layout, index);
                });
            const icon = new LayoutIcon(layout, connectorPositions);
            item.insert_child_below(icon, item.label);
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

        const suppress = this._settings.get_boolean('confirm-switch');
        applyLayout(layout, !suppress).catch(e => {
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
        this._settings = this.getSettings();
        this._indicator = new DisplayModes(this);
        Main.panel.addToStatusArea('display-modes', this._indicator);

        this._monitorManager = Meta.MonitorManager.get();
        this._updateAutoConfirm();
        this._confirmSettingId = this._settings.connect('changed::confirm-switch',
            () => this._updateAutoConfirm());
    }

    _updateAutoConfirm() {
        const suppress = this._settings.get_boolean('confirm-switch');

        if (suppress && !this._confirmId) {
            this._confirmId = this._monitorManager.connect(
                'confirm-display-change', () => {
                    this._monitorManager.confirm_display_change();
                });
        } else if (!suppress && this._confirmId) {
            this._monitorManager.disconnect(this._confirmId);
            this._confirmId = null;
        }
    }

    disable() {
        if (this._confirmId) {
            this._monitorManager.disconnect(this._confirmId);
            this._confirmId = null;
        }
        if (this._confirmSettingId) {
            this._settings.disconnect(this._confirmSettingId);
            this._confirmSettingId = null;
        }
        this._monitorManager = null;
        this._settings = null;
        this._indicator?.destroy();
        this._indicator = null;
    }
}
