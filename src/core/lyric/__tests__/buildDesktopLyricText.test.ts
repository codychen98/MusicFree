import type { IParsedLrcItem } from "@/utils/lrcParser";
import { buildDesktopLyricText } from "../buildDesktopLyricText";

function line(
    index: number,
    lrc: string,
    translation?: string,
): IParsedLrcItem {
    return { index, time: index, lrc, translation };
}

const sampleLyrics: IParsedLrcItem[] = [
    line(0, "第一行"),
    line(1, "第二行"),
    line(2, ""),
    line(3, "第四行"),
    line(4, "第五行"),
];

describe("buildDesktopLyricText", () => {
    it("returns empty string when current is null", () => {
        expect(
            buildDesktopLyricText({
                lyrics: sampleLyrics,
                current: null,
                lineCount: 1,
            }),
        ).toBe("");
    });

    it("shows one line for lineCount 1", () => {
        expect(
            buildDesktopLyricText({
                lyrics: sampleLyrics,
                current: sampleLyrics[0],
                lineCount: 1,
            }),
        ).toBe("第一行");
    });

    it("shows current and next non-empty line for lineCount 2", () => {
        expect(
            buildDesktopLyricText({
                lyrics: sampleLyrics,
                current: sampleLyrics[0],
                lineCount: 2,
            }),
        ).toBe("第一行\n第二行");
    });

    it("skips empty next lines when collecting for lineCount 3", () => {
        expect(
            buildDesktopLyricText({
                lyrics: sampleLyrics,
                current: sampleLyrics[1],
                lineCount: 3,
            }),
        ).toBe("第二行\n第四行\n第五行");
    });

    it("at end of track returns only available lines", () => {
        expect(
            buildDesktopLyricText({
                lyrics: sampleLyrics,
                current: sampleLyrics[4],
                lineCount: 3,
            }),
        ).toBe("第五行");
    });

    it("includes empty current line when lineCount is 1", () => {
        expect(
            buildDesktopLyricText({
                lyrics: sampleLyrics,
                current: sampleLyrics[2],
                lineCount: 1,
            }),
        ).toBe("");
    });

    it("appends translation without consuming a line slot", () => {
        expect(
            buildDesktopLyricText({
                lyrics: sampleLyrics,
                current: line(0, "Hello", "你好"),
                lineCount: 2,
                showTranslation: true,
            }),
        ).toBe("Hello\n第二行\n你好");
    });

    it("returns translation only when current lrc is empty and showTranslation", () => {
        expect(
            buildDesktopLyricText({
                lyrics: [line(0, "", "译")],
                current: line(0, "", "译"),
                lineCount: 1,
                showTranslation: true,
            }),
        ).toBe("译");
    });
});
