import { errorLog } from "@/utils/log";
import type { RemoteStorageClient } from "@/core/remote-storage/types";

import { remotePathsForWebdavTrack } from "./path";
import type { RenameWebdavRemoteTrackInput } from "./types";
import { getRemoteMusicClient } from "./upload";

async function assertRenameTargetsAvailable(
    client: RemoteStorageClient,
    oldPaths: ReturnType<typeof remotePathsForWebdavTrack>,
    newPaths: ReturnType<typeof remotePathsForWebdavTrack>,
): Promise<void> {
    if (await client.exists(newPaths.audioPath)) {
        throw new Error("WEBDAV_RENAME_TARGET_EXISTS");
    }

    if (await client.exists(oldPaths.lrcPath)) {
        if (await client.exists(newPaths.lrcPath)) {
            throw new Error("WEBDAV_RENAME_TARGET_EXISTS");
        }
    }

    if (await client.exists(oldPaths.tranLrcPath)) {
        if (await client.exists(newPaths.tranLrcPath)) {
            throw new Error("WEBDAV_RENAME_TARGET_EXISTS");
        }
    }
}

async function moveRemoteFileIfExists(
    client: RemoteStorageClient,
    oldPath: string,
    newPath: string,
): Promise<void> {
    if (!(await client.exists(oldPath))) {
        return;
    }
    await client.moveFile(oldPath, newPath);
}

export async function renameWebdavRemoteTrack(
    input: RenameWebdavRemoteTrackInput,
): Promise<void> {
    const oldRemoteAudioPath = input.oldRemoteAudioPath?.trim();
    const newRemoteAudioPath = input.newRemoteAudioPath?.trim();
    if (!oldRemoteAudioPath || !newRemoteAudioPath) {
        throw new Error("WEBDAV_REMOTE_PATH_MISSING");
    }

    if (oldRemoteAudioPath === newRemoteAudioPath) {
        return;
    }

    const client = await getRemoteMusicClient();
    const oldPaths = remotePathsForWebdavTrack(oldRemoteAudioPath);
    const newPaths = remotePathsForWebdavTrack(newRemoteAudioPath);

    if (!(await client.exists(oldPaths.audioPath))) {
        throw new Error("WEBDAV_REMOTE_SOURCE_MISSING");
    }

    await assertRenameTargetsAvailable(client, oldPaths, newPaths);

    try {
        await client.moveFile(oldPaths.audioPath, newPaths.audioPath);
        await moveRemoteFileIfExists(client, oldPaths.lrcPath, newPaths.lrcPath);
        await moveRemoteFileIfExists(
            client,
            oldPaths.tranLrcPath,
            newPaths.tranLrcPath,
        );
    } catch (e: unknown) {
        errorLog("Remote-重命名远程歌曲失败", {
            oldRemoteAudioPath,
            newRemoteAudioPath,
            reason: e instanceof Error ? e.message : e,
        });
        throw e;
    }
}
