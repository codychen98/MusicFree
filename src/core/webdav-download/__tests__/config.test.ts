import {
    lyricSidecarFilename,
    remotePathFor,
    resolveFirstSearchPathSegment,
    resolveRemoteDir,
    translationSidecarFilename,
} from "../path";

describe("resolveFirstSearchPathSegment", () => {
    it("returns first comma-separated segment", () => {
        expect(
            resolveFirstSearchPathSegment(
                "/(Reinstall)/BACKUP/MusicFree/Download, /other",
            ),
        ).toBe("/(Reinstall)/BACKUP/MusicFree/Download");
    });

    it("normalizes backslashes and trailing slashes", () => {
        expect(resolveFirstSearchPathSegment("foo\\bar\\\\")).toBe("foo/bar");
    });

    it("returns empty for blank input", () => {
        expect(resolveFirstSearchPathSegment("")).toBe("");
        expect(resolveFirstSearchPathSegment(undefined)).toBe("");
    });
});

describe("resolveRemoteDir", () => {
    it("matches first searchPath segment", () => {
        expect(resolveRemoteDir("/MusicFree/Download, /other")).toBe(
            "/MusicFree/Download",
        );
    });
});

describe("remotePathFor", () => {
    it("joins dir and basename", () => {
        expect(
            remotePathFor("/(Reinstall)/BACKUP/MusicFree/Download", "a@b.flac"),
        ).toBe("/(Reinstall)/BACKUP/MusicFree/Download/a@b.flac");
    });

    it("handles root dir", () => {
        expect(remotePathFor("/", "song.mp3")).toBe("/song.mp3");
    });
});

describe("sidecar filenames", () => {
    it("derives lrc and tran.lrc from audio name", () => {
        expect(lyricSidecarFilename("最后一页@江语晨.flac")).toBe(
            "最后一页@江语晨.lrc",
        );
        expect(translationSidecarFilename("最后一页@江语晨.flac")).toBe(
            "最后一页@江语晨.tran.lrc",
        );
    });
});
