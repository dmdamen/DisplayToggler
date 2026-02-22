import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.gnome.Mutter.DisplayConfig';
const OBJECT_PATH = '/org/gnome/Mutter/DisplayConfig';
const INTERFACE = 'org.gnome.Mutter.DisplayConfig';

/**
 * Call GetCurrentState on Mutter DisplayConfig and parse into JS objects.
 * Returns { serial, monitors (Map<connector, info>), logicalMonitors }.
 */
export function getCurrentState() {
    const result = Gio.DBus.session.call_sync(
        BUS_NAME, OBJECT_PATH, INTERFACE,
        'GetCurrentState',
        null, null,
        Gio.DBusCallFlags.NONE, -1, null,
    );

    const [serial, monitors, logicalMonitors] = result.deep_unpack();

    // Map connector -> { connector, vendor, product, serial, currentMode }
    const monitorMap = new Map();
    for (const [spec, modes] of monitors) {
        const [connector, vendor, product, monSerial] = spec;
        let currentMode = null;
        for (const mode of modes) {
            const [modeId, width, height, refreshRate, , , modeProps] = mode;
            if (modeProps?.['is-current']) {
                currentMode = {id: modeId, width, height, refreshRate};
                break;
            }
        }
        monitorMap.set(connector, {
            connector, vendor, product, serial: monSerial, currentMode,
        });
    }

    // Parse logical monitors
    const parsedLogical = logicalMonitors.map(lm => {
        const [x, y, scale, transform, primary, monSpecs] = lm;
        return {
            x, y, scale, transform, primary,
            monitors: monSpecs.map(([c, v, p, s]) => ({
                connector: c, vendor: v, product: p, serial: s,
            })),
        };
    });

    return {serial, monitors: monitorMap, logicalMonitors: parsedLogical};
}

/**
 * Convert parsed display state into a storable layout object.
 */
export function stateToLayout(state, name) {
    return {
        name,
        logicalMonitors: state.logicalMonitors.map(lm => ({
            x: lm.x, y: lm.y, scale: lm.scale,
            transform: lm.transform, primary: lm.primary,
            monitors: lm.monitors.map(mon => {
                const info = state.monitors.get(mon.connector);
                return {
                    connector: mon.connector,
                    vendor: mon.vendor,
                    product: mon.product,
                    serial: mon.serial,
                    mode: info?.currentMode?.id ?? '',
                    width: info?.currentMode?.width ?? 0,
                    height: info?.currentMode?.height ?? 0,
                };
            }),
        })),
    };
}

/**
 * Human-readable summary of monitors in a layout (e.g. "DP-1 2560x1440 + DP-2 2560x1440").
 */
export function layoutSummary(layout) {
    const parts = [];
    for (const lm of layout.logicalMonitors) {
        for (const mon of lm.monitors)
            parts.push(`${mon.connector} ${mon.width}x${mon.height}`);
    }
    return parts.join(' + ');
}

/**
 * Apply a saved layout via ApplyMonitorsConfig with a fresh serial.
 */
export function applyLayout(layout) {
    const {serial} = getCurrentState();

    const logicalMonitors = layout.logicalMonitors.map(lm => [
        lm.x, lm.y, lm.scale, lm.transform, lm.primary,
        lm.monitors.map(mon => [mon.connector, mon.mode, {}]),
    ]);

    Gio.DBus.session.call_sync(
        BUS_NAME, OBJECT_PATH, INTERFACE,
        'ApplyMonitorsConfig',
        new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
            serial, 2, logicalMonitors, {},
        ]),
        null, Gio.DBusCallFlags.NONE, -1, null,
    );
}
