import { getCurrentDialog, showDialog } from "@/components/dialogs/useDialog";
import {
    androidSentinelAudioUrl,
    internalFakeSoundKey,
    legacyFakeAudioUrl,
    sortIndexSymbol,
    timeStampSymbol,
} from "@/constants/commonConst";
import { MusicRepeatMode } from "@/constants/repeatModeConst";
import delay from "@/utils/delay";
import getUrlExt from "@/utils/getUrlExt";
import { errorLog, trace } from "@/utils/log";
import { logQueueSnapshot } from "@/utils/trackPlayerDebug";
import {
    isNearEndOfTrack,
    shouldSkipPlaybackEndedFallback,
    shouldTriggerEofWatchdog,
    shouldTriggerSentinelStuckWatchdog,
} from "@/core/trackPlayer/playbackWatchdog";
import { createMediaIndexMap } from "@/utils/mediaIndexMap";
import {
    getLocalPath,
    isSameMediaItem,
} from "@/utils/mediaUtils";
import Network from "@/utils/network";
import PersistStatus from "@/utils/persistStatus";
import { getQualityOrder } from "@/utils/qualities";
import { musicIsPaused } from "@/utils/trackUtils";
import EventEmitter from "eventemitter3";
import { produce } from "immer";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import shuffle from "lodash.shuffle";
import { Platform } from "react-native";
import ReactNativeTrackPlayer, {
    Event,
    State,
    Track,
    TrackMetadataBase,
    usePlaybackState,
    useProgress,
} from "react-native-track-player";
import LocalMusicSheet from "../localMusicSheet";

import { TrackPlayerEvents } from "@/core.defination/trackPlayer";
import type { IAppConfig } from "@/types/core/config";
import type { IMusicHistory } from "@/types/core/musicHistory";
import { ITrackPlayer } from "@/types/core/trackPlayer/index";
import minDistance from "@/utils/minDistance";
import { IPluginManager } from "@/types/core/pluginManager";
import { ImgAsset } from "@/constants/assetsConst";
import { resolveImportedAssetOrPath } from "@/utils/fileUtils";
import { configureTrackPlayerOptions } from "@/core/control/configureTrackPlayerOptions";



const currentMusicAtom = atom<IMusic.IMusicItem | null>(null);
const repeatModeAtom = atom<MusicRepeatMode>(MusicRepeatMode.QUEUE);
const qualityAtom = atom<IMusic.IQualityKey>("standard");
const playListAtom = atom<IMusic.IMusicItem[]>([]);


class TrackPlayer extends EventEmitter<{
    [TrackPlayerEvents.PlayEnd]: () => void;
    [TrackPlayerEvents.CurrentMusicChanged]: (musicItem: IMusic.IMusicItem | null) => void;
    [TrackPlayerEvents.ProgressChanged]: (progress: {
        position: number;
        duration: number;
    }) => void;
}> implements ITrackPlayer {
    // 依赖
    private configService!: IAppConfig;
    private musicHistoryService!: IMusicHistory;
    private pluginManagerService!: IPluginManager;

    // 当前播放的音乐下标
    private currentIndex = -1;
    // 音乐播放器服务是否启动
    private serviceInited = false;
    /** RNTP EOF / watchdog listeners (main app + playback service share one registration). */
    private playbackHandlersRegistered = false;
    /** Prevents double auto-advance when sentinel + queue-ended/state-ended fire together. */
    private isAdvancingQueue = false;
    private nearEndSince: number | null = null;
    private positionStallSince: number | null = null;
    private lastWatchdogPosition: number | null = null;
    private sentinelStuckSince: number | null = null;
    /** Bumps on each `play()` so async native-queue prefetch cannot apply to a stale song. */
    private nativeQueuePrefetchToken = 0;
    // 播放队列索引map
    private playListIndexMap = createMediaIndexMap([] as IMusic.IMusicItem[]);


    private static maxMusicQueueLength = 10000;
    private static halfMaxMusicQueueLength = 5000;
    private static toggleRepeatMapping = {
        [MusicRepeatMode.SHUFFLE]: MusicRepeatMode.SINGLE,
        [MusicRepeatMode.SINGLE]: MusicRepeatMode.QUEUE,
        [MusicRepeatMode.QUEUE]: MusicRepeatMode.SHUFFLE,
    };
    private static fakeAudioUrl =
        Platform.OS === "android"
            ? androidSentinelAudioUrl
            : legacyFakeAudioUrl;
    private static proposedAudioUrl = "musicfree://proposed-audio";

    constructor() {
        super();
    }

    public get previousMusic() {
        const currentMusic = this.currentMusic;
        if (!currentMusic) {
            return null;
        }

        return this.getPlayListMusicAt(this.currentIndex - 1);
    }

    public get currentMusic() {
        return getDefaultStore().get(currentMusicAtom);
    }

    /** For headless controls when the atom is unset but RNTP is still playing. */
    public async resolveCurrentMusicItem(): Promise<IMusic.IMusicItem | null> {
        const fromAtom = this.currentMusic;
        if (fromAtom) {
            return fromAtom;
        }

        const persisted = PersistStatus.get("music.musicItem");
        if (persisted?.id != null && persisted.platform != null) {
            if (this.isInPlayList(persisted)) {
                return persisted;
            }
            const fromPersistedList = this.playList.find(it =>
                isSameMediaItem(it, persisted),
            );
            if (fromPersistedList) {
                return fromPersistedList;
            }
            return persisted;
        }

        const activeTrack = await ReactNativeTrackPlayer.getActiveTrack();
        if (!activeTrack?.id || activeTrack.platform == null) {
            return null;
        }

        const fromPlayList = this.playList.find(it =>
            isSameMediaItem(it, activeTrack as IMusic.IMusicItem),
        );
        if (fromPlayList) {
            return fromPlayList;
        }

        return activeTrack as IMusic.IMusicItem;
    }

    public get nextMusic() {
        const currentMusic = this.currentMusic;
        if (!currentMusic) {
            return null;
        }

        return this.getPlayListMusicAt(this.currentIndex + 1);
    }

    public get repeatMode() {
        return getDefaultStore().get(repeatModeAtom);
    }

    public get quality() {
        return getDefaultStore().get(qualityAtom);
    }

    public get playList() {
        return getDefaultStore().get(playListAtom);
    }


    injectDependencies(configService: IAppConfig, musicHistoryService: IMusicHistory, pluginManager: IPluginManager): void {
        this.configService = configService;
        this.musicHistoryService = musicHistoryService;
        this.pluginManagerService = pluginManager;
    }


    async setupTrackPlayer() {
        const rate = PersistStatus.get("music.rate");
        const musicQueue = PersistStatus.get("music.playList");
        const repeatMode = PersistStatus.get("music.repeatMode");
        const progress = PersistStatus.get("music.progress");
        const track = PersistStatus.get("music.musicItem");
        const quality =
            PersistStatus.get("music.quality") ||
            this.configService.getConfig("basic.defaultPlayQuality") ||
            "standard";

        // 状态恢复
        if (rate) {
            ReactNativeTrackPlayer.setRate(+rate / 100);
        }
        if (repeatMode) {
            getDefaultStore().set(repeatModeAtom, repeatMode as MusicRepeatMode);
        }

        if (musicQueue && Array.isArray(musicQueue)) {
            this.addAll(
                musicQueue,
                undefined,
                repeatMode === MusicRepeatMode.SHUFFLE,
            );
        }

        if (track && this.isInPlayList(track)) {
            if (!this.configService.getConfig("basic.autoPlayWhenAppStart")) {
                track.isInit = true;
            }

            // 异步
            this.pluginManagerService.getByMedia(track)
                ?.methods.getMediaSource(track, quality)
                .then(async newSource => {
                    track.url = newSource?.url || track.url;
                    track.headers = newSource?.headers || track.headers;

                    if (isSameMediaItem(this.currentMusic, track)) {
                        await this.setTrackSource(track as Track, false);
                        if (progress) {
                            // 异步
                            this.seekTo(progress);
                        }
                    }
                });
            this.setCurrentMusic(track);

            if (progress) {
                // 异步
                this.seekTo(progress);
            }
        }

        if (!this.serviceInited) {
            this.serviceInited = true;
        }
    }

    /**
     * Register EOF handlers on RNTP. Must run in the playback service context so
     * auto-next still works when the screen is locked (main-app timers are throttled).
     */
    registerPlaybackServiceHandlers(): void {
        if (this.playbackHandlersRegistered) {
            return;
        }
        this.playbackHandlersRegistered = true;

        /**
         * 此事件可能会被触发多次（比如直接替换queue） 参考代码：https://github.com/doublesymmetry/KotlinAudio
         */
        ReactNativeTrackPlayer.addEventListener(
            Event.PlaybackActiveTrackChanged,
            async evt => {
                const sentinelMatched =
                    TrackPlayer.matchesSentinelTransition(evt);
                const trackInternalKey = (
                    evt.track as (Track & { $?: string }) | undefined
                )?.$;
                await logQueueSnapshot("PlaybackActiveTrackChanged", {
                    index: evt.index,
                    lastIndex: evt.lastIndex,
                    trackUrl: evt.track?.url,
                    trackInternalKey,
                    fakeAudioUrl: TrackPlayer.fakeAudioUrl,
                    sentinelMatched,
                });
                if (sentinelMatched) {
                    await this.handlePlaybackEnded("sentinel");
                    return;
                }
                if (
                    evt.index === 1 &&
                    evt.lastIndex === 0 &&
                    TrackPlayer.isRealPlayableUrl(evt.track?.url)
                ) {
                    await this.onNativeQueueAdvancedToNext(
                        evt.track as Track,
                        "nativeRealNext",
                    );
                    return;
                }
                if (evt.index === 1 && evt.lastIndex === 0) {
                    await this.repairSentinelQueueAtIndexOne(evt);
                }
            },
        );

        ReactNativeTrackPlayer.addEventListener(
            Event.PlaybackQueueEnded,
            async evt => {
                await logQueueSnapshot("PlaybackQueueEnded", {
                    track: evt.track,
                    position: evt.position,
                });
                await this.handlePlaybackEnded("PlaybackQueueEnded");
            },
        );

        ReactNativeTrackPlayer.addEventListener(
            Event.PlaybackState,
            async playbackState => {
                if (playbackState.state !== State.Ended) {
                    return;
                }
                await logQueueSnapshot("PlaybackState:Ended");
                await this.handlePlaybackEnded("PlaybackState:Ended");
            },
        );

        ReactNativeTrackPlayer.addEventListener(
            Event.PlaybackError,
            async e => {
                errorLog("播放出错", e.message);
                await logQueueSnapshot("PlaybackError", {
                    message: e.message,
                    code: e.code,
                });
                // WARNING: 不稳定，报错的时候有可能track已经变到下一首歌去了
                const currentTrack =
                    await ReactNativeTrackPlayer.getActiveTrack();
                if (currentTrack?.isInit) {
                    // HACK: 避免初始失败的情况
                    ReactNativeTrackPlayer.updateMetadataForTrack(0, {
                        ...currentTrack,
                        // @ts-ignore
                        isInit: undefined,
                    });
                    return;
                }

                if (
                    !TrackPlayer.isSentinelUrl(currentTrack?.url) &&
                    currentTrack?.url !== TrackPlayer.proposedAudioUrl &&
                    (await ReactNativeTrackPlayer.getActiveTrackIndex()) === 0 &&
                    e.message &&
                    e.message !== "android-io-file-not-found"
                ) {
                    trace("播放出错", {
                        message: e.message,
                        code: e.code,
                    });

                    this.handlePlayFail();
                }
            },
        );
    }

    /** Called from playback service on each native progress tick (works while screen is locked). */
    tickPlaybackWatchdog(progress?: {
        position: number;
        duration: number;
    }): void {
        void this.runPlaybackWatchdog(progress);
    }

    /**************** 播放队列 ******************/
    getMusicIndexInPlayList(musicItem?: IMusic.IMusicItem | null) {
        if (!musicItem) {
            return -1;
        }
        return this.playListIndexMap.getIndex(musicItem);
    }

    isInPlayList(musicItem?: IMusic.IMusicItem | null) {
        if (!musicItem) {
            return false;
        }

        return this.playListIndexMap.has(musicItem);
    }

    getPlayListMusicAt(index: number): IMusic.IMusicItem | null {
        const playList = this.playList;
        const len = playList.length;
        if (len === 0) {
            return null;
        }
        return playList[(index + len) % len];
    }

    isPlayListEmpty() {
        return this.playList.length === 0;
    }

    /****** 播放逻辑 *****/
    addAll(
        musicItems: Array<IMusic.IMusicItem>,
        beforeIndex?: number,
        shouldShuffle?: boolean,
    ): void {
        const now = Date.now();
        let newPlayList: IMusic.IMusicItem[] = [];
        let currentPlayList = this.playList;
        musicItems.forEach((item, index) => {
            item[timeStampSymbol] = now;
            item[sortIndexSymbol] = index;
        });

        if (beforeIndex === undefined || beforeIndex < 0) {
            // 1.1. 添加到歌单末尾，并过滤掉已有的歌曲
            newPlayList = currentPlayList.concat(
                musicItems.filter(item => !this.isInPlayList(item)),
            );
        } else {
            // 1.2. 新的播放列表，插入
            const indexMap = createMediaIndexMap(musicItems);
            const beforeDraft = currentPlayList
                .slice(0, beforeIndex)
                .filter(item => !indexMap.has(item));
            const afterDraft = currentPlayList
                .slice(beforeIndex)
                .filter(item => !indexMap.has(item));

            newPlayList = [...beforeDraft, ...musicItems, ...afterDraft];
        }

        // 如果太长了
        if (newPlayList.length > TrackPlayer.maxMusicQueueLength) {
            newPlayList = this.shrinkPlayListToSize(
                newPlayList,
                beforeIndex ?? newPlayList.length - 1,
            );
        }

        // 2. 如果需要随机
        if (shouldShuffle) {
            newPlayList = shuffle(newPlayList);
        }
        // 3. 设置播放列表
        this.setPlayList(newPlayList);
    }

    add(
        musicItem: IMusic.IMusicItem | IMusic.IMusicItem[],
        beforeIndex?: number,
    ): void {
        this.addAll(
            Array.isArray(musicItem) ? musicItem : [musicItem],
            beforeIndex,
        );
    }

    addNext(musicItem: IMusic.IMusicItem | IMusic.IMusicItem[]): void {
        const shouldAutoPlay = this.isPlayListEmpty() || !this.currentMusic;

        this.add(musicItem, this.currentIndex + 1);

        if (shouldAutoPlay) {
            this.play(Array.isArray(musicItem) ? musicItem[0] : musicItem);
        }
    }

    /** Replace every queue row matching `oldItem` (same platform + id). */
    replaceMatchingMusic(
        oldItem: IMusic.IMusicItem,
        newItem: IMusic.IMusicItem,
    ): void {
        const playList = this.playList;
        let changed = false;
        const newPlayList = playList.map(row => {
            if (!isSameMediaItem(oldItem, row)) {
                return row;
            }
            changed = true;
            return {
                ...newItem,
                $timestamp: row.$timestamp,
                $sortIndex: row.$sortIndex,
                artwork: newItem.artwork || row.artwork,
            };
        });
        if (!changed) {
            return;
        }
        if (this.currentMusic && isSameMediaItem(oldItem, this.currentMusic)) {
            const idx = newPlayList.findIndex(it =>
                isSameMediaItem(it, newItem),
            );
            const current =
                idx >= 0 ? newPlayList[idx] : newPlayList[this.currentIndex];
            this.setCurrentMusic(current ?? null);
        }
        this.setPlayList(newPlayList);
    }

    /** Re-fetch media when a renamed track is currently playing (identity / path changed). */
    async refreshAfterTrackRename(
        oldItem: IMusic.IMusicItem,
        newItem: IMusic.IMusicItem,
    ): Promise<void> {
        if (!this.isCurrentMusic(newItem) && !this.isCurrentMusic(oldItem)) {
            return;
        }

        if (this.getMusicIndexInPlayList(newItem) === -1) {
            return;
        }

        const { position = 0 } = await ReactNativeTrackPlayer.getProgress();
        const playbackState = (
            await ReactNativeTrackPlayer.getPlaybackState()
        ).state;
        const wasPlaying = !musicIsPaused(playbackState);

        await this.play(newItem, false);

        if (position > 0) {
            await this.seekTo(position);
        }

        if (!wasPlaying) {
            await this.pause();
        }
    }

    async remove(musicItem: IMusic.IMusicItem): Promise<void> {
        const playList = this.playList;

        let newPlayList: IMusic.IMusicItem[] = [];
        let currentMusic: IMusic.IMusicItem | null = this.currentMusic;
        const targetIndex = this.getMusicIndexInPlayList(musicItem);
        let shouldPlayCurrent: boolean | null = null;
        if (targetIndex === -1) {
            // 1. 这种情况应该是出错了
            return;
        }
        // 2. 移除的是当前项
        if (this.currentIndex === targetIndex) {
            // 2.1 停止播放，移除当前项
            newPlayList = produce(playList, draft => {
                draft.splice(targetIndex, 1);
            });
            // 2.2 设置新的播放列表，并更新当前音乐
            if (newPlayList.length === 0) {
                currentMusic = null;
                shouldPlayCurrent = false;
            } else {
                currentMusic = newPlayList[this.currentIndex % newPlayList.length];
                try {
                    const state = (
                        await ReactNativeTrackPlayer.getPlaybackState()
                    ).state;
                    shouldPlayCurrent = !musicIsPaused(state);
                } catch {
                    shouldPlayCurrent = false;
                }
            }
            this.setCurrentMusic(currentMusic);
        } else {
            // 3. 删除
            newPlayList = produce(playList, draft => {
                draft.splice(targetIndex, 1);
            });
        }

        this.setPlayList(newPlayList);
        if (shouldPlayCurrent === true) {
            await this.play(currentMusic, true);
        } else if (shouldPlayCurrent === false) {
            await ReactNativeTrackPlayer.reset();
        }
    }

    isCurrentMusic(musicItem?: IMusic.IMusicItem | null) {
        return isSameMediaItem(musicItem, this.currentMusic);
    }

    async play(
        musicItem?: IMusic.IMusicItem | null,
        forcePlay?: boolean,
    ): Promise<void> {
        await logQueueSnapshot("play:start", {
            musicId: musicItem?.id,
            musicTitle: musicItem?.title,
            forcePlay,
        });
        try {
            // 如果不传参，默认是播放当前音乐
            if (!musicItem) {
                musicItem = this.currentMusic;
            }
            if (!musicItem) {
                throw new Error(PlayFailReason.PLAY_LIST_IS_EMPTY);
            }
            // 1. 移动网络禁止播放
            const localPath = getLocalPath(musicItem);
            if (
                Network.isCellular &&
                !this.configService.getConfig("basic.useCelluarNetworkPlay") &&
                !LocalMusicSheet.isLocalMusic(musicItem) &&
                !localPath
            ) {
                await ReactNativeTrackPlayer.reset();
                throw new Error(PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY);
            }

            // 2. 如果是当前正在播放的音频
            if (this.isCurrentMusic(musicItem)) {
                // 获取底层播放器中的track
                const currentTrack = await ReactNativeTrackPlayer.getTrack(0);
                // 2.1 如果当前有真实可播放源（非 proposed / fake 占位）
                if (
                    TrackPlayer.isRealPlayableUrl(currentTrack?.url) &&
                    isSameMediaItem(
                        musicItem,
                        currentTrack as IMusic.IMusicItem,
                    )
                ) {
                    if (forcePlay) {
                        // 2.1.1 强制重新开始
                        await this.seekTo(0);
                    }
                    const currentState = (
                        await ReactNativeTrackPlayer.getPlaybackState()
                    ).state;
                    if (currentState === State.Stopped) {
                        await this.setTrackSource(currentTrack as Track);
                    } else {
                        const realTrack = this.patchMediaArtwork(
                            currentTrack as Track,
                        );
                        if (realTrack) {
                            await this.ensureSentinelQueue(realTrack);
                        }
                        if (currentState !== State.Playing) {
                            // 2.1.2 恢复播放
                            await ReactNativeTrackPlayer.play();
                        }
                    }
                    // 这种情况下，播放队列和当前歌曲都不需要变化
                    return;
                }
                // 2.2 其他情况：重新获取源
            }

            // 3. 如果没有在播放列表中，添加到队尾；同时更新列表状态
            const inPlayList = this.isInPlayList(musicItem);
            if (!inPlayList) {
                this.add(musicItem);
            }

            // 4. 更新列表状态和当前音乐
            this.nativeQueuePrefetchToken += 1;
            this.setCurrentMusic(musicItem);
            await ReactNativeTrackPlayer.setQueue([{
                ...musicItem,
                url: TrackPlayer.proposedAudioUrl,
                artwork: resolveImportedAssetOrPath(musicItem.artwork?.trim?.()?.length ? musicItem.artwork : ImgAsset.albumDefault) as unknown as any,
            }, this.getFakeNextTrack()]);

            // 5. 获取音源
            let track: IMusic.IMusicItem;

            // 5.1 通过插件获取音源
            const plugin = this.pluginManagerService.getByName(musicItem.platform);
            // 5.2 获取音质排序
            const qualityOrder = getQualityOrder(
                this.configService.getConfig("basic.defaultPlayQuality") ?? "standard",
                this.configService.getConfig("basic.playQualityOrder") ?? "asc",
            );
            // 5.3 插件返回音源
            let source: IPlugin.IMediaSourceResult | null = null;
            for (let quality of qualityOrder) {
                if (this.isCurrentMusic(musicItem)) {
                    source =
                        (await plugin?.methods?.getMediaSource(
                            musicItem,
                            quality,
                        )) ?? null;
                    // 5.3.1 获取到真实源
                    if (source) {
                        this.setQuality(quality);
                        break;
                    }
                } else {
                    // 5.3.2 已经切换到其他歌曲了，
                    return;
                }
            }

            if (!this.isCurrentMusic(musicItem)) {
                return;
            }
            if (!source) {
                // 如果有source
                if (musicItem.source) {
                    for (let quality of qualityOrder) {
                        if (musicItem.source[quality]?.url) {
                            source = musicItem.source[quality]!;
                            this.setQuality(quality);

                            break;
                        }
                    }
                }
                // 5.4 没有返回源
                if (!source && !musicItem.url) {
                    // 插件失效的情况
                    if (this.configService.getConfig("basic.tryChangeSourceWhenPlayFail")) {
                        // 重试
                        const similarMusic = await this.getSimilarMusic(
                            musicItem,
                            "music",
                            () => !this.isCurrentMusic(musicItem),
                        );

                        if (similarMusic) {
                            const similarMusicPlugin =
                                this.pluginManagerService.getByMedia(similarMusic);

                            for (let quality of qualityOrder) {
                                if (this.isCurrentMusic(musicItem)) {
                                    source =
                                        (await similarMusicPlugin?.methods?.getMediaSource(
                                            similarMusic,
                                            quality,
                                        )) ?? null;
                                    // 5.4.1 获取到真实源
                                    if (source) {
                                        this.setQuality(quality);
                                        break;
                                    }
                                } else {
                                    // 5.4.2 已经切换到其他歌曲了，
                                    return;
                                }
                            }
                        }

                        if (!source) {
                            throw new Error(PlayFailReason.INVALID_SOURCE);
                        }
                    } else {
                        throw new Error(PlayFailReason.INVALID_SOURCE);
                    }
                } else {
                    source = {
                        url: musicItem.url,
                    };
                    this.setQuality("standard");
                }
            }

            // 6. 特殊类型源
            if (getUrlExt(source.url) === ".m3u8") {
                // @ts-ignore
                source.type = "hls";
            }
            // 7. 合并结果
            track = this.mergeTrackSource(musicItem, source) as IMusic.IMusicItem;

            // 8. 新增历史记录
            this.musicHistoryService.addMusic(musicItem);

            trace("获取音源成功", track);
            // 9. 设置音源
            await this.setTrackSource(track as Track);

            // 10. 获取补充信息
            let info: Partial<IMusic.IMusicItem> | null = null;
            try {
                info =
                    (await plugin?.methods?.getMusicInfo?.(musicItem)) ?? null;
                if (
                    (typeof info?.url === "string" && info.url.trim() === "") ||
                    (info?.url && typeof info.url !== "string")
                ) {
                    delete info.url;
                }
            } catch { }

            // 11. 设置补充信息
            if (info && this.isCurrentMusic(musicItem)) {
                const mergedTrack = this.mergeTrackSource(track, info);
                getDefaultStore().set(currentMusicAtom, mergedTrack as IMusic.IMusicItem);
                await ReactNativeTrackPlayer.updateMetadataForTrack(
                    0,
                    mergedTrack as TrackMetadataBase,
                );
            }
        } catch (e: any) {
            const message = e?.message;
            if (
                message ===
                "The player is not initialized. Call setupPlayer first."
            ) {
                await ReactNativeTrackPlayer.setupPlayer();
                // Re-apply options after the bare setupPlayer recovery, otherwise the
                // re-created player has no progressUpdateEventInterval and
                // PlaybackProgressUpdated never fires — freezing lyric line sync (and
                // other progress-driven UI) until a full restart.
                await configureTrackPlayerOptions();
                this.play(musicItem, forcePlay);
            } else if (message === PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY) {
                if (getCurrentDialog()?.name !== "SimpleDialog") {
                    showDialog("SimpleDialog", {
                        title: "流量提醒",
                        content:
                            "当前非WIFI环境，侧边栏设置中打开【使用移动网络播放】功能后可继续播放",
                    });
                }
            } else if (message === PlayFailReason.INVALID_SOURCE) {
                trace("音源为空，播放失败");
                await this.handlePlayFail();
            } else if (message === PlayFailReason.PLAY_LIST_IS_EMPTY) {
                // 队列是空的，不应该出现这种情况
            }
        } finally {
            await logQueueSnapshot("play:end", {
                musicId: musicItem?.id,
                musicTitle: musicItem?.title,
            });
        }
    }

    async pause(): Promise<void> {
        await ReactNativeTrackPlayer.pause();
    }

    toggleRepeatMode(): void {
        this.setRepeatMode(TrackPlayer.toggleRepeatMapping[this.repeatMode]);
    }

    // 清空播放队列
    async clearPlayList(): Promise<void> {
        this.setPlayList([]);
        this.setCurrentMusic(null);

        await ReactNativeTrackPlayer.reset();
        PersistStatus.set("music.musicItem", undefined);
        PersistStatus.set("music.progress", 0);
    }

    async skipToNext(): Promise<void> {
        await logQueueSnapshot("skipToNext:start");
        try {
            if (this.isPlayListEmpty()) {
                this.setCurrentMusic(null);
                return;
            }

            await this.play(this.getPlayListMusicAt(this.currentIndex + 1), true);
        } finally {
            await logQueueSnapshot("skipToNext:end");
        }
    }

    async skipToPrevious(): Promise<void> {
        if (this.isPlayListEmpty()) {
            this.setCurrentMusic(null);
            return;
        }

        await this.play(
            this.getPlayListMusicAt(this.currentIndex === -1 ? 0 : this.currentIndex - 1),
            true,
        );
    }

    async changeQuality(newQuality: IMusic.IQualityKey): Promise<boolean> {
        // 获取当前的音乐和进度
        if (newQuality === this.quality) {
            return true;
        }

        // 获取当前歌曲
        const musicItem = this.currentMusic;
        if (!musicItem) {
            return false;
        }
        try {
            const progress = await ReactNativeTrackPlayer.getProgress();
            const plugin = this.pluginManagerService.getByMedia(musicItem);
            const newSource = await plugin?.methods?.getMediaSource(
                musicItem,
                newQuality,
            );
            if (!newSource?.url) {
                throw new Error(PlayFailReason.INVALID_SOURCE);
            }
            if (this.isCurrentMusic(musicItem)) {
                const playingState = (
                    await ReactNativeTrackPlayer.getPlaybackState()
                ).state;
                await this.setTrackSource(
                    this.mergeTrackSource(musicItem, newSource) as unknown as Track,
                    !musicIsPaused(playingState),
                );

                await this.seekTo(progress.position ?? 0);
                this.setQuality(newQuality);
            }
            return true;
        } catch {
            // 修改失败
            return false;
        }
    }

    async playWithReplacePlayList(
        musicItem: IMusic.IMusicItem,
        newPlayList: IMusic.IMusicItem[],
    ): Promise<void> {
        if (newPlayList.length !== 0) {
            const now = Date.now();
            if (newPlayList.length > TrackPlayer.maxMusicQueueLength) {
                newPlayList = this.shrinkPlayListToSize(
                    newPlayList,
                    newPlayList.findIndex(it => isSameMediaItem(it, musicItem)),
                );
            }

            newPlayList.forEach((it, index) => {
                it[timeStampSymbol] = now;
                it[sortIndexSymbol] = index;
            });

            this.setPlayList(
                this.repeatMode === MusicRepeatMode.SHUFFLE
                    ? shuffle(newPlayList)
                    : newPlayList,
            );
            await this.play(musicItem, true);
        }
    }

    async seekTo(progress: number) {
        PersistStatus.set("music.progress", progress);
        return ReactNativeTrackPlayer.seekTo(progress);
    }

    getProgress = ReactNativeTrackPlayer.getProgress;
    getRate = ReactNativeTrackPlayer.getRate;
    setRate = ReactNativeTrackPlayer.setRate;
    reset = ReactNativeTrackPlayer.reset;


    /**************** 辅助函数 -- 设置内部状态 ****************/

    private setCurrentMusic(musicItem?: IMusic.IMusicItem | null) {
        // 设置UI内部状态的musicitem
        if (!musicItem) {
            this.currentIndex = -1;
            getDefaultStore().set(currentMusicAtom, null);
            PersistStatus.set("music.musicItem", undefined);
            PersistStatus.set("music.progress", 0);

            this.emit(TrackPlayerEvents.CurrentMusicChanged, null);
            return;
        }
        if (typeof musicItem.artwork !== "string") {
            musicItem.artwork = ImgAsset.albumDefault;
        }
        this.currentIndex = this.getMusicIndexInPlayList(musicItem);
        getDefaultStore().set(currentMusicAtom, musicItem);

        this.emit(TrackPlayerEvents.CurrentMusicChanged, musicItem);
    }

    private setRepeatMode(mode: MusicRepeatMode) {
        const playList = this.playList;
        let newPlayList: IMusic.IMusicItem[];
        const prevMode = getDefaultStore().get(repeatModeAtom);
        if (
            (prevMode === MusicRepeatMode.SHUFFLE &&
                mode !== MusicRepeatMode.SHUFFLE) ||
            (mode === MusicRepeatMode.SHUFFLE &&
                prevMode !== MusicRepeatMode.SHUFFLE)
        ) {
            if (mode === MusicRepeatMode.SHUFFLE) {
                newPlayList = shuffle(playList);
            } else {
                newPlayList = this.sortByTimestampAndIndex(playList, true);
            }
            this.setPlayList(newPlayList);
        }

        getDefaultStore().set(repeatModeAtom, mode);
        // 更新下一首歌的信息
        ReactNativeTrackPlayer.updateMetadataForTrack(
            1,
            this.getFakeNextTrack(),
        );
        // 记录
        PersistStatus.set("music.repeatMode", mode);
    }

    private setQuality(quality: IMusic.IQualityKey) {
        getDefaultStore().set(qualityAtom, quality);
        PersistStatus.set("music.quality", quality);
    }

    // 设置音源
    private async setTrackSource(track: Track, autoPlay = true) {
        await logQueueSnapshot("setTrackSource:start", {
            trackUrl: track.url,
            autoPlay,
        });
        try {
            const clonedTrack = this.patchMediaArtwork(track);
            if (!clonedTrack) {
                return;
            }
            await this.ensureSentinelQueue(clonedTrack);
            PersistStatus.set("music.musicItem", track as IMusic.IMusicItem);
            PersistStatus.set("music.progress", 0);
            if (autoPlay) {
                await ReactNativeTrackPlayer.play();
            }
        } finally {
            await logQueueSnapshot("setTrackSource:end", {
                trackUrl: track.url,
                autoPlay,
            });
        }
    }

    /**
     * 设置播放队列
     * @param newPlayList 播放队列
     * @param persist 是否持久化
     */
    private setPlayList(newPlayList: IMusic.IMusicItem[], persist = true) {
        getDefaultStore().set(playListAtom, newPlayList);

        this.playListIndexMap = createMediaIndexMap(newPlayList);

        if (persist) {
            PersistStatus.set("music.playList", newPlayList);
        }

        this.currentIndex = this.getMusicIndexInPlayList(this.currentMusic);
    }


    /**************** 辅助函数 -- 工具方法 ****************/
    private shrinkPlayListToSize = (
        queue: IMusic.IMusicItem[],
        targetIndex = this.currentIndex,
    ) => {
        // 播放列表上限，太多无法缓存状态
        if (queue.length > TrackPlayer.maxMusicQueueLength) {
            if (targetIndex < TrackPlayer.halfMaxMusicQueueLength) {
                queue = queue.slice(0, TrackPlayer.maxMusicQueueLength);
            } else {
                const right = Math.min(
                    queue.length,
                    targetIndex + TrackPlayer.halfMaxMusicQueueLength,
                );
                const left = Math.max(0, right - TrackPlayer.maxMusicQueueLength);
                queue = queue.slice(left, right);
            }
        }
        return queue;
    };

    private mergeTrackSource(
        mediaItem: ICommon.IMediaBase,
        props: Record<string, any> | undefined,
    ) {
        return props
            ? {
                ...mediaItem,
                ...props,
                id: mediaItem.id,
                platform: mediaItem.platform,
            }
            : mediaItem;
    }

    private sortByTimestampAndIndex(array: any[], newArray = false) {
        if (newArray) {
            array = [...array];
        }
        return array.sort((a, b) => {
            const ts = a[timeStampSymbol] - b[timeStampSymbol];
            if (ts !== 0) {
                return ts;
            }
            return a[sortIndexSymbol] - b[sortIndexSymbol];
        });
    }

    private static isSentinelUrl(url?: string): boolean {
        return (
            url === TrackPlayer.fakeAudioUrl || url === legacyFakeAudioUrl
        );
    }

    private static isRealPlayableUrl(url?: string): boolean {
        return Boolean(
            url &&
            !TrackPlayer.isSentinelUrl(url) &&
            url !== TrackPlayer.proposedAudioUrl,
        );
    }

    private static isSentinelTrack(track?: Track | null): boolean {
        if (!track) {
            return false;
        }
        const extended = track as Track & { $?: string };
        return (
            TrackPlayer.isSentinelUrl(track.url) ||
            extended.$ === internalFakeSoundKey
        );
    }

    private static matchesSentinelTransition(evt: {
        index?: number;
        lastIndex?: number;
        track?: Track;
    }): boolean {
        return (
            evt.index === 1 &&
            evt.lastIndex === 0 &&
            TrackPlayer.isSentinelTrack(evt.track)
        );
    }

    /**
     * RNTP only holds [now playing, tail]. The app playlist is authoritative;
     * tail should be the real next song when possible so the native player can
     * advance without the fake sentinel (see prefetchAndUpdateNativeQueueTail).
     */
    private async ensureSentinelQueue(realTrack: Track): Promise<void> {
        const queue = await ReactNativeTrackPlayer.getQueue();
        const expectedNext =
            this.repeatMode === MusicRepeatMode.SINGLE
                ? null
                : this.getPlayListMusicAt(this.currentIndex + 1);
        const tailIsPrefetchedReal =
            expectedNext &&
            queue[1] &&
            TrackPlayer.isRealPlayableUrl(queue[1].url) &&
            isSameMediaItem(queue[1] as IMusic.IMusicItem, expectedNext);
        const needsRepair =
            queue.length !== 2 ||
            queue[0]?.url !== realTrack.url ||
            (!tailIsPrefetchedReal &&
                !TrackPlayer.isSentinelUrl(queue[1]?.url));
        if (needsRepair) {
            await ReactNativeTrackPlayer.setQueue([
                realTrack,
                this.getFakeNextTrack(),
            ]);
        }
        const activeIndex =
            await ReactNativeTrackPlayer.getActiveTrackIndex();
        if (activeIndex !== 0) {
            await ReactNativeTrackPlayer.skip(0);
        }
        const anchor = this.currentMusic;
        if (anchor && this.repeatMode !== MusicRepeatMode.SINGLE) {
            void this.prefetchAndUpdateNativeQueueTail(anchor, realTrack);
        }
    }

    private async resolveMediaSourceForItem(
        musicItem: IMusic.IMusicItem,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        const plugin = this.pluginManagerService.getByName(musicItem.platform);
        const qualityOrder = getQualityOrder(
            this.configService.getConfig("basic.defaultPlayQuality") ??
                "standard",
            this.configService.getConfig("basic.playQualityOrder") ?? "asc",
        );
        for (const quality of qualityOrder) {
            const source =
                (await plugin?.methods?.getMediaSource(musicItem, quality)) ??
                null;
            if (source?.url) {
                return source;
            }
        }
        if (musicItem.source) {
            for (const quality of qualityOrder) {
                if (musicItem.source[quality]?.url) {
                    return musicItem.source[quality]!;
                }
            }
        }
        if (musicItem.url) {
            return { url: musicItem.url };
        }
        return null;
    }

    /** Put the real next app-playlist track at RNTP index 1 so EOF can advance natively. */
    private async prefetchAndUpdateNativeQueueTail(
        anchorItem: IMusic.IMusicItem,
        track0: Track,
    ): Promise<void> {
        if (this.repeatMode === MusicRepeatMode.SINGLE) {
            return;
        }
        const token = this.nativeQueuePrefetchToken;
        const anchorIndex = this.getMusicIndexInPlayList(anchorItem);
        const nextItem = this.getPlayListMusicAt(anchorIndex + 1);
        if (!nextItem) {
            return;
        }

        const source = await this.resolveMediaSourceForItem(nextItem);
        if (token !== this.nativeQueuePrefetchToken) {
            return;
        }
        if (!this.isCurrentMusic(anchorItem)) {
            return;
        }
        const stillNext = this.getPlayListMusicAt(this.currentIndex + 1);
        if (!stillNext || !isSameMediaItem(nextItem, stillNext)) {
            return;
        }
        if (!source?.url) {
            return;
        }

        let track1 = this.mergeTrackSource(nextItem, source) as IMusic.IMusicItem;
        if (getUrlExt(source.url) === ".m3u8") {
            // @ts-ignore
            track1 = { ...track1, type: "hls" };
        }
        const patchedNext = this.patchMediaArtwork(track1 as Track);
        if (!patchedNext) {
            return;
        }

        const activeIndex =
            await ReactNativeTrackPlayer.getActiveTrackIndex();
        if (activeIndex !== 0) {
            return;
        }
        const queue = await ReactNativeTrackPlayer.getQueue();
        if (
            queue.length !== 2 ||
            !isSameMediaItem(queue[0] as IMusic.IMusicItem, anchorItem)
        ) {
            return;
        }

        await ReactNativeTrackPlayer.setQueue([track0, patchedNext]);
        await logQueueSnapshot("prefetchNativeQueueTail", {
            anchorId: anchorItem.id,
            nextId: nextItem.id,
            nextUrl: patchedNext.url,
        });
    }

    /** RNTP advanced to a prefetched real track; sync app playlist index / UI. */
    private async onNativeQueueAdvancedToNext(
        track: Track,
        reason: string,
    ): Promise<void> {
        if (this.isAdvancingQueue) {
            return;
        }
        const expectedNext = this.getPlayListMusicAt(this.currentIndex + 1);
        if (
            !expectedNext ||
            !isSameMediaItem(track as IMusic.IMusicItem, expectedNext)
        ) {
            return;
        }

        this.isAdvancingQueue = true;
        try {
            this.emit(TrackPlayerEvents.PlayEnd);
            this.musicHistoryService.addMusic(expectedNext);
            this.setCurrentMusic(expectedNext);
            trace(
                "nativeQueueAdvanced",
                JSON.stringify({
                    reason,
                    id: expectedNext.id,
                    title: expectedNext.title,
                }),
            );
        } finally {
            this.isAdvancingQueue = false;
        }
    }

    private getFakeNextTrack() {
        let track: Track | undefined;
        const repeatMode = this.repeatMode;
        if (repeatMode === MusicRepeatMode.SINGLE) {
            // 单曲循环
            track = this.getPlayListMusicAt(this.currentIndex) as Track;
        } else {
            // 下一曲
            track = this.getPlayListMusicAt(this.currentIndex + 1) as Track;
        }

        if (track) {
            return produce(track, _ => {
                _.url = TrackPlayer.fakeAudioUrl;
                _.$ = internalFakeSoundKey;
                _.artwork = resolveImportedAssetOrPath(ImgAsset.albumDefault) as unknown as any;
            });
        } else {
            // 只有列表长度为0时才会出现的特殊情况
            return {
                url: TrackPlayer.fakeAudioUrl,
                $: internalFakeSoundKey,
            } as Track;
        }
    }


    private async handlePlayFail() {
        // 如果自动跳转下一曲, 500s后自动跳转
        if (!this.configService.getConfig("basic.autoStopWhenError")) {
            await delay(500);
            await this.skipToNext();
        }
    }

    /**
     * EOF fallback when the fake-sentinel track never becomes active (e.g. plugin
     * stream reloads index 0 at end). Skip when active URL is fake/proposed unless
     * `reason === "sentinel"` (PlaybackActiveTrackChanged on the fake track).
     */
    private async handlePlaybackEnded(reason: string): Promise<void> {
        if (this.isAdvancingQueue) {
            return;
        }

        const activeTrack = await ReactNativeTrackPlayer.getActiveTrack();
        const activeIndex =
            await ReactNativeTrackPlayer.getActiveTrackIndex();
        const playbackState = (
            await ReactNativeTrackPlayer.getPlaybackState()
        ).state;
        if (
            shouldSkipPlaybackEndedFallback({
                reason,
                activeUrl: activeTrack?.url,
                activeIndex,
                state: playbackState,
                proposedAudioUrl: TrackPlayer.proposedAudioUrl,
                isSentinelUrl: TrackPlayer.isSentinelUrl,
            })
        ) {
            return;
        }

        if (this.isPlayListEmpty() || !this.currentMusic) {
            return;
        }

        const fromSentinel = reason === "sentinel";

        await logQueueSnapshot("handlePlaybackEnded", { reason });
        if (fromSentinel) {
            trace("队列末尾，播放下一首");
        }
        trace(
            "handlePlaybackEnded",
            JSON.stringify({
                reason,
                repeatMode: this.repeatMode,
                currentIndex: this.currentIndex,
                playListLength: this.playList.length,
            }),
        );

        this.isAdvancingQueue = true;
        try {
            this.emit(TrackPlayerEvents.PlayEnd);
            if (this.repeatMode === MusicRepeatMode.SINGLE) {
                await this.play(null, true);
            } else {
                await this.skipToNext();
            }
        } finally {
            this.isAdvancingQueue = false;
        }
    }

    private resetWatchdogTimingState(): void {
        this.nearEndSince = null;
        this.positionStallSince = null;
        this.lastWatchdogPosition = null;
        this.sentinelStuckSince = null;
    }

    private async runPlaybackWatchdog(progressHint?: {
        position: number;
        duration: number;
    }): Promise<void> {
        if (this.isAdvancingQueue || this.isPlayListEmpty()) {
            this.resetWatchdogTimingState();
            return;
        }

        try {
            const now = Date.now();
            const [activeIndex, playbackState, activeTrack] = await Promise.all([
                ReactNativeTrackPlayer.getActiveTrackIndex(),
                ReactNativeTrackPlayer.getPlaybackState(),
                ReactNativeTrackPlayer.getActiveTrack(),
            ]);
            const state = playbackState.state;
            let position: number;
            let duration: number;
            if (progressHint) {
                position = progressHint.position;
                duration = progressHint.duration;
            } else {
                const progress = await ReactNativeTrackPlayer.getProgress();
                position = progress.position;
                duration = progress.duration;
            }
            const activeUrl = activeTrack?.url;

            if (
                activeIndex === 1 &&
                TrackPlayer.isSentinelUrl(activeUrl) &&
                (state === State.Loading || state === State.Buffering)
            ) {
                if (this.sentinelStuckSince === null) {
                    this.sentinelStuckSince = now;
                }
            } else {
                this.sentinelStuckSince = null;
            }

            if (isNearEndOfTrack(position, duration)) {
                if (this.nearEndSince === null) {
                    this.nearEndSince = now;
                }
                if (
                    this.lastWatchdogPosition !== null &&
                    Math.abs(position - this.lastWatchdogPosition) < 0.05
                ) {
                    if (this.positionStallSince === null) {
                        this.positionStallSince = now;
                    }
                } else {
                    this.positionStallSince = null;
                }
            } else {
                this.nearEndSince = null;
                this.positionStallSince = null;
            }
            this.lastWatchdogPosition = position;

            const playListLength = this.playList.length;
            let watchdogReason: string | null = null;

            if (
                shouldTriggerSentinelStuckWatchdog({
                    activeIndex,
                    activeUrl,
                    state,
                    isSentinelUrl: TrackPlayer.isSentinelUrl,
                    stuckSince: this.sentinelStuckSince,
                    now,
                })
            ) {
                watchdogReason = "watchdog:sentinelStuck";
            } else if (
                shouldTriggerEofWatchdog({
                    activeIndex,
                    state,
                    position,
                    duration,
                    playListLength,
                    nearEndSince: this.nearEndSince,
                    positionStallSince: this.positionStallSince,
                    now,
                })
            ) {
                watchdogReason = "watchdog:eofStuck";
            }

            if (watchdogReason) {
                await logQueueSnapshot(watchdogReason, {
                    position,
                    duration,
                    state,
                    activeIndex,
                    activeUrl,
                });
                await this.handlePlaybackEnded(watchdogReason);
            }
        } catch {
            // Ignore transient RNTP read failures during watchdog tick.
        }
    }

    /** Index 1 reached but track is not the fake sentinel — repair queue only. */
    private async repairSentinelQueueAtIndexOne(evt: {
        track?: Track;
    }): Promise<void> {
        const trackUrl = evt.track?.url;
        if (
            trackUrl !== TrackPlayer.proposedAudioUrl &&
            !TrackPlayer.isRealPlayableUrl(trackUrl)
        ) {
            return;
        }

        trace(
            "PlaybackActiveTrackChanged:sentinelMismatch",
            JSON.stringify({
                trackUrl,
                proposedAudioUrl: TrackPlayer.proposedAudioUrl,
            }),
        );

        const track0 = await ReactNativeTrackPlayer.getTrack(0);
        if (
            !track0 ||
            !TrackPlayer.isRealPlayableUrl(track0.url) ||
            !isSameMediaItem(track0 as IMusic.IMusicItem, this.currentMusic)
        ) {
            return;
        }

        const realTrack = this.patchMediaArtwork(track0 as Track);
        if (realTrack) {
            await this.ensureSentinelQueue(realTrack);
        }
    }

    /**
 *
 * @param musicItem 音乐类型
 * @param type 媒体类型
 * @param abortFunction 如果函数为true，则中断
 * @returns
 */
    private async getSimilarMusic<T extends ICommon.SupportMediaType>(
        musicItem: IMusic.IMusicItem,
        type: T = "music" as T,
        abortFunction?: () => boolean,
    ): Promise<ICommon.SupportMediaItemBase[T] | null> {
        const keyword = musicItem.alias || musicItem.title;
        const plugins = this.pluginManagerService.getSearchablePlugins(type);

        let distance = Infinity;
        let minDistanceMusicItem;
        let targetPlugin;

        const startTime = Date.now();

        for (let plugin of plugins) {
            // 超时时间：8s
            if (abortFunction?.() || Date.now() - startTime > 8000) {
                break;
            }
            if (plugin.name === musicItem.platform) {
                continue;
            }
            const results = await plugin.methods
                .search(keyword, 1, type)
                .catch(() => null);

            // 取前两个
            const firstTwo = results?.data?.slice(0, 2) || [];

            for (let item of firstTwo) {
                if (item.title === keyword && item.artist === musicItem.artist) {
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
            return minDistanceMusicItem as ICommon.SupportMediaItemBase[T];
        }

        return null;
    }


    private patchMediaArtwork(track: Track) {
        // Bug: React native track player 在设置音频时，artwork不能为null，并且部分情况下artwork不能为ImageSource类型
        if (!track) {
            return null;
        }
        return {
            ...track,
            artwork: resolveImportedAssetOrPath(
                track.artwork?.trim?.()?.length ? track.artwork : ImgAsset.albumDefault,
            ) as unknown as any,
        };
    }

}

export const usePlayList = () => useAtomValue(playListAtom);
export const useCurrentMusic = () => useAtomValue(currentMusicAtom);
export const useRepeatMode = () => useAtomValue(repeatModeAtom);
export const useMusicQuality = () => useAtomValue(qualityAtom);
export function useMusicState() {
    const playbackState = usePlaybackState();

    return playbackState.state;
}
export { State as MusicState, useProgress };

enum PlayFailReason {
    /** 禁止移动网络播放 */
    FORBID_CELLUAR_NETWORK_PLAY = "FORBID_CELLUAR_NETWORK_PLAY",
    /** 播放列表为空 */
    PLAY_LIST_IS_EMPTY = "PLAY_LIST_IS_EMPTY",
    /** 无效源 */
    INVALID_SOURCE = "INVALID_SOURCE",
    /** 非当前音乐 */
}

const trackPlayer = new TrackPlayer();
export default trackPlayer;