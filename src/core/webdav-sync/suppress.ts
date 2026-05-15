let suppressNotifyDepth = 0;

export function runWithoutWebdavSyncNotify<T>(fn: () => Promise<T>): Promise<T> {
    suppressNotifyDepth += 1;
    return Promise.resolve(fn()).finally(() => {
        suppressNotifyDepth -= 1;
    });
}

export function isWebdavNotifySuppressed(): boolean {
    return suppressNotifyDepth > 0;
}
