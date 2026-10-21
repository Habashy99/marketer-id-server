import express from "express";
import CoordinatorController from "../controllers/coordinator.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

router.get("/", authMiddleware, CoordinatorController.getAllCoordinators);
router.get("/getCoordinatorById", authMiddleware, CoordinatorController.getCoordinatorById);
router.post("/createCoordinator", authMiddleware, CoordinatorController.createCoordinator);
router.put("/updateCoordinator", authMiddleware, CoordinatorController.updateCoordinator);
export default router;