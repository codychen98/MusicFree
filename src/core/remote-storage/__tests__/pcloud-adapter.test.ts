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

    it("uploads backup JSON with PUT and Content-Length", async () => {
        global.fetch = jest.fn().mockResolvedValue({
            json: async () => ({ result: 0, metadata: [], fileids: [] }),
        } as Response);

        const client = createPcloudRemoteStorageFromCredentials({
            hostname: "api.pcloud.com",
            tokenJson: "{\"access_token\":\"abc\",\"token_type\":\"bearer\"}",
        });

        const payload = '{"musicSheets":[]}';
        await client.putText("/MusicFree/MusicFreeBackup.json", payload);

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining(
                "https://api.pcloud.com/uploadfile?access_token=abc&path=%2FMusicFree&filename=MusicFreeBackup.json",
            ),
            expect.objectContaining({
                method: "PUT",
                headers: { "Content-Length": String(payload.length) },
            }),
        );
    });
});
