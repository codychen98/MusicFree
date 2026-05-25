/** First comma-separated segment of plugin `searchPath`, normalized slashes. */
export function resolveFirstSearchPathSegment(
    searchPath: string | undefined,
): string {
    if (!searchPath?.trim()) {
        return "";
    }
    const first = searchPath.split(",")[0]?.trim() ?? "";
    if (!first) {
        return "";
    }
    return first.replace(/\\/g, "/").replace(/\/+$/, "") || first;
}

/** Alias for plugin upload remote directory (first `searchPath` segment). */
export function resolveRemoteDir(searchPath: string | undefined): string {
    return resolveFirstSearchPathSegment(searchPath);
}

/** Join remote directory and file basename (WebDAV full path). */
export function remotePathFor(remoteDir: string, filename: string): string {
    const dir = remoteDir.replace(/\\/g, "/").replace(/\/+$/, "");
    const base = filename.replace(/^\/+/, "");
    if (!dir) {
        return `/${base}`;
    }
    if (dir === "/") {
        return `/${base}`;
    }
    return `${dir}/${base}`;
}

export function lyricSidecarFilename(audioFilename: string): string {
    const lastDot = audioFilename.lastIndexOf(".");
    const base =
        lastDot === -1 ? audioFilename : audioFilename.slice(0, lastDot);
    return `${base}.lrc`;
}

export function translationSidecarFilename(audioFilename: string): string {
    const lastDot = audioFilename.lastIndexOf(".");
    const base =
        lastDot === -1 ? audioFilename : audioFilename.slice(0, lastDot);
    return `${base}.tran.lrc`;
}
