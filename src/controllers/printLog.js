
import { sql, poolPromise } from "../config/db.js";

const PrintLogController = {
    getAllLogs: async (req, res) => {
        try {
            const pool = await poolPromise;

            const result = await pool.request().query(`
                SELECT
                    id,
                    code,
                    name,
                    type,
                    created_by,
                    [date]
                FROM dbo.print_log
                ORDER BY [date] DESC
            `);

            return res.status(200).json({
                message: "Logs retrieved successfully",
                logs: result.recordset,
            });
        } catch (error) {
            console.error("Get all logs error:", error);

            return res.status(500).json({
                message: "Failed to retrieve logs",
            });
        }
    },

    createLog: async (req, res) => {
        try {
            const { code, name, type, created_by } = req.body;

            if (
                code === undefined ||
                code === null ||
                String(code).trim() === "" ||
                typeof name !== "string" ||
                name.trim() === "" ||
                typeof type !== "string" ||
                type.trim() === ""
            ) {
                return res.status(400).json({
                    message: "Code, name, and type are required",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("code", sql.NVarChar(50), String(code).trim())
                .input("name", sql.NVarChar(150), name.trim())
                .input("type", sql.NVarChar(50), type.trim())
                .input(
                    "created_by",
                    sql.NVarChar(100),
                    typeof created_by === "string" && created_by.trim()
                        ? created_by.trim()
                        : null
                )
                .query(`
                    INSERT INTO dbo.print_log
                        (code, name, type, created_by)
                    OUTPUT
                        INSERTED.id,
                        INSERTED.code,
                        INSERTED.name,
                        INSERTED.type,
                        INSERTED.created_by,
                        INSERTED.[date]
                    VALUES
                        (@code, @name, @type, @created_by)
                `);

            return res.status(201).json({
                message: "Log created successfully",
                log: result.recordset[0],
            });
        } catch (error) {
            console.error("Create log error:", error);

            return res.status(500).json({
                message: "Failed to create log",
            });
        }
    },

    getLogByType: async (req, res) => {
        try {
            const { type } = req.query;

            if (typeof type !== "string" || type.trim() === "") {
                return res.status(400).json({
                    message: "Type is required",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("type", sql.NVarChar(50), type.trim())
                .query(`
                    SELECT
                        id,
                        code,
                        name,
                        type,
                        created_by,
                        [date]
                    FROM dbo.print_log
                    WHERE type = @type
                    ORDER BY [date] DESC
                `);

            return res.status(200).json({
                message: "Logs retrieved successfully",
                logs: result.recordset,
            });
        } catch (error) {
            console.error("Get logs by type error:", error);

            return res.status(500).json({
                message: "Failed to retrieve logs by type",
            });
        }
    },

    getLogByDate: async (req, res) => {
        try {
            const { date } = req.query;

            if (
                typeof date !== "string" ||
                !/^\d{4}-\d{2}-\d{2}$/.test(date)
            ) {
                return res.status(400).json({
                    message: "Date is required in YYYY-MM-DD format",
                });
            }

            const parsedDate = new Date(`${date}T00:00:00.000Z`);

            if (
                Number.isNaN(parsedDate.getTime()) ||
                parsedDate.toISOString().slice(0, 10) !== date
            ) {
                return res.status(400).json({
                    message: "Invalid date",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("date", sql.Date, date)
                .query(`
                    SELECT
                        id,
                        code,
                        name,
                        type,
                        created_by,
                        [date]
                    FROM dbo.print_log
                    WHERE [date] >= @date
                      AND [date] < DATEADD(DAY, 1, @date)
                    ORDER BY [date] DESC
                `);

            return res.status(200).json({
                message: "Logs retrieved successfully",
                logs: result.recordset,
            });
        } catch (error) {
            console.error("Get logs by date error:", error);

            return res.status(500).json({
                message: "Failed to retrieve logs by date",
            });
        }
    },
    deleteLog: async (req, res) => {
        try {
            const { id } = req.body;

            if (
                id === undefined ||
                id === null ||
                !Number.isInteger(Number(id)) ||
                Number(id) <= 0
            ) {
                return res.status(400).json({
                    message: "A valid log ID is required",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, Number(id))
                .query(`
                DELETE FROM dbo.print_log
                OUTPUT
                    DELETED.id,
                    DELETED.code,
                    DELETED.name,
                    DELETED.type
                WHERE id = @id
            `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "Log not found",
                });
            }

            return res.status(200).json({
                message: "تم حذف السجل بنجاح",
                deletedLog: result.recordset[0],
            });
        } catch (error) {
            console.error("Delete log error:", error);

            return res.status(500).json({
                message: "Failed to delete log",
            });
        }
    },
};

export default PrintLogController;
