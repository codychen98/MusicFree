import {
    getRemoteBackupPaths,
    normalizeWebdavRootPath,
    normalizeWebdavServerUrl,
    resolveRemoteAbsolutePath,
    splitWebdavUrlIntoServerAndRoot,
} from "../remote-paths";

describe("normalizeWebdavServerUrl", () => {
    it("normalizes pCloud server URL to host root", () => {
        expect(
            normalizeWebdavServerUrl(
                "https://webdav.pcloud.com/(Reinstall)\\BACKUP\\",
            ),
        ).toBe("https://webdav.pcloud.com/");
    });
});

describe("normalizeWebdavRootPath", () => {
    it("normalizes slashes and leading slash", () => {
        expect(normalizeWebdavRootPath("(Reinstall)\\BACKUP\\")).toBe(
            "/(Reinstall)/BACKUP",
        );
    });
});

describe("resolveRemoteAbsolutePath", () => {
    it("resolves relative backup path under cloud root", () => {
        expect(
            resolveRemoteAbsolutePath(
                "/(Reinstall)/BACKUP",
                "/MusicFree/MusicFreeBackup.json",
            ),
        ).toBe("/(Reinstall)/BACKUP/MusicFree/MusicFreeBackup.json");
    });

    it("leaves absolute paths under root unchanged", () => {
        expect(
            resolveRemoteAbsolutePath(
                "/(Reinstall)/BACKUP",
                "/(Reinstall)/BACKUP/MusicFree/Download/song.mp3",
            ),
        ).toBe("/(Reinstall)/BACKUP/MusicFree/Download/song.mp3");
    });
});

describe("getRemoteBackupPaths", () => {
    it("places playlist backup file under cloud root", () => {
        const backupPaths = getRemoteBackupPaths("/(Reinstall)/BACKUP");
        expect(backupPaths.file).toBe(
            "/(Reinstall)/BACKUP/MusicFree/MusicFreeBackup.json",
        );
        expect(backupPaths.legacyFile).toBe("/MusicFree/MusicFreeBackup.json");
    });
});

describe("splitWebdavUrlIntoServerAndRoot", () => {
    it("extracts pCloud server URL and cloud root from combined URL", () => {
        const split = splitWebdavUrlIntoServerAndRoot(
            "https://webdav.pcloud.com/(Reinstall)/BACKUP/",
        );
        expect(split.serverUrl).toBe("https://webdav.pcloud.com/");
        expect(split.rootPath).toBe("/(Reinstall)/BACKUP");
    });
});
