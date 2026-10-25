
import "dotenv/config";

const baseUrl = process.env.NEXTCLOUD_BASE_URL?.replace(/\/+$/, "");
const login = process.env.NEXTCLOUD_LOGIN;
const userId = process.env.NEXTCLOUD_USER_ID;
const appPassword = process.env.NEXTCLOUD_APP_PASSWORD;

const rootFolder = (
    process.env.NEXTCLOUD_ROOT_FOLDER || "MarketerID Backend"
).replace(/^\/+|\/+$/g, "");

if (!baseUrl || !login || !userId || !appPassword) {
    throw new Error("Nextcloud environment variables are missing.");
}

export const nextcloudConfig = {
    baseUrl,
    login,
    userId,
    appPassword,
    rootFolder,
    webDavUrl: `${baseUrl}/remote.php/dav/files/${encodeURIComponent(userId)}`,
    authorization: `Basic ${Buffer.from(
        `${login}:${appPassword}`
    ).toString("base64")}`,
};
