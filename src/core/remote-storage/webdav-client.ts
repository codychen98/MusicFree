import { AuthType, createClient, type WebDAVClient } from "webdav";

import {
    normalizeWebdavCredentialsUrl,
    normalizeWebdavServerUrl,
    resolveWebdavClientPath,
} from "./remote-paths";
import type { RemoteStorageClient, WebdavCredentials } from "./types";
import { createWebdavRemoteStorage } from "./webdav-adapter";

export function createWebdavClient(credentials: WebdavCredentials): WebDAVClient {
    const serverUrl = normalizeWebdavServerUrl(credentials.url);
    return createClient(serverUrl, {
        authType: AuthType.Password,
        username: credentials.username,
        password: credentials.password,
    });
}

export function createWebdavRemoteStorageFromCredentials(
    credentials: WebdavCredentials,
): RemoteStorageClient {
    const originalUrl = normalizeWebdavCredentialsUrl(credentials.url);
    const serverUrl = normalizeWebdavServerUrl(originalUrl);
    const rootPath = credentials.rootPath ?? "";
    const client = createWebdavClient({
        ...credentials,
        url: serverUrl,
    });
    const pathFor = (path: string) =>
        resolveWebdavClientPath(serverUrl, rootPath, path);
    return createWebdavRemoteStorage(client, pathFor);
}
