
import express from "express";
import ManufacturingCostController from "../controllers/manufacturingCostController.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

router.get(
    "/product/:barcode",
    authMiddleware,
    ManufacturingCostController.getProductByBarcode
);

export default router;
