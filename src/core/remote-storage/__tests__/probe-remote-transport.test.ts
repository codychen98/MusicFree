import { probeVerifiedRemoteTransport } from "../probe-remote-transport";
import type { RemoteStorageCredentials } from "../types";

type FetchHandler = (input: string) => Response | Promise<Response>;

function createMockFetch(handler: FetchHandler) {
    return async (input: string | URL) => handler(String(input));
}

function createCredentials(
    overrides: Partial<RemoteStorageCredentials> = {},
): RemoteStorageCredentials {
    return {
        pcloud: overrides.pcloud,
        webdav: overrides.webdav,
    };
}

const webdav = {
    url: "https://webdav.example",
    username: "user",
    password: "pass",
};

describe("probeVerifiedRemoteTransport", () => {
    it("selects pcloud when pcloud probe succeeds", async () => {
        const status = await probeVerifiedRemoteTransport(
            createCredentials({
                pcloud: {
                    hostname: "api.pcloud.com",
                    tokenJson:
                        "{\"access_token\":\"good\",\"token_type\":\"bearer\"}",
                },
                webdav,
            }),
            {
                fetch: createMockFetch((input) => {
                    if (input.includes("/userinfo")) {
                        return new Response(JSON.stringify({ result: 0 }));
                    }
                    throw new Error(`unexpected fetch ${input}`);
                }),
            },
        );
        expect(status).toBe("pcloud");
    });

    it("falls back to webdav when pcloud fails and webdav works", async () => {
        const status = await probeVerifiedRemoteTransport(
            createCredentials({
                pcloud: {
                    hostname: "api.pcloud.com",
                    tokenJson:
                        "{\"access_token\":\"bad\",\"token_type\":\"bearer\"}",
                },
                webdav,
            }),
            {
                fetch: createMockFetch((input) => {
                    if (input.includes("/userinfo")) {
                        return new Response(
                            JSON.stringify({
                                result: 2094,
                                error: "Invalid 'access_token' provided.",
                            }),
                        );
                    }
                    throw new Error(`unexpected fetch ${input}`);
                }),
                probeWebdav: async () => true,
            },
        );
        expect(status).toBe("webdav");
    });

    it("reports both_offline when pcloud and webdav both fail", async () => {
        const status = await probeVerifiedRemoteTransport(
            createCredentials({
                pcloud: {
                    hostname: "api.pcloud.com",
                    tokenJson:
                        "{\"access_token\":\"bad\",\"token_type\":\"bearer\"}",
                },
                webdav,
            }),
            {
                fetch: createMockFetch((input) => {
                    if (input.includes("/userinfo")) {
                        return new Response(
                            JSON.stringify({
                                result: 2094,
                                error: "Invalid 'access_token' provided.",
                            }),
                        );
                    }
                    throw new Error(`unexpected fetch ${input}`);
                }),
                probeWebdav: async () => false,
            },
        );
        expect(status).toBe("both_offline");
    });

    it("selects webdav when only webdav credentials are complete", async () => {
        const status = await probeVerifiedRemoteTransport(
            createCredentials({ webdav }),
            {
                probeWebdav: async () => true,
            },
        );
        expect(status).toBe("webdav");
    });

    it("reports none when no credentials are complete", async () => {
        const status = await probeVerifiedRemoteTransport(createCredentials({}));
        expect(status).toBe("none");
    });

    it("reports offline when pcloud-only probe fails", async () => {
        const status = await probeVerifiedRemoteTransport(
            createCredentials({
                pcloud: {
                    hostname: "api.pcloud.com",
                    tokenJson:
                        "{\"access_token\":\"bad\",\"token_type\":\"bearer\"}",
                },
            }),
            {
                fetch: createMockFetch((input) => {
                    if (input.includes("/userinfo")) {
                        return new Response(
                            JSON.stringify({
                                result: 2094,
                                error: "Invalid 'access_token' provided.",
                            }),
                        );
                    }
                    throw new Error(`unexpected fetch ${input}`);
                }),
            },
        );
        expect(status).toBe("offline");
    });
});
