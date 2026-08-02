/**
 * Tolerant backup JSON parse (parity with Desktop backup-resume/types).
 * Optional `pluginOrder` on old backups is a no-op when omitted/invalid.
 */

export interface IBackupPluginEntry {
    srcUrl: string;
    version: string;
}

export interface IBackupSyncMeta {
    updatedAt: number;
    sourceDeviceId?: string;
}

/** Plugin tab order: platform/name → sort index. Optional on old backups. */
export type IBackupPluginOrder = Record<string, number>;

export interface IBackupPayload {
    musicSheets: IMusic.IMusicSheetItem[];
    plugins: IBackupPluginEntry[];
    pluginOrder?: IBackupPluginOrder;
    syncMeta?: IBackupSyncMeta;
}

/**
 * Tolerant parse of optional `pluginOrder`.
 * Missing / non-object / empty-after-filter → undefined (no-op for consumers).
 * Keeps only non-empty string keys with finite number values.
 */
export function parsePluginOrder(raw: unknown): IBackupPluginOrder | undefined {
    if (raw === null || raw === undefined || typeof raw !== "object") {
        return undefined;
    }
    if (Array.isArray(raw)) {
        return undefined;
    }

    const result: IBackupPluginOrder = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof key !== "string" || key.length === 0) {
            continue;
        }
        if (typeof value !== "number" || !Number.isFinite(value)) {
            continue;
        }
        result[key] = value;
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Map phone `pluginMeta.getPluginOrder()` into backup `pluginOrder`.
 * Same filtering as parsePluginOrder; empty / missing → undefined (omit from payload).
 */
export function pluginOrderMapToBackupOrder(
    order: Record<string, number> | null | undefined,
): IBackupPluginOrder | undefined {
    return parsePluginOrder(order);
}

export function parseBackupPayload(
    data: string | Record<string, unknown> | object,
): IBackupPayload {
    const dataObj =
        typeof data === "string"
            ? (JSON.parse(data) as Record<string, unknown>)
            : (data as Record<string, unknown>);
    const musicSheets = Array.isArray(dataObj?.musicSheets)
        ? (dataObj.musicSheets as IMusic.IMusicSheetItem[])
        : [];
    const plugins = Array.isArray(dataObj?.plugins)
        ? (dataObj.plugins as IBackupPluginEntry[]).filter(
              (entry): entry is IBackupPluginEntry =>
                  typeof entry?.srcUrl === "string" && entry.srcUrl.length > 0,
          )
        : [];
    const syncMeta =
        dataObj?.syncMeta &&
        typeof dataObj.syncMeta === "object" &&
        typeof (dataObj.syncMeta as IBackupSyncMeta).updatedAt === "number"
            ? (dataObj.syncMeta as IBackupSyncMeta)
            : undefined;
    const pluginOrder = parsePluginOrder(dataObj?.pluginOrder);

    return {
        musicSheets,
        plugins,
        ...(pluginOrder ? { pluginOrder } : {}),
        ...(syncMeta ? { syncMeta } : {}),
    };
}
