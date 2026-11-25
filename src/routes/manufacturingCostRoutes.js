import express from "express";
import ManufacturingCostController from "../controllers/manufacturingCostController.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

// Search ingredient names, barcodes and itemean directly in SQL Server.
router.get(
  "/search/:search",
  authMiddleware,
  ManufacturingCostController.searchProducts,
);

// Keep the existing single-product lookup for the base product flow.
router.get(
  "/product/:barcode",
  authMiddleware,
  ManufacturingCostController.getProductByBarcode,
);

export default router;
