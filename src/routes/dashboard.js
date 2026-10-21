
import express from "express";
import DashboardController from "../controllers/dashboard.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

router.get("/stats", authMiddleware, DashboardController.getStats);

export default router;
