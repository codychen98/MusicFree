import { internalSerializeKey, supportLocalMediaType } from "@/constants/commonConst";
import pathConst from "@/constants/pathConst";
import { IAppConfig } from "@/types/core/config";
import { IInjectable } from "@/types/infra";
import { buildDownloadBasename } from "@/utils/downloadFilename";
import { addFileScheme, mkdirR } from "@/utils/fileUtils";
import { errorLog } from "@/utils/log";
import { patchMediaExtra } from "@/utils/mediaExtra";
import { getMediaUniqueKey, isSameMediaItem } from "@/utils/mediaUtils";
import network from "@/utils/network";
import { getQualityOrder } from "@/utils/qualities";
import EventEmitter from "eventemitter3";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { nanoid } from "nanoid";
import path from "path-browserify";
import { useEffect, useState } from "react";
import { copyFile, downloadFile, exists, unlink, writeFile } from "react-native-fs";
import { migrateTrackToWebdavSource } from "./migrateTrackToWebdavSource";
import LocalMusicSheet from "./localMusicSheet";
import { isWebdavDownloadTargetAvailable } from "./webdav-download/config";
import {
    getRemoteMusicConfig,
    remoteAudioExists,
    remotePathFor,
    uploadDownloadArtifacts,
} from "./webdav-download/upload";
import { IPluginManager } from "@/types/core/pluginManager";

interface SidecarLyricPaths {
    lrcPath?: string;
    tranLrcPath?: string;
}


export enum DownloadStatus {
    // 等待下载
    Pending,
    // 准备下载链接
    Preparing,
    // 下载中
    Downloading,
    // 下载完成
    Completed,
    // 下载失败
    Error
}


export enum DownloaderEvent {
    // 某次下载行为出错
    DownloadError = "download-error",

    // 下载任务更新
    DownloadTaskUpdate = "download-task-update",

    // 下载某个音乐时出错
    DownloadTaskError = "download-task-error",

    // 下载完成
    DownloadQueueCompleted = "download-queue-completed",

    /** WebDAV 6B: remote audio already exists; upload skipped */
    WebdavAudioSkipped = "webdav-audio-skipped",

    /** WebDAV upload failed; file saved locally instead */
    WebdavUploadFallback = "webdav-upload-fallback",
}

export enum DownloadFailReason {
    /** 无网络 */
    NetworkOffline = "network-offline",
    /** 设置-禁止在移动网络下下载 */
    NotAllowToDownloadInCellular = "not-allow-to-download-in-cellular",
    /** 无法获取到媒体源 */
    FailToFetchSource = "no-valid-source",
    /** 没有文件写入的权限 */
    NoWritePermission = "no-write-permission",
    Unknown = "unknown",
}

interface IDownloadTaskInfo {
    // 状态
    status: DownloadStatus;
    // 目标文件名
    filename: string;
    // 下载id
    jobId?: number;
    // 下载音质
    quality?: IMusic.IQualityKey;
    // 文件大小
    fileSize?: number;
    // 已下载大小
    downloadedSize?: number;
    // 音乐信息
    musicItem: IMusic.IMusicItem;
    // 如果下载失败，下载失败的原因
    errorReason?: DownloadFailReason;

    /** Optional preflight result (WebDAV destination only). */
    preparedSource?: {
        url: string;
        headers?: Record<string, string>;
        extension: string;
    };
}


const downloadQueueAtom = atom<IMusic.IMusicItem[]>([]);
const downloadTasks = new Map<string, IDownloadTaskInfo>();


interface IEvents {
    /** 某次下载行为出现报错 */
    [DownloaderEvent.DownloadError]: (reason: DownloadFailReason, error?: Error) => void;
    /** 下载某个媒体时报错 */
    [DownloaderEvent.DownloadTaskError]: (reason: DownloadFailReason, mediaItem: IMusic.IMusicItem, error?: Error) => void;
    /** 下载任务更新 */
    [DownloaderEvent.DownloadTaskUpdate]: (task: IDownloadTaskInfo) => void;
    /** 下载队列清空 */
    [DownloaderEvent.DownloadQueueCompleted]: () => void;
    /** WebDAV 目标：远端已有同名音频，跳过上传 */
    [DownloaderEvent.WebdavAudioSkipped]: (mediaItem: IMusic.IMusicItem) => void;
    /** WebDAV 上传失败，已回退到本地文件夹（reason 供 toast 展示） */
    [DownloaderEvent.WebdavUploadFallback]: (
        mediaItem: IMusic.IMusicItem,
        reason: string,
    ) => void;
}

class Downloader extends EventEmitter<IEvents> implements IInjectable {
    private configService!: IAppConfig;
    private pluginManagerService!: IPluginManager;

    private downloadingCount = 0;

    private static generateFilename(musicItem: IMusic.IMusicItem) {
        return buildDownloadBasename(musicItem);
    }

    /**
     * Write sibling `.lrc` / `.tran.lrc` next to the downloaded audio file.
     * Failures are logged only; they do not fail the download task.
     */
    private async writeSidecarLyrics(
        musicItem: IMusic.IMusicItem,
        audioPath: string,
    ): Promise<SidecarLyricPaths> {
        try {
            const plugin = this.pluginManagerService.getByMedia(musicItem);
            const lrcSource = await plugin?.methods
                ?.getLyric(musicItem)
                ?.catch(() => null);
            if (!lrcSource) {
                return {};
            }

            const lastDot = audioPath.lastIndexOf(".");
            if (lastDot === -1) {
                return {};
            }
            const basePath = audioPath.slice(0, lastDot);
            const paths: SidecarLyricPaths = {};

            if (lrcSource.rawLrc) {
                const lrcPath = `${basePath}.lrc`;
                await writeFile(lrcPath, lrcSource.rawLrc, "utf8");
                paths.lrcPath = lrcPath;
            }
            if (lrcSource.translation) {
                const tranPath = `${basePath}.tran.lrc`;
                await writeFile(tranPath, lrcSource.translation, "utf8");
                paths.tranLrcPath = tranPath;
            }
            return paths;
        } catch (e: unknown) {
            errorLog("下载-写入歌词失败", {
                item: {
                    id: musicItem.id,
                    title: musicItem.title,
                    platform: musicItem.platform,
                },
                reason: e instanceof Error ? e.message : e,
            });
            return {};
        }
    }

    private shouldUseWebdavDownloadDestination(): boolean {
        const destination =
            this.configService.getConfig("basic.downloadDestination") ?? "local";
        return destination === "webdav" && isWebdavDownloadTargetAvailable();
    }

    private async ensureLocalDownloadFolder(targetDownloadPath: string): Promise<boolean> {
        try {
            const folder = path.dirname(targetDownloadPath);
            const folderExists = await exists(folder);
            if (!folderExists) {
                await mkdirR(folder);
            }
            return true;
        } catch (e: unknown) {
            return false;
        }
    }

    private async finalizeLocalDownload(
        cacheDownloadPath: string,
        targetDownloadPath: string,
        musicItem: IMusic.IMusicItem,
    ): Promise<void> {
        await copyFile(cacheDownloadPath, targetDownloadPath);
        await this.writeSidecarLyrics(musicItem, targetDownloadPath);

        LocalMusicSheet.addMusic({
            ...musicItem,
            [internalSerializeKey]: {
                localPath: targetDownloadPath,
            },
        });

        patchMediaExtra(musicItem, {
            downloaded: true,
            localPath: targetDownloadPath,
        });
    }

    private async completeWebdavDownload(
        cacheDownloadPath: string,
        musicItem: IMusic.IMusicItem,
        audioFilename: string,
    ): Promise<{ audioSkipped: boolean }> {
        const sidecars = await this.writeSidecarLyrics(musicItem, cacheDownloadPath);
        const uploadResult = await uploadDownloadArtifacts({
            localAudioPath: cacheDownloadPath,
            audioFilename,
            localLrcPath: sidecars.lrcPath ?? null,
            localTranLrcPath: sidecars.tranLrcPath ?? null,
        });

        await migrateTrackToWebdavSource(musicItem, {
            remotePath: uploadResult.remoteAudioPath,
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album,
            duration: musicItem.duration,
        });

        return { audioSkipped: uploadResult.audioSkipped };
    }

    injectDependencies(configService: IAppConfig, pluginManager: IPluginManager): void {
        this.configService = configService;
        this.pluginManagerService = pluginManager;
    }

    private updateDownloadTask(musicItem: IMusic.IMusicItem, patch: Partial<IDownloadTaskInfo>) {
        const newValue = {
            ...downloadTasks.get(getMediaUniqueKey(musicItem)),
            ...patch,
        } as IDownloadTaskInfo;
        downloadTasks.set(getMediaUniqueKey(musicItem), newValue);
        this.emit(DownloaderEvent.DownloadTaskUpdate, newValue);
        return newValue;
    }

    // 开始下载
    private markTaskAsStarted(musicItem: IMusic.IMusicItem) {
        this.downloadingCount++;
        this.updateDownloadTask(musicItem, {
            status: DownloadStatus.Preparing,
        });
    }

    private markTaskAsCompleted(musicItem: IMusic.IMusicItem) {
        this.downloadingCount--;
        this.updateDownloadTask(musicItem, {
            status: DownloadStatus.Completed,
        });
    }

    private markTaskAsError(musicItem: IMusic.IMusicItem, reason: DownloadFailReason, error?: Error) {
        this.downloadingCount--;
        this.updateDownloadTask(musicItem, {
            status: DownloadStatus.Error,
            errorReason: reason,
        });
        this.emit(DownloaderEvent.DownloadTaskError, reason, musicItem, error);
    }

    /** 匹配文件后缀 */
    private getExtensionName(url: string) {
        const regResult = url.match(
            /^https?\:\/\/.+\.([^\?\.]+?$)|(?:([^\.]+?)\?.+$)/,
        );
        if (regResult) {
            return regResult[1] ?? regResult[2] ?? "mp3";
        } else {
            return "mp3";
        }
    };

    /** 获取下载路径 */
    private getDownloadPath(fileName: string) {
        const dlPath =
            this.configService.getConfig("basic.downloadPath") ?? pathConst.downloadMusicPath;
        if (!dlPath.endsWith("/")) {
            return `${dlPath}/${fileName ?? ""}`;
        }
        return fileName ? dlPath + fileName : dlPath;
    };

    /** 获取缓存的下载路径 */
    private getCacheDownloadPath(fileName: string) {
        const cachePath = pathConst.downloadCachePath;
        if (!cachePath.endsWith("/")) {
            return `${cachePath}/${fileName ?? ""}`;
        }
        return fileName ? cachePath + fileName : cachePath;
    }


    private async downloadNextPendingTask() {
        const maxDownloadCount = Math.max(1, Math.min(+(this.configService.getConfig("basic.maxDownload") || 3), 10));
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);

        // 如果超过最大下载数量，或者没有下载任务，则不执行
        if (this.downloadingCount >= maxDownloadCount || this.downloadingCount >= downloadQueue.length) {
            return;
        }

        // 寻找下一个pending task
        let nextTask: IDownloadTaskInfo | null = null;
        for (let i = 0; i < downloadQueue.length; i++) {
            const musicItem = downloadQueue[i];
            const key = getMediaUniqueKey(musicItem);
            const task = downloadTasks.get(key);
            if (task && task.status === DownloadStatus.Pending) {
                nextTask = task;
                break;
            }
        }

        // 没有下一个任务了
        if (!nextTask) {
            if (this.downloadingCount === 0) {
                this.emit(DownloaderEvent.DownloadQueueCompleted);
            }
            return;
        }

        const musicItem = nextTask.musicItem;
        // 更新下载状态
        this.markTaskAsStarted(musicItem);

        let url = nextTask.preparedSource?.url ?? musicItem.url;
        let headers = nextTask.preparedSource?.headers ?? musicItem.headers;

        const plugin = this.pluginManagerService.getByName(musicItem.platform);

        try {
            if (!nextTask.preparedSource && plugin) {
                const qualityOrder = getQualityOrder(
                    nextTask.quality ??
                    this.configService.getConfig("basic.defaultDownloadQuality") ??
                    "standard",
                    this.configService.getConfig("basic.downloadQualityOrder") ?? "asc",
                );
                let data: IPlugin.IMediaSourceResult | null = null;
                for (let quality of qualityOrder) {
                    try {
                        data = await plugin.methods.getMediaSource(
                            musicItem,
                            quality,
                            1,
                            true,
                        );
                        if (!data?.url) {
                            continue;
                        }
                        break;
                    } catch { }
                }
                url = data?.url ?? url;
                headers = data?.headers;
            }
            if (!url) {
                throw new Error(DownloadFailReason.FailToFetchSource);
            }
        } catch (e: any) {
            /** 无法下载，跳过 */
            errorLog("下载失败-无法获取下载链接", {
                item: {
                    id: musicItem.id,
                    title: musicItem.title,
                    platform: musicItem.platform,
                    quality: nextTask.quality,
                },
                reason: e?.message ?? e,
            });

            if (e.message === DownloadFailReason.FailToFetchSource) {
                this.markTaskAsError(musicItem, DownloadFailReason.FailToFetchSource, e);
            } else {
                this.markTaskAsError(musicItem, DownloadFailReason.Unknown, e);
            }
            this.downloadNextPendingTask();
            return;
        }

        // 预处理完成，可以开始处理下一个任务
        this.downloadNextPendingTask();

        // 下载逻辑
        // 识别文件后缀
        let extension =
            nextTask.preparedSource?.extension ?? this.getExtensionName(url);
        if (supportLocalMediaType.every(item => item !== ("." + extension))) {
            extension = "mp3";
        }

        const audioFilename = `${nextTask.filename}.${extension}`;

        // 缓存下载地址
        const cacheDownloadPath = addFileScheme(
            this.getCacheDownloadPath(`${nanoid()}.${extension}`),
        );

        const useWebdavDestination = this.shouldUseWebdavDownloadDestination();

        // 真实下载地址（仅本地模式需要）
        const targetDownloadPath = useWebdavDestination
            ? null
            : addFileScheme(this.getDownloadPath(audioFilename));

        if (useWebdavDestination) {
            try {
                const remoteCheck = await remoteAudioExists({
                    audioFilename,
                });
                const remoteAudioPath = remoteCheck.remoteAudioPath;
                if (remoteCheck.exists) {
                    await migrateTrackToWebdavSource(musicItem, {
                        remotePath: remoteAudioPath,
                        title: musicItem.title,
                        artist: musicItem.artist,
                        album: musicItem.album,
                        duration: musicItem.duration,
                    });
                    this.emit(DownloaderEvent.WebdavAudioSkipped, musicItem);
                    this.markTaskAsCompleted(musicItem);
                    this.downloadNextPendingTask();

                    const key = getMediaUniqueKey(musicItem);
                    if (downloadTasks.get(key)?.status === DownloadStatus.Completed) {
                        downloadTasks.delete(key);
                        const downloadQueue = getDefaultStore().get(
                            downloadQueueAtom,
                        );
                        const newDownloadQueue = downloadQueue.filter(
                            item => !isSameMediaItem(item, musicItem),
                        );
                        getDefaultStore().set(downloadQueueAtom, newDownloadQueue);
                    }
                    return;
                }
            } catch (e: unknown) {
                // Pre-check failure should not block download; fallback to normal flow.
                errorLog("下载-WebDAV远端存在性预检查失败", {
                    item: {
                        id: musicItem.id,
                        title: musicItem.title,
                        platform: musicItem.platform,
                    },
                    reason: e instanceof Error ? e.message : e,
                });
            }
        }

        if (targetDownloadPath) {
            const folderReady = await this.ensureLocalDownloadFolder(targetDownloadPath);
            if (!folderReady) {
                this.markTaskAsError(
                    musicItem,
                    DownloadFailReason.NoWritePermission,
                    new Error("mkdir failed"),
                );
                this.downloadNextPendingTask();
                return;
            }
        }

        // 下载
        const { promise } = downloadFile({
            fromUrl: url ?? "",
            toFile: cacheDownloadPath,
            headers: headers,
            background: true,
            begin: (res) => {
                this.updateDownloadTask(musicItem, {
                    status: DownloadStatus.Downloading,
                    downloadedSize: 0,
                    fileSize: res.contentLength,
                    jobId: res.jobId,
                });
            },
            progress: (res) => {
                this.updateDownloadTask(musicItem, {
                    status: DownloadStatus.Downloading,
                    downloadedSize: res.bytesWritten,
                    fileSize: res.contentLength,
                    jobId: res.jobId,
                });
            },
        });

        try {
            await promise;

            if (useWebdavDestination) {
                try {
                    const webdavResult = await this.completeWebdavDownload(
                        cacheDownloadPath,
                        musicItem,
                        audioFilename,
                    );
                    if (webdavResult.audioSkipped) {
                        this.emit(
                            DownloaderEvent.WebdavAudioSkipped,
                            musicItem,
                        );
                    }
                } catch (uploadError: unknown) {
                    const uploadReason =
                        uploadError instanceof Error
                            ? uploadError.message
                            : String(uploadError);
                    errorLog("下载-WebDAV上传失败，回退本地", {
                        item: {
                            id: musicItem.id,
                            title: musicItem.title,
                            platform: musicItem.platform,
                        },
                        reason: uploadReason,
                    });
                    const fallbackTarget = addFileScheme(
                        this.getDownloadPath(audioFilename),
                    );
                    const folderReady =
                        await this.ensureLocalDownloadFolder(fallbackTarget);
                    if (!folderReady) {
                        throw uploadError;
                    }
                    await this.finalizeLocalDownload(
                        cacheDownloadPath,
                        fallbackTarget,
                        musicItem,
                    );
                    this.emit(
                        DownloaderEvent.WebdavUploadFallback,
                        musicItem,
                        uploadReason,
                    );
                }
            } else {
                await this.finalizeLocalDownload(
                    cacheDownloadPath,
                    targetDownloadPath!,
                    musicItem,
                );
            }

            this.markTaskAsCompleted(musicItem);
        } catch (e: any) {
            this.markTaskAsError(musicItem, DownloadFailReason.Unknown, e);
        } finally {
            try {
                await unlink(cacheDownloadPath);
            } catch { }

            this.downloadNextPendingTask();

            // 如果任务状态是完成，则从队列中移除
            const key = getMediaUniqueKey(musicItem);
            if (downloadTasks.get(key)?.status === DownloadStatus.Completed) {
                downloadTasks.delete(key);
                const downloadQueue = getDefaultStore().get(downloadQueueAtom);
                const newDownloadQueue = downloadQueue.filter(item => !isSameMediaItem(item, musicItem));
                getDefaultStore().set(downloadQueueAtom, newDownloadQueue);
            }
        }
    }

    download(musicItems: IMusic.IMusicItem | IMusic.IMusicItem[], quality?: IMusic.IQualityKey) {
        if (network.isOffline) {
            this.emit(DownloaderEvent.DownloadError, DownloadFailReason.NetworkOffline);
            return;
        }

        if (network.isCellular && !this.configService.getConfig("basic.useCelluarNetworkDownload")) {
            this.emit(DownloaderEvent.DownloadError, DownloadFailReason.NotAllowToDownloadInCellular);
            return;
        }

        // 整理成数组
        if (!Array.isArray(musicItems)) {
            musicItems = [musicItems];
        }

        // WebDAV destination: preflight first, then only queue missing items.
        if (this.shouldUseWebdavDownloadDestination()) {
            void this.preflightWebdavAndEnqueue(musicItems, quality);
            return;
        }

        // 防止重复下载
        musicItems = musicItems.filter(m => {
            const key = getMediaUniqueKey(m);
            // 如果存在下载任务
            if (downloadTasks.has(key)) {
                return false;
            }
            // TODO: 如果已经下载了，也应该返回false
            if (LocalMusicSheet.isLocalMusic(m)) {
                return false;
            }

            // 设置下载任务
            downloadTasks.set(getMediaUniqueKey(m), {
                status: DownloadStatus.Pending,
                filename: Downloader.generateFilename(m),
                quality: quality,
                musicItem: m,
            });

            return true;
        });

        if (!musicItems.length) {
            return;
        }

        // 添加进任务队列
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);
        const newDownloadQueue = [...downloadQueue, ...musicItems];
        getDefaultStore().set(downloadQueueAtom, newDownloadQueue);

        this.downloadNextPendingTask();
    }

    private async preflightWebdavAndEnqueue(
        musicItems: IMusic.IMusicItem[],
        quality?: IMusic.IQualityKey,
    ): Promise<void> {
        try {
            getRemoteMusicConfig();
        } catch {
            // If config is incomplete, fall back to normal queue behavior.
            this.download(musicItems, quality);
            return;
        }

        const candidates = musicItems.filter((m) => {
            const key = getMediaUniqueKey(m);
            if (downloadTasks.has(key)) {
                return false;
            }
            if (LocalMusicSheet.isLocalMusic(m)) {
                return false;
            }
            return true;
        });

        for (const musicItem of candidates) {
            try {
                const plugin = this.pluginManagerService.getByName(musicItem.platform);
                let url = musicItem.url;
                let headers = musicItem.headers;

                if (plugin) {
                    const qualityOrder = getQualityOrder(
                        quality ??
                        this.configService.getConfig("basic.defaultDownloadQuality") ??
                        "standard",
                        this.configService.getConfig("basic.downloadQualityOrder") ?? "asc",
                    );
                    let data: IPlugin.IMediaSourceResult | null = null;
                    for (let q of qualityOrder) {
                        try {
                            data = await plugin.methods.getMediaSource(
                                musicItem,
                                q,
                                1,
                                true,
                            );
                            if (!data?.url) {
                                continue;
                            }
                            break;
                        } catch { }
                    }
                    url = data?.url ?? url;
                    headers = data?.headers;
                }

                if (!url) {
                    continue;
                }

                let extension = this.getExtensionName(url);
                if (supportLocalMediaType.every(item => item !== ("." + extension))) {
                    extension = "mp3";
                }

                const audioFilename = `${Downloader.generateFilename(musicItem)}.${extension}`;
                const remoteCheck = await remoteAudioExists({
                    audioFilename,
                });
                const remoteAudioPath = remoteCheck.remoteAudioPath;
                if (remoteCheck.exists) {
                    await migrateTrackToWebdavSource(musicItem, {
                        remotePath: remoteAudioPath,
                        title: musicItem.title,
                        artist: musicItem.artist,
                        album: musicItem.album,
                        duration: musicItem.duration,
                    });
                    continue;
                }

                const key = getMediaUniqueKey(musicItem);
                downloadTasks.set(key, {
                    status: DownloadStatus.Pending,
                    filename: Downloader.generateFilename(musicItem),
                    quality: quality,
                    musicItem,
                    preparedSource: {
                        url,
                        headers,
                        extension,
                    },
                });

                const downloadQueue = getDefaultStore().get(downloadQueueAtom);
                getDefaultStore().set(downloadQueueAtom, [...downloadQueue, musicItem]);
            } catch (e: unknown) {
                errorLog("下载-WebDAV预检查失败（将继续下载）", {
                    item: {
                        id: musicItem.id,
                        title: musicItem.title,
                        platform: musicItem.platform,
                    },
                    reason: e instanceof Error ? e.message : e,
                });

                const key = getMediaUniqueKey(musicItem);
                if (!downloadTasks.has(key)) {
                    downloadTasks.set(key, {
                        status: DownloadStatus.Pending,
                        filename: Downloader.generateFilename(musicItem),
                        quality: quality,
                        musicItem,
                    });
                    const downloadQueue = getDefaultStore().get(downloadQueueAtom);
                    getDefaultStore().set(downloadQueueAtom, [...downloadQueue, musicItem]);
                }
            }
        }

        this.downloadNextPendingTask();
    }

    remove(musicItem: IMusic.IMusicItem) {
        // 删除下载任务
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (!task) {
            return false;
        }
        if (task.status === DownloadStatus.Pending || task.status === DownloadStatus.Error) {
            downloadTasks.delete(key);
            const downloadQueue = getDefaultStore().get(downloadQueueAtom);
            const newDownloadQueue = downloadQueue.filter(item => !isSameMediaItem(item, musicItem));
            getDefaultStore().set(downloadQueueAtom, newDownloadQueue);
            return true;
        }
        return false;
    }
}


const downloader = new Downloader();
export default downloader;

export function useDownloadTask(musicItem: IMusic.IMusicItem) {
    const [downloadStatus, setDownloadStatus] = useState(downloadTasks.get(getMediaUniqueKey(musicItem)) ?? null);

    useEffect(() => {
        const callback = (task: IDownloadTaskInfo) => {
            if (isSameMediaItem(task?.musicItem, musicItem)) {
                setDownloadStatus(task);
            }
        };
        downloader.on(DownloaderEvent.DownloadTaskUpdate, callback);

        return () => {
            downloader.off(DownloaderEvent.DownloadTaskUpdate, callback);
        };
    }, [musicItem]);

    return downloadStatus;
}

export const useDownloadQueue = () => useAtomValue(downloadQueueAtom);