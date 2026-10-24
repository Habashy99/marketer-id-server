import { sql, poolPromise } from "../database/db.js";
import parseDate from "../helper/parseDate.js";
const CoordinatorController = {
    getAllCoordinators: async (req, res) => {
        try {
            const { job, filter, code } = req.query;

            if (code !== undefined) {
                if (
                    typeof code !== "string" ||
                    !/^\d+$/.test(code.trim()) ||
                    !Number.isSafeInteger(Number(code)) ||
                    Number(code) <= 0 ||
                    Number(code) > 2147483647
                ) {
                    return res.status(400).json({
                        message: "Invalid coordinator code",
                    });
                }
            }

            const pool = await poolPromise;
            const request = pool.request();

            const conditions = [];

            if (code !== undefined) {
                request.input("code", sql.Int, Number(code.trim()));
                conditions.push("c.code = @code");
            }

            if (filter === "expired") {
                conditions.push(`
                (
                    LTRIM(RTRIM(c.states)) = N'غير مفعل'
                    OR c.health_certificate_expiry_date
                        < CAST(GETDATE() AS DATE)
                )
            `);
            } else if (
                job !== undefined &&
                typeof job === "string" &&
                job.trim() !== ""
            ) {
                request.input("job", sql.NVarChar(255), job.trim());
                conditions.push("LTRIM(RTRIM(c.job)) = @job");
            }

            let query = `
            SELECT
                c.*,
                e.exception_id,
                e.exception_name,
                e.exception_start_date,
                e.exception_end_date
            FROM dbo.coordinator AS c
            LEFT JOIN dbo.[exception] AS e
                ON e.coordinator_id = c.id
        `;

            if (conditions.length > 0) {
                query += `
                WHERE ${conditions.join(" AND ")}
            `;
            }

            query += " ORDER BY c.id;";

            const result = await request.query(query);

            return res.status(200).json({
                message: "Get coordinators successful",
                coordinators: result.recordset,
            });
        } catch (error) {
            console.error("Get all coordinators error:", error);

            return res.status(500).json({
                message: "Get coordinators failed",
            });
        }
    },

    getCoordinatorById: async (req, res) => {
        try {
            const id = req.body.id;

            if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
                return res.status(400).json({
                    message: "Invalid coordinator ID",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, Number(id))
                .query(`
                SELECT
                    c.*,
                    e.*
                FROM coordinator AS c
                LEFT JOIN [exception] AS e
                    ON e.coordinator_id = c.id
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
            });
        }
    },

    createCoordinator: async (req, res) => {
        try {
            const {
                code,
                name,
                job,
                companyName,
                healthCertificateIssuanceDate,
                healthCertificateExpiryDate,
                nationalIdNumber,
                mobile,
                governorate,
                notes,
                idIssuanceDate,
                idExpiryDate,
                createdBy,
                address,
                supervisorName,
                numberOfPrintcopies,
                securitySituation,
                profilePicture,
                nationalIdPicture,
                healthCertificatePicture,
                companyAuthorizationPicture,
                socialInsurancePicture,
                supervisorNationalIdPicture,
                state,
            } = req.body;

            if (
                code === undefined ||
                code === null ||
                String(code).trim() === "" ||
                !Number.isInteger(Number(code)) ||
                Number(code) <= 0 ||
                typeof name !== "string" ||
                name.trim() === "" ||
                companyName === undefined ||
                companyName === null ||
                typeof companyName !== "string" ||
                companyName.trim() === "" ||
                createdBy === undefined ||
                createdBy === null ||
                !Number.isInteger(Number(createdBy)) ||
                Number(createdBy) <= 0
            ) {
                return res.status(400).json({
                    message:
                        "Valid code, name, companyName, and createdBy are required",
                });
            }

            if (
                numberOfPrintcopies !== undefined &&
                numberOfPrintcopies !== null &&
                numberOfPrintcopies !== "" &&
                (!Number.isInteger(Number(numberOfPrintcopies)) ||
                    Number(numberOfPrintcopies) < 0)
            ) {
                return res.status(400).json({
                    message: "numberOfPrintcopies must be a non-negative integer",
                });
            }

            const pool = await poolPromise;

            const existingCoordinator = await pool
                .request()
                .input("code", sql.Int, Number(code))
                .query(`
                SELECT id
                FROM dbo.coordinator
                WHERE code = @code
            `);

            if (existingCoordinator.recordset.length > 0) {
                return res.status(409).json({
                    message: "Coordinator code already exists",
                });
            }

            const result = await pool
                .request()
                .input("code", sql.Int, Number(code))
                .input("name", sql.NVarChar(255), name.trim())
                .input("job", sql.NVarChar(255), job || null)
                .input("companyName", sql.NVarChar(255), companyName.trim())
                .input(
                    "healthCertificateIssuanceDate",
                    sql.Date,
                    healthCertificateIssuanceDate || null
                )
                .input(
                    "healthCertificateExpiryDate",
                    sql.Date,
                    healthCertificateExpiryDate || null
                )
                .input(
                    "nationalIdNumber",
                    sql.NVarChar(50),
                    nationalIdNumber || null
                )
                .input("mobile", sql.NVarChar(30), mobile || null)
                .input("governorate", sql.NVarChar(100), governorate || null)
                .input("notes", sql.NVarChar(sql.MAX), notes || null)
                .input("idIssuanceDate", sql.Date, idIssuanceDate || null)
                .input("idExpiryDate", sql.Date, idExpiryDate || null)
                .input("createdBy", sql.Int, Number(createdBy))
                .input("address", sql.NVarChar(500), address || null)
                .input(
                    "supervisorName",
                    sql.NVarChar(255),
                    supervisorName || null
                )
                .input(
                    "numberOfPrintCopies",
                    sql.Int,
                    numberOfPrintcopies === "" ||
                        numberOfPrintcopies === undefined ||
                        numberOfPrintcopies === null
                        ? null
                        : Number(numberOfPrintcopies)
                )
                .input(
                    "securitySituation",
                    sql.NVarChar(100),
                    securitySituation || null
                )
                .input("profilePicture", sql.NVarChar(sql.MAX), profilePicture ?? null)
                .input(
                    "nationalIdPicture",
                    sql.NVarChar(sql.MAX),
                    nationalIdPicture ?? null
                )
                .input(
                    "healthCertificatePicture",
                    sql.NVarChar(sql.MAX),
                    healthCertificatePicture ?? null
                )
                .input(
                    "companyAuthorizationPicture",
                    sql.NVarChar(sql.MAX),
                    companyAuthorizationPicture ?? null
                )
                .input(
                    "socialInsurancePicture",
                    sql.NVarChar(sql.MAX),
                    socialInsurancePicture ?? null
                )
                .input(
                    "supervisorNationalIdPicture",
                    sql.NVarChar(sql.MAX),
                    supervisorNationalIdPicture ?? null
                )
                .input("state", sql.NVarChar(100), state || null)
                .query(`
                INSERT INTO dbo.coordinator (
                    code,
                    name,
                    job,
                    company_name,
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
                    INSERTED.created_by
                VALUES (
                    @code,
                    @name,
                    @job,
                    @companyName,
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
                    @profilePicture,
                    @nationalIdPicture,
                    @healthCertificatePicture,
                    @companyAuthorizationPicture,
                    @socialInsurancePicture,
                    @supervisorNationalIdPicture,
                    @state
                )
            `);

            return res.status(201).json({
                message: "Coordinator created successfully",
                coordinator: result.recordset[0],
            });
        } catch (error) {
            console.error("Create coordinator error:", error);

            if (error.number === 2627 || error.number === 2601) {
                return res.status(409).json({
                    message: "Coordinator code already exists",
                });
            }

            return res.status(500).json({
                message: "Failed to create coordinator",
                error: error.message,
            });
        }
    },


    updateCoordinator: async (req, res) => {
        try {
            const { id, ...fields } = req.body;

            // 1. Validate coordinator ID
            if (
                id === undefined ||
                id === null ||
                String(id).trim() === "" ||
                !Number.isInteger(Number(id)) ||
                Number(id) <= 0 ||
                Number(id) > 2147483647
            ) {
                return res.status(400).json({
                    message: "A valid coordinator id is required",
                });
            }

            // 2. Map editable API fields to database columns.
            // Photo columns are intentionally excluded from this update.
            const columnMap = {
                code: { column: "code", type: sql.Int },
                name: { column: "name", type: sql.NVarChar(255) },
                job: { column: "job", type: sql.NVarChar(255) },
                companyName: {
                    column: "company_name",
                    type: sql.NVarChar(255),
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
                mobile: { column: "mobile", type: sql.NVarChar(30) },
                governorate: {
                    column: "governorate",
                    type: sql.NVarChar(100),
                },
                notes: { column: "notes", type: sql.NVarChar(sql.MAX) },
                idIssuanceDate: {
                    column: "id_issuance_date",
                    type: sql.Date,
                },
                idExpiryDate: {
                    column: "id_expiry_date",
                    type: sql.Date,
                },
                address: { column: "address", type: sql.NVarChar(500) },
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

            // 3. Ignore photo fields completely for now.
            // Existing photo paths in SQL Server will not be changed.
            const photoFields = [
                "profilePicture",
                "nationalIdPicture",
                "healthCertificatePicture",
                "companyAuthorizationPicture",
                "socialInsurancePicture",
                "supervisorNationalIdPicture",
            ];

            for (const field of photoFields) {
                delete fields[field];
            }

            // 4. Reject unknown fields
            const invalidFields = Object.keys(fields).filter(
                key => !Object.hasOwn(columnMap, key)
            );

            if (invalidFields.length > 0) {
                return res.status(400).json({
                    message: "Unknown or non-editable fields",
                    fields: invalidFields,
                });
            }

            // 5. Normalize empty optional values
            const normalizedFields = {};

            for (const [key, value] of Object.entries(fields)) {
                normalizedFields[key] =
                    typeof value === "string" && value.trim() === ""
                        ? null
                        : value;
            }

            // 6. Validate values
            for (const [key, value] of Object.entries(normalizedFields)) {
                if (
                    key === "name" &&
                    (value === null || typeof value !== "string")
                ) {
                    return res.status(400).json({
                        message: "Name cannot be empty",
                    });
                }

                if (
                    key === "code" &&
                    (
                        value === null ||
                        !/^\d+$/.test(String(value).trim()) ||
                        !Number.isSafeInteger(Number(value)) ||
                        Number(value) <= 0 ||
                        Number(value) > 2147483647
                    )
                ) {
                    return res.status(400).json({
                        message: "Code must be a valid positive integer",
                    });
                }

                if (
                    key === "numberOfPrintcopies" &&
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

                const dateFields = [
                    "healthCertificateIssuanceDate",
                    "healthCertificateExpiryDate",
                    "idIssuanceDate",
                    "idExpiryDate",
                ];

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
                            message: `${key} must be a valid date in YYYY-MM-DD format or empty`,
                        });
                    }
                }
            }

            // 7. Connect to SQL Server
            const pool = await poolPromise;

            // 8. Get the current coordinator row
            const existingResult = await pool
                .request()
                .input("id", sql.Int, Number(id))
                .query(`
                SELECT *
                FROM dbo.coordinator
                WHERE id = @id
            `);

            if (existingResult.recordset.length === 0) {
                return res.status(404).json({
                    message: "Coordinator not found",
                });
            }

            const existing = existingResult.recordset[0];

            // 9. Determine which supplied fields actually changed
            const dateFields = [
                "healthCertificateIssuanceDate",
                "healthCertificateExpiryDate",
                "idIssuanceDate",
                "idExpiryDate",
            ];

            const changedEntries = Object.entries(normalizedFields).filter(
                ([key, value]) => {
                    const { column } = columnMap[key];

                    let oldValue = existing[column];
                    let newValue = value;

                    if (dateFields.includes(key)) {
                        oldValue = oldValue
                            ? new Date(oldValue).toISOString().slice(0, 10)
                            : null;

                        newValue = newValue || null;
                    } else if (
                        ["code", "numberOfPrintcopies"].includes(key)
                    ) {
                        oldValue =
                            oldValue === null || oldValue === undefined
                                ? null
                                : Number(oldValue);

                        newValue =
                            newValue === null ? null : Number(newValue);
                    } else {
                        oldValue =
                            oldValue === null || oldValue === undefined
                                ? null
                                : String(oldValue);

                        newValue =
                            newValue === null
                                ? null
                                : String(newValue);

                        if (key === "name" && newValue !== null) {
                            newValue = newValue.trim();
                        }
                    }

                    return oldValue !== newValue;
                }
            );

            if (changedEntries.length === 0) {
                return res.status(200).json({
                    message: "No changes to update",
                    coordinator: existing,
                });
            }

            // 10. Check code uniqueness if the code changed
            const codeEntry = changedEntries.find(
                ([key]) => key === "code"
            );

            if (codeEntry) {
                const duplicate = await pool
                    .request()
                    .input("code", sql.Int, Number(codeEntry[1]))
                    .input("id", sql.Int, Number(id))
                    .query(`
                    SELECT id
                    FROM dbo.coordinator
                    WHERE code = @code AND id <> @id
                `);

                if (duplicate.recordset.length > 0) {
                    return res.status(409).json({
                        message: "Coordinator code already exists",
                    });
                }
            }

            // 11. Update only the changed columns
            const request = pool.request().input(
                "id",
                sql.Int,
                Number(id)
            );

            const setClauses = changedEntries.map(([key, value]) => {
                const { column, type } = columnMap[key];
                const parameter = `value_${key}`;

                let parsedValue = value;

                if (key === "name") {
                    parsedValue = value.trim();
                }

                if (
                    ["code", "numberOfPrintcopies"].includes(key) &&
                    value !== null
                ) {
                    parsedValue = Number(value);
                }

                request.input(parameter, type, parsedValue);

                return `[${column}] = @${parameter}`;
            });

            const result = await request.query(`
            UPDATE dbo.coordinator
            SET ${setClauses.join(", ")}
            OUTPUT INSERTED.*
            WHERE id = @id;
        `);

            return res.status(200).json({
                message: "Coordinator updated successfully",
                coordinator: result.recordset[0],
                updatedFields: changedEntries.map(([key]) => key),
            });
        } catch (error) {
            console.error("Update coordinator error:", error);

            if (error.number === 2627 || error.number === 2601) {
                return res.status(409).json({
                    message: "A value conflicts with a unique constraint",
                });
            }

            return res.status(500).json({
                message: "Failed to update coordinator",
                error: error.message,
            });
        }
    },



}

export default CoordinatorController;