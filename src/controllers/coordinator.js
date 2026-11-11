import { sql, retailPoolPromise } from "../config/db.js";
import {
  uploadCoordinatorPhotos,
  deleteCoordinatorImage,
} from "./imageController.js";
import { COORDINATOR_PHOTO_FIELDS } from "../utils/imagePaths.js";
import { getSecuritySituationByNationalId } from "../helper/getSecuritySituationByNationalId.js";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function getRetailNames(coordinators) {
  if (!coordinators.length) return [];

  const retailPool = await retailPoolPromise;

  if (!retailPool) {
    throw new Error("Retail database unavailable");
  }

  const supplierIds = [
    ...new Set(
      coordinators
        .map((item) => Number(item.company_name))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ];

  const branchIds = [
    ...new Set(
      coordinators
        .map((item) => Number(item.branch))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ];

  const supplierMap = new Map();
  const branchMap = new Map();

  if (supplierIds.length) {
    const request = retailPool.request();

    const parameters = supplierIds.map((id, index) => {
      const parameter = `supplier${index}`;
      request.input(parameter, sql.Int, id);
      return `@${parameter}`;
    });

    const result = await request.query(`
            SELECT
                supplierno AS id,
                LTRIM(RTRIM(a_name)) AS a_name
            FROM dbo.sys_supplier
            WHERE supplierno IN (${parameters.join(",")});
        `);

    for (const item of result.recordset) {
      supplierMap.set(Number(item.id), item.a_name);
    }
  }

  if (branchIds.length) {
    const request = retailPool.request();

    const parameters = branchIds.map((id, index) => {
      const parameter = `branch${index}`;
      request.input(parameter, sql.Int, id);
      return `@${parameter}`;
    });

    const result = await request.query(`
            SELECT
                branch AS id,
                LTRIM(RTRIM(a_name)) AS a_name
            FROM dbo.sys_branch
            WHERE branch IN (${parameters.join(",")});
        `);

    for (const item of result.recordset) {
      branchMap.set(Number(item.id), item.a_name);
    }
  }

  return coordinators.map((coordinator) => {
    const supplierId = Number(coordinator.company_name);
    const branchId = Number(coordinator.branch);

    return {
      ...coordinator,
      supplier_name:
        supplierMap.get(supplierId) ?? coordinator.company_name ?? null,
      branch_name: branchMap.get(branchId) ?? coordinator.branch ?? null,
    };
  });
}

function isValidPositiveInteger(value) {
  return (
    /^\d+$/.test(String(value ?? "").trim()) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) > 0 &&
    Number(value) <= 2147483647
  );
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === value
  );
}

function normalizeOptionalInteger(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  return Number(value);
}

async function validateAdvertisingCompany(pool, advertisingCompanyId) {
  if (advertisingCompanyId === null) {
    return true;
  }

  const result = await pool
    .request()
    .input("advertisingCompanyId", sql.Int, advertisingCompanyId).query(`
            SELECT id
            FROM dbo.advertising_companies
            WHERE id = @advertisingCompanyId
              AND isdeleted = 0;
        `);

  return result.recordset.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Controller                                                                 */
/* -------------------------------------------------------------------------- */

const CoordinatorController = {
  /* ---------------------------------------------------------------------- */
  /* GET ALL COORDINATORS                                                   */
  /* ---------------------------------------------------------------------- */

  getAllCoordinators: async (req, res) => {
    try {
      const { job, filter, code, supplierId, branchId, advertisingCompanyId } =
        req.query;

      const pool = await retailPoolPromise;
      const request = pool.request();
      const conditions = [];

      if (code !== undefined && code !== "") {
        if (!isValidPositiveInteger(code)) {
          return res.status(400).json({
            message: "Invalid coordinator code",
          });
        }

        request.input("code", sql.Int, Number(code));
        conditions.push("c.code = @code");
      }

      if (typeof job === "string" && job.trim()) {
        request.input("job", sql.NVarChar(255), job.trim());
        conditions.push("LTRIM(RTRIM(c.job)) = @job");
      }

      if (filter === "expired") {
        conditions.push(`
                    (
                        LTRIM(RTRIM(c.states)) = N'غير مفعل'
                        OR c.health_certificate_expiry_date
                            < CAST(GETDATE() AS DATE)
                    )
                `);
      }

      if (supplierId !== undefined && supplierId !== "") {
        if (!isValidPositiveInteger(supplierId)) {
          return res.status(400).json({
            message: "Invalid supplier ID",
          });
        }

        request.input(
          "supplierId",
          sql.NVarChar(255),
          String(Number(supplierId)),
        );

        conditions.push("c.company_name = @supplierId");
      }

      if (branchId !== undefined && branchId !== "") {
        if (!isValidPositiveInteger(branchId)) {
          return res.status(400).json({
            message: "Invalid branch ID",
          });
        }

        request.input("branchId", sql.NVarChar(255), String(Number(branchId)));

        conditions.push("c.branch = @branchId");
      }

      if (advertisingCompanyId !== undefined && advertisingCompanyId !== "") {
        if (!isValidPositiveInteger(advertisingCompanyId)) {
          return res.status(400).json({
            message: "Invalid advertising company ID",
          });
        }

        request.input(
          "advertisingCompanyId",
          sql.Int,
          Number(advertisingCompanyId),
        );

        conditions.push("c.advertising_company_id = @advertisingCompanyId");
      }

      let query = `
                SELECT
                    c.*,
                    ac.name AS joined_advertising_company_name,
                    e.exception_id,
                    e.exception_name,
                    e.exception_start_date,
                    e.exception_end_date
                FROM dbo.coordinator AS c
                LEFT JOIN dbo.advertising_companies AS ac
                    ON ac.id = c.advertising_company_id
                    AND ac.isdeleted = 0
                LEFT JOIN dbo.[exception] AS e
                    ON e.coordinator_id = c.id
                    AND e.isdeleted = 0
            `;

      if (conditions.length) {
        query += ` WHERE ${conditions.join(" AND ")}`;
      }

      query += " ORDER BY c.id;";

      const result = await request.query(query);

      const coordinators = await getRetailNames(result.recordset);

      const finalCoordinators = coordinators.map((item) => {
        const { joined_advertising_company_name, ...coordinator } = item;

        return {
          ...coordinator,
          advertising_company_name: joined_advertising_company_name ?? null,
        };
      });

      return res.status(200).json({
        message: "Get coordinators successful",
        coordinators: finalCoordinators,
      });
    } catch (error) {
      console.error("Get all coordinators error:", error);

      return res.status(500).json({
        message: "Get coordinators failed",
        error: error.message,
      });
    }
  },

  /* ---------------------------------------------------------------------- */
  /* GET COORDINATOR BY ID                                                  */
  /* ---------------------------------------------------------------------- */

  getCoordinatorById: async (req, res) => {
    try {
      const id = Number(req.body.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          message: "Invalid coordinator ID",
        });
      }

      const pool = await retailPoolPromise;

      const result = await pool.request().input("id", sql.Int, id).query(`
                    SELECT
                        c.*,
                        e.exception_id,
                        e.coordinator_id,
                        e.exception_name,
                        e.exception_start_date,
                        e.exception_end_date,
                        e.isdeleted
                    FROM dbo.coordinator AS c
                    LEFT JOIN dbo.[exception] AS e
                        ON e.coordinator_id = c.id
                        AND e.isdeleted = 0
                    WHERE c.id = @id;
                `);

      if (!result.recordset.length) {
        return res.status(404).json({
          message: "Coordinator not found",
        });
      }

      return res.status(200).json({
        message: "Get coordinator by ID successful",
        coordinator: result.recordset,
      });
    } catch (error) {
      console.error("Get coordinator by ID error:", error);

      return res.status(500).json({
        message: "Get coordinator by ID failed",
        error: error.message,
      });
    }
  },

  /* ---------------------------------------------------------------------- */
  /* CREATE COORDINATOR                                                     */
  /* ---------------------------------------------------------------------- */

  createCoordinator: async (req, res) => {
    let coordinatorId = null;
    let uploadedPhotoPaths = {};

    try {
      const {
        code,
        name,
        job,
        company_name,
        branch,
        advertising_company_id,
        email_discount,
        health_certificate_issuance_date,
        health_certificate_expiry_date,
        national_id_number,
        mobile,
        governorate,
        notes,
        id_issuance_date,
        id_expiry_date,
        created_by,
        address,
        supervisor_name,
        number_of_print_copies,
        states,
      } = req.body;

      const supplierId = String(company_name ?? "").trim();
      const branchId = String(branch ?? "").trim();

      const advertisingCompanyId = normalizeOptionalInteger(
        advertising_company_id,
      );

      if (
        !isValidPositiveInteger(code) ||
        typeof name !== "string" ||
        !name.trim() ||
        !/^\d+$/.test(supplierId) ||
        !isValidPositiveInteger(supplierId) ||
        !/^\d+$/.test(branchId) ||
        !isValidPositiveInteger(branchId) ||
        !isValidPositiveInteger(created_by)
      ) {
        return res.status(400).json({
          message:
            "Valid code, name, supplier ID, branch ID, and created_by are required",
        });
      }

      if (
        advertisingCompanyId !== null &&
        !isValidPositiveInteger(advertisingCompanyId)
      ) {
        return res.status(400).json({
          message: "Invalid advertising company ID",
        });
      }

      if (
        number_of_print_copies !== undefined &&
        number_of_print_copies !== null &&
        number_of_print_copies !== "" &&
        (!/^\d+$/.test(String(number_of_print_copies).trim()) ||
          !Number.isSafeInteger(Number(number_of_print_copies)) ||
          Number(number_of_print_copies) < 0 ||
          Number(number_of_print_copies) > 2147483647)
      ) {
        return res.status(400).json({
          message: "number_of_print_copies must be a non-negative integer",
        });
      }

      const dateFields = {
        health_certificate_issuance_date,
        health_certificate_expiry_date,
        id_issuance_date,
        id_expiry_date,
      };

      for (const [field, value] of Object.entries(dateFields)) {
        if (
          value !== undefined &&
          value !== null &&
          value !== "" &&
          !isValidDate(value)
        ) {
          return res.status(400).json({
            message: `${field} must be a valid YYYY-MM-DD date`,
          });
        }
      }

      const pool = await retailPoolPromise;

      const advertisingCompanyIsValid = await validateAdvertisingCompany(
        pool,
        advertisingCompanyId,
      );

      if (!advertisingCompanyIsValid) {
        return res.status(400).json({
          message: "Advertising company not found or inactive",
        });
      }

      const existingCoordinator = await pool
        .request()
        .input("code", sql.Int, Number(code)).query(`
                    SELECT id
                    FROM dbo.coordinator
                    WHERE code = @code;
                `);

      if (existingCoordinator.recordset.length) {
        return res.status(409).json({
          message: "Coordinator code already exists",
        });
      }

      // Security status is retrieved from the security database.
      const securitySituation =
        await getSecuritySituationByNationalId(national_id_number);

      const result = await pool
        .request()
        .input("code", sql.Int, Number(code))
        .input("name", sql.NVarChar(255), name.trim())
        .input("job", sql.NVarChar(255), job || null)
        .input("companyName", sql.NVarChar(255), supplierId)
        .input("branch", sql.NVarChar(255), branchId)
        .input("advertisingCompanyId", sql.Int, advertisingCompanyId)
        .input(
          "emailDiscount",
          sql.NVarChar(100),
          email_discount?.trim() || "لا",
        )
        .input(
          "healthCertificateIssuanceDate",
          sql.Date,
          health_certificate_issuance_date || null,
        )
        .input(
          "healthCertificateExpiryDate",
          sql.Date,
          health_certificate_expiry_date || null,
        )
        .input(
          "nationalIdNumber",
          sql.NVarChar(50),
          String(national_id_number ?? "").trim() || null,
        )
        .input("mobile", sql.NVarChar(30), mobile || null)
        .input("governorate", sql.NVarChar(100), governorate || null)
        .input("notes", sql.NVarChar(sql.MAX), notes || null)
        .input("idIssuanceDate", sql.Date, id_issuance_date || null)
        .input("idExpiryDate", sql.Date, id_expiry_date || null)
        .input("createdBy", sql.Int, Number(created_by))
        .input("address", sql.NVarChar(500), address || null)
        .input("supervisorName", sql.NVarChar(255), supervisor_name || null)
        .input(
          "numberOfPrintCopies",
          sql.Int,
          number_of_print_copies === "" ||
            number_of_print_copies === undefined ||
            number_of_print_copies === null
            ? null
            : Number(number_of_print_copies),
        )
        .input("securitySituation", sql.NVarChar(100), securitySituation)
        .input("state", sql.NVarChar(100), states || null).query(`
                    INSERT INTO dbo.coordinator (
                        code,
                        name,
                        job,
                        company_name,
                        branch,
                        advertising_company_id,
                        email_discount,
                        health_certificate_issuance_date,
                        health_certificate_expiry_date,
                        national_id_number,
                        mobile,
                        governorate,
                        notes,
                        id_issuance_date,
                        id_expiry_date,
                        created_by,
                        address,
                        supervisor_name,
                        number_of_print_copies,
                        security_Situation,
                        profile_picture,
                        national_id_picture,
                        health_certificate_picture,
                        company_authorization_picture,
                        social_insurance_picture,
                        supervisor_national_id_picture,
                        states
                    )
                    OUTPUT INSERTED.id
                    VALUES (
                        @code,
                        @name,
                        @job,
                        @companyName,
                        @branch,
                        @advertisingCompanyId,
                        @emailDiscount,
                        @healthCertificateIssuanceDate,
                        @healthCertificateExpiryDate,
                        @nationalIdNumber,
                        @mobile,
                        @governorate,
                        @notes,
                        @idIssuanceDate,
                        @idExpiryDate,
                        @createdBy,
                        @address,
                        @supervisorName,
                        @numberOfPrintCopies,
                        @securitySituation,
                        NULL,
                        NULL,
                        NULL,
                        NULL,
                        NULL,
                        NULL,
                        @state
                    );
                `);

      coordinatorId = result.recordset[0].id;

      uploadedPhotoPaths = await uploadCoordinatorPhotos(
        coordinatorId,
        req.files ?? {},
      );

      const photoEntries = Object.entries(uploadedPhotoPaths);

      if (photoEntries.length) {
        const updateRequest = pool.request();

        updateRequest.input("id", sql.Int, coordinatorId);

        const setClauses = photoEntries.map(
          ([columnName, photoPath], index) => {
            if (!Object.values(COORDINATOR_PHOTO_FIELDS).includes(columnName)) {
              throw new Error(
                `Invalid coordinator photo column: ${columnName}`,
              );
            }

            updateRequest.input(
              `photo${index}`,
              sql.NVarChar(sql.MAX),
              photoPath,
            );

            return `[${columnName}] = @photo${index}`;
          },
        );

        await updateRequest.query(`
                    UPDATE dbo.coordinator
                    SET ${setClauses.join(", ")}
                    WHERE id = @id;
                `);
      }

      const coordinatorResult = await pool
        .request()
        .input("id", sql.Int, coordinatorId).query(`
                    SELECT
                        c.*,
                        ac.name AS advertising_company_name
                    FROM dbo.coordinator AS c
                    LEFT JOIN dbo.advertising_companies AS ac
                        ON ac.id = c.advertising_company_id
                        AND ac.isdeleted = 0
                    WHERE c.id = @id;
                `);

      return res.status(201).json({
        message: "Coordinator created successfully",
        coordinator: coordinatorResult.recordset[0],
      });
    } catch (error) {
      console.error("Create coordinator error:", error);

      if (coordinatorId !== null) {
        try {
          const pool = await retailPoolPromise;

          await pool.request().input("id", sql.Int, coordinatorId).query(`
                            DELETE FROM dbo.coordinator
                            WHERE id = @id;
                        `);
        } catch (deleteError) {
          console.error(
            "Failed to delete coordinator after creation error:",
            deleteError,
          );
        }
      }

      await Promise.allSettled(
        Object.values(uploadedPhotoPaths).map(deleteCoordinatorImage),
      );

      if (error.number === 2627 || error.number === 2601) {
        return res.status(409).json({
          message: "Coordinator code already exists",
        });
      }

      return res.status(error.status || 500).json({
        message: "Failed to create coordinator",
        error: error.message,
      });
    }
  },

  /* ---------------------------------------------------------------------- */
  /* UPDATE COORDINATOR                                                     */
  /* ---------------------------------------------------------------------- */

  updateCoordinator: async (req, res) => {
    let uploadedPhotoPaths = {};
    let databaseUpdateSucceeded = false;

    try {
      const {
        id,
        securitySituation: ignoredSecuritySituation,
        security_situation: ignoredSecuritySituationSnakeCase,
        ...bodyFields
      } = req.body;

      if (!isValidPositiveInteger(id)) {
        return res.status(400).json({
          message: "A valid coordinator id is required",
        });
      }

      const coordinatorId = Number(id);

      // Support snake_case and camelCase from the frontend.
      const aliases = {
        advertising_company_id: "advertisingCompanyId",
        advertisingCompanyId: "advertisingCompanyId",

        company_name: "companyName",
        companyName: "companyName",

        national_id_number: "nationalIdNumber",
        nationalIdNumber: "nationalIdNumber",

        email_discount: "emailDiscount",
        emailDiscount: "emailDiscount",

        health_certificate_issuance_date: "healthCertificateIssuanceDate",
        healthCertificateIssuanceDate: "healthCertificateIssuanceDate",

        health_certificate_expiry_date: "healthCertificateExpiryDate",
        healthCertificateExpiryDate: "healthCertificateExpiryDate",

        id_issuance_date: "idIssuanceDate",
        idIssuanceDate: "idIssuanceDate",

        id_expiry_date: "idExpiryDate",
        idExpiryDate: "idExpiryDate",

        supervisor_name: "supervisorName",
        supervisorName: "supervisorName",

        number_of_print_copies: "numberOfPrintCopies",
        numberOfPrintCopies: "numberOfPrintCopies",
        numberOfPrintcopies: "numberOfPrintCopies",
      };

      const fields = {};

      for (const [key, value] of Object.entries(bodyFields)) {
        const normalizedKey = aliases[key] || key;

        if (Object.hasOwn(fields, normalizedKey)) {
          return res.status(400).json({
            message: "Duplicate fields supplied",
            field: normalizedKey,
          });
        }

        fields[normalizedKey] = value;
      }

      const columnMap = {
        code: {
          column: "code",
          type: sql.Int,
        },
        name: {
          column: "name",
          type: sql.NVarChar(255),
        },
        job: {
          column: "job",
          type: sql.NVarChar(255),
        },
        companyName: {
          column: "company_name",
          type: sql.NVarChar(255),
        },
        advertisingCompanyId: {
          column: "advertising_company_id",
          type: sql.Int,
        },
        branch: {
          column: "branch",
          type: sql.NVarChar(255),
        },
        emailDiscount: {
          column: "email_discount",
          type: sql.NVarChar(100),
        },
        healthCertificateIssuanceDate: {
          column: "health_certificate_issuance_date",
          type: sql.Date,
        },
        healthCertificateExpiryDate: {
          column: "health_certificate_expiry_date",
          type: sql.Date,
        },
        nationalIdNumber: {
          column: "national_id_number",
          type: sql.NVarChar(50),
        },
        mobile: {
          column: "mobile",
          type: sql.NVarChar(30),
        },
        governorate: {
          column: "governorate",
          type: sql.NVarChar(100),
        },
        notes: {
          column: "notes",
          type: sql.NVarChar(sql.MAX),
        },
        idIssuanceDate: {
          column: "id_issuance_date",
          type: sql.Date,
        },
        idExpiryDate: {
          column: "id_expiry_date",
          type: sql.Date,
        },
        address: {
          column: "address",
          type: sql.NVarChar(500),
        },
        supervisorName: {
          column: "supervisor_name",
          type: sql.NVarChar(255),
        },
        numberOfPrintCopies: {
          column: "number_of_print_copies",
          type: sql.Int,
        },
        states: {
          column: "states",
          type: sql.NVarChar(100),
        },
      };

      // Security status is managed automatically.
      // It must never be editable through this endpoint.
      const invalidFields = Object.keys(fields).filter(
        (key) => !Object.hasOwn(columnMap, key),
      );

      if (invalidFields.length) {
        return res.status(400).json({
          message: "Unknown or non-editable fields",
          fields: invalidFields,
        });
      }

      const normalizedFields = {};

      for (const [key, value] of Object.entries(fields)) {
        normalizedFields[key] =
          typeof value === "string" && value.trim() === "" ? null : value;
      }

      const dateFields = [
        "healthCertificateIssuanceDate",
        "healthCertificateExpiryDate",
        "idIssuanceDate",
        "idExpiryDate",
      ];

      for (const [key, value] of Object.entries(normalizedFields)) {
        if (
          key === "name" &&
          (value === null || typeof value !== "string" || !value.trim())
        ) {
          return res.status(400).json({
            message: "Name cannot be empty",
          });
        }

        if (key === "code" && !isValidPositiveInteger(value)) {
          return res.status(400).json({
            message: "Code must be a valid positive integer",
          });
        }

        if (key === "companyName" || key === "branch") {
          if (value !== null && !isValidPositiveInteger(value)) {
            return res.status(400).json({
              message:
                key === "companyName"
                  ? "A valid supplier ID is required"
                  : "A valid branch ID is required",
            });
          }

          if (value !== null) {
            normalizedFields[key] = String(Number(value));
          }
        }

        if (key === "advertisingCompanyId") {
          if (value !== null && !isValidPositiveInteger(value)) {
            return res.status(400).json({
              message: "A valid advertising company ID is required",
            });
          }

          if (value !== null) {
            normalizedFields[key] = Number(value);
          }
        }

        if (key === "numberOfPrintCopies") {
          if (
            value !== null &&
            (!/^\d+$/.test(String(value).trim()) ||
              !Number.isSafeInteger(Number(value)) ||
              Number(value) < 0 ||
              Number(value) > 2147483647)
          ) {
            return res.status(400).json({
              message:
                "numberOfPrintCopies must be a non-negative integer or null",
            });
          }

          if (value !== null) {
            normalizedFields[key] = Number(value);
          }
        }

        if (dateFields.includes(key) && value !== null) {
          if (!isValidDate(value)) {
            return res.status(400).json({
              message: `${key} must be a valid YYYY-MM-DD date or empty`,
            });
          }
        }
      }

      const pool = await retailPoolPromise;

      if (!pool) {
        throw new Error("Retail database unavailable");
      }

      const existingResult = await pool
        .request()
        .input("id", sql.Int, coordinatorId).query(`
        SELECT *
        FROM dbo.coordinator
        WHERE id = @id;
      `);

      if (!existingResult.recordset.length) {
        return res.status(404).json({
          message: "Coordinator not found",
        });
      }

      const existing = existingResult.recordset[0];

      // Validate advertising company if supplied.
      // Null is allowed to remove the selected advertising company.
      if (
        Object.hasOwn(normalizedFields, "advertisingCompanyId") &&
        normalizedFields.advertisingCompanyId !== null
      ) {
        const advertisingCompanyIsValid = await validateAdvertisingCompany(
          pool,
          normalizedFields.advertisingCompanyId,
        );

        if (!advertisingCompanyIsValid) {
          return res.status(400).json({
            message: "Advertising company not found or inactive",
          });
        }
      }

      const oldPhotoPaths = {};

      for (const column of Object.values(COORDINATOR_PHOTO_FIELDS)) {
        oldPhotoPaths[column] = existing[column];
      }

      // Detect actual changes only.
      const changedEntries = Object.entries(normalizedFields).filter(
        ([key, value]) => {
          const column = columnMap[key].column;

          let oldValue = existing[column];
          let newValue = value;

          if (dateFields.includes(key)) {
            oldValue = oldValue
              ? new Date(oldValue).toISOString().slice(0, 10)
              : null;

            newValue = newValue ?? null;
          } else if (
            ["code", "numberOfPrintCopies", "advertisingCompanyId"].includes(
              key,
            )
          ) {
            oldValue = oldValue == null ? null : Number(oldValue);
            newValue = newValue == null ? null : Number(newValue);
          } else {
            oldValue = oldValue == null ? null : String(oldValue);
            newValue = newValue == null ? null : String(newValue);

            if (key === "name" && newValue !== null) {
              newValue = newValue.trim();
            }
          }

          return oldValue !== newValue;
        },
      );

      // Check duplicate coordinator code.
      const codeEntry = changedEntries.find(([key]) => key === "code");

      if (codeEntry) {
        const duplicate = await pool
          .request()
          .input("code", sql.Int, Number(codeEntry[1]))
          .input("id", sql.Int, coordinatorId).query(`
          SELECT id
          FROM dbo.coordinator
          WHERE code = @code
            AND id <> @id;
        `);

        if (duplicate.recordset.length) {
          return res.status(409).json({
            message: "Coordinator code already exists",
          });
        }
      }

      // Refresh security status ONLY when the national ID changes.
      const nationalIdChanged = changedEntries.some(
        ([key]) => key === "nationalIdNumber",
      );

      let securitySituation = null;

      if (nationalIdChanged) {
        securitySituation = await getSecuritySituationByNationalId(
          normalizedFields.nationalIdNumber,
        );
      }

      // Upload photos.
      uploadedPhotoPaths = await uploadCoordinatorPhotos(
        coordinatorId,
        req.files ?? {},
      );

      const allowedPhotoColumns = new Set(
        Object.values(COORDINATOR_PHOTO_FIELDS),
      );

      for (const [column, path] of Object.entries(uploadedPhotoPaths)) {
        if (!allowedPhotoColumns.has(column)) {
          throw new Error(`Unexpected photo database column: ${column}`);
        }

        if (typeof path !== "string" || !path.trim()) {
          throw new Error(`Invalid uploaded path for ${column}`);
        }
      }

      const request = pool.request().input("id", sql.Int, coordinatorId);

      const setClauses = [];

      for (const [key, value] of changedEntries) {
        const { column, type } = columnMap[key];
        const parameter = `value_${key}`;

        let parsedValue = value;

        if (key === "name") {
          parsedValue = value.trim();
        }

        if (
          ["code", "numberOfPrintCopies", "advertisingCompanyId"].includes(
            key,
          ) &&
          value !== null
        ) {
          parsedValue = Number(value);
        }

        request.input(parameter, type, parsedValue);

        setClauses.push(`[${column}] = @${parameter}`);
      }

      // Automatic security status update.
      if (nationalIdChanged) {
        request.input(
          "securitySituationFromSecurity",
          sql.NVarChar(100),
          securitySituation ?? null,
        );

        setClauses.push(
          "[security_situation] = @securitySituationFromSecurity",
        );
      }

      // Add uploaded photo columns.
      for (const [column, path] of Object.entries(uploadedPhotoPaths)) {
        const parameter = `photo_${column}`;

        request.input(parameter, sql.NVarChar(sql.MAX), path);

        setClauses.push(`[${column}] = @${parameter}`);
      }

      if (!setClauses.length) {
        return res.status(200).json({
          message: "No changes to update",
          coordinator: existing,
        });
      }

      const result = await request.query(`
      UPDATE dbo.coordinator
      SET ${setClauses.join(", ")}
      OUTPUT INSERTED.*
      WHERE id = @id;
    `);

      const updatedCoordinator = result.recordset[0];

      databaseUpdateSucceeded = true;

      // Delete old photos only after the database update succeeds.
      const deletionFailures = [];

      for (const [column, newPath] of Object.entries(uploadedPhotoPaths)) {
        const oldPath = oldPhotoPaths[column];

        if (!oldPath || oldPath === newPath) {
          continue;
        }

        try {
          await deleteCoordinatorImage(oldPath);
        } catch (error) {
          console.error(
            `Failed to delete old photo for ${column}:`,
            oldPath,
            error.message,
          );

          deletionFailures.push({
            column,
            oldPath,
            error: error.message,
          });
        }
      }

      return res.status(200).json({
        message: "Coordinator updated successfully",
        coordinator: updatedCoordinator,
        updatedFields: [
          ...changedEntries.map(([key]) => key),
          ...(nationalIdChanged ? ["securitySituation"] : []),
          ...Object.keys(uploadedPhotoPaths),
        ],
        ...(deletionFailures.length > 0 && {
          photoCleanupWarning:
            "The new photo was saved, but some old photos could not be deleted.",
          photoCleanupFailures: deletionFailures,
        }),
      });
    } catch (error) {
      console.error("Update coordinator error:", error);

      // Clean up newly uploaded files if the database update failed.
      if (!databaseUpdateSucceeded) {
        for (const newPath of Object.values(uploadedPhotoPaths)) {
          try {
            await deleteCoordinatorImage(newPath);
          } catch (cleanupError) {
            console.error(
              "Failed to clean up newly uploaded photo:",
              newPath,
              cleanupError.message,
            );
          }
        }
      }

      if (error.number === 2627 || error.number === 2601) {
        return res.status(409).json({
          message: "A value conflicts with a unique constraint",
        });
      }

      return res.status(error.status || 500).json({
        message:
          error.status === 404 ? error.message : "Failed to update coordinator",
        ...(error.status !== 404 && {
          error: error.message,
        }),
      });
    }
  },

  /* ---------------------------------------------------------------------- */
  /* GET COORDINATOR BY CODE                                                */
  /* ---------------------------------------------------------------------- */

  getCoordinatorByCode: async (req, res) => {
    try {
      const { code } = req.params;

      if (!isValidPositiveInteger(code)) {
        return res.status(400).json({
          message: "Invalid coordinator code",
        });
      }

      const pool = await retailPoolPromise;

      const result = await pool.request().input("code", sql.Int, Number(code))
        .query(`
                    SELECT
                        c.code,
                        c.name,
                        c.company_name,
                        c.advertising_company_id,
                        ac.name AS advertising_company_name,
                        c.job,
                        c.national_id_number,
                        c.id_expiry_date,
                        c.profile_picture,
                        c.national_id_picture,
                        c.health_certificate_picture,
                        c.company_authorization_picture,
                        c.social_insurance_picture,
                        c.supervisor_national_id_picture
                    FROM dbo.coordinator AS c
                    LEFT JOIN dbo.advertising_companies AS ac
                        ON ac.id = c.advertising_company_id
                        AND ac.isdeleted = 0
                    WHERE c.code = @code;
                `);

      if (!result.recordset.length) {
        return res.status(404).json({
          message: "Coordinator not found",
        });
      }

      const coordinator = result.recordset[0];

      console.log("Coordinator retrieved:", {
        code: coordinator.code,
        profile_picture: coordinator.profile_picture,
        advertising_company_id: coordinator.advertising_company_id,
        advertising_company_name: coordinator.advertising_company_name,
        photoFields: Object.fromEntries(
          Object.entries(coordinator).filter(([key]) =>
            /picture|photo/i.test(key),
          ),
        ),
      });

      return res.status(200).json({
        message: "Coordinator retrieved successfully",
        coordinator,
      });
    } catch (error) {
      console.error("Get coordinator by code error:", error);

      return res.status(500).json({
        message: "Failed to retrieve coordinator",
        error: error.message,
      });
    }
  },
};

export default CoordinatorController;
