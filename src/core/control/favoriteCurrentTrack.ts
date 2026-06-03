import MusicSheet from "@/core/musicSheet";
import TrackPlayer from "@/core/trackPlayer";

export async function favoriteCurrentTrack(): Promise<void> {
    const musicItem = TrackPlayer.currentMusic;
    if (!musicItem) {
        return;
    }

    const favorites = MusicSheet.getSortedMusicListBySheetId(
        MusicSheet.defaultSheet.id,
    );
    if (favorites.has(musicItem)) {
        return;
    }

    await MusicSheet.addMusic(MusicSheet.defaultSheet.id, musicItem);
}
