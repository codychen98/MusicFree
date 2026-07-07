import {
    createRemoteStorageClient,
    resolveRemoteTransport,
} from "../resolve";
import { RemoteCredentialsIncompleteError } from "../types";

describe("resolveRemoteTransport", () => {
    it("resolves complete webdav credentials to webdav", () => {
        expect(
            resolveRemoteTransport({
                webdav: {
                    url: "https://dav.example",
                    username: "user",
                    password: "pass",
                },
            }),
        ).toBe("webdav");
    });

    it("resolves incomplete webdav credentials to null", () => {
        expect(
            resolveRemoteTransport({
                webdav: { url: "https://dav.example", username: "user" },
            }),
        ).toBeNull();
    });

    it("prefers pcloud when both transports are complete", () => {
        expect(
            resolveRemoteTransport({
                pcloud: {
                    hostname: "api.pcloud.com",
                    tokenJson: "{\"access_token\":\"x\",\"token_type\":\"bearer\"}",
                },
                webdav: {
                    url: "https://dav.example",
                    username: "user",
                    password: "pass",
                },
            }),
        ).toBe("pcloud");
    });

    it("falls through to webdav when pcloud token is invalid", () => {
        expect(
            resolveRemoteTransport({
                pcloud: {
                    hostname: "api.pcloud.com",
                    tokenJson: "not-valid-json",
                },
                webdav: {
                    url: "https://dav.example",
                    username: "user",
                    password: "pass",
                },
            }),
        ).toBe("webdav");
    });

    it("resolves to null when only pcloud token is invalid", () => {
        expect(
            resolveRemoteTransport({
                pcloud: {
                    hostname: "api.pcloud.com",
                    tokenJson: "not-valid-json",
                },
            }),
        ).toBeNull();
    });
});

describe("createRemoteStorageClient", () => {
    it("throws RemoteCredentialsIncompleteError for incomplete credentials", () => {
        expect(() =>
            createRemoteStorageClient({
                webdav: { url: "https://dav.example", username: "user" },
            }),
        ).toThrow(RemoteCredentialsIncompleteError);
    });
});
