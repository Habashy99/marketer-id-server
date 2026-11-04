import { sql, retailPoolPromise } from "../config/db.js";
import {
    uploadCoordinatorPhotos,
    deleteCoordinatorImage,
} from "./imageController.js";
import { COORDINATOR_PHOTO_FIELDS } from "../utils/imagePaths.js";

async function getRetailNames(coordinators) {
    if (coordinators.length === 0) {
        return [];
    }

    const retailPool = await retailPoolPromise;

    if (!retailPool) {
        throw new Error("Retail database unavailable");
    }

    const supplierIds = [
        ...new Set(
            coordinators
                .map((item) => Number(item.company_name))
                .filter((id) => Number.isSafeInteger(id) && id > 0)
        ),
    ];

    const branchIds = [
        ...new Set(
            coordinators
                .map((item) => Number(item.branch))
                .filter((id) => Number.isSafeInteger(id) && id > 0)
        ),
    ];

    const supplierMap = new Map();
    const branchMap = new Map();

    // Get supplier names
    if (supplierIds.length > 0) {
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

        for (const supplier of result.recordset) {
            supplierMap.set(Number(supplier.id), supplier.a_name);
        }
    }

    // Get branch names
    if (branchIds.length > 0) {
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

        for (const branch of result.recordset) {
            branchMap.set(Number(branch.id), branch.a_name);
        }
    }

    return coordinators.map((coordinator) => {
        const supplierId = Number(coordinator.company_name);
        const branchId = Number(coordinator.branch);

        return {
            ...coordinator,

            supplier_name:
                supplierMap.get(supplierId) ??
                coordinator.company_name ??
                null,

            branch_name:
                branchMap.get(branchId) ??
                coordinator.branch ??
                null,
        };
    });
}

const CoordinatorController = {

    getAllCoordinators: async (req, res) => {
        try {
            const {
                job,
                filter,
                code,
                supplierId,
                branchId,
                advertisingCompanyId,
            } = req.query;

            const pool = await retailPoolPromise;
            const request = pool.request();
            const conditions = [];

            // Filter by coordinator code
            if (code !== undefined && code !== "") {
                const normalizedCode = String(code).trim();

                if (
                    !/^\d+$/.test(normalizedCode) ||
                    !Number.isSafeInteger(Number(normalizedCode)) ||
                    Number(normalizedCode) <= 0 ||
                    Number(normalizedCode) > 2147483647
                ) {
                    return res.status(400).json({
                        message: "Invalid coordinator code",
                    });
                }

                request.input("code", sql.Int, Number(normalizedCode));
                conditions.push("c.code = @code");
            }

            // Filter by job
            if (typeof job === "string" && job.trim()) {
                request.input("job", sql.NVarChar(255), job.trim());

                conditions.push("LTRIM(RTRIM(c.job)) = @job");
            }

            // Filter by status
            if (filter === "expired") {
                conditions.push(`
                (
                    LTRIM(RTRIM(c.states)) = N'غير مفعل'
                    OR c.health_certificate_expiry_date
                        < CAST(GETDATE() AS DATE)
                )
            `);
            }

            // Filter by supplier
            if (supplierId !== undefined && supplierId !== "") {
                const id = String(supplierId).trim();

                if (
                    !/^\d+$/.test(id) ||
                    !Number.isSafeInteger(Number(id)) ||
                    Number(id) <= 0 ||
                    Number(id) > 2147483647
                ) {
                    return res.status(400).json({
                        message: "Invalid supplier ID",
                    });
                }

                request.input(
                    "supplierId",
                    sql.NVarChar(255),
                    String(Number(id))
                );

                conditions.push("c.company_name = @supplierId");
            }

            // Filter by branch
            if (branchId !== undefined && branchId !== "") {
                const id = String(branchId).trim();

                if (
                    !/^\d+$/.test(id) ||
                    !Number.isSafeInteger(Number(id)) ||
                    Number(id) <= 0 ||
                    Number(id) > 2147483647
                ) {
                    return res.status(400).json({
                        message: "Invalid branch ID",
                    });
                }

                request.input(
                    "branchId",
                    sql.NVarChar(255),
                    String(Number(id))
                );

                conditions.push("c.branch = @branchId");
            }

            // Filter by advertising company
            if (
                advertisingCompanyId !== undefined &&
                advertisingCompanyId !== ""
            ) {
                const id = String(advertisingCompanyId).trim();

                if (
                    !/^\d+$/.test(id) ||
                    !Number.isSafeInteger(Number(id)) ||
                    Number(id) <= 0 ||
                    Number(id) > 2147483647
                ) {
                    return res.status(400).json({
                        message: "Invalid advertising company ID",
                    });
                }

                request.input(
                    "advertisingCompanyId",
                    sql.Int,
                    Number(id)
                );

                conditions.push(
                    "c.advertising_company_id = @advertisingCompanyId"
                );
            }

            // Main query
            let query = `
            SELECT
                c.*,
                ac.name AS advertising_company_name,
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

            if (conditions.length > 0) {
                query += `
                WHERE ${conditions.join(" AND ")}
            `;
            }

            query += `
            ORDER BY c.id;
        `;

            const result = await request.query(query);

            // Get supplier and branch names from the retail database
            const coordinators = await getRetailNames(result.recordset);

            return res.status(200).json({
                message: "Get coordinators successful",
                coordinators,
            });

        } catch (error) {
            console.error("Get all coordinators error:", error);

            return res.status(500).json({
                message: "Get coordinators failed",
                error: error.message,
            });
        }
    },

    getCoordinatorById: async (req, res) => {
        try {
            const id = Number(req.body.id);

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    message: "Invalid coordinator ID",
                });
            }

            const pool = await retailPoolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, id)
                .query(`
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

            if (result.recordset.length === 0) {
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
                security_situation,
                states,
            } = req.body;

            const supplierId = String(company_name ?? "").trim();
            const branchId = String(branch ?? "").trim();

            // Validate required fields
            if (
                code === undefined ||
                code === null ||
                String(code).trim() === "" ||
                !/^\d+$/.test(String(code).trim()) ||
                !Number.isSafeInteger(Number(code)) ||
                Number(code) <= 0 ||
                Number(code) > 2147483647 ||
                typeof name !== "string" ||
                name.trim() === "" ||
                !/^\d+$/.test(supplierId) ||
                !/^\d+$/.test(branchId) ||
                created_by === undefined ||
                created_by === null ||
                String(created_by).trim() === "" ||
                !/^\d+$/.test(String(created_by).trim()) ||
                !Number.isSafeInteger(Number(created_by)) ||
                Number(created_by) <= 0 ||
                Number(created_by) > 2147483647
            ) {
                return res.status(400).json({
                    message:
                        "Valid code, name, supplier ID, branch ID, and created_by are required",
                });
            }

            // Validate number of print copies
            if (
                number_of_print_copies !== undefined &&
                number_of_print_copies !== null &&
                number_of_print_copies !== "" &&
                (
                    !/^\d+$/.test(String(number_of_print_copies).trim()) ||
                    !Number.isSafeInteger(Number(number_of_print_copies)) ||
                    Number(number_of_print_copies) < 0 ||
                    Number(number_of_print_copies) > 2147483647
                )
            ) {
                return res.status(400).json({
                    message:
                        "number_of_print_copies must be a non-negative integer",
                });
            }

            // Validate date fields
            const dateFields = {
                health_certificate_issuance_date,
                health_certificate_expiry_date,
                id_issuance_date,
                id_expiry_date,
            };

            for (const [field, value] of Object.entries(dateFields)) {
                if (value !== undefined && value !== null && value !== "") {
                    const validFormat =
                        typeof value === "string" &&
                        /^\d{4}-\d{2}-\d{2}$/.test(value);

                    const parsedDate = validFormat
                        ? new Date(`${value}T00:00:00.000Z`)
                        : null;

                    if (
                        !parsedDate ||
                        Number.isNaN(parsedDate.getTime()) ||
                        parsedDate.toISOString().slice(0, 10) !== value
                    ) {
                        return res.status(400).json({
                            message: `${field} must be a valid YYYY-MM-DD date`,
                        });
                    }
                }
            }

            const pool = await retailPoolPromise;

            // Check duplicate coordinator code
            const existingCoordinator = await pool
                .request()
                .input("code", sql.Int, Number(code))
                .query(`
                SELECT id
                FROM dbo.coordinator
                WHERE code = @code;
            `);

            if (existingCoordinator.recordset.length > 0) {
                return res.status(409).json({
                    message: "Coordinator code already exists",
                });
            }

            // Create coordinator first
            const result = await pool
                .request()
                .input("code", sql.Int, Number(code))
                .input("name", sql.NVarChar(255), name.trim())
                .input("job", sql.NVarChar(255), job || null)
                .input("companyName", sql.NVarChar(255), supplierId)
                .input("branch", sql.NVarChar(255), branchId)
                .input(
                    "emailDiscount",
                    sql.NVarChar(100),
                    email_discount?.trim() || "لا"
                )
                .input(
                    "healthCertificateIssuanceDate",
                    sql.Date,
                    health_certificate_issuance_date || null
                )
                .input(
                    "healthCertificateExpiryDate",
                    sql.Date,
                    health_certificate_expiry_date || null
                )
                .input(
                    "nationalIdNumber",
                    sql.NVarChar(50),
                    national_id_number || null
                )
                .input("mobile", sql.NVarChar(30), mobile || null)
                .input(
                    "governorate",
                    sql.NVarChar(100),
                    governorate || null
                )
                .input("notes", sql.NVarChar(sql.MAX), notes || null)
                .input(
                    "idIssuanceDate",
                    sql.Date,
                    id_issuance_date || null
                )
                .input("idExpiryDate", sql.Date, id_expiry_date || null)
                .input("createdBy", sql.Int, Number(created_by))
                .input("address", sql.NVarChar(500), address || null)
                .input(
                    "supervisorName",
                    sql.NVarChar(255),
                    supervisor_name || null
                )
                .input(
                    "numberOfPrintCopies",
                    sql.Int,
                    number_of_print_copies === "" ||
                        number_of_print_copies === undefined ||
                        number_of_print_copies === null
                        ? null
                        : Number(number_of_print_copies)
                )
                .input(
                    "securitySituation",
                    sql.NVarChar(100),
                    security_situation || null
                )
                .input("state", sql.NVarChar(100), states || null)
                .query(`
                INSERT INTO dbo.coordinator (
                    code,
                    name,
                    job,
                    company_name,
                    branch,
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
                    security_situation,
                    profile_picture,
                    national_id_picture,
                    health_certificate_picture,
                    company_authorization_picture,
                    social_insurance_picture,
                    supervisor_national_id_picture,
                    states
                )
                OUTPUT
                    INSERTED.id,
                    INSERTED.code,
                    INSERTED.name,
                    INSERTED.company_name,
                    INSERTED.created_by,
                    INSERTED.states
                VALUES (
                    @code,
                    @name,
                    @job,
                    @companyName,
                    @branch,
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

            // Upload coordinator photos to Nextcloud
            uploadedPhotoPaths = await uploadCoordinatorPhotos(
                coordinatorId,
                req.files ?? {}
            );

            // Update photo paths in SQL Server
            const photoEntries = Object.entries(uploadedPhotoPaths);

            if (photoEntries.length > 0) {
                const updateRequest = pool.request();

                updateRequest.input("id", sql.Int, coordinatorId);

                const setClauses = photoEntries.map(
                    ([columnName, photoPath], index) => {
                        if (
                            !Object.values(COORDINATOR_PHOTO_FIELDS).includes(
                                columnName
                            )
                        ) {
                            throw new Error(
                                `Invalid coordinator photo column: ${columnName}`
                            );
                        }

                        updateRequest.input(
                            `photo${index}`,
                            sql.NVarChar(sql.MAX),
                            photoPath
                        );

                        return `[${columnName}] = @photo${index}`;
                    }
                );

                await updateRequest.query(`
                UPDATE dbo.coordinator
                SET ${setClauses.join(", ")}
                WHERE id = @id;
            `);
            }

            // Return created coordinator with photo paths
            const coordinatorResult = await pool
                .request()
                .input("id", sql.Int, coordinatorId)
                .query(`
                SELECT *
                FROM dbo.coordinator
                WHERE id = @id;
            `);

            return res.status(201).json({
                message: "Coordinator created successfully",
                coordinator: coordinatorResult.recordset[0],
            });

        } catch (error) {
            console.error("Create coordinator error:", error);

            // If the coordinator was already inserted, roll back its database row
            if (coordinatorId !== null) {
                try {
                    const pool = await retailPoolPromise;

                    await pool
                        .request()
                        .input("id", sql.Int, coordinatorId)
                        .query(`
                        DELETE FROM dbo.coordinator
                        WHERE id = @id;
                    `);
                } catch (deleteError) {
                    console.error(
                        "Failed to delete coordinator after creation error:",
                        deleteError
                    );
                }
            }

            // Delete uploaded Nextcloud photos
            await Promise.allSettled(
                Object.values(uploadedPhotoPaths).map(deleteCoordinatorImage)
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

    updateCoordinator: async (req, res) => {
        let uploadedPhotoPaths = {};
        let databaseUpdateSucceeded = false;

        try {
            const { id, ...fields } = req.body;

            // Validate coordinator ID
            if (
                id === undefined ||
                id === null ||
                !/^\d+$/.test(String(id).trim()) ||
                !Number.isSafeInteger(Number(id)) ||
                Number(id) <= 0 ||
                Number(id) > 2147483647
            ) {
                return res.status(400).json({
                    message: "A valid coordinator id is required",
                });
            }

            const coordinatorId = Number(id);

            // Editable database columns
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
                numberOfPrintcopies: {
                    column: "number_of_print_copies",
                    type: sql.Int,
                },
                securitySituation: {
                    column: "security_situation",
                    type: sql.NVarChar(100),
                },
                states: {
                    column: "states",
                    type: sql.NVarChar(100),
                },
            };

            // Reject unknown fields
            const invalidFields = Object.keys(fields).filter(
                (key) => !Object.hasOwn(columnMap, key)
            );

            if (invalidFields.length > 0) {
                return res.status(400).json({
                    message: "Unknown or non-editable fields",
                    fields: invalidFields,
                });
            }

            // Normalize empty strings to null
            const normalizedFields = {};

            for (const [key, value] of Object.entries(fields)) {
                normalizedFields[key] =
                    typeof value === "string" && value.trim() === ""
                        ? null
                        : value;
            }

            const dateFields = [
                "healthCertificateIssuanceDate",
                "healthCertificateExpiryDate",
                "idIssuanceDate",
                "idExpiryDate",
            ];

            // Validate fields
            for (const [key, value] of Object.entries(normalizedFields)) {
                if (
                    key === "name" &&
                    (value === null || typeof value !== "string" || !value.trim())
                ) {
                    return res.status(400).json({
                        message: "Name cannot be empty",
                    });
                }

                // Validate coordinator code
                if (key === "code") {
                    if (
                        value === null ||
                        !/^\d+$/.test(String(value).trim()) ||
                        !Number.isSafeInteger(Number(value)) ||
                        Number(value) <= 0 ||
                        Number(value) > 2147483647
                    ) {
                        return res.status(400).json({
                            message: "Code must be a valid positive integer",
                        });
                    }
                }

                // Validate supplier ID and branch ID
                if (key === "companyName" || key === "branch") {
                    if (
                        value !== null &&
                        (
                            !/^\d+$/.test(String(value).trim()) ||
                            !Number.isSafeInteger(Number(value)) ||
                            Number(value) <= 0 ||
                            Number(value) > 2147483647
                        )
                    ) {
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

                // Validate advertising company ID
                if (key === "advertisingCompanyId") {
                    if (
                        value !== null &&
                        (
                            !/^\d+$/.test(String(value).trim()) ||
                            !Number.isSafeInteger(Number(value)) ||
                            Number(value) <= 0 ||
                            Number(value) > 2147483647
                        )
                    ) {
                        return res.status(400).json({
                            message: "A valid advertising company ID is required",
                        });
                    }

                    if (value !== null) {
                        normalizedFields[key] = Number(value);
                    }
                }

                // Validate number of print copies
                if (key === "numberOfPrintcopies") {
                    if (
                        value !== null &&
                        (
                            !/^\d+$/.test(String(value).trim()) ||
                            !Number.isSafeInteger(Number(value)) ||
                            Number(value) < 0 ||
                            Number(value) > 2147483647
                        )
                    ) {
                        return res.status(400).json({
                            message:
                                "numberOfPrintcopies must be a non-negative integer or null",
                        });
                    }

                    if (value !== null) {
                        normalizedFields[key] = Number(value);
                    }
                }

                // Validate dates
                if (dateFields.includes(key) && value !== null) {
                    const validFormat =
                        typeof value === "string" &&
                        /^\d{4}-\d{2}-\d{2}$/.test(value);

                    const parsedDate = validFormat
                        ? new Date(`${value}T00:00:00.000Z`)
                        : null;

                    if (
                        !parsedDate ||
                        Number.isNaN(parsedDate.getTime()) ||
                        parsedDate.toISOString().slice(0, 10) !== value
                    ) {
                        return res.status(400).json({
                            message: `${key} must be a valid YYYY-MM-DD date or empty`,
                        });
                    }
                }
            }

            const pool = await retailPoolPromise;

            // Get existing coordinator
            const existingResult = await pool
                .request()
                .input("id", sql.Int, coordinatorId)
                .query(`
                SELECT *
                FROM dbo.coordinator
                WHERE id = @id;
            `);

            if (existingResult.recordset.length === 0) {
                return res.status(404).json({
                    message: "Coordinator not found",
                });
            }

            const existing = existingResult.recordset[0];

            // Save old photo paths
            const oldPhotoPaths = {};

            for (const column of Object.values(COORDINATOR_PHOTO_FIELDS)) {
                oldPhotoPaths[column] = existing[column];
            }

            // Find only changed fields
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
                        key === "code" ||
                        key === "numberOfPrintcopies" ||
                        key === "advertisingCompanyId"
                    ) {
                        oldValue =
                            oldValue == null ? null : Number(oldValue);

                        newValue =
                            newValue == null ? null : Number(newValue);
                    } else {
                        oldValue =
                            oldValue == null ? null : String(oldValue);

                        newValue =
                            newValue == null ? null : String(newValue);

                        if (key === "name" && newValue !== null) {
                            newValue = newValue.trim();
                        }
                    }

                    return oldValue !== newValue;
                }
            );

            // Check duplicate coordinator code
            const codeEntry = changedEntries.find(
                ([key]) => key === "code"
            );

            if (codeEntry) {
                const duplicate = await pool
                    .request()
                    .input("code", sql.Int, Number(codeEntry[1]))
                    .input("id", sql.Int, coordinatorId)
                    .query(`
                    SELECT id
                    FROM dbo.coordinator
                    WHERE code = @code
                      AND id <> @id;
                `);

                if (duplicate.recordset.length > 0) {
                    return res.status(409).json({
                        message: "Coordinator code already exists",
                    });
                }
            }

            // Upload photos
            uploadedPhotoPaths = await uploadCoordinatorPhotos(
                coordinatorId,
                req.files ?? {}
            );

            // Validate uploaded photo columns and paths
            const allowedPhotoColumns = new Set(
                Object.values(COORDINATOR_PHOTO_FIELDS)
            );

            for (const [column, path] of Object.entries(uploadedPhotoPaths)) {
                if (!allowedPhotoColumns.has(column)) {
                    throw new Error(
                        `Unexpected photo database column: ${column}`
                    );
                }

                if (typeof path !== "string" || path.trim() === "") {
                    throw new Error(
                        `Invalid uploaded path for ${column}`
                    );
                }
            }

            // Prepare SQL update
            const request = pool.request().input(
                "id",
                sql.Int,
                coordinatorId
            );

            const setClauses = [];

            for (const [key, value] of changedEntries) {
                const { column, type } = columnMap[key];
                const parameter = `value_${key}`;

                let parsedValue = value;

                if (key === "name") {
                    parsedValue = value.trim();
                }

                if (
                    (
                        key === "code" ||
                        key === "numberOfPrintcopies" ||
                        key === "advertisingCompanyId"
                    ) &&
                    value !== null
                ) {
                    parsedValue = Number(value);
                }

                request.input(parameter, type, parsedValue);

                setClauses.push(`[${column}] = @${parameter}`);
            }

            // Add photo updates
            for (const [column, path] of Object.entries(uploadedPhotoPaths)) {
                const parameter = `photo_${column}`;

                request.input(
                    parameter,
                    sql.NVarChar(sql.MAX),
                    path
                );

                setClauses.push(`[${column}] = @${parameter}`);
            }

            // Nothing changed
            if (setClauses.length === 0) {
                return res.status(200).json({
                    message: "No changes to update",
                    coordinator: existing,
                });
            }

            // Execute update
            const result = await request.query(`
            UPDATE dbo.coordinator
            SET ${setClauses.join(", ")}
            OUTPUT INSERTED.*
            WHERE id = @id;
        `);

            const updatedCoordinator = result.recordset[0];

            databaseUpdateSucceeded = true;

            // Delete old photos only after successful database update
            const deletionFailures = [];

            for (const [column, newPath] of Object.entries(uploadedPhotoPaths)) {
                const oldPath = oldPhotoPaths[column];

                if (!oldPath || oldPath === newPath) {
                    continue;
                }

                try {
                    await deleteCoordinatorImage(oldPath);

                    console.log(
                        `Deleted old photo for ${column}:`,
                        oldPath
                    );
                } catch (error) {
                    console.error(
                        `Failed to delete old photo for ${column}:`,
                        oldPath,
                        error.message
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

            // Clean up newly uploaded photos if DB update failed
            if (!databaseUpdateSucceeded) {
                for (const newPath of Object.values(uploadedPhotoPaths)) {
                    try {
                        await deleteCoordinatorImage(newPath);
                    } catch (cleanupError) {
                        console.error(
                            "Failed to clean up newly uploaded photo:",
                            newPath,
                            cleanupError.message
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
                    error.status === 404
                        ? error.message
                        : "Failed to update coordinator",
                ...(error.status !== 404 && {
                    error: error.message,
                }),
            });
        }
    },

    getCoordinatorByCode: async (req, res) => {
        try {
            const { code } = req.params;

            if (
                !code ||
                !/^\d+$/.test(code.trim()) ||
                !Number.isSafeInteger(Number(code)) ||
                Number(code) <= 0 ||
                Number(code) > 2147483647
            ) {
                return res.status(400).json({
                    message: "Invalid coordinator code",
                });
            }

            const pool = await retailPoolPromise;

            const result = await pool
                .request()
                .input("code", sql.Int, Number(code.trim()))
                .query(`
                SELECT *
                FROM dbo.coordinator
                WHERE code = @code;
            `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "Coordinator not found",
                });
            }

            return res.status(200).json({
                message: "Coordinator retrieved successfully",
                coordinator: result.recordset[0],
            });
        } catch (error) {
            console.error("Get coordinator by code error:", error);

            return res.status(500).json({
                message: "Failed to retrieve coordinator",
            });
        }
    },
}

export default CoordinatorController;