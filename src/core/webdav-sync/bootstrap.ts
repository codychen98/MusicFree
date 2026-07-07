import Backup from "@/core/backup";
import MusicSheet from "@/core/musicSheet";
import { trace } from "@/utils/log";
import PersistStatus from "@/utils/persistStatus";

import {
    clearRemotePendingPushAfterManualRestore,
    isRemoteAutoSyncEnabled,
    isRemoteCredentialsComplete,
    isRemotePendingPush,
} from "./config";
import { getActiveRemoteBackupPaths, getActiveRemoteStorageClient } from "./remote-client";
import { confirmEmptyRemoteOverwrite } from "./empty-remote-dialog";
import { flushRemoteUpload } from "./upload";

function remoteSyncLog(message: string, detail?: unknown): void {
    if (PersistStatus.get("app.webdavSyncDebug") !== true) {
        return;
    }
    trace(`[remote-sync] ${message}`, detail);
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
    if (!isRemoteCredentialsComplete()) {
        return null;
    }
    const client = getActiveRemoteStorageClient();
    const paths = getActiveRemoteBackupPaths();

    if (await client.exists(paths.file)) {
        return client.getText(paths.file);
    }

    if (
        paths.legacyFile !== paths.file
        && (await client.exists(paths.legacyFile))
    ) {
        return client.getText(paths.legacyFile);
    }

    return null;
}

/** Replace local playlists with remote snapshot; clear stale pending-push flag. */
export async function applyRemoteBackupRaw(raw: string): Promise<void> {
    await Backup.resumeFromWebdavRemote(raw);
    clearRemotePendingPushAfterManualRestore();
}

/** @deprecated Use applyRemoteBackupRaw */
export const applyWebdavRemoteBackupRaw = applyRemoteBackupRaw;

export type RemotePullOverwriteResult = "applied" | "cancelled";

/** @deprecated Use RemotePullOverwriteResult */
export type WebdavPullOverwriteResult = RemotePullOverwriteResult;

/**
 * Full overwrite from remote storage (remote source of truth).
 * Empty remote + non-empty local: same confirmation as auto-sync before wiping local.
 */
export async function pullRemoteSnapshotWithOverwriteGate(
    raw: string,
): Promise<RemotePullOverwriteResult> {
    const remoteTrackCount = countTracksInBackup(raw);
    const localTrackCount = countLocalTracks();

    if (remoteTrackCount === 0 && localTrackCount > 0) {
        remoteSyncLog(
            "pull: empty remote with local data — empty-remote confirm",
        );
        const confirmed = await confirmEmptyRemoteOverwrite();
        if (!confirmed) {
            remoteSyncLog("pull: user cancelled empty remote overwrite");
            return "cancelled";
        }
        remoteSyncLog("pull: user confirmed empty remote overwrite");
    }

    await applyRemoteBackupRaw(raw);
    remoteSyncLog(
        `pull: full overwrite finished (${remoteTrackCount} remote track(s))`,
    );
    return "applied";
}

/** @deprecated Use pullRemoteSnapshotWithOverwriteGate */
export const pullWebdavSnapshotWithOverwriteGate =
    pullRemoteSnapshotWithOverwriteGate;

/**
 * Remote-wins sync (cold start and foreground resume): when `MusicFreeBackup.json` exists
 * on remote storage, pull with full sheet overwrite (remote is source of truth).
 * `backup.remote.pendingPush` does not skip pull.
 * Empty remote + non-empty local: blocking dialog before overwrite (Desktop D6 / Android A4).
 * No remote file: push local snapshot if pending, so first backup can be created.
 */
export async function runRemoteBootstrapSync(): Promise<void> {
    if (!isRemoteAutoSyncEnabled() || !isRemoteCredentialsComplete()) {
        remoteSyncLog(
            "bootstrap skipped (auto-sync off or credentials incomplete)",
        );
        return;
    }

    remoteSyncLog("bootstrap: remote-wins — evaluate auto-pull");

    let raw: string | null;
    try {
        raw = await fetchRemoteBackupRaw();
    } catch (error: unknown) {
        remoteSyncLog("bootstrap: fetch remote failed", error);
        if (isRemotePendingPush()) {
            const pushed = await flushRemoteUpload();
            remoteSyncLog(
                `bootstrap: fetch failed — flush pending push ${pushed ? "succeeded" : "failed"}`,
            );
        }
        return;
    }

    if (raw === null) {
        remoteSyncLog("bootstrap: no remote backup file");
        if (isRemotePendingPush()) {
            const pushed = await flushRemoteUpload();
            remoteSyncLog(
                `bootstrap: no remote — flush pending push ${pushed ? "succeeded" : "failed"}`,
            );
        }
        return;
    }

    try {
        const result = await pullRemoteSnapshotWithOverwriteGate(raw);
        remoteSyncLog(`bootstrap: pull ${result}`);
    } catch (error: unknown) {
        remoteSyncLog("bootstrap: pull failed", error);
    }
}

/** @deprecated Use runRemoteBootstrapSync */
export const runWebdavBootstrapSync = runRemoteBootstrapSync;
