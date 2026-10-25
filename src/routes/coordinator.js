
import express from "express";
import CoordinatorController from "../controllers/coordinator.js";
import authMiddleware from "../middlewares/auth.js";
import upload from "../middlewares/imageUploadMiddleware.js";
import { getCoordinatorPhoto } from "../controllers/imageController.js";
const router = express.Router();

router.get(
    "/",
    authMiddleware,
    CoordinatorController.getAllCoordinators
);

router.get(
    "/getCoordinatorById",
    authMiddleware,
    CoordinatorController.getCoordinatorById
);

router.post(
    "/createCoordinator",
    authMiddleware,
    CoordinatorController.createCoordinator
);

router.put(
    "/updateCoordinator",
    authMiddleware,
    upload.fields([
        { name: "profilePicture", maxCount: 1 },
        { name: "nationalIdPicture", maxCount: 1 },
        { name: "healthCertificatePicture", maxCount: 1 },
        { name: "companyAuthorizationPicture", maxCount: 1 },
        { name: "socialInsurancePicture", maxCount: 1 },
        { name: "supervisorNationalIdPicture", maxCount: 1 },
    ]),
    CoordinatorController.updateCoordinator
);
router.get(
    "/photo",
    authMiddleware,
    getCoordinatorPhoto
);

router.get("/photo-test", (req, res) => {
    res.status(200).json({
        message: "Coordinator photo route is working",
    });
});

export default router;
