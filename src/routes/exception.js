import express from "express";
import ExceptionController from "../controllers/exception.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();
router.post("/createException", authMiddleware, ExceptionController.createException);
router.delete("/deleteException", authMiddleware, ExceptionController.deleteException);
export default router;