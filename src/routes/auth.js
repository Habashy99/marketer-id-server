import express from "express";
import AuthController from "../controllers/auth.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();
router.get("/", authMiddleware, AuthController.getAllAuths);
router.get("/getAuthById", authMiddleware, AuthController.getAuthByNumber);
router.post("/createAuth", authMiddleware, AuthController.createAuth);
router.put("/updateAuth", authMiddleware, AuthController.updateAuth);
export default router;