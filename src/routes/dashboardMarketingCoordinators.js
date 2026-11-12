import express from "express";
import authMiddleware from "../middlewares/auth.js";
import dashboardMarketingCoordinatorsController from "../controllers/dashboardMarketingCoordinators.js";

const router = express.Router();

router.get(
  "/stats",
  authMiddleware,
  dashboardMarketingCoordinatorsController.getStats,
);

export default router;
