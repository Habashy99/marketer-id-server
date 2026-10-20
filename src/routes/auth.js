import express from "express";
import AuthController from "../controllers/auth.js";

const router = express.Router();
router.get("/", AuthController.getAllAuths);
router.get("/getAuthById", AuthController.getAuthByNumber);
router.post("/createAuth", AuthController.createAuth);
router.put("/updateAuth", AuthController.updateAuth);
export default router;