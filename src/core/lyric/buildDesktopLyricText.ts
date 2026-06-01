import type { IParsedLrcItem } from "@/utils/lrcParser";

export type DesktopLineCount = 1 | 2 | 3;

export interface BuildDesktopLyricTextOptions {
    lyrics: readonly IParsedLrcItem[];
    current: IParsedLrcItem | null;
    lineCount: DesktopLineCount;
    /** Appended after lyric lines; does not consume a line-count slot. */
    showTranslation?: boolean;
}

function findItemArrayIndex(
    lyrics: readonly IParsedLrcItem[],
    current: IParsedLrcItem,
): number {
    const idx = lyrics.findIndex(item => item.index === current.index);
    return idx >= 0 ? idx : current.index;
}

function collectLyricLines(
    lyrics: readonly IParsedLrcItem[],
    current: IParsedLrcItem,
    lineCount: DesktopLineCount,
): string[] {
    const lines: string[] = [current.lrc ?? ""];
    if (lineCount <= 1) {
        return lines;
    }
    let scanIdx = findItemArrayIndex(lyrics, current) + 1;
    while (lines.length < lineCount && scanIdx < lyrics.length) {
        const text = lyrics[scanIdx]?.lrc?.trim() ?? "";
        if (text) {
            lines.push(text);
        }
        scanIdx += 1;
    }
    return lines;
}

export function buildDesktopLyricText(
    options: BuildDesktopLyricTextOptions,
): string {
    const { lyrics, current, lineCount, showTranslation = false } = options;
    if (!current) {
        return "";
    }
    const body = collectLyricLines(lyrics, current, lineCount).join("\n");
    const translation = current.translation?.trim() ?? "";
    if (showTranslation && translation) {
        return body ? `${body}\n${translation}` : translation;
    }
    return body;
}
