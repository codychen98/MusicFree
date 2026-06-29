import { errorLog } from "@/utils/log";
import { AuthType, createClient, type WebDAVClient } from "webdav";

import { remotePathsForWebdavTrack } from "./path";
import {
    getWebdavMusicPluginConfig,
    type WebdavMusicPluginConfig,
} from "./upload";

export interface RenameWebdavRemoteTrackInput {
    oldRemoteAudioPath: string;
    newRemoteAudioPath: string;
}

let cachedClient: WebDAVClient | null = null;
let cachedClientKey = "";

function getWebdavMusicClient(config: WebdavMusicPluginConfig): WebDAVClient {
    const key = `${config.url}\0${config.username}\0${config.password}`;
    if (cachedClient && cachedClientKey === key) {
        return cachedClient;
    }
    cachedClient = createClient(config.url, {
        authType: AuthType.Password,
        username: config.username,
        password: config.password,
    });
    cachedClientKey = key;
    return cachedClient;
}

async function assertRenameTargetsAvailable(
    client: WebDAVClient,
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
    client: WebDAVClient,
    oldPath: string,
    newPath: string,
): Promise<void> {
    if (!(await client.exists(oldPath))) {
        return;
    }
    await client.moveFile(oldPath, newPath, { overwrite: false });
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

    const config = getWebdavMusicPluginConfig();
    const client = getWebdavMusicClient(config);
    const oldPaths = remotePathsForWebdavTrack(oldRemoteAudioPath);
    const newPaths = remotePathsForWebdavTrack(newRemoteAudioPath);

    if (!(await client.exists(oldPaths.audioPath))) {
        throw new Error("WEBDAV_REMOTE_SOURCE_MISSING");
    }

    await assertRenameTargetsAvailable(client, oldPaths, newPaths);

    try {
        await client.moveFile(oldPaths.audioPath, newPaths.audioPath, {
            overwrite: false,
        });
        await moveRemoteFileIfExists(client, oldPaths.lrcPath, newPaths.lrcPath);
        await moveRemoteFileIfExists(
            client,
            oldPaths.tranLrcPath,
            newPaths.tranLrcPath,
        );
    } catch (e: unknown) {
        errorLog("WebDAV-重命名远程歌曲失败", {
            oldRemoteAudioPath,
            newRemoteAudioPath,
            reason: e instanceof Error ? e.message : e,
        });
        throw e;
    }
}
