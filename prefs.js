import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

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

        const buildRows = () => {
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

                let row;

                if (layout) {
                    row = new Adw.EntryRow({
                        title: layoutSummary(layout),
                        show_apply_button: true,
                    });
                    row.set_text(layout.name || '');

                    row.connect('apply', () => {
                        try {
                            const current = settings.get_strv('layouts');
                            const l = JSON.parse(current[slot]);
                            l.name = row.get_text();
                            current[slot] = JSON.stringify(l);
                            settings.set_strv('layouts', current);
                        } catch { /* ignore */ }
                    });

                    const suffix = new Gtk.Box({spacing: 4, valign: Gtk.Align.CENTER});

                    const saveBtn = new Gtk.Button({
                        icon_name: 'document-save-symbolic',
                        valign: Gtk.Align.CENTER,
                        tooltip_text: 'Save current display layout to this slot',
                        css_classes: ['flat'],
                    });
                    saveBtn.connect('clicked', () => {
                        try {
                            const state = getCurrentState();
                            const name = row.get_text() || `Layout ${slot + 1}`;
                            const newLayout = stateToLayout(state, name);
                            const current = settings.get_strv('layouts');
                            current[slot] = JSON.stringify(newLayout);
                            settings.set_strv('layouts', current);
                            buildRows();
                        } catch (e) {
                            window.add_toast(new Adw.Toast({title: `Error: ${e.message}`}));
                        }
                    });
                    suffix.append(saveBtn);

                    const delBtn = new Gtk.Button({
                        icon_name: 'user-trash-symbolic',
                        valign: Gtk.Align.CENTER,
                        tooltip_text: 'Delete this layout',
                        css_classes: ['flat'],
                    });
                    delBtn.connect('clicked', () => {
                        const current = settings.get_strv('layouts');
                        current[slot] = '';
                        settings.set_strv('layouts', current);
                        buildRows();
                    });
                    suffix.append(delBtn);

                    row.add_suffix(suffix);
                } else {
                    row = new Adw.ActionRow({
                        title: `Slot ${slot + 1}`,
                        subtitle: 'Empty',
                    });

                    const saveBtn = new Gtk.Button({
                        label: 'Save Current',
                        valign: Gtk.Align.CENTER,
                        css_classes: ['suggested-action'],
                    });
                    saveBtn.connect('clicked', () => {
                        try {
                            const state = getCurrentState();
                            const name = `Layout ${slot + 1}`;
                            const newLayout = stateToLayout(state, name);
                            const current = settings.get_strv('layouts');
                            current[slot] = JSON.stringify(newLayout);
                            settings.set_strv('layouts', current);
                            buildRows();
                        } catch (e) {
                            window.add_toast(new Adw.Toast({title: `Error: ${e.message}`}));
                        }
                    });
                    row.add_suffix(saveBtn);
                }

                group.add(row);
                rows.push(row);
            }
        };

        buildRows();
    }
}
