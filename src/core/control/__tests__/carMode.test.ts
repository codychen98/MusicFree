jest.mock("@/core/musicSheet", () => ({
    __esModule: true,
    default: {
        getSortedMusicListBySheetId: jest.fn(),
    },
}));

jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: {
        repeatMode: "QUEUE",
        playWithReplacePlayList: jest.fn(() => Promise.resolve()),
    },
}));

jest.mock("@/native/lyricUtil", () => ({
    __esModule: true,
    default: {
        checkSystemAlertPermission: jest.fn(() => Promise.resolve(true)),
        showStatusBarLyric: jest.fn(() => Promise.resolve()),
    },
}));

jest.mock("@/core/appConfig", () => ({
    __esModule: true,
    default: {
        setConfig: jest.fn(),
    },
}));

jest.mock("@/core/lyricManager", () => ({
    __esModule: true,
    default: {
        getDesktopLyricOverlayOptions: jest.fn(() => ({ maxLines: 1 })),
        refreshDesktopLyricOverlay: jest.fn(),
    },
}));

jest.mock("@/utils/toast", () => ({
    __esModule: true,
    default: {
        warn: jest.fn(),
    },
}));

jest.mock("@/core/i18n", () => ({
    __esModule: true,
    default: {
        t: jest.fn((key: string) => key),
    },
}));

import Config from "@/core/appConfig";
import MusicSheet from "@/core/musicSheet";
import TrackPlayer from "@/core/trackPlayer";
import lyricManager from "@/core/lyricManager";
import LyricUtil from "@/native/lyricUtil";
import Toast from "@/utils/toast";
import { MusicRepeatMode } from "@/constants/repeatModeConst";
import { runCarMode } from "../carMode";

const mockedGetSheet = MusicSheet.getSortedMusicListBySheetId as jest.MockedFunction<
    typeof MusicSheet.getSortedMusicListBySheetId
>;
const mockedPlay = TrackPlayer.playWithReplacePlayList as jest.MockedFunction<
    typeof TrackPlayer.playWithReplacePlayList
>;
const mockedCheckPermission =
    LyricUtil.checkSystemAlertPermission as jest.MockedFunction<
        typeof LyricUtil.checkSystemAlertPermission
    >;

const trackA = {
    id: "a",
    title: "A",
    artist: "Artist",
    platform: "local",
} as IMusic.IMusicItem;

const trackB = {
    id: "b",
    title: "B",
    artist: "Artist",
    platform: "local",
} as IMusic.IMusicItem;

describe("runCarMode", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(TrackPlayer, "repeatMode", {
            configurable: true,
            value: MusicRepeatMode.QUEUE,
        });
        mockedGetSheet.mockReturnValue({
            musicList: [trackA, trackB],
        } as ReturnType<typeof MusicSheet.getSortedMusicListBySheetId>);
        mockedCheckPermission.mockResolvedValue(true);
    });

    it("toasts and does not play when favorites are empty", async () => {
        mockedGetSheet.mockReturnValue({
            musicList: [],
        } as ReturnType<typeof MusicSheet.getSortedMusicListBySheetId>);

        await runCarMode();

        expect(Toast.warn).toHaveBeenCalledWith("toast.carMode.emptyFavorites");
        expect(mockedPlay).not.toHaveBeenCalled();
    });

    it("plays first track when not in shuffle mode", async () => {
        await runCarMode();

        expect(mockedPlay).toHaveBeenCalledWith(trackA, [trackA, trackB]);
        expect(Config.setConfig).toHaveBeenCalledWith(
            "lyric.showStatusBarLyric",
            true,
        );
        expect(lyricManager.refreshDesktopLyricOverlay).toHaveBeenCalled();
    });

    it("picks random track when shuffle mode is on", async () => {
        Object.defineProperty(TrackPlayer, "repeatMode", {
            configurable: true,
            value: MusicRepeatMode.SHUFFLE,
        });
        const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.99);

        await runCarMode();

        expect(mockedPlay).toHaveBeenCalledWith(trackB, [trackA, trackB]);
        randomSpy.mockRestore();
    });

    it("still plays when overlay permission is denied", async () => {
        mockedCheckPermission.mockResolvedValue(false);

        await runCarMode();

        expect(mockedPlay).toHaveBeenCalled();
        expect(Toast.warn).toHaveBeenCalledWith(
            "toast.carMode.overlayPermissionDenied",
        );
        expect(LyricUtil.showStatusBarLyric).not.toHaveBeenCalled();
        expect(Config.setConfig).not.toHaveBeenCalledWith(
            "lyric.showStatusBarLyric",
            true,
        );
    });
});
