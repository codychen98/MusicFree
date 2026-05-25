import { errorLog } from "@/utils/log";
import { readFile } from "react-native-fs";
import { AuthType, createClient, type WebDAVClient } from "webdav";

import {
    getWebdavMusicPluginUserVariables,
    isWebdavDownloadTargetAvailable,
} from "./config";
import {
    lyricSidecarFilename,
    remotePathFor,
    resolveRemoteDir,
    translationSidecarFilename,
} from "./path";

export class WebdavMusicPluginConfigIncompleteError extends Error {
    constructor() {
        super("WEBDAV_MUSIC_PLUGIN_CONFIG_INCOMPLETE");
        this.name = "WebdavMusicPluginConfigIncompleteError";
    }
}

export interface WebdavMusicPluginConfig {
    url: string;
    username: string;
    password: string;
    searchPath: string;
    remoteDir: string;
}

let cachedClient: WebDAVClient | null = null;
let cachedClientKey = "";

export function getWebdavMusicPluginConfig(): WebdavMusicPluginConfig {
    if (!isWebdavDownloadTargetAvailable()) {
        throw new WebdavMusicPluginConfigIncompleteError();
    }
    const vars = getWebdavMusicPluginUserVariables();
    const url = vars.url?.trim() ?? "";
    const username = vars.username?.trim() ?? "";
    const password = vars.password?.trim() ?? "";
    const searchPath = vars.searchPath?.trim() ?? "";
    const remoteDir = resolveRemoteDir(searchPath);
    if (!url || !username || !password || !remoteDir) {
        throw new WebdavMusicPluginConfigIncompleteError();
    }
    return { url, username, password, searchPath, remoteDir };
}

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

function normalizeLocalPath(localPath: string): string {
    return localPath.startsWith("file://") ? localPath.slice(7) : localPath;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

async function ensureRemoteDirectory(
    client: WebDAVClient,
    remoteDir: string,
): Promise<void> {
    if (!(await client.exists(remoteDir))) {
        await client.createDirectory(remoteDir, { recursive: true });
    }
}

export async function remoteFileExists(remotePath: string): Promise<boolean> {
    const config = getWebdavMusicPluginConfig();
    const client = getWebdavMusicClient(config);
    return client.exists(remotePath);
}

export async function remoteAudioExists(remotePath: string): Promise<boolean> {
    return remoteFileExists(remotePath);
}

export type UploadFileMode = "binary" | "text";

export async function uploadFile(
    localPath: string,
    remotePath: string,
    mode: UploadFileMode = "binary",
): Promise<void> {
    const config = getWebdavMusicPluginConfig();
    const client = getWebdavMusicClient(config);
    await ensureRemoteDirectory(client, config.remoteDir);

    const normalizedLocal = normalizeLocalPath(localPath);
    const payload =
        mode === "text"
            ? await readFile(normalizedLocal, "utf8")
            : base64ToArrayBuffer(
                  await readFile(normalizedLocal, "base64"),
              );

    await client.putFileContents(remotePath, payload, {
        overwrite: true,
    });
}

export interface UploadDownloadArtifactsInput {
    localAudioPath: string;
    /** Remote basename, e.g. `title@artist.flac`. */
    audioFilename: string;
    localLrcPath?: string | null;
    localTranLrcPath?: string | null;
}

export interface UploadDownloadArtifactsResult {
    remoteAudioPath: string;
    audioSkipped: boolean;
    lrcUploaded: boolean;
    tranLrcUploaded: boolean;
}

/**
 * Upload cached download + sidecar lyrics (6B: skip audio PUT if remote exists;
 * still upload missing `.lrc` / `.tran.lrc`).
 */
export async function uploadDownloadArtifacts(
    input: UploadDownloadArtifactsInput,
): Promise<UploadDownloadArtifactsResult> {
    const config = getWebdavMusicPluginConfig();
    const client = getWebdavMusicClient(config);
    await ensureRemoteDirectory(client, config.remoteDir);

    const remoteAudioPath = remotePathFor(config.remoteDir, input.audioFilename);
    let audioSkipped = false;

    try {
        if (await client.exists(remoteAudioPath)) {
            audioSkipped = true;
        } else {
            await uploadFile(input.localAudioPath, remoteAudioPath, "binary");
        }

        let lrcUploaded = false;
        let tranLrcUploaded = false;

        if (input.localLrcPath) {
            const remoteLrc = remotePathFor(
                config.remoteDir,
                lyricSidecarFilename(input.audioFilename),
            );
            if (!(await client.exists(remoteLrc))) {
                await uploadFile(input.localLrcPath, remoteLrc, "text");
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
        errorLog("WebDAV-上传下载文件失败", {
            remoteAudioPath,
            audioFilename: input.audioFilename,
            reason: e instanceof Error ? e.message : e,
        });
        throw e;
    }
}

export { remotePathFor, resolveRemoteDir } from "./path";
