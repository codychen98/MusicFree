import {
    getRemoteMusicPath,
    isRemoteCredentialsCompleteInConfig,
    isRemoteMusicAvailableInConfig,
} from "@/core/remote-storage/remote-config";

describe("isRemoteMusicAvailableInConfig", () => {
    function webdavConfig(
        overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
        return {
            "backup.webdav.url": "https://dav.example.com",
            "backup.webdav.username": "user",
            "backup.webdav.password": "pass",
            ...overrides,
        };
    }

    it("is unavailable without credentials", () => {
        const config = {
            "backup.webdav.url": "",
            "backup.webdav.username": "",
            "backup.webdav.password": "",
            "backup.remote.musicPath": "/Music/Download",
        };
        expect(isRemoteMusicAvailableInConfig(config)).toBe(false);
    });

    it("is unavailable with empty musicPath", () => {
        const config = webdavConfig({
            "backup.remote.musicPath": "",
        });
        expect(isRemoteCredentialsCompleteInConfig(config)).toBe(true);
        expect(isRemoteMusicAvailableInConfig(config)).toBe(false);
    });

    it("is available with webdav creds and musicPath", () => {
        const config = webdavConfig({
            "backup.remote.musicPath": "/(Reinstall)/BACKUP/MusicFree/Download",
        });
        expect(isRemoteMusicAvailableInConfig(config)).toBe(true);
        expect(getRemoteMusicPath(config)).toBe(
            "/(Reinstall)/BACKUP/MusicFree/Download",
        );
    });

    it("is available with pcloud creds and musicPath", () => {
        const config = {
            "backup.remote.pcloud.hostname": "eapi.pcloud.com",
            "backup.remote.pcloud.tokenJson":
                '{"access_token":"tok","token_type":"bearer"}',
            "backup.remote.musicPath": "/Music/Download",
        };
        expect(isRemoteMusicAvailableInConfig(config)).toBe(true);
    });
});
