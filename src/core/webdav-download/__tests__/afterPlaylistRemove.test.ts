import {
    handleWebdavAfterPlaylistRemove,
    onWebdavAfterPlaylistRemove,
    WebdavAfterPlaylistRemoveEvent,
} from "../afterPlaylistRemove";
import { remotePathsForWebdavTrack } from "../path";

jest.mock("../delete", () => ({
    deleteWebdavRemoteTrack: jest.fn(),
}));

jest.mock("../config", () => ({
    WEBDAV_MUSIC_PLUGIN_PLATFORM: "WebDAV",
    isWebdavDownloadTargetAvailable: jest.fn(() => true),
}));

import { deleteWebdavRemoteTrack } from "../delete";
import { isWebdavDownloadTargetAvailable } from "../config";

const mockedDelete = deleteWebdavRemoteTrack as jest.MockedFunction<
    typeof deleteWebdavRemoteTrack
>;
const mockedAvailable = isWebdavDownloadTargetAvailable as jest.MockedFunction<
    typeof isWebdavDownloadTargetAvailable
>;

describe("remotePathsForWebdavTrack", () => {
    it("derives sidecar paths from full remote audio path", () => {
        expect(
            remotePathsForWebdavTrack(
                "/(Reinstall)/BACKUP/MusicFree/Download/最后一页@江语晨.flac",
            ),
        ).toEqual({
            audioPath: "/(Reinstall)/BACKUP/MusicFree/Download/最后一页@江语晨.flac",
            lrcPath:
                "/(Reinstall)/BACKUP/MusicFree/Download/最后一页@江语晨.lrc",
            tranLrcPath:
                "/(Reinstall)/BACKUP/MusicFree/Download/最后一页@江语晨.tran.lrc",
        });
    });
});

describe("handleWebdavAfterPlaylistRemove", () => {
    beforeEach(() => {
        mockedDelete.mockReset();
        mockedAvailable.mockReturnValue(true);
    });

    it("emits skipped event with remaining playlist titles", async () => {
        const listener = jest.fn();
        onWebdavAfterPlaylistRemove(
            WebdavAfterPlaylistRemoveEvent.RemoteDeleteSkipped,
            listener,
        );

        const item = {
            platform: "WebDAV",
            id: "/music/song.flac",
            title: "Song",
            artist: "Artist",
            album: "Album",
            duration: 0,
        } as IMusic.IMusicItem;

        await handleWebdavAfterPlaylistRemove([item], () => [
            { id: "favorite", title: "我喜欢" },
            { id: "custom", title: "通勤" },
        ]);

        expect(listener).toHaveBeenCalledWith({
            title: "Song",
            playlistTitles: ["我喜欢", "通勤"],
        });
        expect(mockedDelete).not.toHaveBeenCalled();
    });

    it("deletes remote track when no playlists still reference it", async () => {
        const item = {
            platform: "WebDAV",
            id: "/music/song.flac",
            title: "Song",
            artist: "Artist",
            album: "Album",
            duration: 0,
        } as IMusic.IMusicItem;

        await handleWebdavAfterPlaylistRemove([item], () => []);

        expect(mockedDelete).toHaveBeenCalledWith(item);
    });
});
