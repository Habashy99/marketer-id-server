import sharp from "sharp";

export async function processImage(buffer) {
    const image = sharp(buffer, {
        limitInputPixels: 25_000_000,
        failOn: "error",
    });

    const metadata = await image.metadata();

    if (!["jpeg", "png", "webp"].includes(metadata.format)) {
        throw new Error("Unsupported image format.");
    }

    if (metadata.width > 10000 || metadata.height > 10000) {
        throw new Error("Image dimensions are too large.");
    }

    return image
        .rotate()
        .resize({
            width: 1600,
            height: 1600,
            fit: "inside",
            withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
}