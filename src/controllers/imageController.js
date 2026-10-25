
import sharp from "sharp";
import crypto from "node:crypto";
import { sql, poolPromise } from "../config/db.js";
import { nextcloudConfig } from "../config/nextcloud.js";
import { COORDINATOR_PHOTO_FIELDS } from "../utils/imagePaths.js";

const { webDavUrl, authorization, rootFolder } = nextcloudConfig;

function encodePath(path) {
    return path
        .split("/")
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

function normalizePhotoPath(photoPath) {
    if (typeof photoPath !== "string" || !photoPath.trim()) {
        throw new Error("Photo path is required.");
    }

    const normalizedPath = photoPath.replace(/\\/g, "/");

    if (
        normalizedPath.startsWith("/") ||
        normalizedPath.split("/").some(
            (segment) => !segment || segment === "." || segment === ".."
        ) ||
        !normalizedPath.startsWith(`${rootFolder}/coordinators/`)
    ) {
        throw new Error("Invalid coordinator photo path.");
    }

    return normalizedPath;
}

function getWebDavUrl(relativePath) {
    return `${webDavUrl}/${encodePath(relativePath)}`;
}

async function nextcloudRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            Authorization: authorization,
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        const error = new Error(
            `Nextcloud request failed (${response.status}): ${body.slice(0, 300)}`
        );

        error.status = response.status === 404 ? 404 : 502;
        throw error;
    }

    return response;
}

async function nextcloudFolderExists(url) {
    const response = await fetch(url, {
        method: "PROPFIND",
        headers: {
            Authorization: authorization,
            Depth: "0",
        },
    });

    if (response.status === 207) return true;
    if (response.status === 404) return false;

    const body = await response.text().catch(() => "");
    throw new Error(
        `Could not check Nextcloud folder (${response.status}): ${body.slice(0, 300)}`
    );
}

async function ensureNextcloudFolder(folderPath) {
    const segments = folderPath.split("/").filter(Boolean);
    let currentPath = "";

    for (const segment of segments) {
        currentPath = currentPath
            ? `${currentPath}/${segment}`
            : segment;

        const url = getWebDavUrl(currentPath);

        if (await nextcloudFolderExists(url)) continue;

        const response = await fetch(url, {
            method: "MKCOL",
            headers: { Authorization: authorization },
        });

        if (response.status === 201) continue;

        // Another request may have created the folder concurrently.
        if (
            response.status === 405 &&
            await nextcloudFolderExists(url)
        ) {
            continue;
        }

        const body = await response.text().catch(() => "");
        throw new Error(
            `Could not create folder "${currentPath}" (${response.status}): ${body.slice(0, 300)}`
        );
    }
}

export async function testNextcloudConnection() {
    const response = await fetch(`${webDavUrl}/`, {
        method: "PROPFIND",
        headers: {
            Authorization: authorization,
            Depth: "0",
        },
    });

    if (response.status !== 207) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `Nextcloud connection failed (${response.status}): ${body.slice(0, 300)}`
        );
    }

    console.log("Nextcloud WebDAV connection successful.");
    return true;
}

export async function processImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error("Invalid image buffer.");
    }

    const maxWidth = Number(process.env.IMAGE_MAX_WIDTH) || 1200;
    const quality = Number(process.env.IMAGE_WEBP_QUALITY) || 82;

    return sharp(buffer, {
        limitInputPixels: 40_000_000,
        failOn: "error",
    })
        .rotate()
        .resize({
            width: maxWidth,
            withoutEnlargement: true,
        })
        .webp({ quality })
        .toBuffer();
}

export async function uploadCoordinatorImage(
    coordinatorCode,
    fieldName,
    processedBuffer
) {
    if (!Object.hasOwn(COORDINATOR_PHOTO_FIELDS, fieldName)) {
        throw new Error(`Unsupported photo field: ${fieldName}`);
    }

    if (
        typeof coordinatorCode !== "string" ||
        !coordinatorCode.trim()
    ) {
        throw new Error("Coordinator code is required.");
    }

    if (!Buffer.isBuffer(processedBuffer) || !processedBuffer.length) {
        throw new Error("The processed image buffer is empty.");
    }

    // Prevent coordinator codes from creating nested or unsafe paths.
    if (
        coordinatorCode.includes("/") ||
        coordinatorCode.includes("\\") ||
        coordinatorCode === "." ||
        coordinatorCode === ".."
    ) {
        throw new Error("Invalid coordinator code for folder name.");
    }

    const folderPath =
        `${rootFolder}/coordinators/${coordinatorCode.trim()}`;

    await ensureNextcloudFolder(folderPath);

    const filename = `${fieldName}-${crypto.randomUUID()}.webp`;
    const relativePath = `${folderPath}/${filename}`;

    await nextcloudRequest(getWebDavUrl(relativePath), {
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
        body: processedBuffer,
    });

    return relativePath;
}

export async function uploadCoordinatorPhotos(
    coordinatorId,
    files = {}
) {
    const pool = await poolPromise;

    const coordinatorResult = await pool
        .request()
        .input("id", sql.Int, coordinatorId)
        .query(`
            SELECT id, code
            FROM dbo.coordinator
            WHERE id = @id;
        `);

    const coordinator = coordinatorResult.recordset[0];

    if (!coordinator) {
        const error = new Error("Coordinator not found.");
        error.status = 404;
        throw error;
    }

    const uploadedPaths = {};

    try {
        for (const [fieldName, columnName] of Object.entries(
            COORDINATOR_PHOTO_FIELDS
        )) {
            const fileValue = files[fieldName];
            const file = Array.isArray(fileValue)
                ? fileValue[0]
                : fileValue;

            if (!file) continue;

            const processedBuffer = await processImage(file.buffer);

            const path = await uploadCoordinatorImage(
                String(coordinator.code),
                fieldName,
                processedBuffer
            );

            uploadedPaths[columnName] = path;
        }

        return uploadedPaths;
    } catch (error) {
        // Avoid leaving newly uploaded files behind if a later upload fails.
        await Promise.allSettled(
            Object.values(uploadedPaths).map(deleteCoordinatorImage)
        );

        throw error;
    }
}

export async function getCoordinatorPhoto(req, res) {
    try {
        const photoPath = normalizePhotoPath(req.query.path);
        const response = await nextcloudRequest(getWebDavUrl(photoPath));

        const imageBuffer = Buffer.from(await response.arrayBuffer());

        res.setHeader(
            "Content-Type",
            response.headers.get("content-type") || "image/webp"
        );
        res.setHeader("Cache-Control", "private, max-age=3600");

        return res.status(200).send(imageBuffer);
    } catch (error) {
        console.error("Get coordinator photo error:", error);

        return res.status(error.status || 500).json({
            message: "Failed to load coordinator photo.",
        });
    }
}

export async function deleteCoordinatorImage(photoPath) {
    if (!photoPath) return;

    const normalizedPath = normalizePhotoPath(photoPath);

    const response = await fetch(getWebDavUrl(normalizedPath), {
        method: "DELETE",
        headers: { Authorization: authorization },
    });

    // WebDAV commonly returns 204 for success; 404 means already absent.
    if (!response.ok && response.status !== 404) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `Failed to delete old photo (${response.status}): ${body.slice(0, 300)}`
        );
    }
}
