import ListItem, { ListItemHeader } from "@/components/base/listItem";
import ThemeSwitch from "@/components/base/switch";
import Backup from "@/core/backup";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import Toast from "@/utils/toast";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";

import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import axios from "axios";

import { ResumeMode } from "@/constants/commonConst.ts";
import Config, { useAppConfig } from "@/core/appConfig";
import {
    fetchRemoteBackupRaw,
    pullRemoteSnapshotWithOverwriteGate,
} from "@/core/webdav-sync/bootstrap";
import {
    cancelScheduledRemoteUpload,
    uploadBackupToRemote,
} from "@/core/webdav-sync/upload";
import {
    isRemoteCredentialsComplete,
    recordRemoteUploadSuccess,
} from "@/core/webdav-sync/config";
import {
    getRemoteStorageCredentialsFromConfig,
    isPcloudTokenFieldPresentButInvalidInConfig,
    type RemoteConfigSnapshot,
} from "@/core/remote-storage/remote-config";
import { resolveRemoteTransport } from "@/core/remote-storage/resolve";
import { useI18N } from "@/core/i18n";

const PCLOUD_HOSTNAME_US = "api.pcloud.com";
const PCLOUD_HOSTNAME_EU = "eapi.pcloud.com";
import delay from "@/utils/delay";
import { writeInChunks } from "@/utils/fileUtils.ts";
import { errorLog } from "@/utils/log.ts";
import { getDocumentAsync } from "expo-document-picker";
import { readAsStringAsync } from "expo-file-system";
export default function BackupSetting() {
    const { t } = useI18N();
    const navigate = useNavigate();

    const resumeMode = useAppConfig("backup.resumeMode");
    const webdavUrl = useAppConfig("backup.webdav.url");
    const webdavRootPath = useAppConfig("backup.webdav.rootPath");
    const webdavUsername = useAppConfig("backup.webdav.username");
    const webdavPassword = useAppConfig("backup.webdav.password");
    const pcloudHostname = useAppConfig("backup.remote.pcloud.hostname");
    const pcloudToken = useAppConfig("backup.remote.pcloud.tokenJson");
    const remoteMusicPath = useAppConfig("backup.remote.musicPath");
    const remoteAutoSync = useAppConfig("backup.remote.autoSync");

    const remoteSnapshot: RemoteConfigSnapshot = {
        "backup.webdav.url": webdavUrl,
        "backup.webdav.rootPath": webdavRootPath,
        "backup.webdav.username": webdavUsername,
        "backup.webdav.password": webdavPassword,
        "backup.remote.pcloud.hostname": pcloudHostname,
        "backup.remote.pcloud.tokenJson": pcloudToken,
        "backup.remote.musicPath": remoteMusicPath,
    };

    const transport = resolveRemoteTransport(
        getRemoteStorageCredentialsFromConfig(remoteSnapshot),
    );
    const remoteCredentialsComplete = transport !== null;
    const pcloudTokenInvalid =
        isPcloudTokenFieldPresentButInvalidInConfig(remoteSnapshot);

    const transportStatusText =
        transport === "pcloud"
            ? t("backupAndResume.remoteTransport.pcloud")
            : transport === "webdav"
                ? t("backupAndResume.remoteTransport.webdav")
                : t("backupAndResume.remoteTransport.none");

    const pcloudRegionText =
        `${pcloudHostname ?? ""}`.trim() === PCLOUD_HOSTNAME_EU
            ? t("backupAndResume.pcloudRegion.eu")
            : t("backupAndResume.pcloudRegion.us");


    const onBackupToLocal = async () => {
        navigate(ROUTE_PATH.FILE_SELECTOR, {
            fileType: "folder",
            multi: false,
            actionText: t("backupAndResume.beginBackup"),
            async onAction(selectedFiles) {
                const raw = Backup.backup();
                const folder = selectedFiles[0]?.path;
                return new Promise(resolve => {
                    showDialog("LoadingDialog", {
                        title: t("backupAndResume.backupDialogTitle"),
                        loadingText: t("backupAndResume.backuping"),
                        promise: writeInChunks(
                            `${folder}${folder?.endsWith("/") ? "" : "/"
                            }backup.json`,
                            raw,
                        ),
                        onResolve(_, hideDialog) {
                            Toast.success(t("toast.backupSuccess"));
                            hideDialog();
                            resolve(true);
                        },
                        onCancel(hideDialog) {
                            hideDialog();
                            resolve(false);
                        },
                        onReject(reason, hideDialog) {
                            hideDialog();
                            resolve(false);
                            console.log(reason);
                            Toast.warn(t("toast.backupFail", { reason: reason?.message ?? reason }));
                        },
                    });
                });
            },
        });
    };

    async function onResumeFromLocal() {
        try {
            const pickResult = await getDocumentAsync({
                copyToCacheDirectory: true,
                type: "application/json",
            });
            if (pickResult.canceled) {
                return;
            }
            const result = await readAsStringAsync(pickResult.assets[0].uri);
            return new Promise(resolve => {
                showDialog("LoadingDialog", {
                    title: t("backupAndResume.resumeFromLocalFile"),
                    loadingText: t("backupAndResume.resuming"),
                    async task() {
                        await delay(300, false);
                        return Backup.resume(result, resumeMode);
                    },
                    onResolve(_, hideDialog) {
                        Toast.success(t("toast.resumeSuccess"));
                        hideDialog();
                        resolve(true);
                    },
                    onCancel(hideDialog) {
                        hideDialog();
                        resolve(false);
                    },
                    onReject(reason, hideDialog) {
                        hideDialog();
                        resolve(false);
                        console.log(reason);
                        Toast.warn(t("toast.resumeFail", { reason: reason?.message ?? reason }));
                    },
                });
            });
        } catch (e: any) {
            errorLog("恢复失败", e);
            Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
        }
    }

    async function onResumeFromUrl() {
        showPanel("SimpleInput", {
            title: t("backupAndResume.resumeFromUrlDialogTitle"),
            placeholder: t("backupAndResume.resumeFromUrlDialogPlaceHolder"),
            maxLength: 1024,
            async onOk(text, closePanel) {
                try {
                    const url = text.trim();
                    if (url.endsWith(".json") || url.endsWith(".txt")) {
                        const raw = (await axios.get(text)).data;
                        await Backup.resume(raw, resumeMode);
                        Toast.success(t("toast.resumeSuccess"));
                        closePanel();
                    } else {
                        throw "无效的URL";
                    }
                } catch (e: any) {
                    Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
                }
            },
        });
    }

    async function onResumeFromRemote() {
        if (!isRemoteCredentialsComplete()) {
            Toast.warn(t("toast.resumePreCheckFailed"));
            return;
        }

        cancelScheduledRemoteUpload();

        try {
            const raw = await fetchRemoteBackupRaw();
            if (raw === null) {
                Toast.warn(t("toast.backupFileNotFound"));
                return;
            }
            const result = await pullRemoteSnapshotWithOverwriteGate(raw);
            if (result === "cancelled") {
                return;
            }
            Toast.success(t("toast.resumeSuccess"));
        } catch (e: any) {
            Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
        }
    }

    async function onBackupToRemote() {
        if (!isRemoteCredentialsComplete()) {
            Toast.warn(t("toast.resumePreCheckFailed"));
            return;
        }
        try {
            await uploadBackupToRemote();
            recordRemoteUploadSuccess();
            Toast.success(t("toast.backupSuccess"));
        } catch (e: any) {
            Toast.warn(t("toast.backupFail", { reason: e?.message ?? e }));
        }
    }

    return (
        <ScrollView style={style.wrapper}>
            <ListItemHeader>{t("sidebar.backupAndResume")}</ListItemHeader>

            <ListItem
                withHorizontalPadding
                onPress={() => {
                    showDialog("RadioDialog", {
                        title: t("backupAndResume.setResumeMode"),
                        content: [
                            {
                                label: t(("backupAndResume.resumeMode." + ResumeMode.Append) as any),
                                value: ResumeMode.Append,
                            },
                            {
                                label: t(("backupAndResume.resumeMode." + ResumeMode.OverwriteDefault) as any),
                                value: ResumeMode.OverwriteDefault,
                            },
                            {
                                label: t(("backupAndResume.resumeMode." + ResumeMode.Overwrite) as any),
                                value: ResumeMode.Overwrite,
                            },
                        ],
                        onOk(value) {
                            Config.setConfig(
                                "backup.resumeMode",
                                value as any,
                            );
                        },
                    });
                }}>
                <ListItem.Content title={t("backupAndResume.resumeMode")} />
                <ListItem.ListItemText>
                    {
                        t(("backupAndResume.resumeMode." + ((resumeMode as ResumeMode) ||
                            ResumeMode.Append)) as any)
                    }
                </ListItem.ListItemText>
            </ListItem>
            <ListItemHeader>{t("backupAndResume.localBackup")}</ListItemHeader>
            <ListItem withHorizontalPadding onPress={onBackupToLocal}>
                <ListItem.Content title={t("backupAndResume.backupToLocal")} />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onResumeFromLocal}>
                <ListItem.Content title={t("backupAndResume.resumeFromLocalFile")} />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onResumeFromUrl}>
                <ListItem.Content title={t("backupAndResume.resumeFromUrlDialogTitle")} />
            </ListItem>
            <ListItemHeader>
                {t("backupAndResume.remoteStorage")}
            </ListItemHeader>
            <ListItem withHorizontalPadding heightType="small">
                <ListItem.Content
                    title={t("backupAndResume.remoteTransportStatus")}
                    description={t("backupAndResume.remotePriorityHint")}
                />
                <ListItem.ListItemText>
                    {transportStatusText}
                </ListItem.ListItemText>
            </ListItem>
            <ListItem
                withHorizontalPadding
                onPress={() => {
                    showDialog("RadioDialog", {
                        title: t("backupAndResume.pcloudRegion"),
                        content: [
                            {
                                label: t("backupAndResume.pcloudRegion.us"),
                                value: PCLOUD_HOSTNAME_US,
                            },
                            {
                                label: t("backupAndResume.pcloudRegion.eu"),
                                value: PCLOUD_HOSTNAME_EU,
                            },
                        ],
                        onOk(value) {
                            Config.setConfig(
                                "backup.remote.pcloud.hostname",
                                value as any,
                            );
                        },
                    });
                }}>
                <ListItem.Content title={t("backupAndResume.pcloudRegion")} />
                <ListItem.ListItemText>{pcloudRegionText}</ListItem.ListItemText>
            </ListItem>
            <ListItem
                withHorizontalPadding
                heightType={pcloudTokenInvalid ? "small" : undefined}
                onPress={() => {
                    showPanel("SetUserVariables", {
                        title: t("backupAndResume.pcloudSettings"),
                        initValues: { token: pcloudToken ?? "" },
                        variables: [
                            {
                                key: "token",
                                name: t("backupAndResume.pcloudToken"),
                                hint: t("backupAndResume.pcloudTokenHint"),
                            },
                        ],
                        onOk(values, closePanel) {
                            Config.setConfig(
                                "backup.remote.pcloud.tokenJson",
                                values?.token ?? "",
                            );
                            Toast.success(t("toast.saveSuccess"));
                            closePanel();
                        },
                    });
                }}>
                <ListItem.Content
                    title={t("backupAndResume.pcloudToken")}
                    description={
                        pcloudTokenInvalid
                            ? t("backupAndResume.pcloudTokenInvalidHint")
                            : undefined
                    }
                />
            </ListItem>
            <ListItem
                withHorizontalPadding
                onPress={() => {
                    showPanel("SetUserVariables", {
                        title: t("backupAndResume.remoteSettings"),
                        initValues: {
                            url: webdavUrl ?? "",
                            rootPath: webdavRootPath ?? "",
                            username: webdavUsername ?? "",
                            password: webdavPassword ?? "",
                        },
                        variables: [
                            {
                                key: "url",
                                name: t("backupAndResume.webdavServerUrl"),
                                hint: t("backupAndResume.webdavServerUrlHint"),
                            },
                            {
                                key: "rootPath",
                                name: t("backupAndResume.webdavRootPath"),
                                hint: t("backupAndResume.webdavRootPathHint"),
                            },
                            {
                                key: "username",
                                name: t("common.username"),
                            },
                            {
                                key: "password",
                                name: t("common.password"),
                            },
                        ],
                        onOk(values, closePanel) {
                            Config.setConfig(
                                "backup.webdav.url",
                                values?.url ?? "",
                            );
                            Config.setConfig(
                                "backup.webdav.rootPath",
                                values?.rootPath ?? "",
                            );
                            Config.setConfig(
                                "backup.webdav.username",
                                values?.username ?? "",
                            );
                            Config.setConfig(
                                "backup.webdav.password",
                                values?.password ?? "",
                            );
                            Toast.success(t("toast.saveSuccess"));
                            closePanel();
                        },
                    });
                }}>
                <ListItem.Content
                    title={t("backupAndResume.webdavServerUrl")}
                />
            </ListItem>
            <ListItem
                withHorizontalPadding
                onPress={() => {
                    showPanel("SetUserVariables", {
                        title: t("backupAndResume.remoteMusicPath"),
                        initValues: { musicPath: remoteMusicPath ?? "" },
                        variables: [
                            {
                                key: "musicPath",
                                name: t("backupAndResume.remoteMusicPath"),
                                hint: t("backupAndResume.remoteMusicPathHint"),
                            },
                        ],
                        onOk(values, closePanel) {
                            Config.setConfig(
                                "backup.remote.musicPath",
                                values?.musicPath ?? "",
                            );
                            Toast.success(t("toast.saveSuccess"));
                            closePanel();
                        },
                    });
                }}>
                <ListItem.Content
                    title={t("backupAndResume.remoteMusicPath")}
                    description={t("backupAndResume.remoteMusicPathHint")}
                />
            </ListItem>
            <ListItem withHorizontalPadding heightType="small">
                <ListItem.Content
                    title={t("backupAndResume.remoteAutoSync")}
                    description={
                        remoteCredentialsComplete
                            ? undefined
                            : t("backupAndResume.remoteAutoSyncCredentialsHint")
                    }
                />
                <ThemeSwitch
                    value={remoteAutoSync === true}
                    onValueChange={(next: boolean) => {
                        if (next && !remoteCredentialsComplete) {
                            Toast.warn(
                                t(
                                    "backupAndResume.remoteAutoSyncRequiresCredentials",
                                ),
                            );
                            return;
                        }
                        Config.setConfig("backup.remote.autoSync", next);
                    }}
                />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onBackupToRemote}>
                <ListItem.Content title={t("backupAndResume.backupToRemote")} />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onResumeFromRemote}>
                <ListItem.Content title={t("backupAndResume.resumeFromRemote")} />
            </ListItem>
        </ScrollView>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
});
