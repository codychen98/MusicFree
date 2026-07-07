export interface WebdavCredentials {
    url: string;
    /** Cloud root folder, e.g. /(Reinstall)/BACKUP */
    rootPath?: string;
    username: string;
    password: string;
}

export interface PcloudCredentials {
    hostname: string;
    tokenJson: string;
}

export interface RemoteStorageCredentials {
    webdav?: Partial<WebdavCredentials>;
    pcloud?: Partial<PcloudCredentials>;
}

export type RemoteTransport = "webdav" | "pcloud";

export interface RemoteDirectoryEntry {
    path: string;
    basename: string;
    size: number;
    type: "file" | "directory";
    mime?: string;
}

export interface RemoteStorageClient {
    exists(path: string): Promise<boolean>;
    getText(path: string): Promise<string>;
    getBinary(path: string): Promise<Uint8Array>;
    putText(path: string, body: string): Promise<void>;
    putBinary(path: string, body: Uint8Array): Promise<void>;
    ensureDir(path: string): Promise<void>;
    deleteFile(path: string): Promise<void>;
    moveFile(from: string, to: string): Promise<void>;
    listDirectory(path: string): Promise<RemoteDirectoryEntry[]>;
    getDownloadUrl(path: string): Promise<string>;
}

export class PcloudTokenParseError extends Error {
    constructor() {
        super("PCLOUD_TOKEN_PARSE_ERROR");
        this.name = "PcloudTokenParseError";
    }
}

export class PcloudTokenInvalidError extends Error {
    constructor(public readonly reason: string) {
        super(`PCLOUD_TOKEN_INVALID:${reason}`);
        this.name = "PcloudTokenInvalidError";
    }
}

export class PcloudApiError extends Error {
    constructor(
        public readonly code: number,
        message: string,
    ) {
        super(`PCLOUD_API_${code}:${message}`);
        this.name = "PcloudApiError";
    }
}

export class RemoteCredentialsIncompleteError extends Error {
    constructor() {
        super("REMOTE_CREDENTIALS_INCOMPLETE");
        this.name = "RemoteCredentialsIncompleteError";
    }
}

export class RemoteTransportOfflineError extends Error {
    constructor() {
        super("REMOTE_TRANSPORT_OFFLINE");
        this.name = "RemoteTransportOfflineError";
    }
}
