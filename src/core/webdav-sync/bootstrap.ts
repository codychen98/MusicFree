import { ResumeMode } from "@/constants/commonConst.ts";
import Backup from "@/core/backup";
import Config from "@/core/appConfig";
import MusicSheet from "@/core/musicSheet";
import { trace } from "@/utils/log";
import PersistStatus from "@/utils/persistStatus";
import { AuthType, createClient } from "webdav";
import {
    clearWebdavPendingPushAfterManualRestore,
    isWebdavAutoSyncEnabled,
    isWebdavCredentialsComplete,
    isWebdavPendingPush,
} from "./config";
import { WEBDAV_REMOTE_BACKUP_FILE, flushWebdavUpload } from "./upload";
import { confirmEmptyRemoteOverwrite } from "./empty-remote-dialog";

function webdavSyncLog(message: string, detail?: unknown): void {
    if (PersistStatus.get("app.webdavSyncDebug") !== true) {
        return;
    }
    trace(`[webdav-sync] ${message}`, detail);
}

function countTracksInBackup(rawText: string): number {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        return 0;
    }
    if (typeof parsed !== "object" || parsed === null) {
        return 0;
    }
    const sheets = (parsed as { musicSheets?: unknown }).musicSheets;
    if (!Array.isArray(sheets)) {
        return 0;
    }
    return sheets.reduce((total: number, sheet: unknown) => {
        if (typeof sheet !== "object" || sheet === null) {
            return total;
        }
        const list = (sheet as { musicList?: unknown }).musicList;
        return total + (Array.isArray(list) ? list.length : 0);
    }, 0);
}

function countLocalTracks(): number {
    return MusicSheet.backupSheets().reduce(
        (t, sheet) => t + (sheet.musicList?.length ?? 0),
        0,
    );
}

export async function fetchRemoteBackupRaw(): Promise<string | null> {
    const url = Config.getConfig("webdav.url");
    const username = Config.getConfig("webdav.username");
    const password = Config.getConfig("webdav.password");
    if (!(url && username && password)) {
        return null;
    }
    const client = createClient(url, {
        authType: AuthType.Password,
        username,
        password,
    });
    if (!(await client.exists(WEBDAV_REMOTE_BACKUP_FILE))) {
        return null;
    }
    return (await client.getFileContents(WEBDAV_REMOTE_BACKUP_FILE, {
        format: "text",
    })) as string;
}

async function autoPullFromRemote(raw: string): Promise<void> {
    await Backup.resume(raw, ResumeMode.Append, {
        fullSheetOverwrite: true,
    });
    clearWebdavPendingPushAfterManualRestore();
}

/**
 * Cold-start sync: when `MusicFreeBackup.json` exists on WebDAV, always pull with full
 * sheet overwrite (remote is source of truth). `webdav.pendingPush` does not skip pull.
 * Empty remote + non-empty local: blocking dialog before overwrite (Desktop D6 / Android A4).
 * No remote file: push local snapshot if pending, so first backup can be created.
 */
export async function runWebdavBootstrapSync(): Promise<void> {
    if (!isWebdavAutoSyncEnabled() || !isWebdavCredentialsComplete()) {
        webdavSyncLog(
            "bootstrap skipped (auto-sync off or credentials incomplete)",
        );
        return;
    }

    webdavSyncLog("bootstrap: remote-wins — evaluate auto-pull");

    let raw: string | null;
    try {
        raw = await fetchRemoteBackupRaw();
    } catch (error: unknown) {
        webdavSyncLog("bootstrap: fetch remote failed", error);
        if (isWebdavPendingPush()) {
            const pushed = await flushWebdavUpload();
            webdavSyncLog(
                `bootstrap: fetch failed — flush pending push ${pushed ? "succeeded" : "failed"}`,
            );
        }
        return;
    }

    if (raw === null) {
        webdavSyncLog("bootstrap: no remote backup file");
        if (isWebdavPendingPush()) {
            const pushed = await flushWebdavUpload();
            webdavSyncLog(
                `bootstrap: no remote — flush pending push ${pushed ? "succeeded" : "failed"}`,
            );
        }
        return;
    }

    const remoteTrackCount = countTracksInBackup(raw);
    const localTrackCount = countLocalTracks();

    if (remoteTrackCount === 0 && localTrackCount > 0) {
        webdavSyncLog(
            "bootstrap: empty remote with local data — empty-remote confirm",
        );
        const confirmed = await confirmEmptyRemoteOverwrite();
        if (!confirmed) {
            webdavSyncLog("bootstrap: user cancelled empty remote overwrite");
            return;
        }
        webdavSyncLog("bootstrap: user confirmed empty remote overwrite");
        try {
            await autoPullFromRemote(raw);
            webdavSyncLog("bootstrap: empty-remote pull finished");
        } catch (error: unknown) {
            webdavSyncLog("bootstrap: empty-remote pull failed", error);
        }
        return;
    }

    if (remoteTrackCount === 0) {
        webdavSyncLog("bootstrap: remote and local empty — nothing to pull");
        return;
    }

    webdavSyncLog(
        `bootstrap: auto-pull ${remoteTrackCount} remote track(s) (overwrite)`,
    );
    try {
        await autoPullFromRemote(raw);
        webdavSyncLog("bootstrap: auto-pull finished");
    } catch (error: unknown) {
        webdavSyncLog("bootstrap: auto-pull failed", error);
    }
}
