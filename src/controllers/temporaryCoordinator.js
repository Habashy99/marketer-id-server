import sql from "mssql";
import { poolPromise } from "../config/db.js";

const TemporaryCoordinatorController = {

    // CREATE
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
            } = req.body;

            // Validate required fields
            if (
                !name?.trim() ||
                !mother_company?.trim() ||
                !national_id_number?.trim() ||
                !branch?.trim() ||
                !advertising_company_id ||
                !from_date ||
                !to_date
            ) {
                return res.status(400).json({
                    message: "All fields are required.",
                });
            }

            const companyId = Number(advertising_company_id);

            if (!Number.isInteger(companyId) || companyId <= 0) {
                return res.status(400).json({
                    message: "Invalid advertising company ID.",
                });
            }

            if (
                Number.isNaN(Date.parse(from_date)) ||
                Number.isNaN(Date.parse(to_date))
            ) {
                return res.status(400).json({
                    message: "Invalid date.",
                });
            }

            if (new Date(to_date) < new Date(from_date)) {
                return res.status(400).json({
                    message: "The end date cannot be before the start date.",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("name", sql.NVarChar(150), name.trim())
                .input("mother_company", sql.NVarChar(150), mother_company.trim())
                .input("advertising_company_id", sql.Int, companyId)
                .input("national_id_number", sql.NVarChar(20), national_id_number.trim())
                .input("branch", sql.NVarChar(150), branch.trim())
                .input("from_date", sql.Date, from_date)
                .input("to_date", sql.Date, to_date)
                .query(`
                INSERT INTO dbo.temporary_coordinator (
                    name,
                    mother_company,
                    advertising_company_id,
                    national_id_number,
                    branch,
                    from_date,
                    to_date
                )
                OUTPUT INSERTED.id
                VALUES (
                    @name,
                    @mother_company,
                    @advertising_company_id,
                    @national_id_number,
                    @branch,
                    @from_date,
                    @to_date
                );
            `);

            const newId = result.recordset[0].id;

            // Return the created coordinator with advertising company name
            const coordinatorResult = await pool
                .request()
                .input("id", sql.Int, newId)
                .query(`
                SELECT
                    tc.id,
                    tc.name,
                    tc.mother_company,
                    tc.advertising_company_id,
                    ac.name AS advertising_company,
                    tc.national_id_number,
                    tc.branch,
                    tc.from_date,
                    tc.to_date
                FROM dbo.temporary_coordinator AS tc
                LEFT JOIN dbo.advertising_companies AS ac
                    ON ac.id = tc.advertising_company_id
                WHERE tc.id = @id;
            `);

            return res.status(201).json({
                message: "Temporary coordinator created successfully.",
                coordinator: coordinatorResult.recordset[0],
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

    // GET ALL
    getAllTemporaryCoordinators: async (req, res) => {
        try {
            const pool = await poolPromise;

            const result = await pool.request().query(`
                SELECT
                    tc.id,
                    tc.name,
                    tc.mother_company,
                    tc.advertising_company_id,
                    ac.name AS advertising_company,
                    tc.national_id_number,
                    tc.branch,
                    tc.from_date,
                    tc.to_date
                FROM dbo.temporary_coordinator AS tc
                LEFT JOIN dbo.advertising_companies AS ac
                    ON ac.id = tc.advertising_company_id
                ORDER BY tc.id DESC;
            `);

            return res.status(200).json({
                message: "Temporary coordinators retrieved successfully.",
                coordinators: result.recordset,
            });
        } catch (error) {
            console.error("getAllTemporaryCoordinators:", error);

            return res.status(500).json({
                message: "Failed to retrieve temporary coordinators.",
            });
        }
    },

    // GET BY ID
    getTemporaryCoordinatorById: async (req, res) => {
        try {
            const { id } = req.params;

            if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
                return res.status(400).json({
                    message: "Invalid temporary coordinator ID.",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, Number(id))
                .query(`
                    SELECT
                        tc.id,
                        tc.name,
                        tc.mother_company,
                        tc.advertising_company_id,
                        ac.name AS advertising_company,
                        tc.national_id_number,
                        tc.branch,
                        tc.from_date,
                        tc.to_date
                    FROM dbo.temporary_coordinator AS tc
                    LEFT JOIN dbo.advertising_companies AS ac
                        ON ac.id = tc.advertising_company_id
                    WHERE tc.id = @id;
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "Temporary coordinator not found.",
                });
            }

            return res.status(200).json({
                message: "Temporary coordinator retrieved successfully.",
                coordinator: result.recordset[0],
            });
        } catch (error) {
            console.error("getTemporaryCoordinatorById:", error);

            return res.status(500).json({
                message: "Failed to retrieve temporary coordinator.",
            });
        }
    },

    // UPDATE
    updateTemporaryCoordinator: async (req, res) => {
        try {
            const { id } = req.params;

            if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
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
            } = req.body;

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
            };

            const updates = Object.entries(fields).filter(
                ([key]) => Object.prototype.hasOwnProperty.call(req.body, key)
            );

            if (updates.length === 0) {
                return res.status(400).json({
                    message: "No fields provided for update.",
                });
            }

            // Validate required text fields when provided.
            for (const key of [
                "name",
                "mother_company",
                "national_id_number",
                "branch",
            ]) {
                if (
                    Object.prototype.hasOwnProperty.call(req.body, key) &&
                    (typeof req.body[key] !== "string" ||
                        !req.body[key].trim())
                ) {
                    return res.status(400).json({
                        message: `${key} cannot be empty.`,
                    });
                }
            }

            if (
                Object.prototype.hasOwnProperty.call(
                    req.body,
                    "advertising_company_id"
                ) &&
                (!Number.isInteger(Number(advertising_company_id)) ||
                    Number(advertising_company_id) <= 0)
            ) {
                return res.status(400).json({
                    message: "Invalid advertising company ID.",
                });
            }

            for (const key of ["from_date", "to_date"]) {
                if (
                    Object.prototype.hasOwnProperty.call(req.body, key) &&
                    (!req.body[key] ||
                        Number.isNaN(Date.parse(req.body[key])))
                ) {
                    return res.status(400).json({
                        message: `Invalid ${key}.`,
                    });
                }
            }

            const pool = await poolPromise;

            const request = pool.request();
            request.input("id", sql.Int, Number(id));

            // Get existing record.
            const existingResult = await request.query(`
                SELECT *
                FROM dbo.temporary_coordinator
                WHERE id = @id;
            `);

            if (existingResult.recordset.length === 0) {
                return res.status(404).json({
                    message: "Temporary coordinator not found.",
                });
            }

            const existing = existingResult.recordset[0];

            const finalFromDate = Object.prototype.hasOwnProperty.call(
                req.body,
                "from_date"
            )
                ? from_date
                : existing.from_date;

            const finalToDate = Object.prototype.hasOwnProperty.call(
                req.body,
                "to_date"
            )
                ? to_date
                : existing.to_date;

            if (new Date(finalToDate) < new Date(finalFromDate)) {
                return res.status(400).json({
                    message: "The end date cannot be before the start date.",
                });
            }

            const setClauses = [];

            updates.forEach(([key, field], index) => {
                const parameterName = `value${index}`;

                request.input(
                    parameterName,
                    field.type,
                    typeof field.value === "string"
                        ? field.value.trim()
                        : field.value
                );

                setClauses.push(`${key} = @${parameterName}`);
            });

            await request.query(`
                UPDATE dbo.temporary_coordinator
                SET ${setClauses.join(", ")}
                WHERE id = @id;
            `);

            // Return updated record.
            const updatedResult = await pool
                .request()
                .input("id", sql.Int, Number(id))
                .query(`
                    SELECT
                        tc.id,
                        tc.name,
                        tc.mother_company,
                        tc.advertising_company_id,
                        ac.name AS advertising_company,
                        tc.national_id_number,
                        tc.branch,
                        tc.from_date,
                        tc.to_date
                    FROM dbo.temporary_coordinator AS tc
                    LEFT JOIN dbo.advertising_companies AS ac
                        ON ac.id = tc.advertising_company_id
                    WHERE tc.id = @id;
                `);

            return res.status(200).json({
                message: "Temporary coordinator updated successfully.",
                coordinator: updatedResult.recordset[0],
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

    // DELETE
    deleteTemporaryCoordinator: async (req, res) => {
        try {
            const { id } = req.params;

            if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
                return res.status(400).json({
                    message: "Invalid temporary coordinator ID.",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, Number(id))
                .query(`
                    DELETE FROM dbo.temporary_coordinator
                    WHERE id = @id;

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