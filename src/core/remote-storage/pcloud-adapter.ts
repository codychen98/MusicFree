import { normalizeRemotePath } from "./paths";
import type { RemoteDirectoryEntry, RemoteStorageClient } from "./types";
import { PcloudApiError } from "./types";

const NOT_FOUND_CODES = new Set([2005, 2009]);

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

    const uploadBinary = async (path: string, body: Uint8Array) => {
        const { folderPath, filename } = splitFolderAndFilename(path);
        const url = new URL(`${base}/uploadfile`);
        url.searchParams.set("access_token", accessToken);
        url.searchParams.set("path", folderPath);
        url.searchParams.set("filename", filename);

        if (body.length === 0) {
            const formData = new FormData();
            formData.append("file", new Blob([]), filename);
            const response = await fetch(url.toString(), {
                method: "POST",
                body: formData,
            });
            assertOk((await response.json()) as PcloudResponse<unknown>);
            return;
        }

        const response = await fetch(url.toString(), {
            method: "PUT",
            body,
            headers: {
                "Content-Length": String(body.length),
            },
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
