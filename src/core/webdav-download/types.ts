export class RemoteMusicConfigIncompleteError extends Error {
    constructor() {
        super("REMOTE_MUSIC_CONFIG_INCOMPLETE");
        this.name = "RemoteMusicConfigIncompleteError";
    }
}

/** @deprecated Use `RemoteMusicConfigIncompleteError` */
export class WebdavMusicPluginConfigIncompleteError extends RemoteMusicConfigIncompleteError {
    constructor() {
        super();
        this.name = "WebdavMusicPluginConfigIncompleteError";
    }
}

export interface RemoteMusicConfig {
    musicPath: string;
    remoteDir: string;
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

export interface RemoteAudioExistsInput {
    /** Basename only, e.g. `title@artist.flac`. */
    audioFilename: string;
}

export interface RemoteAudioExistsResult {
    remoteAudioPath: string;
    exists: boolean;
}

export interface FetchRemoteSidecarLyricsResult {
    rawLrc?: string;
    translation?: string;
}

export interface UploadRemoteSidecarLyricsInput {
    remoteAudioPath: string;
    rawLrc: string;
    translation?: string;
}

export interface RenameWebdavRemoteTrackInput {
    oldRemoteAudioPath: string;
    newRemoteAudioPath: string;
}
