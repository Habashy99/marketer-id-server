
import express from "express";
import AuthUserController from "../controllers/authUser.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

router.post("/createAuthUser",authMiddleware, AuthUserController.createAuthUser);
router.put("/updateAuthUser", authMiddleware, AuthUserController.updateAuthUser);
router.delete("/deleteAuthUser", authMiddleware, AuthUserController.deleteAuthUser);

export default router;
