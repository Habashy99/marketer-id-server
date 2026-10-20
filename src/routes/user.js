import express from "express";
import UserController from "../controllers/user.js";

const router = express.Router();

router.get("/", UserController.getAllUsers);
router.get("/getUserById", UserController.getUserById);
router.post("/createUser", UserController.createUser);
router.put("/updateUser", UserController.updateUser);
export default router;