import { IAppConfig } from "@/types/core/config";
import { ITrackPlayer } from "@/types/core/trackPlayer";
import { IInjectable } from "@/types/infra";
import LyricParser, { IParsedLrcItem } from "@/utils/lrcParser";
import { getMediaExtraProperty, patchMediaExtra } from "@/utils/mediaExtra";
import { isSameMediaItem } from "@/utils/mediaUtils";
import minDistance from "@/utils/minDistance";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { Plugin } from "./pluginManager";

import pathConst from "@/constants/pathConst";
import { buildDesktopLyricText } from "@/core/lyric/buildDesktopLyricText";
import LyricUtil from "@/native/lyricUtil";
import { checkAndCreateDir } from "@/utils/fileUtils";
import PersistStatus from "@/utils/persistStatus";
import CryptoJs from "crypto-js";
import { unlink, writeFile } from "react-native-fs";
import RNTrackPlayer, { Event } from "react-native-track-player";
import { TrackPlayerEvents } from "@/core.defination/trackPlayer";
import { IPluginManager } from "@/types/core/pluginManager";


interface ILyricState {
    loading: boolean;
    lyrics: IParsedLrcItem[];
    hasTranslation: boolean;
    meta?: Record<string, string>;
}

const defaultLyricState = {
    loading: true,
    lyrics: [],
    hasTranslation: false,
};

/** Abort hung plugin lyric fetches so EOF/stuck playback does not leave 加载中... forever. */
const LYRIC_FETCH_TIMEOUT_MS = 15_000;

/** UI retry when lyrics stay on loading with no successful refresh (see lyric tab watchdog). */
export const LYRIC_UI_STUCK_RETRY_MS = 3_000;

const lyricStateAtom = atom<ILyricState>(defaultLyricState);
const currentLyricItemAtom = atom<IParsedLrcItem | null>(null);


class LyricManager implements IInjectable {

    private trackPlayer!: ITrackPlayer;
    private appConfig!: IAppConfig;
    private pluginManager!: IPluginManager;

    private lyricParser: LyricParser | null = null;

    /** Monotonic id; only the latest refreshLyric call may commit lyric state. */
    private lyricRefreshGeneration = 0;

    get currentLyricItem() {
        return getDefaultStore().get(currentLyricItemAtom);
    }

    get lyricState() {
        return getDefaultStore().get(lyricStateAtom);
    }

    injectDependencies(trackPlayerService: ITrackPlayer, appConfigService: IAppConfig, pluginManager: IPluginManager): void {
        this.trackPlayer = trackPlayerService;
        this.appConfig = appConfigService;
        this.pluginManager = pluginManager;
    }

    /** Rebuild overlay text from current lyric state (e.g. after line-count setting change). */
    refreshDesktopLyricOverlay() {
        this.updateStatusBarLyricOverlay(
            getDefaultStore().get(currentLyricItemAtom),
            this.lyricState.lyrics,
        );
    }

    getDesktopLyricOverlayOptions() {
        return this.getStatusBarLyricConfig();
    }

    private getStatusBarLyricConfig() {
        const lineCount = this.appConfig.getConfig("lyric.desktopLineCount") ?? 1;
        return {
            topPercent: this.appConfig.getConfig("lyric.topPercent"),
            leftPercent: this.appConfig.getConfig("lyric.leftPercent"),
            align: this.appConfig.getConfig("lyric.align"),
            color: this.appConfig.getConfig("lyric.color"),
            backgroundColor: this.appConfig.getConfig("lyric.backgroundColor"),
            widthPercent: this.appConfig.getConfig("lyric.widthPercent"),
            fontSize: this.appConfig.getConfig("lyric.fontSize"),
            maxLines: lineCount,
        };
    }

    private updateStatusBarLyricOverlay(
        currentItem: IParsedLrcItem | null,
        lyrics: readonly IParsedLrcItem[] = this.lyricState.lyrics,
    ) {
        if (!this.appConfig.getConfig("lyric.showStatusBarLyric")) {
            return;
        }

        const lineCount = this.appConfig.getConfig("lyric.desktopLineCount") ?? 1;
        const showTranslation = PersistStatus.get("lyric.showTranslation");
        const hasSyncedLyrics = lyrics.length > 0 && currentItem != null;

        let text: string;
        let maxLines = lineCount;

        if (!hasSyncedLyrics) {
            const musicItem = this.trackPlayer.currentMusic;
            text = musicItem
                ? `${musicItem.title} - ${musicItem.artist}`
                : "MusicFree";
            maxLines = 1;
        } else {
            text = buildDesktopLyricText({
                lyrics,
                current: currentItem,
                lineCount,
                showTranslation: !!showTranslation,
            });
            if (
                showTranslation &&
                currentItem?.translation?.trim()
            ) {
                maxLines = lineCount + 1;
            }
        }

        LyricUtil.setStatusBarLyricMaxLines(maxLines);
        LyricUtil.setStatusBarLyricText(text);
    }

    setup() {
        // 更新歌词
        this.trackPlayer.on(TrackPlayerEvents.CurrentMusicChanged, (musicItem) => {
            const forceRefetch = this.lyricState.loading;
            this.refreshLyric(!forceRefetch, true);

            if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
                this.updateStatusBarLyricOverlay(null, []);
            }
        });

        RNTrackPlayer.addEventListener(Event.PlaybackProgressUpdated, evt => {
            const parser = this.lyricParser;
            if (!parser || !this.trackPlayer.isCurrentMusic(parser.musicItem)) {
                return;
            }

            const currentLyricItem = getDefaultStore().get(currentLyricItemAtom);
            const newLyricItem = parser.getPosition(evt.position);


            if (currentLyricItem?.lrc !== newLyricItem?.lrc) {
                // 更新当前歌词状态
                getDefaultStore().set(currentLyricItemAtom, newLyricItem ?? null);

                if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
                    this.updateStatusBarLyricOverlay(
                        newLyricItem ?? null,
                        this.lyricState.lyrics,
                    );
                }
            }
        });


        if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
            LyricUtil.showStatusBarLyric(
                "MusicFree",
                this.getStatusBarLyricConfig(),
            );
        }

        this.refreshLyric(true);
    }

    associateLyric(musicItem: IMusic.IMusicItem, linkToMusicItem: ICommon.IMediaBase) {
        if (!musicItem || !linkToMusicItem) {
            return false;
        }

        // 如果当前音乐项和关联的音乐项相同，则不需要重新关联
        if (isSameMediaItem(musicItem, linkToMusicItem)) {
            patchMediaExtra(musicItem, {
                associatedLrc: undefined,
            });
            return false;
        } else {
            patchMediaExtra(musicItem, {
                associatedLrc: linkToMusicItem,
            });
            if (this.trackPlayer.isCurrentMusic(musicItem)) {
                this.refreshLyric(false);
            }
            return true;
        }
    }

    unassociateLyric(musicItem: IMusic.IMusicItem) {
        if (!musicItem) {
            return;
        }

        patchMediaExtra(musicItem, {
            associatedLrc: undefined,
        });

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(false);
        }
    }

    async uploadLocalLyric(musicItem: IMusic.IMusicItem, lyricContent: string, type: "raw" | "translation" = "raw") {
        if (!musicItem) {
            return;
        }

        const platformHash = CryptoJs.MD5(musicItem.platform).toString(
            CryptoJs.enc.Hex,
        );
        const idHash: string = CryptoJs.MD5(musicItem.id).toString(
            CryptoJs.enc.Hex,
        );

        // 检查是否缓存文件夹存在
        await checkAndCreateDir(pathConst.localLrcPath + platformHash);
        await writeFile(pathConst.localLrcPath +
            platformHash +
            "/" +
            idHash +
            (type === "raw" ? "" : ".tran") +
            ".lrc", lyricContent, "utf8");

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(false, false);
        }
    }

    async removeLocalLyric(musicItem: IMusic.IMusicItem) {
        if (!musicItem) {
            return;
        }

        const platformHash = CryptoJs.MD5(musicItem.platform).toString(
            CryptoJs.enc.Hex,
        );
        const idHash: string = CryptoJs.MD5(musicItem.id).toString(
            CryptoJs.enc.Hex,
        );

        const basePath =
            pathConst.localLrcPath + platformHash + "/" + idHash;

        await unlink(basePath + ".lrc").catch(() => { });
        await unlink(basePath + ".tran.lrc").catch(() => { });

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(false, false);
        }

    }


    updateLyricOffset(musicItem: IMusic.IMusicItem, offset: number) {
        if (!musicItem) {
            return;
        }

        // 更新歌词偏移
        patchMediaExtra(musicItem, {
            lyricOffset: offset,
        });

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(true, false);
        }
    }

    /** Force a lyric reload for the current track (e.g. after stuck loading UI). */
    retryCurrentLyric() {
        this.refreshLyric(false, false);
    }

    private isActiveLyricRefresh(generation: number): boolean {
        return generation === this.lyricRefreshGeneration;
    }

    private setLyricAsLoadingState() {
        getDefaultStore().set(lyricStateAtom, {
            loading: true,
            lyrics: [],
            hasTranslation: false,
        });
        getDefaultStore().set(currentLyricItemAtom, null);
    }

    private setLyricAsNoLyricState() {
        getDefaultStore().set(lyricStateAtom, {
            loading: false,
            lyrics: [],
            hasTranslation: false,
        });
        getDefaultStore().set(currentLyricItemAtom, null);
        if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
            this.updateStatusBarLyricOverlay(null, []);
        }
    }

    private withLyricFetchTimeout<T>(promise: Promise<T>): Promise<T | undefined> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(undefined), LYRIC_FETCH_TIMEOUT_MS);
            promise
                .then((value) => {
                    clearTimeout(timer);
                    resolve(value);
                })
                .catch(() => {
                    clearTimeout(timer);
                    resolve(undefined);
                });
        });
    }

    private canCommitLyricRefresh(
        generation: number,
        musicItem: IMusic.IMusicItem,
    ): boolean {
        return (
            this.isActiveLyricRefresh(generation) &&
            this.trackPlayer.isCurrentMusic(musicItem)
        );
    }

    private async refreshLyric(skipFetchLyricSourceIfSame: boolean = true, ignoreProgress: boolean = false) {
        const generation = ++this.lyricRefreshGeneration;
        const currentMusicItem = this.trackPlayer.currentMusic;

        // 如果没有当前音乐项，重置歌词状态
        if (!currentMusicItem) {
            if (this.isActiveLyricRefresh(generation)) {
                this.lyricParser = null;
                this.setLyricAsNoLyricState();
            }
            return;
        }

        let committed = false;

        try {
            let lrcSource: ILyric.ILyricSource | null;

            const canUseCachedParser =
                skipFetchLyricSourceIfSame &&
                this.lyricParser &&
                this.trackPlayer.isCurrentMusic(this.lyricParser.musicItem);

            if (canUseCachedParser) {
                lrcSource = this.lyricParser!.lyricSource ?? null;
            } else {
                if (!this.canCommitLyricRefresh(generation, currentMusicItem)) {
                    return;
                }
                this.lyricParser = null;
                this.setLyricAsLoadingState();

                const getLyric = this.pluginManager
                    .getByMedia(currentMusicItem)
                    ?.methods?.getLyric(currentMusicItem);
                lrcSource =
                    getLyric != null
                        ? (await this.withLyricFetchTimeout(getLyric)) ?? null
                        : null;
            }

            if (!this.canCommitLyricRefresh(generation, currentMusicItem)) {
                return;
            }

            // 如果歌词源不存在，并且开启自动搜索歌词
            if (!lrcSource && this.appConfig.getConfig("lyric.autoSearchLyric")) {
                this.setLyricAsLoadingState();

                lrcSource =
                    (await this.withLyricFetchTimeout(
                        this.searchSimilarLyric(currentMusicItem),
                    )) ?? null;
            }

            if (!this.canCommitLyricRefresh(generation, currentMusicItem)) {
                return;
            }

            // 如果源不存在，恢复默认设置
            if (!lrcSource) {
                this.lyricParser = null;
                this.setLyricAsNoLyricState();
                committed = true;
                return;
            }

            this.lyricParser = new LyricParser(lrcSource.rawLrc!, {
                extra: {
                    offset: (getMediaExtraProperty(currentMusicItem, "lyricOffset") || 0) * -1,
                },
                musicItem: currentMusicItem,
                lyricSource: lrcSource,
                translation: lrcSource.translation,
            });

            getDefaultStore().set(lyricStateAtom, {
                loading: false,
                lyrics: this.lyricParser.getLyricItems(),
                hasTranslation: !!lrcSource.translation,
                meta: this.lyricParser.getMeta(),
            });

            const currentLyric = ignoreProgress ? (this.lyricParser.getLyricItems()?.[0] ?? null) : this.lyricParser.getPosition((await this.trackPlayer.getProgress()).position);
            getDefaultStore().set(currentLyricItemAtom, currentLyric || null);

            if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
                this.updateStatusBarLyricOverlay(
                    currentLyric || null,
                    this.lyricParser.getLyricItems(),
                );
            }

            committed = true;
        } catch {
            if (this.canCommitLyricRefresh(generation, currentMusicItem)) {
                this.lyricParser = null;
                this.setLyricAsNoLyricState();
                committed = true;
            }
        } finally {
            if (
                this.isActiveLyricRefresh(generation) &&
                !committed &&
                this.trackPlayer.isCurrentMusic(currentMusicItem)
            ) {
                this.lyricParser = null;
                this.setLyricAsNoLyricState();
            }
        }
    }

    /**
     * 检索最接近的歌词
     * @param musicItem 
     * @returns 
     */
    private async searchSimilarLyric(musicItem: IMusic.IMusicItem) {
        const keyword = musicItem.alias || musicItem.title;
        const plugins = this.pluginManager.getSearchablePlugins("lyric");

        let distance = Infinity;
        let minDistanceMusicItem;
        let targetPlugin: Plugin | null = null;

        for (let plugin of plugins) {
            // 如果插件不是当前音乐的插件，或者当前音乐不是正在播放的音乐，则跳过
            if (
                !this.trackPlayer.isCurrentMusic(musicItem)
            ) {
                return null;
            }

            if (plugin.name === musicItem.platform) {
                // 如果插件是当前音乐的插件，则跳过
                continue;
            }

            const results = await plugin.methods
                .search(keyword, 1, "lyric")
                .catch(() => null);

            // 取前两个
            const firstTwo = results?.data?.slice(0, 2) || [];

            for (let item of firstTwo) {
                if (
                    item.title === keyword &&
                    item.artist === musicItem.artist
                ) {
                    distance = 0;
                    minDistanceMusicItem = item;
                    targetPlugin = plugin;
                    break;
                } else {
                    const dist =
                        minDistance(keyword, musicItem.title) +
                        minDistance(item.artist, musicItem.artist);
                    if (dist < distance) {
                        distance = dist;
                        minDistanceMusicItem = item;
                        targetPlugin = plugin;
                    }
                }
            }

            if (distance === 0) {
                break;
            }
        }

        if (minDistanceMusicItem && targetPlugin) {
            return await targetPlugin.methods
                .getLyric(minDistanceMusicItem)
                .catch(() => null);
        }

        return null;
    }

}

const lyricManager = new LyricManager();
export default lyricManager;


export const useLyricState = () => useAtomValue(lyricStateAtom);
export const useCurrentLyricItem = () => useAtomValue(currentLyricItemAtom);