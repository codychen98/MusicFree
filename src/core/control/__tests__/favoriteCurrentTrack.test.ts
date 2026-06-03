jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: {
        currentMusic: null as IMusic.IMusicItem | null,
    },
}));

jest.mock("@/core/musicSheet", () => ({
    __esModule: true,
    default: {
        defaultSheet: { id: "favorite" },
        getSortedMusicListBySheetId: jest.fn(),
        addMusic: jest.fn(() => Promise.resolve()),
    },
}));

import MusicSheet from "@/core/musicSheet";
import TrackPlayer from "@/core/trackPlayer";
import { favoriteCurrentTrack } from "../favoriteCurrentTrack";

const mockedGetList = MusicSheet.getSortedMusicListBySheetId as jest.MockedFunction<
    typeof MusicSheet.getSortedMusicListBySheetId
>;
const mockedAddMusic = MusicSheet.addMusic as jest.MockedFunction<
    typeof MusicSheet.addMusic
>;

const track = {
    id: "1",
    platform: "test",
    title: "Song",
} as IMusic.IMusicItem;

describe("favoriteCurrentTrack", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        TrackPlayer.currentMusic = null;
        mockedGetList.mockReturnValue({
            has: jest.fn(() => false),
        } as ReturnType<typeof MusicSheet.getSortedMusicListBySheetId>);
    });

    it("does nothing when nothing is playing", async () => {
        await favoriteCurrentTrack();
        expect(mockedGetList).not.toHaveBeenCalled();
        expect(mockedAddMusic).not.toHaveBeenCalled();
    });

    it("does nothing when the track is already favorited", async () => {
        TrackPlayer.currentMusic = track;
        mockedGetList.mockReturnValue({
            has: jest.fn(() => true),
        } as ReturnType<typeof MusicSheet.getSortedMusicListBySheetId>);

        await favoriteCurrentTrack();

        expect(mockedGetList).toHaveBeenCalledWith("favorite");
        expect(mockedAddMusic).not.toHaveBeenCalled();
    });

    it("adds the current track when it is not favorited", async () => {
        TrackPlayer.currentMusic = track;
        const has = jest.fn(() => false);
        mockedGetList.mockReturnValue({
            has,
        } as ReturnType<typeof MusicSheet.getSortedMusicListBySheetId>);

        await favoriteCurrentTrack();

        expect(has).toHaveBeenCalledWith(track);
        expect(mockedAddMusic).toHaveBeenCalledWith("favorite", track);
    });
});
