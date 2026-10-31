
import express from "express";
import TemporaryCoordinatorController from "../controllers/temporaryCoordinator.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

router.get(
    "/",
    authMiddleware,
    TemporaryCoordinatorController.getAllTemporaryCoordinators
);

router.post(
    "/",
    authMiddleware,
    TemporaryCoordinatorController.createTemporaryCoordinator
);

router.get(
    "/:id",
    authMiddleware,
    TemporaryCoordinatorController.getTemporaryCoordinatorById
);

router.put(
    "/:id",
    authMiddleware,
    TemporaryCoordinatorController.updateTemporaryCoordinator
);

router.delete(
    "/:id",
    authMiddleware,
    TemporaryCoordinatorController.deleteTemporaryCoordinator
);

export default router;
