
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
        let transaction;

        try {
            const { code, name, type } = req.body;

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

            const createdBy = req.user?.code;

            if (createdBy === undefined || createdBy === null) {
                return res.status(401).json({
                    message: "Authenticated user not found",
                });
            }

            const normalizedCode = String(code).trim();
            const pool = await poolPromise;

            transaction = new sql.Transaction(pool);
            await transaction.begin();

            // Increment the print counter for this coordinator.
            const updateResult = await new sql.Request(transaction)
                .input("code", sql.NVarChar(50), normalizedCode)
                .query(`
                UPDATE dbo.coordinator
                SET number_of_print_copies =
                    ISNULL(number_of_print_copies, 0) + 1
                WHERE code = @code;

                SELECT @@ROWCOUNT AS affectedRows;
            `);

            if (updateResult.recordset[0].affectedRows === 0) {
                await transaction.rollback();
                transaction = null;

                return res.status(404).json({
                    message: "Coordinator not found",
                });
            }

            // Insert the print log in the same transaction.
            const logResult = await new sql.Request(transaction)
                .input("code", sql.NVarChar(50), normalizedCode)
                .input("name", sql.NVarChar(150), name.trim())
                .input("type", sql.NVarChar(50), type.trim())
                .input("created_by", sql.NVarChar(100), String(createdBy))
                .query(`
                INSERT INTO dbo.print_log
                    (code, name, type, created_by, [date])
                OUTPUT
                    INSERTED.id,
                    INSERTED.code,
                    INSERTED.name,
                    INSERTED.type,
                    INSERTED.created_by,
                    INSERTED.[date]
                VALUES
                    (@code, @name, @type, @created_by, GETDATE());
            `);

            await transaction.commit();
            transaction = null;

            return res.status(201).json({
                message: "Print log created and counter updated successfully",
                log: logResult.recordset[0],
            });
        } catch (error) {
            if (transaction) {
                try {
                    await transaction.rollback();
                } catch (rollbackError) {
                    console.error("Transaction rollback error:", rollbackError);
                }
            }

            console.error("Create log error:", error);

            return res.status(500).json({
                message: "Failed to create log and update print counter",
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
    getTotalPrintedCards: async (req, res) => {
        try {
            const pool = await poolPromise;

            const result = await pool.request().query(`
            SELECT
                COALESCE(SUM(number_of_print_copies), 0) AS totalPrintedCards
            FROM dbo.coordinator
        `);

            return res.status(200).json({
                message: "Total printed cards retrieved successfully",
                totalPrintedCards: result.recordset[0].totalPrintedCards,
            });
        } catch (error) {
            console.error("Get total printed cards error:", error);

            return res.status(500).json({
                message: "Failed to retrieve total printed cards",
            });
        }
    },

};

export default PrintLogController;
