import type { WebDAVClient } from "webdav";

import { createWebdavRemoteStorage } from "../webdav-adapter";

type MockWebdavClient = WebDAVClient & {
    calls: Array<{ method: string; args: unknown[] }>;
    store: Map<string, string | Uint8Array>;
};

function createMockWebdavClient(): MockWebdavClient {
    const store = new Map<string, string | Uint8Array>();
    const calls: Array<{ method: string; args: unknown[] }> = [];

    const record = (method: string, args: unknown[]) => {
        calls.push({ method, args });
    };

    return {
        calls,
        store,
        async exists(path: string) {
            record("exists", [path]);
            return store.has(path);
        },
        async getFileContents(path: string, options?: { format?: string }) {
            record("getFileContents", [path, options]);
            const value = store.get(path);
            if (value === undefined) {
                throw new Error(`ENOENT: ${path}`);
            }
            if (options?.format === "text") {
                return typeof value === "string"
                    ? value
                    : new TextDecoder().decode(value);
            }
            return value instanceof Uint8Array ? value : new TextEncoder().encode(value);
        },
        async putFileContents(path: string, data: string | Uint8Array) {
            record("putFileContents", [path, data]);
            store.set(path, data);
            return true;
        },
        async createDirectory(path: string, options?: { recursive?: boolean }) {
            record("createDirectory", [path, options]);
        },
        async deleteFile(path: string) {
            record("deleteFile", [path]);
            store.delete(path);
        },
        async moveFile(from: string, to: string) {
            record("moveFile", [from, to]);
            const value = store.get(from);
            if (value === undefined) {
                throw new Error(`ENOENT: ${from}`);
            }
            store.set(to, value);
            store.delete(from);
        },
        async getDirectoryContents(path: string) {
            record("getDirectoryContents", [path]);
            const prefix = path === "/" ? "/" : `${path}/`;
            return [...store.entries()]
                .filter(([key]) => {
                    if (!key.startsWith(prefix)) {
                        return false;
                    }
                    const remainder = key.slice(prefix.length);
                    return remainder.length > 0 && !remainder.includes("/");
                })
                .map(([key, value]) => {
                    const basename = key.slice(prefix.length);
                    return {
                        filename: key,
                        basename,
                        size: value instanceof Uint8Array
                            ? value.length
                            : new TextEncoder().encode(value).length,
                        type: "file" as const,
                    };
                });
        },
        getFileDownloadLink(path: string) {
            record("getFileDownloadLink", [path]);
            return `https://webdav.example${path}`;
        },
    } as unknown as MockWebdavClient;
}

describe("createWebdavRemoteStorage", () => {
    it("maps WebDAV client operations through the adapter", async () => {
        const mock = createMockWebdavClient();
        const client = createWebdavRemoteStorage(mock);

        await client.ensureDir("/MusicFree");
        expect(
            mock.calls.some(
                (call) =>
                    call.method === "createDirectory"
                    && call.args[0] === "/MusicFree",
            ),
        ).toBe(true);

        await client.putText("/MusicFree/MusicFreeBackup.json", "{\"ok\":true}");
        expect(await client.exists("/MusicFree/MusicFreeBackup.json")).toBe(true);

        const text = await client.getText("/MusicFree/MusicFreeBackup.json");
        expect(text).toBe("{\"ok\":true}");

        await client.putBinary("/music/song.flac", new Uint8Array([1, 2, 3]));
        const binary = await client.getBinary("/music/song.flac");
        expect(binary).toEqual(new Uint8Array([1, 2, 3]));

        await client.moveFile("/music/song.flac", "/music/renamed.flac");
        expect(await client.exists("/music/song.flac")).toBe(false);
        expect(await client.exists("/music/renamed.flac")).toBe(true);

        await client.deleteFile("/music/renamed.flac");
        expect(await client.exists("/music/renamed.flac")).toBe(false);

        const downloadUrl = await client.getDownloadUrl(
            "/MusicFree/MusicFreeBackup.json",
        );
        expect(downloadUrl).toBe(
            "https://webdav.example/MusicFree/MusicFreeBackup.json",
        );
    });

    it("lists directory entries from WebDAV client", async () => {
        const mock = createMockWebdavClient();
        const client = createWebdavRemoteStorage(mock);

        await client.putText("/music/a.mp3", "a");
        await client.putText("/music/b.mp3", "b");

        const entries = await client.listDirectory("/music");
        expect(entries).toHaveLength(2);
        expect(entries.map((entry) => entry.basename).sort()).toEqual([
            "a.mp3",
            "b.mp3",
        ]);
    });
});
