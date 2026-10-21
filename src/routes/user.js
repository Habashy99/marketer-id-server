import express from "express";
import UserController from "../controllers/user.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

router.get("/", authMiddleware, UserController.getAllUsers);
router.post("/signup", UserController.signup);
router.post("/login", UserController.login);
router.post("/logout", UserController.logout);
router.get("/getUserById", authMiddleware, UserController.getUserById);
router.post("/createUser", authMiddleware, UserController.createUser);
router.put("/updateUser", authMiddleware, UserController.updateUser);
export default router;