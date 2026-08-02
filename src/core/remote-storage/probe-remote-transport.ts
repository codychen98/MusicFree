import { parsePcloudTokenJson } from "./parse-pcloud-token";
import {
    isPcloudCredentialsComplete,
    isWebdavCredentialsComplete,
} from "./resolve";
import { normalizeWebdavServerUrl } from "./remote-paths";
import type {
    PcloudCredentials,
    RemoteStorageCredentials,
    WebdavCredentials,
} from "./types";

const PROBE_TIMEOUT_MS = 8000;

export type VerifiedRemoteTransportStatus =
    | "pcloud"
    | "webdav"
    | "both_offline"
    | "offline"
    | "none";

export interface ProbeRemoteTransportDeps {
    fetch?: typeof fetch;
    probeWebdav?: (webdav: WebdavCredentials) => Promise<boolean>;
}

function normalizePcloudHostname(hostname: string): string {
    return hostname.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

async function withProbeTimeout<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
            setTimeout(() => reject(new Error("REMOTE_PROBE_TIMEOUT")), PROBE_TIMEOUT_MS);
        }),
    ]);
}

async function probePcloudConnection(
    pcloud: PcloudCredentials,
    fetchFn: typeof fetch,
): Promise<boolean> {
    const { accessToken } = parsePcloudTokenJson(pcloud.tokenJson);
    const hostname = normalizePcloudHostname(pcloud.hostname);
    const response = await fetchFn(`https://${hostname}/userinfo`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
    const data = (await response.json()) as { result?: number };
    return data.result === 0;
}

async function probeWebdavConnection(webdav: WebdavCredentials): Promise<boolean> {
    const { createWebdavClient } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("./webdav-client") as typeof import("./webdav-client");
    const serverUrl = normalizeWebdavServerUrl(webdav.url);
    const client = createWebdavClient({
        url: serverUrl,
        username: webdav.username,
        password: webdav.password,
    });
    const probePath = webdav.rootPath?.trim() || "/";
    return client.exists(probePath);
}

export async function probeVerifiedRemoteTransport(
    credentials: RemoteStorageCredentials,
    deps: ProbeRemoteTransportDeps = {},
): Promise<VerifiedRemoteTransportStatus> {
    const fetchFn = deps.fetch ?? fetch;
    const probeWebdavFn = deps.probeWebdav ?? probeWebdavConnection;
    const pcloud = credentials.pcloud;
    const webdav = credentials.webdav;
    const pcloudReady = isPcloudCredentialsComplete(pcloud);
    const webdavReady = isWebdavCredentialsComplete(webdav);

    if (!pcloudReady && !webdavReady) {
        return "none";
    }

    if (pcloudReady) {
        let pcloudOk = false;
        try {
            pcloudOk = await withProbeTimeout(
                probePcloudConnection(pcloud, fetchFn),
            );
        } catch {
            pcloudOk = false;
        }
        if (pcloudOk) {
            return "pcloud";
        }
        if (webdavReady) {
            let webdavOk = false;
            try {
                webdavOk = await withProbeTimeout(probeWebdavFn(webdav));
            } catch {
                webdavOk = false;
            }
            return webdavOk ? "webdav" : "both_offline";
        }
        return "offline";
    }

    if (webdavReady) {
        let webdavOk = false;
        try {
            webdavOk = await withProbeTimeout(probeWebdavFn(webdav));
        } catch {
            webdavOk = false;
        }
        return webdavOk ? "webdav" : "offline";
    }

    return "none";
}
