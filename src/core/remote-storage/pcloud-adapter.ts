import { normalizeRemotePath } from "./paths";
import type { RemoteDirectoryEntry, RemoteStorageClient } from "./types";
import { PcloudApiError } from "./types";

/** pCloud uses 2055 for missing paths on stat; 2009 appears in older samples. */
const NOT_FOUND_CODES = new Set([2009, 2055]);

type PcloudResponse<T> = { result: number; error?: string } & T;

function assertOk<T>(json: PcloudResponse<T>): T {
    if (json.result !== 0) {
        throw new PcloudApiError(json.result, json.error ?? "UNKNOWN");
    }
    return json;
}

export interface PcloudAdapterOptions {
    hostname: string;
    accessToken: string;
}

export function createPcloudRemoteStorage({
    hostname,
    accessToken,
}: PcloudAdapterOptions): RemoteStorageClient {
    const base = `https://${hostname.trim()}`;
    const call = async <T>(method: string, params: Record<string, string>) => {
        const url = new URL(`${base}/${method}`);
        url.searchParams.set("access_token", accessToken);
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        const response = await fetch(url.toString());
        return assertOk((await response.json()) as PcloudResponse<T>);
    };

    const toPath = (path: string) => normalizeRemotePath(path);

    const splitFolderAndFilename = (path: string) => {
        const normalized = toPath(path);
        const lastSlash = normalized.lastIndexOf("/");
        if (lastSlash <= 0) {
            return { folderPath: "/", filename: normalized.slice(1) || "file" };
        }
        return {
            folderPath: normalized.slice(0, lastSlash) || "/",
            filename: normalized.slice(lastSlash + 1),
        };
    };

    const authHeaders = (): Record<string, string> => ({
        Authorization: `Bearer ${accessToken}`,
    });

    const uploadBinary = async (path: string, body: Uint8Array) => {
        const { folderPath, filename } = splitFolderAndFilename(path);

        if (body.length === 0) {
            const formData = new FormData();
            formData.append("path", folderPath);
            formData.append("filename", filename);
            formData.append("nopartial", "1");
            formData.append("content", new Blob([]), filename);
            const response = await fetch(`${base}/uploadfile`, {
                method: "POST",
                headers: authHeaders(),
                body: formData,
            });
            assertOk((await response.json()) as PcloudResponse<unknown>);
            return;
        }

        const url = new URL(`${base}/uploadfile`);
        url.searchParams.set("path", folderPath);
        url.searchParams.set("filename", filename);
        url.searchParams.set("nopartial", "1");

        // React Native's Blob cannot be constructed from ArrayBuffer/TypedArray;
        // pass the bytes directly (RN fetch sends typed arrays via base64).
        const response = await fetch(url.toString(), {
            method: "PUT",
            headers: {
                ...authHeaders(),
                "Content-Length": String(body.length),
                "Content-Type": "application/octet-stream",
            },
            body,
        });
        assertOk((await response.json()) as PcloudResponse<unknown>);
    };

    return {
        async exists(path) {
            try {
                await call("stat", { path: toPath(path) });
                return true;
            } catch (error) {
                if (error instanceof PcloudApiError && NOT_FOUND_CODES.has(error.code)) {
                    return false;
                }
                throw error;
            }
        },
        async getText(path) {
            const binary = await this.getBinary(path);
            return new TextDecoder().decode(binary);
        },
        async getBinary(path) {
            const url = await this.getDownloadUrl(path);
            const response = await fetch(url);
            return new Uint8Array(await response.arrayBuffer());
        },
        async putText(path, body) {
            await this.putBinary(path, new TextEncoder().encode(body));
        },
        async putBinary(path, body) {
            await uploadBinary(toPath(path), body);
        },
        async ensureDir(path) {
            await call("createfolderifnotexists", { path: toPath(path) });
        },
        async deleteFile(path) {
            await call("deletefile", { path: toPath(path) });
        },
        async moveFile(from, to) {
            await call("renamefile", { path: toPath(from), topath: toPath(to) });
        },
        async listDirectory(path) {
            const data = await call<{
                metadata?: {
                    contents?: Array<{
                        path: string;
                        name: string;
                        size?: number;
                        isfolder?: boolean;
                    }>;
                };
            }>("listfolder", { path: toPath(path) });
            return (data.metadata?.contents ?? []).map(
                (entry): RemoteDirectoryEntry => ({
                    path: toPath(entry.path),
                    basename: entry.name,
                    size: entry.size ?? 0,
                    type: entry.isfolder ? "directory" : "file",
                }),
            );
        },
        async getDownloadUrl(path) {
            const data = await call<{ hosts: string[]; path: string }>("getfilelink", {
                path: toPath(path),
            });
            const host = data.hosts[0] ?? hostname;
            const url = `https://${host}${data.path}`;
            return url.startsWith("https://") ? url : url.replace("http://", "https://");
        },
    };
}
