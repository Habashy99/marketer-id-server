import express from "express";
import RetailController from "../controllers/retail.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

router.get("/suppliers", authMiddleware, RetailController.getSuppliers);
router.get("/branches", authMiddleware, RetailController.getBranches);
router.get(
    "/suppliers/search",
    authMiddleware,
    RetailController.searchSuppliers
);
router.get(
    "/branches/search",
    authMiddleware,
    RetailController.searchBranches
);
export default router;