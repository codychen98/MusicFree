import Loading from "@/components/base/loading";
import ThemeText from "@/components/base/themeText";
import {
    RenameTrackError,
    renameMusicTrack,
} from "@/core/renameTrack";
import { WebdavMusicPluginConfigIncompleteError } from "@/core/webdav-download/upload";
import { useI18N } from "@/core/i18n";
import useColors from "@/hooks/useColors";
import rpx, { vmax } from "@/utils/rpx";
import Toast from "@/utils/toast";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { TextInput } from "react-native-gesture-handler";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { hidePanel } from "../usePanel";
import { fontSizeConst } from "@/constants/uiConst";

interface IRenameMusicTrackProps {
    musicItem: IMusic.IMusicItem;
}

function resolveRenameErrorMessage(
    error: unknown,
    t: (key: string) => string,
): string {
    if (error instanceof RenameTrackError) {
        switch (error.code) {
            case "RENAME_TARGET_EXISTS":
                return t("panel.renameTrack.targetExists");
            case "RENAME_INVALID_INPUT":
                return t("panel.renameTrack.invalidInput");
            default:
                return t("panel.renameTrack.failed");
        }
    }
    if (
        error instanceof WebdavMusicPluginConfigIncompleteError ||
        (error instanceof Error &&
            error.message === "WEBDAV_MUSIC_PLUGIN_CONFIG_INCOMPLETE")
    ) {
        return t("panel.renameTrack.webdavConfigIncomplete");
    }
    if (error instanceof Error && error.message) {
        return `${t("panel.renameTrack.failed")} ${error.message}`;
    }
    return t("panel.renameTrack.failed");
}

export default function RenameMusicTrack(props: IRenameMusicTrackProps) {
    const { musicItem } = props;
    const { t } = useI18N();
    const colors = useColors();
    const [loading, setLoading] = useState(false);
    const [title, setTitle] = useState(musicItem.title ?? "");
    const [artist, setArtist] = useState(musicItem.artist ?? "");
    const canSubmit = title.trim().length > 0 && artist.trim().length > 0;

    const handleConfirm = async () => {
        if (!canSubmit || loading) {
            return;
        }
        setLoading(true);
        try {
            await renameMusicTrack(musicItem, {
                title: title.trim(),
                artist: artist.trim(),
            });
            Toast.success(t("panel.renameTrack.success"));
            hidePanel();
        } catch (error: unknown) {
            Toast.warn(resolveRenameErrorMessage(error, t));
            setLoading(false);
        }
    };

    return (
        <PanelBase
            keyboardAvoidBehavior="height"
            height={vmax(40)}
            renderBody={() => (
                <>
                    <PanelHeader
                        title={t("panel.renameTrack.title")}
                        onCancel={hidePanel}
                        onOk={handleConfirm}
                    />
                    {loading ? (
                        <View style={style.loadingWrapper}>
                            <Loading text={t("panel.renameTrack.loading")} />
                        </View>
                    ) : (
                        <View style={style.form}>
                            <ThemeText
                                fontSize="description"
                                fontColor="textSecondary"
                                style={style.label}>
                                {t("panel.renameTrack.titleLabel")}
                            </ThemeText>
                            <TextInput
                                value={title}
                                autoFocus
                                onChangeText={setTitle}
                                style={[
                                    style.input,
                                    {
                                        color: colors.text,
                                        backgroundColor: colors.placeholder,
                                    },
                                ]}
                                placeholderTextColor={colors.textSecondary}
                                placeholder={t("panel.renameTrack.titlePlaceholder")}
                                maxLength={120}
                            />
                            <ThemeText
                                fontSize="description"
                                fontColor="textSecondary"
                                style={style.label}>
                                {t("panel.renameTrack.artistLabel")}
                            </ThemeText>
                            <TextInput
                                value={artist}
                                onChangeText={setArtist}
                                style={[
                                    style.input,
                                    {
                                        color: colors.text,
                                        backgroundColor: colors.placeholder,
                                    },
                                ]}
                                placeholderTextColor={colors.textSecondary}
                                placeholder={t("panel.renameTrack.artistPlaceholder")}
                                maxLength={120}
                            />
                        </View>
                    )}
                </>
            )}
        />
    );
}

const style = StyleSheet.create({
    form: {
        paddingHorizontal: rpx(24),
        paddingBottom: rpx(24),
    },
    label: {
        marginBottom: rpx(8),
        marginTop: rpx(16),
    },
    input: {
        borderRadius: rpx(12),
        fontSize: fontSizeConst.content,
        lineHeight: fontSizeConst.content * 1.5,
        padding: rpx(12),
    },
    loadingWrapper: {
        paddingVertical: rpx(48),
    },
});
