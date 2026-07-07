const mockGetFSInfo = jest.fn();

jest.mock("react-native-fs", () => ({
    getFSInfo: (...args: unknown[]) => mockGetFSInfo(...args),
}));

jest.mock("@/utils/log", () => ({
    errorLog: jest.fn(),
}));

import { hasSufficientFreeSpace, MIN_FREE_SPACE_BYTES } from "../free-space";

describe("hasSufficientFreeSpace", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns true when free space is at or above the threshold", async () => {
        mockGetFSInfo.mockResolvedValue({ freeSpace: MIN_FREE_SPACE_BYTES });
        expect(await hasSufficientFreeSpace()).toBe(true);
    });

    it("returns false when free space is below the threshold", async () => {
        mockGetFSInfo.mockResolvedValue({ freeSpace: MIN_FREE_SPACE_BYTES - 1 });
        expect(await hasSufficientFreeSpace()).toBe(false);
    });

    it("honors a custom threshold", async () => {
        mockGetFSInfo.mockResolvedValue({ freeSpace: 100 });
        expect(await hasSufficientFreeSpace(50)).toBe(true);
        expect(await hasSufficientFreeSpace(200)).toBe(false);
    });

    it("fails open (returns true) when free space cannot be determined", async () => {
        mockGetFSInfo.mockRejectedValue(new Error("boom"));
        expect(await hasSufficientFreeSpace()).toBe(true);
    });
});
