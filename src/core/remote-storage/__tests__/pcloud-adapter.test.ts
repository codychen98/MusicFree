import { createPcloudRemoteStorageFromCredentials } from "../pcloud-client";
import { isValidPcloudTokenJson } from "../parse-pcloud-token";

describe("pcloud token parsing", () => {
    it("accepts rclone bearer token JSON", () => {
        expect(
            isValidPcloudTokenJson(
                "{\"access_token\":\"abc\",\"token_type\":\"bearer\"}",
            ),
        ).toBe(true);
    });

    it("rejects invalid token JSON", () => {
        expect(isValidPcloudTokenJson("invalid-json")).toBe(false);
    });
});

describe("pcloud adapter", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.resetAllMocks();
    });

    it("builds HTTPS download URL", async () => {
        global.fetch = jest.fn().mockResolvedValue({
            json: async () => ({
                result: 0,
                hosts: ["c123.pcloud.com"],
                path: "/getfile/file.mp3",
            }),
        } as Response);

        const client = createPcloudRemoteStorageFromCredentials({
            hostname: "api.pcloud.com",
            tokenJson: "{\"access_token\":\"abc\",\"token_type\":\"bearer\"}",
        });

        await expect(client.getDownloadUrl("/music/file.mp3")).resolves.toBe(
            "https://c123.pcloud.com/getfile/file.mp3",
        );
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining("https://api.pcloud.com/getfilelink?"),
        );
    });

    it("uploads backup JSON with PUT, nopartial, Bearer auth, and raw bytes body", async () => {
        global.fetch = jest.fn().mockResolvedValue({
            json: async () => ({ result: 0, metadata: [], fileids: [] }),
        } as Response);

        const client = createPcloudRemoteStorageFromCredentials({
            hostname: "api.pcloud.com",
            tokenJson: "{\"access_token\":\"abc\",\"token_type\":\"bearer\"}",
        });

        const payload = '{"musicSheets":[]}';
        await client.putText("/MusicFree/MusicFreeBackup.json", payload);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
            string,
            RequestInit,
        ];
        expect(url).toContain(
            "https://api.pcloud.com/uploadfile?path=%2FMusicFree&filename=MusicFreeBackup.json&nopartial=1",
        );
        expect(url).not.toContain("access_token=");
        expect(init.method).toBe("PUT");
        expect(init.headers).toEqual(
            expect.objectContaining({
                Authorization: "Bearer abc",
                "Content-Length": String(payload.length),
                "Content-Type": "application/octet-stream",
            }),
        );
        // Must stay a raw Uint8Array: RN's Blob rejects ArrayBuffer/TypedArray
        // parts, which broke remote backup on device (Node's Blob accepts them,
        // so a Blob assertion here would hide the regression).
        expect(init.body).toBeInstanceOf(Uint8Array);
        expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(payload);
    });

    it("uploads empty file with FormData nopartial and Bearer auth", async () => {
        global.fetch = jest.fn().mockResolvedValue({
            json: async () => ({ result: 0, metadata: [], fileids: [] }),
        } as Response);

        const client = createPcloudRemoteStorageFromCredentials({
            hostname: "api.pcloud.com",
            tokenJson: "{\"access_token\":\"abc\",\"token_type\":\"bearer\"}",
        });

        await client.putBinary("/MusicFree/empty.bin", new Uint8Array(0));

        expect(global.fetch).toHaveBeenCalledWith(
            "https://api.pcloud.com/uploadfile",
            expect.objectContaining({
                method: "POST",
                headers: { Authorization: "Bearer abc" },
                body: expect.any(FormData),
            }),
        );
        const form = (global.fetch as jest.Mock).mock.calls[0][1]
            .body as FormData;
        expect(form.get("path")).toBe("/MusicFree");
        expect(form.get("filename")).toBe("empty.bin");
        expect(form.get("nopartial")).toBe("1");
    });
});
