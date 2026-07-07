/** 备份与恢复 */
/** 歌单、插件 */
import { compare } from "compare-versions";
import { nanoid } from "nanoid";
import PluginManager from "./pluginManager";
import MusicSheet from "@/core/musicSheet";
import { ResumeMode } from "@/constants/commonConst.ts";
import Config from "./appConfig";
import {
    getRemoteBackupSourceDeviceId,
    type RemoteConfigSnapshot,
} from "@/core/remote-storage/remote-config";
import { runWithoutWebdavSyncNotify } from "@/core/webdav-sync/suppress";

function readBackupSourceDeviceConfigSnapshot(): RemoteConfigSnapshot {
    return {
        "backup.remote.backupSourceDeviceId": Config.getConfig(
            "backup.remote.backupSourceDeviceId",
        ),
        "webdav.backupSourceDeviceId": Config.getConfig(
            "webdav.backupSourceDeviceId",
        ),
    };
}

/**
 * 结果：一份大的json文件
 * {
 *     musicSheets: [],
 *     plugins: [],
 *     syncMeta?: { updatedAt, sourceDeviceId }  // WebDAV uploads only; tolerated on restore
 * }
 */

export interface IBackupSyncMeta {
    updatedAt: number;
    sourceDeviceId?: string;
}

interface IBackupJson {
    musicSheets: IMusic.IMusicSheetItem[];
    plugins: Array<{ srcUrl: string; version: string }>;
}

function buildBackupPayload(): IBackupJson {
    const musicSheets = MusicSheet.backupSheets();
    const plugins = PluginManager.getEnabledPlugins();
    const normalizedPlugins = plugins
        .map(_ => ({
            srcUrl: _.instance.srcUrl,
            version: _.instance.version ?? "0.0.0",
        }))
        .filter(
            (
                p,
            ): p is { srcUrl: string; version: string } =>
                typeof p.srcUrl === "string" && p.srcUrl.length > 0,
        );

    return {
        musicSheets,
        plugins: normalizedPlugins,
    };
}

function backup() {
    return JSON.stringify(buildBackupPayload());
}

/** Full JSON written to remote backup: base payload plus syncMeta bump (parity with Desktop D2). */
function stringifyWebdavBackupWithSyncMeta(): string {
    let sourceDeviceId = getRemoteBackupSourceDeviceId(
        readBackupSourceDeviceConfigSnapshot(),
    );
    if (!sourceDeviceId) {
        sourceDeviceId = nanoid();
        Config.setConfig("backup.remote.backupSourceDeviceId", sourceDeviceId);
    }
    const syncMeta: IBackupSyncMeta = {
        updatedAt: Date.now(),
        sourceDeviceId,
    };
    return JSON.stringify({ ...buildBackupPayload(), syncMeta });
}

interface IBackupResumeOptions {
    /** Match Desktop `BackupResume.resume(..., overwrite: true)` for WebDAV auto-pull. */
    fullSheetOverwrite?: boolean;
}

/**
 * WebDAV pull: local playlists match remote exactly (add missing, remove extras).
 * Used by auto-sync and manual restore — not the Settings "resume mode" merge options.
 */
async function resumeFromWebdavRemote(raw: string | Object) {
    return resume(raw, ResumeMode.Append, { fullSheetOverwrite: true });
}

async function resume(
    raw: string | Object,
    resumeMode: ResumeMode = ResumeMode.Append,
    options?: IBackupResumeOptions,
) {
    return runWithoutWebdavSyncNotify(async () => {
        let obj: IBackupJson;
        if (typeof raw === "string") {
            obj = JSON.parse(raw);
        } else {
            obj = raw as IBackupJson;
        }

        const { plugins, musicSheets } = obj ?? {};
        const sheetsPayload = Array.isArray(musicSheets) ? musicSheets : [];
        /** 恢复插件 */
        const validPlugins = PluginManager.getEnabledPlugins();
        const resumePlugins = plugins?.map(_ => {
            // 校验是否安装过: 同源且本地版本更高就忽略掉
            if (
                validPlugins.find(
                    plugin =>
                        plugin.instance.srcUrl === _.srcUrl &&
                        compare(
                            plugin.instance.version ?? "0.0.0",
                            _.version ?? "0.0.1",
                            ">=",
                        ),
                )
            ) {
                return;
            }
            return PluginManager.installPluginFromUrl(_.srcUrl);
        });

        /** 恢复歌单 */
        const resumeMusicSheets = options?.fullSheetOverwrite
            ? MusicSheet.resumeSheetsFullOverwrite(sheetsPayload)
            : MusicSheet.resumeSheets(sheetsPayload, resumeMode);

        return Promise.all([...(resumePlugins ?? []), resumeMusicSheets]);
    });
}

const Backup = {
    backup,
    resume,
    resumeFromWebdavRemote,
    stringifyWebdavBackupWithSyncMeta,
};
export default Backup;
