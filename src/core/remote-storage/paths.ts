export function normalizeRemotePath(path: string): string {
    const normalized = path.replace(/\\/g, "/").trim();
    if (!normalized) {
        return "/";
    }
    const withLeading = normalized.startsWith("/") ? normalized : `/${normalized}`;
    const withoutTrailing = withLeading.replace(/\/+$/, "");
    return withoutTrailing || "/";
}
