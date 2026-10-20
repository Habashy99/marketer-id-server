
import express from "express";
import AuthUserController from "../controllers/authUser.js";

const router = express.Router();

router.post("/createAuthUser", AuthUserController.createAuthUser);
router.put("/updateAuthUser", AuthUserController.updateAuthUser);
router.delete("/deleteAuthUser", AuthUserController.deleteAuthUser);

export default router;
