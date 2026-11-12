
import express from "express";
import conductController from "../controllers/conduct.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

router.get("/stats", authMiddleware, conductController.getStats);
router.post(
    "/records",
    authMiddleware,
    conductController.getRecordsByCategory
);
export default router;
