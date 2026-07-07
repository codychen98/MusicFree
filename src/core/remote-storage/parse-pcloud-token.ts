import { PcloudTokenInvalidError, PcloudTokenParseError } from "./types";

export interface ParsedPcloudToken {
    accessToken: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePcloudTokenJson(tokenJson: string): ParsedPcloudToken {
    const trimmed = tokenJson.trim();
    if (!trimmed) {
        throw new PcloudTokenInvalidError("EMPTY_TOKEN_JSON");
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        throw new PcloudTokenParseError();
    }

    if (!isRecord(parsed)) {
        throw new PcloudTokenInvalidError("TOKEN_NOT_OBJECT");
    }

    const accessToken = parsed.access_token;
    if (typeof accessToken !== "string" || !accessToken.trim()) {
        throw new PcloudTokenInvalidError("MISSING_ACCESS_TOKEN");
    }

    const tokenType = parsed.token_type;
    if (typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer") {
        throw new PcloudTokenInvalidError("INVALID_TOKEN_TYPE");
    }

    return {
        accessToken: accessToken.trim(),
    };
}

/** True when token JSON parses to a bearer access_token (used for transport selection). */
export function isValidPcloudTokenJson(tokenJson: string): boolean {
    try {
        parsePcloudTokenJson(tokenJson);
        return true;
    } catch {
        return false;
    }
}
