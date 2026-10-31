
import express from "express";

import AdvertisingCompany from "../controllers/advertisingCompany.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

router.get(
    "/",
    authMiddleware,
    AdvertisingCompany.getAllAdvertisingCompanies
);

router.post(
    "/",
    authMiddleware,
    AdvertisingCompany.createAdvertisingCompany
);

router.delete(
    "/:id",
    authMiddleware,
    AdvertisingCompany.deleteAdvertisingCompany
);

export default router;
