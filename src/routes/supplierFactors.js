
import express from "express";

import SupplierFactorsController from "../controllers/supplierFactors.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Branches                                                                   */
/* -------------------------------------------------------------------------- */

router.get(
    "/branches",
    authMiddleware,
    SupplierFactorsController.getBranches
);

export default router;
