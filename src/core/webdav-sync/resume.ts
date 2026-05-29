import { AppState, type AppStateStatus } from "react-native";
import { runWebdavBootstrapSync } from "./bootstrap";

let setupDone = false;
let previousAppState: AppStateStatus = AppState.currentState;
let syncInFlight: Promise<void> | null = null;

function isReturningToForeground(nextState: AppStateStatus): boolean {
    return (
        previousAppState.match(/inactive|background/) !== null &&
        nextState === "active"
    );
}

function runResumeSync(): void {
    if (syncInFlight !== null) {
        return;
    }
    syncInFlight = runWebdavBootstrapSync().finally(() => {
        syncInFlight = null;
    });
}

/**
 * Pull/push WebDAV backup when the app returns from background (same rules as cold start).
 * Register after the initial bootstrap sync so startup does not run twice.
 */
export function setupWebdavResumeSync(): void {
    if (setupDone) {
        return;
    }
    setupDone = true;
    previousAppState = AppState.currentState;

    AppState.addEventListener("change", nextState => {
        if (isReturningToForeground(nextState)) {
            runResumeSync();
        }
        previousAppState = nextState;
    });
}
