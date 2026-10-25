import multer from "multer";

const allowedMimeTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 6,
        fileSize: 10 * 1024 * 1024,
    },
    fileFilter: (req, file, callback) => {
        if (!allowedMimeTypes.has(file.mimetype)) {
            return callback(
                new Error("Only JPEG, PNG, and WebP images are allowed.")
            );
        }

        callback(null, true);
    },
});

export default upload;