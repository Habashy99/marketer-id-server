
import express from "express";
import CardLogsController from "../controllers/cardLogs.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

router.get("/", authMiddleware, CardLogsController.getAllLogs);
router.get("/total", authMiddleware, CardLogsController.getTotalQuantity);
router.post("/", authMiddleware, CardLogsController.createLog);
router.delete("/:id", authMiddleware, CardLogsController.deleteLog);

export default router;
