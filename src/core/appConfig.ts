import { useMMKVObject } from "react-native-mmkv";

import { getStorage, removeStorage } from "@/utils/storage";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV.ts";
import { buildLegacyRemoteConfigMigration } from "@/core/remote-storage/migrate-legacy-config";
import {
    normalizeRemoteConfigPatch,
    REMOTE_MUSIC_PLUGIN_PLATFORM,
    type RemoteConfigSnapshot,
} from "@/core/remote-storage/remote-config";
import pluginMeta from "@/core/pluginManager/meta";

import type { AppConfigPropertyKey, IAppConfig, IAppConfigProperties } from "@/types/core/config";
import { safeStringify } from "@/utils/jsonUtil";

const configStore = getOrCreateMMKV("App.config");

const REMOTE_CONFIG_KEYS = new Set<AppConfigPropertyKey>([
    "backup.webdav.url",
    "backup.webdav.rootPath",
    "backup.webdav.username",
    "backup.webdav.password",
    "backup.remote.musicPath",
    "backup.remote.pcloud.hostname",
    "backup.remote.pcloud.tokenJson",
    "backup.remote.autoSync",
    "backup.remote.pendingPush",
    "backup.remote.lastSuccessfulPushAt",
    "backup.remote.backupSourceDeviceId",
    "webdav.url",
    "webdav.username",
    "webdav.password",
    "webdav.autoSync",
    "webdav.pendingPush",
    "webdav.lastSuccessfulPushAt",
    "webdav.backupSourceDeviceId",
]);

class AppConfig implements IAppConfig {
    // 迁移函数
    private async migrateConfig(): Promise<void> {

        const schemaVersion = !configStore.contains("$schema") ? 0 : parseInt(configStore.getString("$schema") || "0", 10);

        if (schemaVersion < 1) {
            // 获取旧配置
            const oldConfig = await getStorage("local-config");

            // 如果没有旧配置，直接初始化新配置
            if (!oldConfig) {
                configStore.set("$schema", "1");
                return;
            }

            // 迁移每个字段
            const mapping: [string, AppConfigPropertyKey][] = [
                // Basic
                [
                    "setting.basic.autoPlayWhenAppStart",
                    "basic.autoPlayWhenAppStart",
                ],
                [
                    "setting.basic.useCelluarNetworkPlay",
                    "basic.useCelluarNetworkPlay",
                ],
                [
                    "setting.basic.useCelluarNetworkDownload",
                    "basic.useCelluarNetworkDownload",
                ],
                ["setting.basic.maxDownload", "basic.maxDownload"],
                ["setting.basic.clickMusicInSearch", "basic.clickMusicInSearch"],
                ["setting.basic.clickMusicInAlbum", "basic.clickMusicInAlbum"],
                ["setting.basic.downloadPath", "basic.downloadPath"],
                ["setting.basic.notInterrupt", "basic.notInterrupt"],
                ["setting.basic.tempRemoteDuck", "basic.tempRemoteDuck"],
                ["setting.basic.autoStopWhenError", "basic.autoStopWhenError"],
                ["setting.basic.pluginCacheControl", "basic.pluginCacheControl"],
                ["setting.basic.maxCacheSize", "basic.maxCacheSize"],
                ["setting.basic.defaultPlayQuality", "basic.defaultPlayQuality"],
                ["setting.basic.playQualityOrder", "basic.playQualityOrder"],
                [
                    "setting.basic.defaultDownloadQuality",
                    "basic.defaultDownloadQuality",
                ],
                [
                    "setting.basic.downloadQualityOrder",
                    "basic.downloadQualityOrder",
                ],
                ["setting.basic.musicDetailDefault", "basic.musicDetailDefault"],
                ["setting.basic.musicDetailAwake", "basic.musicDetailAwake"],
                ["setting.basic.debug.errorLog", "debug.errorLog"],
                ["setting.basic.debug.traceLog", "debug.traceLog"],
                ["setting.basic.debug.devLog", "debug.devLog"],
                ["setting.basic.maxHistoryLen", "basic.maxHistoryLen"],
                ["setting.basic.autoUpdatePlugin", "basic.autoUpdatePlugin"],
                [
                    "setting.basic.notCheckPluginVersion",
                    "basic.notCheckPluginVersion",
                ],
                ["setting.basic.associateLyricType", "basic.associateLyricType"],
                [
                    "setting.basic.showExitOnNotification",
                    "basic.showExitOnNotification",
                ],
                [
                    "setting.basic.musicOrderInLocalSheet",
                    "basic.musicOrderInLocalSheet",
                ],
                [
                    "setting.basic.tryChangeSourceWhenPlayFail",
                    "basic.tryChangeSourceWhenPlayFail",
                ],

                // Lyric
                ["setting.lyric.showStatusBarLyric", "lyric.showStatusBarLyric"],
                ["setting.lyric.topPercent", "lyric.topPercent"],
                ["setting.lyric.leftPercent", "lyric.leftPercent"],
                ["setting.lyric.align", "lyric.align"],
                ["setting.lyric.color", "lyric.color"],
                ["setting.lyric.backgroundColor", "lyric.backgroundColor"],
                ["setting.lyric.widthPercent", "lyric.widthPercent"],
                ["setting.lyric.fontSize", "lyric.fontSize"],
                ["setting.lyric.detailFontSize", "lyric.detailFontSize"],
                ["setting.lyric.autoSearchLyric", "lyric.autoSearchLyric"],

                // Theme
                ["setting.theme.background", "theme.background"],
                ["setting.theme.backgroundOpacity", "theme.backgroundOpacity"],
                ["setting.theme.backgroundBlur", "theme.backgroundBlur"],
                ["setting.theme.colors", "theme.colors"],
                ["setting.theme.customColors", "theme.customColors"],
                ["setting.theme.followSystem", "theme.followSystem"],
                ["setting.theme.selectedTheme", "theme.selectedTheme"],

                // Backup
                ["setting.backup.resumeMode", "backup.resumeMode"],

                // Plugin
                ["setting.plugin.subscribeUrl", "plugin.subscribeUrl"],

                // WebDAV
                ["setting.webdav.url", "webdav.url"],
                ["setting.webdav.username", "webdav.username"],
                ["setting.webdav.password", "webdav.password"],
            ];

            // 执行迁移
            function getPathValue(obj: Record<string, any>, path: string) {
                const keys = path.split(".");
                let tmp = obj;
                for (let i = 0; i < keys.length; ++i) {
                    tmp = tmp?.[keys[i]];
                }
                return tmp;
            }

            mapping.forEach(([oldPath, newKey]) => {
                const value = getPathValue(oldConfig, oldPath);
                if (value !== undefined) {
                    configStore.set(newKey, safeStringify(value));
                }
            });

            // 设置版本标识
            configStore.set("$schema", "1");

            // 清理旧配置
            await removeStorage("local-config"); // 根据需求决定是否删除旧配置
        }

        if (schemaVersion < 2) {
            // @ts-expect-error 兼容旧版本
            if (this.getConfig("basic.clickMusicInSearch") === "播放歌曲") {
                this.setConfig("basic.clickMusicInSearch", "playMusic");
            } else {
                this.setConfig("basic.clickMusicInSearch", "playMusicAndReplace");
            }

            // @ts-expect-error 兼容旧版本
            if (this.getConfig("basic.clickMusicInAlbum") === "播放专辑") {
                this.setConfig("basic.clickMusicInAlbum", "playAlbum");
            } else {
                this.setConfig("basic.clickMusicInAlbum", "playMusic");
            }

            // @ts-expect-error 兼容旧版本
            if (this.getConfig("basic.tempRemoteDuck") === "暂停") {
                this.setConfig("basic.tempRemoteDuck", "pause");
            } else {
                this.setConfig("basic.tempRemoteDuck", "lowerVolume");
            }

            configStore.set("$schema", "2");
        }

        if (schemaVersion < 3) {
            if (this.getConfig("basic.downloadDestination") === undefined) {
                this.setConfig("basic.downloadDestination", "local");
            }
            configStore.set("$schema", "3");
        }

        if (schemaVersion < 4) {
            if (this.getConfig("lyric.desktopLineCount") === undefined) {
                this.setConfig("lyric.desktopLineCount", 1);
            }
            if (this.getConfig("lyric.resetDesktopLyricOnStartup") === undefined) {
                this.setConfig("lyric.resetDesktopLyricOnStartup", false);
            }
            configStore.set("$schema", "4");
        }

        if (schemaVersion < 5) {
            const rawKeys = new Set(
                configStore
                    .getAllKeys()
                    .filter((key) => key !== "$schema"),
            );
            const snapshot = this.getConfigSnapshot(rawKeys);
            const { patch, migrated } = buildLegacyRemoteConfigMigration(
                snapshot,
                {
                    rawKeys,
                    pluginUserVariables: pluginMeta.getUserVariables(
                        REMOTE_MUSIC_PLUGIN_PLATFORM,
                    ),
                },
            );
            if (migrated) {
                for (const [key, value] of Object.entries(patch)) {
                    configStore.set(key, safeStringify(value));
                }
            }
            if (!configStore.contains("backup.remote.pcloud.hostname")) {
                configStore.set(
                    "backup.remote.pcloud.hostname",
                    safeStringify("api.pcloud.com"),
                );
            }
            if (!configStore.contains("basic.autoCachePlayedRemoteMusic")) {
                configStore.set(
                    "basic.autoCachePlayedRemoteMusic",
                    safeStringify(true),
                );
            }
            if (!configStore.contains("basic.remotePlaybackCacheEnabled")) {
                configStore.set(
                    "basic.remotePlaybackCacheEnabled",
                    safeStringify(true),
                );
            }
            configStore.set("$schema", "5");
        }
    }

    private getConfigSnapshot(rawKeys: ReadonlySet<string>): RemoteConfigSnapshot {
        const snapshot: RemoteConfigSnapshot = {};
        for (const key of rawKeys) {
            const value = configStore.getString(key);
            if (value !== undefined) {
                snapshot[key] = JSON.parse(value);
            }
        }
        return snapshot;
    }

    private applyConfigValue<K extends keyof IAppConfigProperties>(
        key: K,
        value?: IAppConfigProperties[K],
    ): void {
        if (value === undefined) {
            configStore.delete(key);
        } else {
            configStore.set(key, safeStringify(value));
        }
        if (key === "webdav.autoSync" && value === false) {
            configStore.delete("webdav.pendingPush");
        }
        if (key === "backup.remote.autoSync" && value === false) {
            configStore.delete("backup.remote.pendingPush");
        }
    }

    async setup(): Promise<void> {
        await this.migrateConfig();
    }

    setConfig<K extends keyof IAppConfigProperties>(
        key: K,
        value?: IAppConfigProperties[K] | undefined,
    ): void {
        if (REMOTE_CONFIG_KEYS.has(key)) {
            const normalized = normalizeRemoteConfigPatch({ [key]: value });
            for (const [patchKey, patchValue] of Object.entries(normalized)) {
                this.applyConfigValue(
                    patchKey as K,
                    patchValue as IAppConfigProperties[K],
                );
            }
            return;
        }
        this.applyConfigValue(key, value);
    }

    getConfig<K extends keyof IAppConfigProperties>(
        key: K,
    ): IAppConfigProperties[K] | undefined {
        const value = configStore.getString(key);
        if (value === undefined) {
            return undefined;
        }
        return JSON.parse(value);
    }
}

const appConfig = new AppConfig();
export default appConfig;

/***** hooks *****/
export function useAppConfig<K extends keyof IAppConfigProperties>(key: K): IAppConfigProperties[K] | undefined {
    return useMMKVObject<IAppConfigProperties[K]>(key, configStore)[0];
}