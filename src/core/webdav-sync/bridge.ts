let markImpl: (() => void) | null = null;

export function registerWebdavMark(fn: () => void): void {
    markImpl = fn;
}

/** Called by music sheet / plugin code when local playlists change. */
export function markRemoteBackupMutation(): void {
    markImpl?.();
}

/** @deprecated Use markRemoteBackupMutation */
export function markWebdavLocalMutation(): void {
    markRemoteBackupMutation();
}
