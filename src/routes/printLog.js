import express from "express";
import PrintLogController from "../controllers/printLog.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();
router.get("/", authMiddleware, PrintLogController.getAllLogs);
router.get("/getLogByType", authMiddleware, PrintLogController.getLogByType);
router.post("/createLog", authMiddleware, PrintLogController.createLog);
router.get("/getLogByDate", authMiddleware, PrintLogController.getLogByDate);
router.delete(
    "/deleteLog",
    authMiddleware,
    PrintLogController.deleteLog
);
router.get(
    "/total-printed-cards",
    authMiddleware,
    PrintLogController.getTotalPrintedCards
);
export default router;