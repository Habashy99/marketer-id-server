
import express from "express";
import UserController from "../controllers/user.js";
import authMiddleware from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/adminMiddleware.js";

const router = express.Router();


router.post("/login", UserController.login);
router.post("/logout", UserController.logout);


router.get("/me", authMiddleware, UserController.getCurrentUser);


router.get(
    "/",
    authMiddleware,
    adminMiddleware,
    UserController.getAllUsers
);

router.get(
    "/getUserById",
    authMiddleware,
    adminMiddleware,
    UserController.getUserById
);

router.post(
    "/createUser",
    authMiddleware,
    adminMiddleware,
    UserController.createUser
);

router.put(
    "/updateUser",
    authMiddleware,
    adminMiddleware,
    UserController.updateUser
);

router.post("/signup", UserController.signup);

export default router;
