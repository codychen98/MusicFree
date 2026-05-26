import EventEmitter from "eventemitter3";

import {
    isWebdavDownloadTargetAvailable,
    WEBDAV_MUSIC_PLUGIN_PLATFORM,
} from "./config";
import { deleteWebdavRemoteTrack } from "./delete";

export enum WebdavAfterPlaylistRemoveEvent {
    RemoteDeleteSkipped = "RemoteDeleteSkipped",
    RemoteDeleteFailed = "RemoteDeleteFailed",
}

export interface WebdavRemoteDeleteSkippedPayload {
    title: string;
    playlistTitles: string[];
}

export interface WebdavRemoteDeleteFailedPayload {
    title: string;
    reason: string;
}

type WebdavAfterPlaylistRemoveEvents = {
    [WebdavAfterPlaylistRemoveEvent.RemoteDeleteSkipped]: (
        payload: WebdavRemoteDeleteSkippedPayload,
    ) => void;
    [WebdavAfterPlaylistRemoveEvent.RemoteDeleteFailed]: (
        payload: WebdavRemoteDeleteFailedPayload,
    ) => void;
};

const ee = new EventEmitter<WebdavAfterPlaylistRemoveEvents>();

export function onWebdavAfterPlaylistRemove<
    K extends keyof WebdavAfterPlaylistRemoveEvents,
>(event: K, listener: WebdavAfterPlaylistRemoveEvents[K]): void {
    ee.on(event, listener);
}

export type FindSheetsContainingMusic = (
    musicItem: IMusic.IMusicItem,
) => Array<{ id: string; title: string }>;

/**
 * After playlist rows are removed locally, delete WebDAV remote files when the
 * track is no longer referenced in any playlist. Emit UI events when skipped
 * (still in other lists) or remote delete fails.
 */
export async function handleWebdavAfterPlaylistRemove(
    removedItems: IMusic.IMusicItem[],
    findSheetsContainingMusic: FindSheetsContainingMusic,
): Promise<void> {
    if (!removedItems.length) {
        return;
    }

    const webdavItems = removedItems.filter(
        item => item.platform === WEBDAV_MUSIC_PLUGIN_PLATFORM,
    );
    if (!webdavItems.length) {
        return;
    }

    const canDeleteRemote = isWebdavDownloadTargetAvailable();

    for (const item of webdavItems) {
        const remainingSheets = findSheetsContainingMusic(item);
        if (remainingSheets.length > 0) {
            ee.emit(WebdavAfterPlaylistRemoveEvent.RemoteDeleteSkipped, {
                title: item.title,
                playlistTitles: remainingSheets.map(sheet => sheet.title),
            });
            continue;
        }

        if (!canDeleteRemote) {
            continue;
        }

        try {
            await deleteWebdavRemoteTrack(item);
        } catch (e: unknown) {
            ee.emit(WebdavAfterPlaylistRemoveEvent.RemoteDeleteFailed, {
                title: item.title,
                reason: e instanceof Error ? e.message : String(e),
            });
        }
    }
}
