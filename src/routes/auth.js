
import express from "express";
import AuthController from "../controllers/auth.js";
import authMiddleware from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/adminMiddleware.js";

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

router.get("/", AuthController.getAllAuths);
router.get("/getAuthById", AuthController.getAuthByNumber);
router.post("/createAuth", AuthController.createAuth);
router.put("/updateAuth", AuthController.updateAuth);

export default router;
