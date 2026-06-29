import Loading from "@/components/base/loading";
import LyricItem from "@/components/mediaItem/LyricItem";
import { RequestStateCode } from "@/constants/commonConst";
import lyricManager from "@/core/lyricManager";
import TrackPlayer from "@/core/trackPlayer";
import { WEBDAV_MUSIC_PLUGIN_PLATFORM } from "@/core/webdav-download/config";
import {
    SaveSearchedLyricError,
    SaveSearchedLyricErrorCode,
    saveSearchedLyric,
} from "@/core/saveSearchedLyric";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import React, { memo } from "react";
import { hidePanel } from "../../usePanel";
import searchResultStore, { ISearchLyricResult } from "./searchResultStore";
import ListEmpty from "@/components/base/listEmpty";
import ListFooter from "@/components/base/listFooter";
import { FlashList } from "@shopify/flash-list";
import { useI18N } from "@/core/i18n";

interface ILyricListWrapperProps {
    route: {
        key: string;
        title: string;
    };
}
export default function LyricListWrapper(props: ILyricListWrapperProps) {
    const hash = props.route.key;
    const dataStore = searchResultStore.useValue();
    return <LyricList data={dataStore.data[hash]} />;
}

interface ILyricListProps {
    data: ISearchLyricResult;
}

function resolveSaveLyricErrorMessage(
    error: unknown,
    t: (key: string) => string,
): string {
    if (error instanceof SaveSearchedLyricError) {
        switch (error.code) {
            case SaveSearchedLyricErrorCode.WEBDAV_CONFIG_INCOMPLETE:
                return t("panel.searchLrc.toast.webdavConfigIncomplete");
            case SaveSearchedLyricErrorCode.LYRIC_EMPTY:
                return t("panel.searchLrc.toast.lyricEmpty");
            case SaveSearchedLyricErrorCode.UPLOAD_FAILED:
                return t("panel.searchLrc.toast.uploadFailed");
            default:
                return t("panel.searchLrc.toast.saveFailed");
        }
    }
    if (error instanceof Error && error.message) {
        return `${t("panel.searchLrc.toast.saveFailed")} ${error.message}`;
    }
    return t("panel.searchLrc.toast.saveFailed");
}

const ITEM_HEIGHT = rpx(120);
function LyricListImpl(props: ILyricListProps) {
    const data = props.data;
    const searchState = data?.state ?? RequestStateCode.IDLE;
    const targetMusicItem = searchResultStore.useValue().targetMusicItem;

    const { t } = useI18N();

    return searchState === RequestStateCode.PENDING_FIRST_PAGE ? (
        <Loading />
    ) : (
        <FlashList
            estimatedItemSize={ITEM_HEIGHT}
            renderItem={({ item }) => (
                <LyricItem
                    lyricItem={item}
                    onPress={async () => {
                        try {
                            const musicItem =
                                targetMusicItem ?? TrackPlayer.currentMusic;
                            if (!musicItem) {
                                return;
                            }

                            await saveSearchedLyric(musicItem, item);
                            if (TrackPlayer.isCurrentMusic(musicItem)) {
                                lyricManager.retryCurrentLyric();
                            }
                            const successKey =
                                musicItem.platform ===
                                WEBDAV_MUSIC_PLUGIN_PLATFORM
                                    ? "panel.searchLrc.toast.webdavSaved"
                                    : "panel.searchLrc.toast.settingSuccess";
                            Toast.success(t(successKey));
                            hidePanel();
                        } catch (error: unknown) {
                            Toast.warn(resolveSaveLyricErrorMessage(error, t));
                        }
                    }}
                />
            )}
            ListEmptyComponent={<ListEmpty state={searchState} />}
            ListFooterComponent={data?.data?.length ? <ListFooter state={searchState} /> : null}
            data={data?.data}
        />
    );
}

const LyricList = memo(LyricListImpl, (prev, curr) => prev.data === curr.data);
