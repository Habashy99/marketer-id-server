import express from "express";

import authMiddleware from "../middlewares/auth.js";
import requirePermission from "../middlewares/requirePermission.js";

import {
  getSecurityRecords,
  getSecurityByNationalId,
  createSecurityRecord,
  updateSecurityRecord,
  updateSecurityIncident,
  updateSecurityPermit,
  deleteSecurityRecord,
} from "../controllers/securityController.js";

const router = express.Router();

router.use(authMiddleware);

// View
router.get("/", requirePermission(35), getSecurityRecords);
router.get(
  "/national-id/:nationalId",
  requirePermission(35),
  getSecurityByNationalId,
);

// Create
router.post("/", requirePermission(34), createSecurityRecord);

// Update person
router.put(
  "/national-id/:nationalId",
  requirePermission(36),
  updateSecurityRecord,
);

// Update one incident
router.put(
  "/incidents/:incidentId",
  requirePermission(36),
  updateSecurityIncident,
);

// Update one permit
router.put(
  "/permits/:permitId",
  requirePermission(36),
  updateSecurityPermit,
);

// Disable person
router.delete(
  "/national-id/:nationalId",
  requirePermission(37),
  deleteSecurityRecord,
);

export default router;