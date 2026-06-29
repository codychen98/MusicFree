import { buildDownloadBasename } from "@/utils/downloadFilename";
import {
    lyricSidecarFilename,
    translationSidecarFilename,
} from "@/core/webdav-download/path";

function lastPathSeparatorIndex(filePath: string): number {
    const lastBackslash = filePath.lastIndexOf("\\");
    const lastSlash = filePath.lastIndexOf("/");
    return Math.max(lastBackslash, lastSlash);
}

function getPathDirname(filePath: string): string {
    const lastSep = lastPathSeparatorIndex(filePath);
    return lastSep === -1 ? "" : filePath.slice(0, lastSep);
}

function joinPath(dir: string, filename: string): string {
    if (!dir) {
        return filename;
    }
    const sep = dir.includes("\\") ? "\\" : "/";
    return `${dir.replace(/[/\\]+$/, "")}${sep}${filename.replace(/^[/\\]+/, "")}`;
}

export function getAudioBasename(audioFilenameOrPath: string): string {
    const lastSep = lastPathSeparatorIndex(audioFilenameOrPath);
    return lastSep === -1
        ? audioFilenameOrPath
        : audioFilenameOrPath.slice(lastSep + 1);
}

export function getAudioExtension(audioFilenameOrPath: string): string {
    const basename = getAudioBasename(audioFilenameOrPath);
    const lastDot = basename.lastIndexOf(".");
    if (lastDot === -1 || lastDot === basename.length - 1) {
        return "mp3";
    }
    return basename.slice(lastDot + 1);
}

export function buildRenamedAudioFilename(
    currentAudioFilename: string,
    title: string,
    artist: string,
): string {
    const ext = getAudioExtension(currentAudioFilename);
    return `${buildDownloadBasename({ title, artist })}.${ext}`;
}

export function buildNewLocalAudioPath(
    currentAudioPath: string,
    title: string,
    artist: string,
): string {
    const newFilename = buildRenamedAudioFilename(
        getAudioBasename(currentAudioPath),
        title,
        artist,
    );
    return joinPath(getPathDirname(currentAudioPath), newFilename);
}

export function localSidecarPathsForAudio(audioPath: string): {
    lrcPath: string;
    tranLrcPath: string;
} {
    const audioFilename = getAudioBasename(audioPath);
    const dir = getPathDirname(audioPath);
    return {
        lrcPath: joinPath(dir, lyricSidecarFilename(audioFilename)),
        tranLrcPath: joinPath(dir, translationSidecarFilename(audioFilename)),
    };
}
