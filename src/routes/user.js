
import express from "express";
import UserController from "../controllers/user.js";
import authMiddleware from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/adminMiddleware.js";

const router = express.Router();

// Authentication
router.post("/login", UserController.login);
router.post("/logout", UserController.logout);

// Current logged-in user
router.get("/me", authMiddleware, UserController.getCurrentUser);

// User management: admin only
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

// Keep signup only if public registration is intentionally allowed.
// Otherwise, remove this route and create accounts through createUser.
router.post("/signup", UserController.signup);

export default router;
