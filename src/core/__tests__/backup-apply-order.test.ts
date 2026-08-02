const mockApplyPluginOrderMap = jest.fn();
const mockGetEnabledPlugins = jest.fn(() => []);
const mockInstallPluginFromUrl = jest.fn(() => Promise.resolve());
const mockResumeSheets = jest.fn(() => Promise.resolve());
const mockResumeSheetsFullOverwrite = jest.fn(() => Promise.resolve());
const mockGetPluginOrder = jest.fn(() => ({}));

jest.mock("nanoid", () => ({
    nanoid: () => "test-nanoid",
}));

const commonConstMock = {
    ResumeMode: {
        Append: "append",
        Overwrite: "overwrite",
        OverwriteDefault: "overwrite-default",
    },
};
jest.mock("@/constants/commonConst.ts", () => commonConstMock);
jest.mock("@/constants/commonConst", () => commonConstMock);

jest.mock("@/core/pluginManager", () => ({
    __esModule: true,
    default: {
        getEnabledPlugins: (...args: unknown[]) => mockGetEnabledPlugins(...args),
        installPluginFromUrl: (...args: unknown[]) =>
            mockInstallPluginFromUrl(...args),
    },
    applyPluginOrderMap: (...args: unknown[]) => mockApplyPluginOrderMap(...args),
}));

jest.mock("@/core/pluginManager/meta", () => ({
    __esModule: true,
    default: {
        getPluginOrder: (...args: unknown[]) => mockGetPluginOrder(...args),
    },
}));

jest.mock("@/core/musicSheet", () => ({
    __esModule: true,
    default: {
        backupSheets: jest.fn(() => []),
        resumeSheets: (...args: unknown[]) => mockResumeSheets(...args),
        resumeSheetsFullOverwrite: (...args: unknown[]) =>
            mockResumeSheetsFullOverwrite(...args),
    },
}));

jest.mock("@/core/appConfig", () => ({
    __esModule: true,
    default: {
        getConfig: jest.fn(),
        setConfig: jest.fn(),
    },
}));

jest.mock("@/core/webdav-sync/suppress", () => ({
    runWithoutWebdavSyncNotify: async <T>(fn: () => Promise<T>) => fn(),
}));

jest.mock("@/core/remote-storage/remote-config", () => ({
    getRemoteBackupSourceDeviceId: jest.fn(() => "test-device"),
}));

import Backup from "@/core/backup";

describe("Backup.resume pluginOrder apply", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetEnabledPlugins.mockReturnValue([]);
        mockInstallPluginFromUrl.mockResolvedValue(undefined);
        mockResumeSheets.mockResolvedValue(undefined);
        mockResumeSheetsFullOverwrite.mockResolvedValue(undefined);
    });

    it("applies remote pluginOrder via applyPluginOrderMap (remote-wins)", async () => {
        const pluginOrder = {
            "网易(bimiao音源)": 0,
            WebDAV: 1,
            Ciallo: 2,
        };

        await Backup.resume({
            musicSheets: [],
            plugins: [],
            pluginOrder,
        });

        expect(mockApplyPluginOrderMap).toHaveBeenCalledTimes(1);
        expect(mockApplyPluginOrderMap).toHaveBeenCalledWith(pluginOrder);
    });

    it("does not touch order when pluginOrder is missing (legacy backup)", async () => {
        await Backup.resume({
            musicSheets: [],
            plugins: [],
        });

        expect(mockApplyPluginOrderMap).not.toHaveBeenCalled();
    });

    it("does not touch order when pluginOrder is invalid", async () => {
        await Backup.resume({
            musicSheets: [],
            plugins: [],
            pluginOrder: [] as unknown as Record<string, number>,
        });

        expect(mockApplyPluginOrderMap).not.toHaveBeenCalled();
    });

    it("applies order on WebDAV full-overwrite resume path", async () => {
        const pluginOrder = { WebDAV: 0, Other: 1 };

        await Backup.resumeFromWebdavRemote({
            musicSheets: [],
            plugins: [],
            pluginOrder,
            syncMeta: { updatedAt: 1, sourceDeviceId: "pc" },
        });

        expect(mockApplyPluginOrderMap).toHaveBeenCalledWith(pluginOrder);
        expect(mockResumeSheetsFullOverwrite).toHaveBeenCalled();
        expect(mockResumeSheets).not.toHaveBeenCalled();
    });

    it("applies order before sheet resume on Append mode", async () => {
        const callOrder: string[] = [];
        mockApplyPluginOrderMap.mockImplementation(() => {
            callOrder.push("order");
        });
        mockResumeSheets.mockImplementation(() => {
            callOrder.push("sheets");
            return Promise.resolve();
        });

        await Backup.resume(
            {
                musicSheets: [],
                plugins: [],
                pluginOrder: { A: 0 },
            },
            "append" as never,
        );

        expect(callOrder).toEqual(["order", "sheets"]);
    });
});
