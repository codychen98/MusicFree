import {
    parseBackupPayload,
    parsePluginOrder,
} from "@/core/backup-parse";

describe("parsePluginOrder", () => {
    it("omits missing, null, non-object, array, and empty", () => {
        expect(parsePluginOrder(undefined)).toBeUndefined();
        expect(parsePluginOrder(null)).toBeUndefined();
        expect(parsePluginOrder("nope")).toBeUndefined();
        expect(parsePluginOrder([0, 1])).toBeUndefined();
        expect(parsePluginOrder({})).toBeUndefined();
    });

    it("omits when all entries are invalid", () => {
        expect(
            parsePluginOrder({ a: "0", b: null, c: Number.NaN }),
        ).toBeUndefined();
    });

    it("keeps finite number entries and drops bad keys/values", () => {
        const mixed = parsePluginOrder({
            "网易(bimiao音源)": 0,
            Ciallo: 1,
            WebDAV: 2,
            bad: "x",
            "": 9,
            skip: Number.POSITIVE_INFINITY,
        });
        expect(mixed).toEqual({
            "网易(bimiao音源)": 0,
            Ciallo: 1,
            WebDAV: 2,
        });
    });
});

describe("parseBackupPayload", () => {
    it("parses legacy JSON without pluginOrder; sheets/plugins unchanged", () => {
        const legacy = parseBackupPayload({
            musicSheets: [{ id: "s1" }],
            plugins: [{ srcUrl: "https://example.com/p.js", version: "1.0.0" }],
        });
        expect(legacy.musicSheets).toHaveLength(1);
        expect(legacy.plugins).toHaveLength(1);
        expect(legacy.pluginOrder).toBeUndefined();
    });

    it("preserves valid pluginOrder from string JSON", () => {
        const withOrder = parseBackupPayload(
            JSON.stringify({
                musicSheets: [],
                plugins: [],
                pluginOrder: { WebDAV: 0, Other: 1 },
                syncMeta: { updatedAt: 123 },
            }),
        );
        expect(withOrder.pluginOrder).toEqual({ WebDAV: 0, Other: 1 });
        expect(withOrder.syncMeta?.updatedAt).toBe(123);
    });

    it("ignores invalid pluginOrder safely", () => {
        const invalidOrder = parseBackupPayload({
            musicSheets: [],
            plugins: [],
            pluginOrder: "not-a-map",
        });
        expect(invalidOrder.pluginOrder).toBeUndefined();
        expect(Array.isArray(invalidOrder.musicSheets)).toBe(true);
        expect(Array.isArray(invalidOrder.plugins)).toBe(true);
    });

    it("filters bad plugins and keeps valid pluginOrder", () => {
        const filtersBadPlugins = parseBackupPayload({
            musicSheets: "x",
            plugins: [{ srcUrl: "", version: "1" }, { version: "2" }, null],
            pluginOrder: { A: 0 },
        });
        expect(filtersBadPlugins.musicSheets).toEqual([]);
        expect(filtersBadPlugins.plugins).toEqual([]);
        expect(filtersBadPlugins.pluginOrder).toEqual({ A: 0 });
    });
});
