import { createRemoteStorageClient } from "@/core/remote-storage/resolve";
import { getRemoteBackupPaths } from "@/core/remote-storage/remote-paths";
import {
    getRemoteStorageCredentialsFromConfig,
    getWebdavRootPath,
} from "@/core/remote-storage/remote-config";
import type { RemoteStorageClient } from "@/core/remote-storage/types";

import { readRemoteConfigSnapshot } from "./config";

export function getActiveRemoteStorageClient(): RemoteStorageClient {
    const snapshot = readRemoteConfigSnapshot();
    return createRemoteStorageClient(
        getRemoteStorageCredentialsFromConfig(snapshot),
    );
}

export function getActiveRemoteBackupPaths(): ReturnType<
    typeof getRemoteBackupPaths
> {
    return getRemoteBackupPaths(getWebdavRootPath(readRemoteConfigSnapshot()));
}
