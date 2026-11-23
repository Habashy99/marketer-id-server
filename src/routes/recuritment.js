
import express from "express";
import multer from "multer";

import authMiddleware from "../middlewares/auth.js";
import requirePermission from "../middlewares/requirePermission.js";

import {
  checkRecuritment,
  downloadRecuritmentResults,
  checkSecurityNationalId,
} from "../controllers/recuritmentController.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Upload Configuration                                                       */
/* -------------------------------------------------------------------------- */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },

  fileFilter: (req, file, callback) => {
    const allowedExtensions = [".xlsx", ".xls"];

    const extension = file.originalname
      .slice(file.originalname.lastIndexOf("."))
      .toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      return callback(
        new Error(
          "يُسمح برفع ملفات Excel فقط (.xlsx أو .xls).",
        ),
      );
    }

    callback(null, true);
  },
});

/* -------------------------------------------------------------------------- */
/* Authentication & Permission                                               */
/* -------------------------------------------------------------------------- */

router.use(authMiddleware);
router.use(requirePermission(39));

/* -------------------------------------------------------------------------- */
/* Excel Routes                                                               */
/* -------------------------------------------------------------------------- */

// رفع الملف وفحصه
router.post(
  "/check",
  upload.single("file"),
  checkRecuritment,
);

// تنزيل ملف Excel بعد الفحص
router.get(
  "/download/:jobId",
  downloadRecuritmentResults,
);

/* -------------------------------------------------------------------------- */
/* Security Lookup Route                                                      */
/* -------------------------------------------------------------------------- */

// الاستعلام عن الرقم القومي في سجلات الأمن
router.get(
  "/check-national-id/:nationalId",
  checkSecurityNationalId,
);

/* -------------------------------------------------------------------------- */
/* Error Handler                                                              */
/* -------------------------------------------------------------------------- */

router.use((error, req, res, next) => {
  console.error("Recuritment route error:", error);

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "حجم الملف أكبر من الحد المسموح (10 ميجابايت).",
      });
    }

    return res.status(400).json({
      success: false,
      message: "حدث خطأ أثناء رفع الملف.",
    });
  }

  return res.status(400).json({
    success: false,
    message:
      error.message ||
      "حدث خطأ أثناء معالجة الطلب.",
  });
});

export default router;
