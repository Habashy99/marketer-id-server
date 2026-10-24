
import multer from "multer";

// Keep uploaded files in memory.
// The controller currently ignores photo updates, so no files
// will be saved to disk by this middleware.
const storage = multer.memoryStorage();

const fileFilter = (req, file, callback) => {
    if (file.mimetype.startsWith("image/")) {
        callback(null, true);
    } else {
        callback(new Error("Only image files are allowed"), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB per file
        files: 6,
    },
});

export default upload;
