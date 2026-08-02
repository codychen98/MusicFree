import { errorLog } from "@/utils/log";
import type { RemoteStorageClient } from "@/core/remote-storage/types";

import { remotePathsForWebdavTrack } from "./path";
import { getRemoteMusicClient } from "./upload";

async function deleteRemoteFileIfExists(
    client: RemoteStorageClient,
    remotePath: string,
): Promise<void> {
    if (!(await client.exists(remotePath))) {
        return;
    }
    await client.deleteFile(remotePath);
}

/**
 * Delete a WebDAV-hosted track and its sidecar lyrics from the remote music folder.
 * `musicItem.id` must be the full remote audio path.
 */
export async function deleteWebdavRemoteTrack(
    musicItem: IMusic.IMusicItem,
): Promise<void> {
    const remoteAudioPath = musicItem.id?.trim();
    if (!remoteAudioPath) {
        throw new Error("WEBDAV_REMOTE_PATH_MISSING");
    }

    const client = await getRemoteMusicClient();
    const paths = remotePathsForWebdavTrack(remoteAudioPath);

    try {
        await deleteRemoteFileIfExists(client, paths.audioPath);
        await deleteRemoteFileIfExists(client, paths.lrcPath);
        await deleteRemoteFileIfExists(client, paths.tranLrcPath);
    } catch (e: unknown) {
        errorLog("Remote-删除远程歌曲失败", {
            remoteAudioPath,
            reason: e instanceof Error ? e.message : e,
        });
        throw e;
    }
}

export { remotePathsForWebdavTrack } from "./path";
