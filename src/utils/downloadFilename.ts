/** Mirrors `escapeCharacter` in fileUtils, plus `@` for the v2 delimiter. */
const FILENAME_UNSAFE = /[/|\\?*"<>:@]+/g;

/** Max length for the combined `title@artist` basename (extension added separately). */
const MAX_BASENAME_LENGTH = 200;

export type DownloadBasenameFormat = "v2" | "legacy";

export interface ParsedDownloadBasename {
    format: DownloadBasenameFormat;
    title: string;
    artist: string;
    platform?: string;
    id?: string;
}

/**
 * Escape characters unsafe in filenames, including `@` so the v2 delimiter is unambiguous.
 */
export function escapeFilenameSegment(str?: string): string {
    return str !== undefined ? `${str}`.replace(FILENAME_UNSAFE, "_") : "";
}

/**
 * Build `title@artist` for on-disk download names (v2 format).
 */
export function buildDownloadBasename(musicItem: {
    title?: string;
    artist?: string;
}): string {
    const title = escapeFilenameSegment(musicItem.title);
    const artist = escapeFilenameSegment(musicItem.artist);
    return `${title}@${artist}`.slice(0, MAX_BASENAME_LENGTH);
}

/**
 * Parse a filename without extension into title/artist (v2 or legacy four-part format).
 *
 * | Format  | Detection                         | Title        | Artist              |
 * |---------|-----------------------------------|--------------|---------------------|
 * | v2      | Exactly two `@`-segments          | Before `@`   | After `@`           |
 * | legacy  | Four or more `@`-segments         | Segment 2    | `slice(3).join('@')`|
 */
export function parseDownloadBasename(
    filenameWithoutExt: string,
): ParsedDownloadBasename | null {
    const segments = filenameWithoutExt.split("@");

    if (segments.length >= 4) {
        const [platform, id, title, ...artistParts] = segments;
        if (!platform || !id) {
            return null;
        }
        return {
            format: "legacy",
            platform,
            id,
            title: title ?? "",
            artist: artistParts.join("@"),
        };
    }

    if (segments.length === 2) {
        const [title, artist] = segments;
        return {
            format: "v2",
            title: title ?? "",
            artist: artist ?? "",
        };
    }

    return null;
}
