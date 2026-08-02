import {
    pluginOrderMapToBackupOrder,
    type IBackupPayload,
} from "@/core/backup-parse";

describe("pluginOrderMapToBackupOrder", () => {
    it("omits undefined, null, and empty maps", () => {
        expect(pluginOrderMapToBackupOrder(undefined)).toBeUndefined();
        expect(pluginOrderMapToBackupOrder(null)).toBeUndefined();
        expect(pluginOrderMapToBackupOrder({})).toBeUndefined();
    });

    it("omits when all entries are invalid", () => {
        expect(
            pluginOrderMapToBackupOrder({
                a: Number.NaN as number,
                b: Number.POSITIVE_INFINITY as number,
                "": 0,
            }),
        ).toBeUndefined();
    });

    it("keeps finite orders matching known plugin names", () => {
        const order = pluginOrderMapToBackupOrder({
            "网易(bimiao音源)": 0,
            Ciallo: 1,
            WebDAV: 2,
            skip: Number.POSITIVE_INFINITY as number,
        });
        expect(order).toEqual({
            "网易(bimiao音源)": 0,
            Ciallo: 1,
            WebDAV: 2,
        });
    });
});

describe("buildBackupPayload composition", () => {
    it("includes pluginOrder when order map has finite entries", () => {
        const pluginOrder = pluginOrderMapToBackupOrder({
            WebDAV: 0,
            Other: 1,
        });
        const payload: IBackupPayload = {
            musicSheets: [],
            plugins: [{ srcUrl: "https://example.com/p.js", version: "1.0.0" }],
            ...(pluginOrder ? { pluginOrder } : {}),
        };
        expect(payload.pluginOrder).toEqual({ WebDAV: 0, Other: 1 });
    });

    it("WebDAV syncMeta spread preserves pluginOrder", () => {
        const base: IBackupPayload = {
            musicSheets: [],
            plugins: [{ srcUrl: "https://example.com/p.js", version: "1.0.0" }],
            pluginOrder: { WebDAV: 0, Other: 1 },
        };
        const withMeta: IBackupPayload = {
            ...base,
            syncMeta: { updatedAt: 1, sourceDeviceId: "test-device" },
        };
        expect(withMeta.pluginOrder).toEqual({ WebDAV: 0, Other: 1 });
        expect(withMeta.syncMeta?.sourceDeviceId).toBe("test-device");
        expect(JSON.parse(JSON.stringify(withMeta)).pluginOrder).toEqual({
            WebDAV: 0,
            Other: 1,
        });
    });
});
