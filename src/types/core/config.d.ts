import type { ResumeMode, SortType } from "@/constants/commonConst.ts";
import type { CustomizedColors } from "@/hooks/useColors";

export interface IAppConfigProperties {
    $schema: "4";
    // Basic
    "basic.autoPlayWhenAppStart": boolean;
    "basic.useCelluarNetworkPlay": boolean;
    "basic.useCelluarNetworkDownload": boolean;
    "basic.maxDownload": number;
    "basic.clickMusicInSearch": "playMusic" | "playMusicAndReplace";
    "basic.clickMusicInAlbum": "playAlbum" | "playMusic";
    "basic.downloadPath": string;
    /** Where completed downloads are stored; `webdav` uses WebDAV plugin folder (Phase 2). */
    "basic.downloadDestination": "local" | "webdav";
    "basic.notInterrupt": boolean;
    "basic.tempRemoteDuck": "pause" | "lowerVolume";
    "basic.tempRemoteDuckVolume": 0.3 | 0.5 | 0.8;
    "basic.autoStopWhenError": boolean;
    "basic.pluginCacheControl": string;
    "basic.maxCacheSize": number;
    "basic.defaultPlayQuality": IMusic.IQualityKey;
    "basic.playQualityOrder": "asc" | "desc";
    "basic.defaultDownloadQuality": IMusic.IQualityKey;
    "basic.downloadQualityOrder": "asc" | "desc";
    "basic.musicDetailDefault": "album" | "lyric";
    "basic.musicDetailAwake": boolean;
    "basic.maxHistoryLen": number;
    "basic.autoUpdatePlugin": boolean;
    "basic.notCheckPluginVersion": boolean;
    "basic.lazyLoadPlugin": boolean;
    "basic.associateLyricType": "input" | "search";
    "basic.showExitOnNotification": boolean;
    "basic.musicOrderInLocalSheet": SortType;
    "basic.tryChangeSourceWhenPlayFail": boolean;
    /** Background cache remote tracks after successful online play. */
    "basic.autoCachePlayedRemoteMusic": boolean;
    /** Master toggle for offline remote playback file cache reads. */
    "basic.remotePlaybackCacheEnabled": boolean;

    // Lyric
    "lyric.showStatusBarLyric": boolean;
    "lyric.topPercent": number;
    "lyric.leftPercent": number;
    "lyric.align": number;
    "lyric.color": string;
    "lyric.backgroundColor": string;
    "lyric.widthPercent": number;
    "lyric.fontSize": number;
    "lyric.detailFontSize": number;
    "lyric.autoSearchLyric": boolean;
    /** Desktop overlay: 1 = current line; 2 = current + next; 3 = current + next two */
    "lyric.desktopLineCount": 1 | 2 | 3;
    /** Force desktop lyrics off on process cold start (not background resume) */
    "lyric.resetDesktopLyricOnStartup": boolean;

    // Theme
    "theme.background": string;
    "theme.backgroundOpacity": number;
    "theme.backgroundBlur": number;
    "theme.colors": CustomizedColors;
    "theme.customColors"?: CustomizedColors;
    "theme.followSystem": boolean;
    "theme.selectedTheme": string;

    // Backup
    "backup.resumeMode": ResumeMode;
    "backup.webdav.url": string;
    "backup.webdav.rootPath": string;
    "backup.webdav.username": string;
    "backup.webdav.password": string;
    "backup.remote.musicPath": string;
    "backup.remote.pcloud.hostname": string;
    "backup.remote.pcloud.tokenJson": string;
    "backup.remote.autoSync": boolean;
    "backup.remote.pendingPush": boolean;
    "backup.remote.lastSuccessfulPushAt"?: number;
    "backup.remote.backupSourceDeviceId"?: string;

    // Plugin
    "plugin.subscribeUrl": string;

    // WebDAV (legacy; read shim only — migrate to backup.webdav.* / backup.remote.*)
    "webdav.url": string;
    "webdav.username": string;
    "webdav.password": string;
    "webdav.autoSync": boolean;
    /** Dirty local snapshot not yet reflected on remote storage. */
    "webdav.pendingPush": boolean;
    "webdav.lastSuccessfulPushAt"?: number;
    /** Stable id per install; written on first WebDAV upload that attaches syncMeta. */
    "webdav.backupSourceDeviceId"?: string;

    // Debug（保持嵌套结构）
    "debug.errorLog": boolean;
    "debug.traceLog": boolean;
    "debug.devLog": boolean;
}

export type AppConfigPropertyKey = keyof IAppConfigProperties;

export interface IAppConfig<T extends IAppConfigProperties = IAppConfigProperties> {
    setup(): Promise<void>;

    setConfig<K extends keyof T>(key: K, value?: T[K]): void;

    getConfig<K extends keyof T>(key: K): T[K] | undefined;
}