import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {getCurrentState, stateToLayout, layoutSummary} from './dbus.js';

const NUM_SLOTS = 5;

export default class DisplayModesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({title: 'Display Modes'});
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Layout Slots',
            description: 'Save up to 5 display configurations',
        });
        page.add(group);

        let rows = [];
        let selfChange = false;
        const debounceTimers = new Map();

        const buildRows = () => {
            // Clear debounce timers
            for (const [, id] of debounceTimers) {
                if (id) GLib.source_remove(id);
            }
            debounceTimers.clear();

            // Remove old rows
            for (const row of rows) group.remove(row);
            rows = [];

            const layouts = settings.get_strv('layouts');

            for (let i = 0; i < NUM_SLOTS; i++) {
                const slot = i;
                const json = layouts[slot];
                let layout = null;

                if (json) {
                    try { layout = JSON.parse(json); } catch { /* treat as empty */ }
                }

                const row = new Adw.ActionRow({
                    title: `Slot ${slot + 1}`,
                    subtitle: layout ? layoutSummary(layout) : 'Empty',
                });

                const box = new Gtk.Box({spacing: 8, valign: Gtk.Align.CENTER});

                if (layout) {
                    const entry = new Gtk.Entry({
                        text: layout.name || '',
                        placeholder_text: `Layout ${slot + 1}`,
                        valign: Gtk.Align.CENTER,
                        width_chars: 15,
                    });

                    entry.connect('changed', () => {
                        const prev = debounceTimers.get(slot);
                        if (prev) GLib.source_remove(prev);

                        debounceTimers.set(slot, GLib.timeout_add(
                            GLib.PRIORITY_DEFAULT, 500, () => {
                                debounceTimers.set(slot, 0);
                                try {
                                    const current = settings.get_strv('layouts');
                                    const l = JSON.parse(current[slot]);
                                    l.name = entry.get_text();
                                    current[slot] = JSON.stringify(l);
                                    selfChange = true;
                                    settings.set_strv('layouts', current);
                                    selfChange = false;
                                } catch { /* ignore */ }
                                return GLib.SOURCE_REMOVE;
                            },
                        ));
                    });

                    box.append(entry);
                }

                // Save Current / Overwrite button
                const saveBtn = new Gtk.Button({
                    label: layout ? 'Overwrite' : 'Save Current',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['suggested-action'],
                });
                saveBtn.connect('clicked', () => {
                    try {
                        const state = getCurrentState();
                        const name = layout?.name || `Layout ${slot + 1}`;
                        const newLayout = stateToLayout(state, name);
                        const current = settings.get_strv('layouts');
                        current[slot] = JSON.stringify(newLayout);
                        settings.set_strv('layouts', current);
                    } catch (e) {
                        window.add_toast(new Adw.Toast({title: `Error: ${e.message}`}));
                    }
                });
                box.append(saveBtn);

                if (layout) {
                    const delBtn = new Gtk.Button({
                        icon_name: 'user-trash-symbolic',
                        valign: Gtk.Align.CENTER,
                        css_classes: ['destructive-action'],
                    });
                    delBtn.connect('clicked', () => {
                        const current = settings.get_strv('layouts');
                        current[slot] = '';
                        settings.set_strv('layouts', current);
                    });
                    box.append(delBtn);
                }

                row.add_suffix(box);
                group.add(row);
                rows.push(row);
            }
        };

        buildRows();

        const changedId = settings.connect('changed::layouts', () => {
            if (!selfChange) buildRows();
        });

        window.connect('close-request', () => {
            settings.disconnect(changedId);
            for (const [, id] of debounceTimers) {
                if (id) GLib.source_remove(id);
            }
        });
    }
}
