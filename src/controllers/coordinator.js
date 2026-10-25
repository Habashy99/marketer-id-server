import { sql, poolPromise } from "../config/db.js";
import {
    uploadCoordinatorPhotos,
    deleteCoordinatorImage,
} from "./imageController.js";
import { COORDINATOR_PHOTO_FIELDS } from "../utils/imagePaths.js";
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
            states,
        } = req.body;

        // 1. Validate required fields
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
            typeof company_name !== "string" ||
            company_name.trim() === "" ||
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
                    "Valid code, name, company_name, and created_by are required",
            });
        }

        // 2. Validate number of print copies
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

        // 3. Validate date formats
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

        const pool = await poolPromise;

        // 4. Check whether the coordinator code already exists
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

        // 5. Insert coordinator
        const result = await pool
            .request()
            .input("code", sql.Int, Number(code))
            .input("name", sql.NVarChar(255), name.trim())
            .input("job", sql.NVarChar(255), job || null)
            .input(
                "companyName",
                sql.NVarChar(255),
                company_name.trim()
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
            .input(
                "profilePicture",
                sql.NVarChar(sql.MAX),
                profile_picture ?? null
            )
            .input(
                "nationalIdPicture",
                sql.NVarChar(sql.MAX),
                national_id_picture ?? null
            )
            .input(
                "healthCertificatePicture",
                sql.NVarChar(sql.MAX),
                health_certificate_picture ?? null
            )
            .input(
                "companyAuthorizationPicture",
                sql.NVarChar(sql.MAX),
                company_authorization_picture ?? null
            )
            .input(
                "socialInsurancePicture",
                sql.NVarChar(sql.MAX),
                social_insurance_picture ?? null
            )
            .input(
                "supervisorNationalIdPicture",
                sql.NVarChar(sql.MAX),
                supervisor_national_id_picture ?? null
            )
            .input("state", sql.NVarChar(100), states || null)
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
                    INSERTED.created_by,
                    INSERTED.states
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
                );
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
        let uploadedPhotoPaths = {};
        let databaseUpdateSucceeded = false;

        try {
            const { id, ...fields } = req.body;

            // 1. Validate coordinator ID
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

            // 2. Map editable API fields to SQL columns
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

            // 3. Reject unknown fields
            const invalidFields = Object.keys(fields).filter(
                (key) => !Object.hasOwn(columnMap, key)
            );

            if (invalidFields.length > 0) {
                return res.status(400).json({
                    message: "Unknown or non-editable fields",
                    fields: invalidFields,
                });
            }

            // 4. Normalize empty strings
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

            // 5. Validate values
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

            const pool = await poolPromise;

            // 6. Get existing coordinator and old photo paths
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

            const oldPhotoPaths = {};

            for (const column of Object.values(COORDINATOR_PHOTO_FIELDS)) {
                oldPhotoPaths[column] = existing[column];
            }

            // 7. Find actual changes in ordinary fields
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
                        key === "numberOfPrintcopies"
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

            // 8. Check code uniqueness
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
                    WHERE code = @code AND id <> @id;
                `);

                if (duplicate.recordset.length > 0) {
                    return res.status(409).json({
                        message: "Coordinator code already exists",
                    });
                }
            }

            // 9. Upload replacement photos
            uploadedPhotoPaths = await uploadCoordinatorPhotos(
                coordinatorId,
                req.files ?? {}
            );

            // 10. Validate uploaded photo paths
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
                    throw new Error(`Invalid uploaded path for ${column}`);
                }
            }

            // 11. Prepare SQL update
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
                    (key === "code" || key === "numberOfPrintcopies") &&
                    value !== null
                ) {
                    parsedValue = Number(value);
                }

                request.input(parameter, type, parsedValue);
                setClauses.push(`[${column}] = @${parameter}`);
            }

            for (const [column, path] of Object.entries(uploadedPhotoPaths)) {
                const parameter = `photo_${column}`;

                request.input(parameter, sql.NVarChar(sql.MAX), path);
                setClauses.push(`[${column}] = @${parameter}`);
            }

            if (setClauses.length === 0) {
                return res.status(200).json({
                    message: "No changes to update",
                    coordinator: existing,
                });
            }

            // 12. Update SQL before deleting any old images
            const result = await request.query(`
            UPDATE dbo.coordinator
            SET ${setClauses.join(", ")}
            OUTPUT INSERTED.*
            WHERE id = @id;
        `);

            const updatedCoordinator = result.recordset[0];
            databaseUpdateSucceeded = true;

            // 13. Delete old files for replaced photo columns only
            const deletionFailures = [];

            for (const [column, newPath] of Object.entries(uploadedPhotoPaths)) {
                const oldPath = oldPhotoPaths[column];

                if (!oldPath || oldPath === newPath) {
                    continue;
                }

                try {
                    await deleteCoordinatorImage(oldPath);
                    console.log(`Deleted old photo for ${column}:`, oldPath);
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

            // Do not delete new photos if SQL update succeeded.
            // They may now be referenced by the database.
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






}

export default CoordinatorController;