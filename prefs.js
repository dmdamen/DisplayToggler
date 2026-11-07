import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {getCurrentState, stateToLayout, layoutSummary} from './dbus.js';

const NUM_SLOTS = 5;

export default class DisplayModesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(600, 0);
        window.set_size_request(-1, 445);

        const page = new Adw.PreferencesPage({title: 'Display Modes'});
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Profiles',
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
                    try {
                        layout = JSON.parse(json);
                    } catch (e) {
                        console.error(`Display Modes: failed to parse layout slot ${slot}`, e);
                    }
                }

                const name = layout?.name || `Profile ${slot + 1}`;

                const row = new Adw.ActionRow({
                    title: name,
                    subtitle: layout ? layoutSummary(layout) : 'Empty',
                });

                const suffix = new Gtk.Box({spacing: 4, valign: Gtk.Align.CENTER});

                const editBtn = new Gtk.Button({
                    icon_name: 'document-edit-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: 'Rename this profile',
                    css_classes: ['flat'],
                    sensitive: !!layout,
                });
                editBtn.connect('clicked', () => {
                    const dialog = new Adw.AlertDialog({
                        heading: 'Rename Profile',
                    });

                    const entry = new Gtk.Entry({
                        text: layout.name || '',
                        placeholder_text: `Profile ${slot + 1}`,
                        hexpand: true,
                    });
                    entry.connect('activate', () => {
                        dialog.response('save');
                    });
                    dialog.set_extra_child(entry);

                    dialog.add_response('cancel', 'Cancel');
                    dialog.add_response('save', 'Save');
                    dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
                    dialog.set_default_response('save');

                    dialog.connect('response', (_dialog, response) => {
                        if (response === 'save') {
                            try {
                                const current = settings.get_strv('layouts');
                                const l = JSON.parse(current[slot]);
                                l.name = entry.get_text();
                                current[slot] = JSON.stringify(l);
                                settings.set_strv('layouts', current);
                                buildRows();
                            } catch (e) {
                                console.error(`Display Modes: failed to rename layout slot ${slot}`, e);
                            }
                        }
                    });
                    dialog.present(window);
                });
                suffix.append(editBtn);

                const saveBtn = new Gtk.Button({
                    icon_name: 'camera-photo-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: 'Snapshot current display layout to this profile',
                    css_classes: ['flat'],
                });
                saveBtn.connect('clicked', () => {
                    getCurrentState().then(state => {
                        const newLayout = stateToLayout(state, name);
                        const current = settings.get_strv('layouts');
                        current[slot] = JSON.stringify(newLayout);
                        settings.set_strv('layouts', current);
                        buildRows();
                    }).catch(e => {
                        window.add_toast(new Adw.Toast({title: `Error: ${e.message}`}));
                    });
                });
                suffix.append(saveBtn);

                const delBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: 'Delete this profile',
                    css_classes: ['flat'],
                    sensitive: !!layout,
                });
                delBtn.connect('clicked', () => {
                    const current = settings.get_strv('layouts');
                    current[slot] = '';
                    settings.set_strv('layouts', current);

                    // Forget usage and restore state tied to the deleted profile
                    const counts = settings.get_strv('usage-counts');
                    if (slot < counts.length) {
                        counts[slot] = '0';
                        settings.set_strv('usage-counts', counts);
                    }
                    if (settings.get_int('last-applied') === slot)
                        settings.set_int('last-applied', -1);

                    buildRows();
                });
                suffix.append(delBtn);

                row.add_suffix(suffix);

                group.add(row);
                rows.push(row);
            }
        };

        buildRows();

        const behaviorGroup = new Adw.PreferencesGroup({
            title: 'Behavior',
        });
        page.add(behaviorGroup);

        const confirmRow = new Adw.SwitchRow({
            title: 'Suppress confirmation dialog',
            subtitle: 'Apply layout changes immediately without confirmation',
        });
        confirmRow.set_active(settings.get_boolean('confirm-switch'));
        confirmRow.connect('notify::active', () => {
            settings.set_boolean('confirm-switch', confirmRow.get_active());
        });
        behaviorGroup.add(confirmRow);
    }
}
