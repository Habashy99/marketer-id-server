import express from "express";
import authMiddleware from "../middlewares/auth.js";
const router = express.Router();
router.get(
    "/",
    authMiddleware,
    requirePermission(35),
    SecurityController.getAll
);

router.post(
    "/",
    authMiddleware,
    requirePermission(34),
    SecurityController.create
);

router.put(
    "/:id",
    authMiddleware,
    requirePermission(36),
    SecurityController.update
);

router.delete(
    "/:id",
    authMiddleware,
    requirePermission(37),
    SecurityController.delete
);
export default router;