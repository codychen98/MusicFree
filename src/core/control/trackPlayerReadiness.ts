let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> = new Promise<void>(resolve => {
    readyResolve = resolve;
});

export function beginTrackPlayerInit(): void {
    readyPromise = new Promise<void>(resolve => {
        readyResolve = resolve;
    });
}

export function markTrackPlayerReady(): void {
    readyResolve?.();
    readyResolve = null;
}

export function waitForTrackPlayerReady(): Promise<void> {
    return readyPromise;
}
