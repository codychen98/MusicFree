import { DeviceEventEmitter } from "react-native";
import {
    handleMusicFreeControl,
    type MusicFreeControlAction,
} from "@/core/control/handleMusicFreeControl";

const MUSIC_FREE_CONTROL_EVENT = "MusicFreeControl";

function isControlAction(value: unknown): value is MusicFreeControlAction {
    return (
        value === "car" ||
        value === "next" ||
        value === "prev" ||
        value === "favorite"
    );
}

let subscribed = false;

export function registerMusicFreeControlListener(): void {
    if (subscribed) {
        return;
    }
    subscribed = true;

    DeviceEventEmitter.addListener(
        MUSIC_FREE_CONTROL_EVENT,
        (payload?: { action?: unknown }) => {
            const action = payload?.action;
            if (!isControlAction(action)) {
                return;
            }
            void handleMusicFreeControl(action).catch(() => {
                // Skip/car may fail when player or favorites are unavailable.
            });
        },
    );
}

registerMusicFreeControlListener();
