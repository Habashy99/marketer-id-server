
import express from "express";

import externalApiKey from "../middlewares/externalApiKey.js";
import {
  checkSecurityNationalId,
} from "../controllers/recuritmentController.js";

const router = express.Router();

// حماية جميع مسارات هذا الـ API باستخدام API Key
router.use(externalApiKey);

// البحث بالرقم القومي
router.post(
  "/check-national-id",
  checkSecurityNationalId,
);

export default router;
