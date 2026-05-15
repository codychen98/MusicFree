let markImpl: (() => void) | null = null;

export function registerWebdavMark(fn: () => void): void {
    markImpl = fn;
}

/** Called by music sheet / plugin code; bound in `upload.ts` at module load after `suppress` resolves. */
export function markWebdavLocalMutation(): void {
    markImpl?.();
}
