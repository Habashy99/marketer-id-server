
import express from "express";
import AuthUserController from "../controllers/authUser.js";
import authMiddleware from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/adminMiddleware.js";

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

router.post(
    "/createAuthUser",
    AuthUserController.createAuthUser
);

router.put(
    "/updateAuthUser",
    AuthUserController.updateAuthUser
);

router.delete(
    "/deleteAuthUser",
    AuthUserController.deleteAuthUser
);

export default router;
