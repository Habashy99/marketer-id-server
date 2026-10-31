import axios from "axios";
import { randomUUID } from "node:crypto";
import { nextcloudConfig } from "../config/nextcloud.js";

const {
    webdavUrl,
    username,
    password,
    rootFolder,
} = nextcloudConfig;

const auth = { username, password };

function encodePath(path) {
    return path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

async function createFolder(path) {
    const url = `${webdavUrl}${encodePath(path)}`;

    try {
        await axios.request({
            method: "MKCOL",
            url,
            auth,
            timeout: 15000,
        });
    } catch (error) {
        if (error.response?.status !== 405) {
            throw error;
        }
    }
}

async function ensureFolders(path) {
    const segments = path.split("/");
    let currentPath = "";

    for (const segment of segments) {
        currentPath = currentPath
            ? `${currentPath}/${segment}`
            : segment;

        await createFolder(currentPath);
    }
}

export async function uploadCoordinatorImage(
    coordinatorId,
    fieldName,
    buffer
) {
    const folder = `${rootFolder}/coordinators/${coordinatorId}`;
    await ensureFolders(folder);

    const fileName = `${fieldName}-${randomUUID()}.webp`;
    const relativePath = `${folder}/${fileName}`;
    const url = `${webdavUrl}${encodePath(relativePath)}`;

    await axios.put(url, buffer, {
        auth,
        timeout: 60000,
        headers: {
            "Content-Type": "image/webp",
        },
        maxBodyLength: 20 * 1024 * 1024,
    });

    return relativePath;
}