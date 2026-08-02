/** 备份与恢复 */
/** 歌单、插件 */
import { compare } from "compare-versions";
import { nanoid } from "nanoid";
import PluginManager, { applyPluginOrderMap } from "./pluginManager";
import MusicSheet from "@/core/musicSheet";
import { ResumeMode } from "@/constants/commonConst.ts";
import Config from "./appConfig";
import {
    getRemoteBackupSourceDeviceId,
    type RemoteConfigSnapshot,
} from "@/core/remote-storage/remote-config";
import { runWithoutWebdavSyncNotify } from "@/core/webdav-sync/suppress";
import pluginMeta from "@/core/pluginManager/meta";
import {
    parseBackupPayload,
    pluginOrderMapToBackupOrder,
    type IBackupPayload,
    type IBackupSyncMeta,
} from "@/core/backup-parse";

export type { IBackupSyncMeta, IBackupPluginOrder } from "@/core/backup-parse";

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
 *     pluginOrder?: { [platformOrName]: number },  // optional; remote-wins on pull (A3)
 *     syncMeta?: { updatedAt, sourceDeviceId }  // WebDAV uploads only; tolerated on restore
 * }
 */

type IBackupJson = IBackupPayload;

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

    const pluginOrder = pluginOrderMapToBackupOrder(
        pluginMeta.getPluginOrder(),
    );

    return {
        musicSheets,
        plugins: normalizedPlugins,
        ...(pluginOrder ? { pluginOrder } : {}),
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
        const obj = parseBackupPayload(
            typeof raw === "string" ? raw : (raw as Record<string, unknown>),
        );
        const { plugins, musicSheets, pluginOrder } = obj;

        // Remote-wins order apply (all resume paths, including WebDAV); missing = no-op.
        if (pluginOrder) {
            applyPluginOrderMap(pluginOrder);
        }

        const sheetsPayload = musicSheets;
        /** 恢复插件 */
        const validPlugins = PluginManager.getEnabledPlugins();
        const resumePlugins = plugins.map(_ => {
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

        return Promise.all([...resumePlugins, resumeMusicSheets]);
    });
}

const Backup = {
    backup,
    resume,
    resumeFromWebdavRemote,
    stringifyWebdavBackupWithSyncMeta,
};
export default Backup;
