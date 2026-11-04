import sql from "mssql";
import { retailPoolPromise } from "../config/db.js";

// ==========================================
// GET SUPPLIER AND BRANCH NAMES
// ==========================================

async function getRetailNames(coordinators) {
    if (!coordinators.length) return [];

    const retailPool = await retailPoolPromise;

    if (!retailPool) {
        throw new Error("Retail database unavailable.");
    }

    const supplierIds = [
        ...new Set(
            coordinators
                .map((item) => Number(item.mother_company))
                .filter(
                    (id) => Number.isSafeInteger(id) && id > 0
                )
        ),
    ];

    const branchIds = [
        ...new Set(
            coordinators
                .map((item) => Number(item.branch))
                .filter(
                    (id) => Number.isSafeInteger(id) && id > 0
                )
        ),
    ];

    const supplierMap = new Map();
    const branchMap = new Map();

    // ==========================================
    // GET SUPPLIER NAMES
    // ==========================================

    if (supplierIds.length > 0) {
        const request = retailPool.request();

        const params = supplierIds.map((id, index) => {
            const key = `supplier${index}`;
            request.input(key, sql.Int, id);
            return `@${key}`;
        });

        const result = await request.query(`
            SELECT
                supplierno AS id,
                LTRIM(RTRIM(a_name)) AS name
            FROM dbo.sys_supplier
            WHERE supplierno IN (${params.join(",")});
        `);

        result.recordset.forEach((item) => {
            supplierMap.set(String(item.id), item.name);
        });
    }

    // ==========================================
    // GET BRANCH NAMES
    // ==========================================

    if (branchIds.length > 0) {
        const request = retailPool.request();

        const params = branchIds.map((id, index) => {
            const key = `branch${index}`;
            request.input(key, sql.Int, id);
            return `@${key}`;
        });

        const result = await request.query(`
            SELECT
                branch AS id,
                LTRIM(RTRIM(a_name)) AS name
            FROM dbo.sys_branch
            WHERE branch IN (${params.join(",")});
        `);

        result.recordset.forEach((item) => {
            branchMap.set(String(item.id), item.name);
        });
    }

    return coordinators.map((item) => ({
        ...item,

        mother_company_name:
            supplierMap.get(String(item.mother_company)) ??
            item.mother_company ??
            "-",

        branch_name:
            branchMap.get(String(item.branch)) ??
            item.branch ??
            "-",
    }));
}

// ==========================================
// VALIDATION HELPERS
// ==========================================

function isValidId(value) {
    return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isValidDate(value) {
    return (
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value))
    );
}

function isValidDateRange(fromDate, toDate) {
    return fromDate <= toDate;
}

// ==========================================
// GET COORDINATOR SELECT QUERY
// ==========================================

const coordinatorSelectQuery = `
    SELECT
        tc.id,
        tc.name,
        tc.mother_company,
        tc.advertising_company_id,
        ac.name AS advertising_company,
        tc.national_id_number,
        tc.branch,
        tc.from_date,
        tc.to_date,
        tc.notes
    FROM dbo.temporary_coordinator AS tc
    LEFT JOIN dbo.advertising_companies AS ac
        ON ac.id = tc.advertising_company_id
        AND ac.isdeleted = 0
`;

// ==========================================
// TEMPORARY COORDINATOR CONTROLLER
// ==========================================

const TemporaryCoordinatorController = {

    // ==========================================
    // CREATE
    // ==========================================

    createTemporaryCoordinator: async (req, res) => {
        try {
            const {
                name,
                mother_company,
                advertising_company_id,
                national_id_number,
                branch,
                from_date,
                to_date,
                notes,
            } = req.body;

            if (
                typeof name !== "string" ||
                !name.trim() ||
                typeof mother_company !== "string" ||
                !mother_company.trim() ||
                typeof national_id_number !== "string" ||
                !national_id_number.trim() ||
                typeof branch !== "string" ||
                !branch.trim() ||
                !isValidId(advertising_company_id) ||
                !isValidDate(from_date) ||
                !isValidDate(to_date)
            ) {
                return res.status(400).json({
                    message: "Please provide all required fields.",
                });
            }

            if (!isValidDateRange(from_date, to_date)) {
                return res.status(400).json({
                    message: "The end date cannot be before the start date.",
                });
            }

            if (
                notes !== undefined &&
                notes !== null &&
                typeof notes !== "string"
            ) {
                return res.status(400).json({
                    message: "Invalid notes value.",
                });
            }

            const pool = await retailPoolPromise;

            if (!pool) {
                throw new Error("Database unavailable.");
            }

            const result = await pool
                .request()
                .input("name", sql.NVarChar(150), name.trim())
                .input(
                    "mother_company",
                    sql.NVarChar(150),
                    mother_company.trim()
                )
                .input(
                    "advertising_company_id",
                    sql.Int,
                    Number(advertising_company_id)
                )
                .input(
                    "national_id_number",
                    sql.NVarChar(20),
                    national_id_number.trim()
                )
                .input("branch", sql.NVarChar(150), branch.trim())
                .input("from_date", sql.Date, from_date)
                .input("to_date", sql.Date, to_date)
                .input(
                    "notes",
                    sql.NVarChar(sql.MAX),
                    notes?.trim() || null
                )
                .query(`
                    INSERT INTO dbo.temporary_coordinator (
                        name,
                        mother_company,
                        advertising_company_id,
                        national_id_number,
                        branch,
                        from_date,
                        to_date,
                        notes
                    )
                    OUTPUT INSERTED.id
                    VALUES (
                        @name,
                        @mother_company,
                        @advertising_company_id,
                        @national_id_number,
                        @branch,
                        @from_date,
                        @to_date,
                        @notes
                    );
                `);

            const newId = result.recordset[0].id;

            const coordinatorResult = await pool
                .request()
                .input("id", sql.Int, newId)
                .query(`
                    ${coordinatorSelectQuery}
                    WHERE tc.id = @id
                      AND tc.isdeleted = 0;
                `);

            const coordinators = await getRetailNames(
                coordinatorResult.recordset
            );

            return res.status(201).json({
                message: "Temporary coordinator created successfully.",
                coordinator: coordinators[0],
            });

        } catch (error) {
            console.error("createTemporaryCoordinator:", error);

            if (error.number === 547) {
                return res.status(400).json({
                    message: "The selected advertising company does not exist.",
                });
            }

            return res.status(500).json({
                message: "Failed to create temporary coordinator.",
            });
        }
    },

    // ==========================================
    // GET ALL
    // ==========================================

    getAllTemporaryCoordinators: async (req, res) => {
        try {
            const pool = await retailPoolPromise;

            const result = await pool.request().query(`
                ${coordinatorSelectQuery}
                WHERE tc.isdeleted = 0
                ORDER BY tc.id DESC;
            `);

            const coordinators = await getRetailNames(
                result.recordset
            );

            return res.status(200).json({
                message: "Temporary coordinators retrieved successfully.",
                coordinators,
            });

        } catch (error) {
            console.error("getAllTemporaryCoordinators:", error);

            return res.status(500).json({
                message: "Failed to retrieve temporary coordinators.",
            });
        }
    },

    // ==========================================
    // GET BY ID
    // ==========================================

    getTemporaryCoordinatorById: async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    message: "Invalid temporary coordinator ID.",
                });
            }

            const pool = await retailPoolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, Number(id))
                .query(`
                    ${coordinatorSelectQuery}
                    WHERE tc.id = @id
                      AND tc.isdeleted = 0;
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "Temporary coordinator not found.",
                });
            }

            const coordinators = await getRetailNames(
                result.recordset
            );

            return res.status(200).json({
                message: "Temporary coordinator retrieved successfully.",
                coordinator: coordinators[0],
            });

        } catch (error) {
            console.error("getTemporaryCoordinatorById:", error);

            return res.status(500).json({
                message: "Failed to retrieve temporary coordinator.",
            });
        }
    },

    // ==========================================
    // UPDATE
    // ==========================================

    updateTemporaryCoordinator: async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    message: "Invalid temporary coordinator ID.",
                });
            }

            const {
                name,
                mother_company,
                advertising_company_id,
                national_id_number,
                branch,
                from_date,
                to_date,
                notes,
            } = req.body;

            const pool = await retailPoolPromise;

            const request = pool.request();

            request.input("id", sql.Int, Number(id));

            // ==========================================
            // GET EXISTING RECORD
            // ==========================================

            const existingResult = await request.query(`
                SELECT *
                FROM dbo.temporary_coordinator
                WHERE id = @id
                  AND isdeleted = 0;
            `);

            if (existingResult.recordset.length === 0) {
                return res.status(404).json({
                    message: "Temporary coordinator not found.",
                });
            }

            const existing = existingResult.recordset[0];

            // ==========================================
            // PREPARE UPDATE FIELDS
            // ==========================================

            const fields = {
                name: {
                    value: name,
                    type: sql.NVarChar(150),
                },
                mother_company: {
                    value: mother_company,
                    type: sql.NVarChar(150),
                },
                advertising_company_id: {
                    value: advertising_company_id,
                    type: sql.Int,
                },
                national_id_number: {
                    value: national_id_number,
                    type: sql.NVarChar(20),
                },
                branch: {
                    value: branch,
                    type: sql.NVarChar(150),
                },
                from_date: {
                    value: from_date,
                    type: sql.Date,
                },
                to_date: {
                    value: to_date,
                    type: sql.Date,
                },
                notes: {
                    value: notes,
                    type: sql.NVarChar(sql.MAX),
                },
            };

            const updates = Object.entries(fields).filter(
                ([key]) =>
                    Object.prototype.hasOwnProperty.call(req.body, key)
            );

            if (updates.length === 0) {
                return res.status(400).json({
                    message: "No fields provided for update.",
                });
            }

            // ==========================================
            // VALIDATE TEXT FIELDS
            // ==========================================

            for (const key of [
                "name",
                "mother_company",
                "national_id_number",
                "branch",
            ]) {
                if (
                    Object.prototype.hasOwnProperty.call(req.body, key) &&
                    (
                        typeof req.body[key] !== "string" ||
                        !req.body[key].trim()
                    )
                ) {
                    return res.status(400).json({
                        message: `${key} cannot be empty.`,
                    });
                }
            }

            // ==========================================
            // VALIDATE NOTES
            // ==========================================

            if (
                Object.prototype.hasOwnProperty.call(req.body, "notes") &&
                notes !== null &&
                notes !== undefined &&
                typeof notes !== "string"
            ) {
                return res.status(400).json({
                    message: "Invalid notes value.",
                });
            }

            // ==========================================
            // VALIDATE ADVERTISING COMPANY
            // ==========================================

            if (
                Object.prototype.hasOwnProperty.call(
                    req.body,
                    "advertising_company_id"
                ) &&
                !isValidId(advertising_company_id)
            ) {
                return res.status(400).json({
                    message: "Invalid advertising company ID.",
                });
            }

            // ==========================================
            // VALIDATE DATES
            // ==========================================

            for (const key of ["from_date", "to_date"]) {
                if (
                    Object.prototype.hasOwnProperty.call(req.body, key) &&
                    !isValidDate(req.body[key])
                ) {
                    return res.status(400).json({
                        message: `Invalid ${key}.`,
                    });
                }
            }

            const finalFromDate = Object.prototype.hasOwnProperty.call(
                req.body,
                "from_date"
            )
                ? from_date
                : existing.from_date.toISOString().slice(0, 10);

            const finalToDate = Object.prototype.hasOwnProperty.call(
                req.body,
                "to_date"
            )
                ? to_date
                : existing.to_date.toISOString().slice(0, 10);

            if (
                !isValidDateRange(
                    String(finalFromDate).slice(0, 10),
                    String(finalToDate).slice(0, 10)
                )
            ) {
                return res.status(400).json({
                    message: "The end date cannot be before the start date.",
                });
            }

            // ==========================================
            // BUILD UPDATE QUERY
            // ==========================================

            const setClauses = [];

            updates.forEach(([key, field], index) => {
                const parameterName = `value${index}`;

                let value = field.value;

                if (typeof value === "string") {
                    value = value.trim();
                }

                if (key === "notes" && !value) {
                    value = null;
                }

                if (key === "advertising_company_id") {
                    value = Number(value);
                }

                request.input(
                    parameterName,
                    field.type,
                    value
                );

                setClauses.push(`${key} = @${parameterName}`);
            });

            await request.query(`
                UPDATE dbo.temporary_coordinator
                SET ${setClauses.join(", ")}
                WHERE id = @id
                  AND isdeleted = 0;
            `);

            // ==========================================
            // GET UPDATED RECORD
            // ==========================================

            const updatedResult = await pool
                .request()
                .input("id", sql.Int, Number(id))
                .query(`
                    ${coordinatorSelectQuery}
                    WHERE tc.id = @id
                      AND tc.isdeleted = 0;
                `);

            if (updatedResult.recordset.length === 0) {
                return res.status(404).json({
                    message: "Temporary coordinator not found.",
                });
            }

            const coordinators = await getRetailNames(
                updatedResult.recordset
            );

            return res.status(200).json({
                message: "Temporary coordinator updated successfully.",
                coordinator: coordinators[0],
            });

        } catch (error) {
            console.error("updateTemporaryCoordinator:", error);

            if (error.number === 547) {
                return res.status(400).json({
                    message: "The selected advertising company does not exist.",
                });
            }

            return res.status(500).json({
                message: "Failed to update temporary coordinator.",
            });
        }
    },

    // ==========================================
    // DELETE
    // ==========================================

    deleteTemporaryCoordinator: async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidId(id)) {
                return res.status(400).json({
                    message: "Invalid temporary coordinator ID.",
                });
            }

            const pool = await retailPoolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, Number(id))
                .query(`
                    UPDATE dbo.temporary_coordinator
                    SET isdeleted = 1
                    WHERE id = @id
                      AND isdeleted = 0;

                    SELECT @@ROWCOUNT AS affectedRows;
                `);

            if (result.recordset[0].affectedRows === 0) {
                return res.status(404).json({
                    message: "Temporary coordinator not found.",
                });
            }

            return res.status(200).json({
                message: "Temporary coordinator deleted successfully.",
            });

        } catch (error) {
            console.error("deleteTemporaryCoordinator:", error);

            return res.status(500).json({
                message: "Failed to delete temporary coordinator.",
            });
        }
    },
};

export default TemporaryCoordinatorController;