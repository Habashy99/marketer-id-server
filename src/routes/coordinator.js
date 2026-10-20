import express from "express";
import CoordinatorController from "../controllers/coordinator.js";

const router = express.Router();

router.get("/", CoordinatorController.getAllCoordinators);
router.get("/getCoordinatorById", CoordinatorController.getCoordinatorById);
router.post("/createCoordinator", CoordinatorController.createCoordinator);
router.put("/updateCoordinator", CoordinatorController.updateCoordinator);
export default router;