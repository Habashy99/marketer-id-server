
import express from "express";

import DailyExchangeController from "../controllers/dailyExchange.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

router.get(
    "/product/:barcode",
    authMiddleware,
    DailyExchangeController.getProductByBarcode
);

export default router;
