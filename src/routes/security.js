
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

  // Security dashboard
  getSecurityDashboardStats,

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
/* Security Dashboard                                                         */
/* -------------------------------------------------------------------------- */

router.get(
  "/dashboard/stats",
  requirePermission(41),
  getSecurityDashboardStats,
);

/* -------------------------------------------------------------------------- */
/* Coordinator Security Review                                                */
/* -------------------------------------------------------------------------- */

router.get(
  "/coordinators",
  requirePermission(35),
  getSecurityCoordinators,
);

router.post(
  "/import-coordinators",
  requirePermission(34),
  importSecurityCoordinators,
);

router.put(
  "/coordinators/:nationalId",
  requirePermission(36),
  updateCoordinatorSecurity,
);

/* -------------------------------------------------------------------------- */
/* Security Records                                                           */
/* -------------------------------------------------------------------------- */

router.get(
  "/",
  requirePermission(35),
  getSecurityRecords,
);

router.get(
  "/national-id/:nationalId",
  requirePermission(35),
  getSecurityByNationalId,
);

router.post(
  "/",
  requirePermission(34),
  createSecurityRecord,
);

/* -------------------------------------------------------------------------- */
/* Update Security Records                                                    */
/* -------------------------------------------------------------------------- */

router.put(
  "/national-id/:nationalId",
  requirePermission(36),
  updateSecurityRecord,
);

router.put(
  "/incidents/:incidentId",
  requirePermission(36),
  updateSecurityIncident,
);

router.put(
  "/permits/:permitId",
  requirePermission(36),
  updateSecurityPermit,
);

/* -------------------------------------------------------------------------- */
/* Delete Security Records                                                    */
/* -------------------------------------------------------------------------- */

router.delete(
  "/national-id/:nationalId",
  requirePermission(37),
  deleteSecurityRecord,
);

/* -------------------------------------------------------------------------- */
/* National ID Validation                                                     */
/* -------------------------------------------------------------------------- */

router.get(
  "/check-national-id/:nationalId",
  checkSecurityNationalId,
);

export default router;
