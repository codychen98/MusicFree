import {
    buildNewLocalAudioPath,
    buildRenamedAudioFilename,
    getAudioBasename,
    getAudioExtension,
    localSidecarPathsForAudio,
} from "@/utils/renameDownloadPath";

describe("renameDownloadPath", () => {
    it("preserves audio extension when renaming", () => {
        expect(
            buildRenamedAudioFilename("old@name.flac", "飞云之下", "林俊杰&韩红"),
        ).toBe("飞云之下@林俊杰&韩红.flac");
    });

    it("defaults extension to mp3 when missing", () => {
        expect(getAudioExtension("track")).toBe("mp3");
    });

    it("derives sidecar paths beside audio file", () => {
        const paths = localSidecarPathsForAudio(
            "/MusicFree/Download/飞云之下@林俊杰&韩红.flac",
        );
        expect(paths.lrcPath).toBe(
            "/MusicFree/Download/飞云之下@林俊杰&韩红.lrc",
        );
        expect(paths.tranLrcPath).toBe(
            "/MusicFree/Download/飞云之下@林俊杰&韩红.tran.lrc",
        );
    });

    it("builds new local path in same directory", () => {
        expect(
            buildNewLocalAudioPath(
                "/data/Music/old@name.mp3",
                "New Title",
                "New Artist",
            ),
        ).toBe("/data/Music/New Title@New Artist.mp3");
    });

    it("extracts basename from remote path", () => {
        expect(getAudioBasename("/remote/dir/song@artist.flac")).toBe(
            "song@artist.flac",
        );
    });
});
