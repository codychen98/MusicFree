import {
    buildDownloadBasename,
    escapeFilenameSegment,
    parseDownloadBasename,
} from "../downloadFilename";

describe("escapeFilenameSegment", () => {
    it("escapes @ in title and artist segments", () => {
        expect(escapeFilenameSegment("a@b")).toBe("a_b");
    });

    it("escapes path-unsafe characters like escapeCharacter", () => {
        expect(escapeFilenameSegment('a/b?c*"d')).toBe("a_b_c_d");
    });
});

describe("buildDownloadBasename", () => {
    it("joins title and artist with @", () => {
        expect(
            buildDownloadBasename({ title: "最后一页", artist: "江语晨" }),
        ).toBe("最后一页@江语晨");
    });

    it("escapes @ inside title or artist", () => {
        expect(
            buildDownloadBasename({ title: "a@b", artist: "c" }),
        ).toBe("a_b@c");
    });

    it("truncates combined basename to 200 characters", () => {
        const longTitle = "t".repeat(150);
        const longArtist = "a".repeat(100);
        expect(buildDownloadBasename({ title: longTitle, artist: longArtist }).length).toBe(
            200,
        );
    });
});

describe("parseDownloadBasename", () => {
    it("parses v2 title@artist", () => {
        expect(parseDownloadBasename("最后一页@江语晨")).toEqual({
            format: "v2",
            title: "最后一页",
            artist: "江语晨",
        });
    });

    it("parses legacy platform@id@title@artist", () => {
        expect(parseDownloadBasename("网易(a)@1@最后一页@江语晨")).toEqual({
            format: "legacy",
            platform: "网易(a)",
            id: "1",
            title: "最后一页",
            artist: "江语晨",
        });
    });

    it("joins legacy artist when it contains @", () => {
        expect(parseDownloadBasename("p@id@title@a@b")).toEqual({
            format: "legacy",
            platform: "p",
            id: "id",
            title: "title",
            artist: "a@b",
        });
    });

    it("returns null for legacy without platform or id", () => {
        expect(parseDownloadBasename("@id@title@artist")).toBeNull();
        expect(parseDownloadBasename("p@@title@artist")).toBeNull();
    });

    it("returns null for ambiguous segment counts", () => {
        expect(parseDownloadBasename("only-title")).toBeNull();
        expect(parseDownloadBasename("a@b@c")).toBeNull();
    });
});
