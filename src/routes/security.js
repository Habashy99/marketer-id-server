import express from "express";

import authMiddleware from "../middlewares/auth.js";
import requirePermission from "../middlewares/requirePermission.js";

import {
  // Security records
  getSecurityRecords,
  getSecurityByNationalId,
  createSecurityRecord,
  updateSecurityRecord,
  updateSecurityIncident,
  updateSecurityPermit,
  deleteSecurityRecord,
  checkSecurityNationalId,

  // Coordinator security workflow
  getSecurityCoordinators,
  importSecurityCoordinators,
  updateCoordinatorSecurity,
} from "../controllers/securityController.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

router.use(authMiddleware);

/* -------------------------------------------------------------------------- */
/* Coordinator Security Review                                                */
/* -------------------------------------------------------------------------- */

// Fetch all coordinators and their security status
router.get("/coordinators", requirePermission(35), getSecurityCoordinators);

// Import coordinators who are not registered in security_persons
router.post(
  "/import-coordinators",
  requirePermission(34),
  importSecurityCoordinators,
);

// Update coordinator security status and append notes
router.put(
  "/coordinators/:nationalId",
  requirePermission(36),
  updateCoordinatorSecurity,
);

/* -------------------------------------------------------------------------- */
/* Security Records                                                           */
/* -------------------------------------------------------------------------- */

// View security records
router.get("/", requirePermission(35), getSecurityRecords);

// Get one person by national ID, including incidents and permits
router.get(
  "/national-id/:nationalId",
  requirePermission(35),
  getSecurityByNationalId,
);

// Create a new security person
router.post("/", requirePermission(34), createSecurityRecord);

/* -------------------------------------------------------------------------- */
/* Update Security Records                                                    */
/* -------------------------------------------------------------------------- */

// Update person information
router.put(
  "/national-id/:nationalId",
  requirePermission(36),
  updateSecurityRecord,
);

// Update an existing incident
router.put(
  "/incidents/:incidentId",
  requirePermission(36),
  updateSecurityIncident,
);

// Update an existing permit
router.put("/permits/:permitId", requirePermission(36), updateSecurityPermit);

/* -------------------------------------------------------------------------- */
/* Delete Security Records                                                    */
/* -------------------------------------------------------------------------- */

// Soft-delete a security person
router.delete(
  "/national-id/:nationalId",
  requirePermission(37),
  deleteSecurityRecord,
);

router.get("/check-national-id/:nationalId", checkSecurityNationalId);

export default router;
