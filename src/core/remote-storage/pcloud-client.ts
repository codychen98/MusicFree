import { parsePcloudTokenJson } from "./parse-pcloud-token";
import { createPcloudRemoteStorage } from "./pcloud-adapter";
import type { PcloudCredentials, RemoteStorageClient } from "./types";

export function createPcloudRemoteStorageFromCredentials(
    credentials: PcloudCredentials,
): RemoteStorageClient {
    const parsed = parsePcloudTokenJson(credentials.tokenJson);
    return createPcloudRemoteStorage({
        hostname: credentials.hostname.trim(),
        accessToken: parsed.accessToken,
    });
}
