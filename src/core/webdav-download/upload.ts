import { createRemoteStorageClient, resolveRemoteTransport } from "@/core/remote-storage/resolve";
import {
    getRemoteMusicPath,
    getRemoteStorageCredentialsFromConfig,
    isRemoteCredentialsCompleteInConfig,
} from "@/core/remote-storage/remote-config";
import type { RemoteStorageClient } from "@/core/remote-storage/types";
import { errorLog } from "@/utils/log";
import { readFile } from "react-native-fs";

import { readRemoteMusicConfigSnapshot } from "./config";
import {
    lyricSidecarFilename,
    remotePathFor,
    resolveRemoteDir,
    translationSidecarFilename,
} from "./path";
import {
    RemoteMusicConfigIncompleteError,
    type RemoteAudioExistsInput,
    type RemoteAudioExistsResult,
    type RemoteMusicConfig,
    type UploadDownloadArtifactsInput,
    type UploadDownloadArtifactsResult,
    WebdavMusicPluginConfigIncompleteError,
} from "./types";

export type {
    RemoteAudioExistsInput,
    RemoteAudioExistsResult,
    RemoteMusicConfig,
    UploadDownloadArtifactsInput,
    UploadDownloadArtifactsResult,
} from "./types";

export {
    RemoteMusicConfigIncompleteError,
    WebdavMusicPluginConfigIncompleteError,
} from "./types";

let cachedClient: RemoteStorageClient | null = null;
let cachedClientKey = "";

function trim(value: string | undefined): string {
    return value?.trim() ?? "";
}

function buildRemoteMusicClientCacheKey(): string {
    const snapshot = readRemoteMusicConfigSnapshot();
    const creds = getRemoteStorageCredentialsFromConfig(snapshot);
    const transport = resolveRemoteTransport(creds);
    if (transport === "pcloud") {
        const pcloud = creds.pcloud!;
        return `pcloud\0${trim(pcloud.hostname)}\0${trim(pcloud.tokenJson)}`;
    }
    if (transport === "webdav") {
        const webdav = creds.webdav!;
        return `webdav\0${trim(webdav.url)}\0${trim(webdav.rootPath ?? "")}\0${trim(webdav.username)}\0${trim(webdav.password)}`;
    }
    return "";
}

export function getRemoteMusicConfig(): RemoteMusicConfig {
    const snapshot = readRemoteMusicConfigSnapshot();
    const musicPath = getRemoteMusicPath(snapshot);
    const remoteDir = resolveRemoteDir(musicPath);
    if (!isRemoteCredentialsCompleteInConfig(snapshot) || !remoteDir) {
        throw new RemoteMusicConfigIncompleteError();
    }
    return { musicPath, remoteDir };
}

export function getRemoteMusicClient(): RemoteStorageClient {
    const key = buildRemoteMusicClientCacheKey();
    if (!key) {
        throw new RemoteMusicConfigIncompleteError();
    }
    if (cachedClient && cachedClientKey === key) {
        return cachedClient;
    }
    const snapshot = readRemoteMusicConfigSnapshot();
    cachedClient = createRemoteStorageClient(
        getRemoteStorageCredentialsFromConfig(snapshot),
    );
    cachedClientKey = key;
    return cachedClient;
}

function normalizeLocalPath(localPath: string): string {
    return localPath.startsWith("file://") ? localPath.slice(7) : localPath;
}

function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

type UploadFileMode = "binary" | "text";

async function uploadFile(
    client: RemoteStorageClient,
    localPath: string,
    remotePath: string,
    mode: UploadFileMode,
): Promise<void> {
    const normalizedLocal = normalizeLocalPath(localPath);
    if (mode === "text") {
        const payload = await readFile(normalizedLocal, "utf8");
        await client.putText(remotePath, payload);
        return;
    }
    const payload = base64ToUint8Array(await readFile(normalizedLocal, "base64"));
    await client.putBinary(remotePath, payload);
}

export async function remoteFileExists(remotePath: string): Promise<boolean> {
    const client = getRemoteMusicClient();
    return client.exists(remotePath);
}

export async function remoteAudioExists(
    input: RemoteAudioExistsInput | string,
): Promise<boolean | RemoteAudioExistsResult> {
    if (typeof input === "string") {
        return remoteFileExists(input);
    }
    const config = getRemoteMusicConfig();
    const client = getRemoteMusicClient();
    const remoteAudioPath = remotePathFor(config.remoteDir, input.audioFilename);
    const exists = await client.exists(remoteAudioPath);
    return {
        remoteAudioPath,
        exists,
    };
}

export async function uploadDownloadArtifacts(
    input: UploadDownloadArtifactsInput,
): Promise<UploadDownloadArtifactsResult> {
    const config = getRemoteMusicConfig();
    const client = getRemoteMusicClient();
    await client.ensureDir(config.remoteDir);

    const remoteAudioPath = remotePathFor(config.remoteDir, input.audioFilename);
    let audioSkipped = false;

    try {
        if (await client.exists(remoteAudioPath)) {
            audioSkipped = true;
        } else {
            await uploadFile(
                client,
                input.localAudioPath,
                remoteAudioPath,
                "binary",
            );
        }

        let lrcUploaded = false;
        let tranLrcUploaded = false;

        if (input.localLrcPath) {
            const remoteLrc = remotePathFor(
                config.remoteDir,
                lyricSidecarFilename(input.audioFilename),
            );
            if (!(await client.exists(remoteLrc))) {
                await uploadFile(client, input.localLrcPath, remoteLrc, "text");
                lrcUploaded = true;
            }
        }

        if (input.localTranLrcPath) {
            const remoteTran = remotePathFor(
                config.remoteDir,
                translationSidecarFilename(input.audioFilename),
            );
            if (!(await client.exists(remoteTran))) {
                await uploadFile(
                    client,
                    input.localTranLrcPath,
                    remoteTran,
                    "text",
                );
                tranLrcUploaded = true;
            }
        }

        return {
            remoteAudioPath,
            audioSkipped,
            lrcUploaded,
            tranLrcUploaded,
        };
    } catch (e: unknown) {
        errorLog("Remote-上传下载文件失败", {
            remoteAudioPath,
            audioFilename: input.audioFilename,
            reason: e instanceof Error ? e.message : e,
        });
        throw e;
    }
}

export { remotePathFor, resolveRemoteDir } from "./path";
