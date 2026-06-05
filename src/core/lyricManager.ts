import { IAppConfig } from "@/types/core/config";
import { ITrackPlayer } from "@/types/core/trackPlayer";
import { IInjectable } from "@/types/infra";
import LyricParser, { IParsedLrcItem } from "@/utils/lrcParser";
import { getMediaExtraProperty, patchMediaExtra } from "@/utils/mediaExtra";
import { getMediaUniqueKey, isSameMediaItem } from "@/utils/mediaUtils";
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
import { AppState } from "react-native";
import RNTrackPlayer, { Event } from "react-native-track-player";
import { TrackPlayerEvents } from "@/core.defination/trackPlayer";
import { IPluginManager } from "@/types/core/pluginManager";
import { lyricLog } from "@/utils/log";


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

    /**
     * True while a refreshLyric fetch is actively running (plugin getLyric and/or
     * auto-search). The recovery watchdog must NOT retry while this is true, otherwise
     * it bumps the generation token and aborts the very fetch that would populate lyrics.
     */
    private refreshInFlight = false;

    /** Background/desktop recovery: detect stuck state without the lyrics tab mounted. */
    private lyricRecoveryTrackKey: string | null = null;
    private lyricRecoveryStuckSince: number | null = null;
    private lastLyricRecoveryRetryAt = 0;
    private static readonly LYRIC_RECOVERY_RETRY_COOLDOWN_MS = 3_000;

    /** [debug] throttle for the per-second progress-tick state log. */
    private lastTickLogAt = 0;

    /**
     * Guard so the lyric event listeners are registered exactly once. setup() is the only
     * place those listeners are wired, and it can legitimately be invoked more than once
     * (e.g. the track-player re-init/recovery path), so it must be idempotent to avoid
     * duplicate listeners — and to guarantee a single registration when the initial
     * player init failed and setup is retried from bootstrap.
     */
    private didSetup = false;

    /** [debug] Compact identity of a music item for logs. */
    private mkey(m?: IMusic.IMusicItem | null): string | null {
        return m ? `${m.platform}@${m.id}` : null;
    }

    /** [debug] Snapshot of the manager's lyric state for logs. */
    private lyricStateSnapshot() {
        const parser = this.lyricParser;
        return {
            loading: this.lyricState.loading,
            lyricsLen: this.lyricState.lyrics.length,
            generation: this.lyricRefreshGeneration,
            refreshInFlight: this.refreshInFlight,
            parserTrack: this.mkey(parser?.musicItem ?? null),
            currentTrack: this.mkey(this.trackPlayer.currentMusic),
            appState: AppState.currentState,
            showDesktop: !!this.appConfig.getConfig("lyric.showStatusBarLyric"),
        };
    }

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

        lyricLog("desktop:setText", {
            hasSyncedLyrics,
            maxLines,
            textPreview: text.slice(0, 40),
            currentItemIdx: currentItem?.index ?? null,
            lyricsLen: lyrics.length,
        });
        LyricUtil.setStatusBarLyricMaxLines(maxLines);
        LyricUtil.setStatusBarLyricText(text);
    }

    setup() {
        if (this.didSetup) {
            return;
        }
        this.didSetup = true;
        lyricLog("setup", this.lyricStateSnapshot());
        // 更新歌词
        this.trackPlayer.on(TrackPlayerEvents.CurrentMusicChanged, () => {
            lyricLog("event:CurrentMusicChanged", this.lyricStateSnapshot());
            this.resetLyricRecoveryWatchdog();
            // Always refetch on track change so stale lyrics/parser from a prior song
            // cannot remain when overlapping refreshLyric calls abort mid-flight.
            this.refreshLyric(false, true);

            if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
                this.updateStatusBarLyricOverlay(null, []);
            }
        });

        // Single progress entry point: resync the active line/overlay from the playback
        // position and, only when genuinely stuck, retry. This listener also fires while
        // the app is backgrounded (the playback service keeps this JS context alive), so
        // desktop lyrics recover here too without a separate service hook.
        RNTrackPlayer.addEventListener(Event.PlaybackProgressUpdated, evt => {
            // [debug] throttled tick log so we can see whether ticks fire (incl. background)
            // and what the lyric state is while stuck.
            const now = Date.now();
            if (now - this.lastTickLogAt > 2_000) {
                this.lastTickLogAt = now;
                lyricLog("tick", {
                    position: Math.round(evt.position),
                    ...this.lyricStateSnapshot(),
                });
            }
            this.tickLyricRecoveryWatchdog(evt.position);
        });

        AppState.addEventListener("change", nextState => {
            lyricLog("event:AppState", { nextState, ...this.lyricStateSnapshot() });
            if (nextState !== "active") {
                return;
            }
            this.tickLyricRecoveryWatchdog();
            if (this.needsLyricRecovery()) {
                lyricLog("appState:retry", this.lyricStateSnapshot());
                this.retryCurrentLyric();
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
        lyricLog("retryCurrentLyric", this.lyricStateSnapshot());
        this.refreshLyric(false, false);
    }

    needsLyricRecovery(): boolean {
        if (!this.trackPlayer.currentMusic) {
            return false;
        }
        // A fetch in progress is NOT stuck; retrying would abort it via the generation
        // token and loop forever. Only orphaned loading (no live fetch) or a drifted
        // parser is recoverable.
        if (this.refreshInFlight) {
            return false;
        }
        return this.lyricState.loading || this.isLyricDisplayStale();
    }

    /**
     * Runs on every playback progress tick (including background via playback service).
     * Resyncs desktop/in-app lyrics when the parser is valid but the highlight drifted,
     * and retries fetch after {@link LYRIC_UI_STUCK_RETRY_MS} when loading or parser-less.
     */
    tickLyricRecoveryWatchdog(position?: number): void {
        const currentMusic = this.trackPlayer.currentMusic;
        if (!currentMusic) {
            this.resetLyricRecoveryWatchdog();
            return;
        }

        const trackKey = getMediaUniqueKey(currentMusic);
        if (this.lyricRecoveryTrackKey !== trackKey) {
            this.lyricRecoveryTrackKey = trackKey;
            this.lyricRecoveryStuckSince = null;
        }

        if (position != null && this.tryResyncLyricToPosition(position)) {
            this.lyricRecoveryStuckSince = null;
            return;
        }

        if (!this.needsLyricRecovery()) {
            this.lyricRecoveryStuckSince = null;
            return;
        }

        const now = Date.now();
        if (this.lyricRecoveryStuckSince === null) {
            this.lyricRecoveryStuckSince = now;
            return;
        }
        if (now - this.lyricRecoveryStuckSince < LYRIC_UI_STUCK_RETRY_MS) {
            return;
        }
        if (
            now - this.lastLyricRecoveryRetryAt <
            LyricManager.LYRIC_RECOVERY_RETRY_COOLDOWN_MS
        ) {
            return;
        }

        lyricLog("watchdog:retry", {
            stuckMs: now - (this.lyricRecoveryStuckSince ?? now),
            ...this.lyricStateSnapshot(),
        });
        this.lastLyricRecoveryRetryAt = now;
        this.lyricRecoveryStuckSince = now;
        this.retryCurrentLyric();
    }

    /**
     * True when lyrics are shown for a track but the in-memory parser is missing or
     * bound to another track (progress events will not advance the highlight).
     */
    isLyricDisplayStale(): boolean {
        const currentMusic = this.trackPlayer.currentMusic;
        if (!currentMusic || this.lyricState.loading) {
            return false;
        }
        if (this.lyricState.lyrics.length === 0) {
            return false;
        }
        return (
            !this.lyricParser ||
            !this.trackPlayer.isCurrentMusic(this.lyricParser.musicItem)
        );
    }

    private isActiveLyricRefresh(generation: number): boolean {
        return generation === this.lyricRefreshGeneration;
    }

    private resetLyricRecoveryWatchdog() {
        this.lyricRecoveryTrackKey = null;
        this.lyricRecoveryStuckSince = null;
    }

    /** Parser matches current track but highlight/overlay drifted from playback position. */
    private tryResyncLyricToPosition(position: number): boolean {
        const parser = this.lyricParser;
        if (!parser || !this.trackPlayer.isCurrentMusic(parser.musicItem)) {
            return false;
        }

        const newLyricItem = parser.getPosition(position);
        const currentLyricItem = getDefaultStore().get(currentLyricItemAtom);
        if (
            currentLyricItem?.index === newLyricItem?.index &&
            currentLyricItem?.lrc === newLyricItem?.lrc
        ) {
            return false;
        }

        getDefaultStore().set(currentLyricItemAtom, newLyricItem ?? null);
        if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
            this.updateStatusBarLyricOverlay(
                newLyricItem ?? null,
                this.lyricState.lyrics,
            );
        }
        return true;
    }

    private setLyricAsLoadingState() {
        lyricLog("state:loading", { currentTrack: this.mkey(this.trackPlayer.currentMusic) });
        getDefaultStore().set(lyricStateAtom, {
            loading: true,
            lyrics: [],
            hasTranslation: false,
        });
        getDefaultStore().set(currentLyricItemAtom, null);
        if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
            this.updateStatusBarLyricOverlay(null, []);
        }
    }

    private setLyricAsNoLyricState() {
        lyricLog("state:noLyric", { currentTrack: this.mkey(this.trackPlayer.currentMusic) });
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

    /** Drop lyrics/parser that belong to a different track before a new fetch starts. */
    private clearStaleLyricStateForTrack(
        currentMusicItem: IMusic.IMusicItem,
        generation: number,
    ) {
        if (!this.isActiveLyricRefresh(generation)) {
            return;
        }
        const parserMatchesCurrent =
            this.lyricParser &&
            this.trackPlayer.isCurrentMusic(this.lyricParser.musicItem);
        if (!parserMatchesCurrent) {
            this.lyricParser = null;
            this.setLyricAsLoadingState();
        }
    }

    private async refreshLyric(skipFetchLyricSourceIfSame: boolean = true, ignoreProgress: boolean = false) {
        const generation = ++this.lyricRefreshGeneration;
        const currentMusicItem = this.trackPlayer.currentMusic;

        lyricLog("refresh:enter", {
            generation,
            skipFetchLyricSourceIfSame,
            ignoreProgress,
            currentTrack: this.mkey(currentMusicItem),
            refreshInFlight: this.refreshInFlight,
        });

        // 如果没有当前音乐项，重置歌词状态
        if (!currentMusicItem) {
            lyricLog("refresh:noCurrentMusic", { generation, active: this.isActiveLyricRefresh(generation) });
            if (this.isActiveLyricRefresh(generation)) {
                this.lyricParser = null;
                this.setLyricAsNoLyricState();
            }
            return;
        }

        this.clearStaleLyricStateForTrack(currentMusicItem, generation);

        let committed = false;
        this.refreshInFlight = true;

        try {
            let lrcSource: ILyric.ILyricSource | null;

            const canUseCachedParser =
                skipFetchLyricSourceIfSame &&
                this.lyricParser &&
                this.trackPlayer.isCurrentMusic(this.lyricParser.musicItem);

            lyricLog("refresh:branch", { generation, canUseCachedParser: !!canUseCachedParser });

            if (canUseCachedParser) {
                lrcSource = this.lyricParser!.lyricSource ?? null;
            } else {
                if (!this.canCommitLyricRefresh(generation, currentMusicItem)) {
                    lyricLog("refresh:abort", {
                        generation,
                        where: "beforeFetch",
                        active: this.isActiveLyricRefresh(generation),
                        isCurrent: this.trackPlayer.isCurrentMusic(currentMusicItem),
                    });
                    return;
                }
                this.lyricParser = null;
                this.setLyricAsLoadingState();

                lyricLog("refresh:getLyric:start", { generation, currentTrack: this.mkey(currentMusicItem) });
                const getLyric = this.pluginManager
                    .getByMedia(currentMusicItem)
                    ?.methods?.getLyric(currentMusicItem);
                lyricLog("refresh:getLyric:hasMethod", { generation, hasMethod: getLyric != null });
                lrcSource =
                    getLyric != null
                        ? (await this.withLyricFetchTimeout(getLyric)) ?? null
                        : null;
                lyricLog("refresh:getLyric:done", {
                    generation,
                    gotSource: !!lrcSource,
                    rawLrcLen: lrcSource?.rawLrc?.length ?? 0,
                    active: this.isActiveLyricRefresh(generation),
                    isCurrent: this.trackPlayer.isCurrentMusic(currentMusicItem),
                });
            }

            if (!this.canCommitLyricRefresh(generation, currentMusicItem)) {
                lyricLog("refresh:abort", {
                    generation,
                    where: "afterFetch",
                    active: this.isActiveLyricRefresh(generation),
                    isCurrent: this.trackPlayer.isCurrentMusic(currentMusicItem),
                });
                return;
            }

            // 如果歌词源不存在，并且开启自动搜索歌词
            if (!lrcSource && this.appConfig.getConfig("lyric.autoSearchLyric")) {
                lyricLog("refresh:autoSearch:start", { generation });
                this.setLyricAsLoadingState();

                lrcSource =
                    (await this.withLyricFetchTimeout(
                        this.searchSimilarLyric(currentMusicItem),
                    )) ?? null;
                lyricLog("refresh:autoSearch:done", {
                    generation,
                    gotSource: !!lrcSource,
                    active: this.isActiveLyricRefresh(generation),
                    isCurrent: this.trackPlayer.isCurrentMusic(currentMusicItem),
                });
            }

            if (!this.canCommitLyricRefresh(generation, currentMusicItem)) {
                lyricLog("refresh:abort", {
                    generation,
                    where: "afterAutoSearch",
                    active: this.isActiveLyricRefresh(generation),
                    isCurrent: this.trackPlayer.isCurrentMusic(currentMusicItem),
                });
                return;
            }

            // 如果源不存在，恢复默认设置
            if (!lrcSource) {
                lyricLog("refresh:noSource", { generation });
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

            lyricLog("refresh:commit", {
                generation,
                lyricsLen: this.lyricParser.getLyricItems().length,
                hasTranslation: !!lrcSource.translation,
            });
            committed = true;
        } catch (e: any) {
            lyricLog("refresh:catch", {
                generation,
                error: e?.message ?? String(e),
                canCommit: this.canCommitLyricRefresh(generation, currentMusicItem),
            });
            if (this.canCommitLyricRefresh(generation, currentMusicItem)) {
                this.lyricParser = null;
                this.setLyricAsNoLyricState();
                committed = true;
            }
        } finally {
            lyricLog("refresh:finally", {
                generation,
                committed,
                active: this.isActiveLyricRefresh(generation),
                isCurrent: this.trackPlayer.isCurrentMusic(currentMusicItem),
                refreshInFlightBefore: this.refreshInFlight,
            });
            // Only the active (latest) refresh owns the in-flight flag and the orphan
            // cleanup; a superseded refresh must leave both to the newer one still running.
            if (this.isActiveLyricRefresh(generation)) {
                this.refreshInFlight = false;
                if (!committed && this.trackPlayer.isCurrentMusic(currentMusicItem)) {
                    this.lyricParser = null;
                    this.setLyricAsNoLyricState();
                }
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