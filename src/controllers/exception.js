
import { sql, poolPromise } from "../config/db.js";

const ExceptionController = {
    createException: async (req, res) => {
        try {
            const {
                coordinatorCode,
                exceptionName,
                exceptionStartDate,
                exceptionEndDate,
            } = req.body;

            if (
                !Number.isInteger(Number(coordinatorCode)) ||
                Number(coordinatorCode) <= 0 ||
                typeof exceptionName !== "string" ||
                exceptionName.trim() === "" ||
                !exceptionStartDate ||
                !exceptionEndDate
            ) {
                return res.status(400).json({
                    message: "Valid coordinator code, exception name, and dates are required",
                });
            }

            if (exceptionStartDate > exceptionEndDate) {
                return res.status(400).json({
                    message: "Start date must be before or equal to end date",
                });
            }

            const pool = await poolPromise;

            const coordinator = await pool
                .request()
                .input("code", sql.Int, Number(coordinatorCode))
                .query(`
                    SELECT id
                    FROM dbo.coordinator
                    WHERE code = @code;
                `);

            if (coordinator.recordset.length === 0) {
                return res.status(404).json({
                    message: "Coordinator not found",
                });
            }

            const coordinatorId = coordinator.recordset[0].id;

            const result = await pool
                .request()
                .input("coordinatorId", sql.Int, coordinatorId)
                .input("exceptionName", sql.NVarChar(255), exceptionName.trim())
                .input("startDate", sql.Date, exceptionStartDate)
                .input("endDate", sql.Date, exceptionEndDate)
                .query(`
                    INSERT INTO dbo.exception (
                        coordinator_id,
                        exception_name,
                        exception_start_date,
                        exception_end_date
                    )
                    OUTPUT
                        INSERTED.exception_id,
                        INSERTED.coordinator_id,
                        INSERTED.exception_name,
                        INSERTED.exception_start_date,
                        INSERTED.exception_end_date
                    VALUES (
                        @coordinatorId,
                        @exceptionName,
                        @startDate,
                        @endDate
                    );
                `);

            return res.status(201).json({
                message: "Exception created successfully",
                exception: result.recordset[0],
            });
        } catch (error) {
            console.error("Create exception error:", error);

            return res.status(500).json({
                message: "Failed to create exception",
            });
        }
    },


    deleteException: async (req, res) => {
        try {
            const { coordinatorCode, exceptionName } = req.body;

            if (
                !Number.isInteger(Number(coordinatorCode)) ||
                Number(coordinatorCode) <= 0 ||
                typeof exceptionName !== "string" ||
                !exceptionName.trim()
            ) {
                return res.status(400).json({
                    message: "يرجى إدخال رقم المنسق واسم الاستثناء بشكل صحيح.",
                });
            }

            const pool = await poolPromise;

            const coordinatorResult = await pool
                .request()
                .input("code", sql.Int, Number(coordinatorCode))
                .query(`
                SELECT id
                FROM dbo.coordinator
                WHERE code = @code
            `);

            if (coordinatorResult.recordset.length === 0) {
                return res.status(404).json({
                    message: "المنسق غير موجود.",
                });
            }

            const coordinatorId = coordinatorResult.recordset[0].id;

            const exceptionResult = await pool
                .request()
                .input("coordinatorId", sql.Int, coordinatorId)
                .input("exceptionName", sql.NVarChar(255), exceptionName.trim())
                .query(`
                SELECT TOP (2)
                    exception_id,
                    coordinator_id,
                    exception_name,
                    exception_start_date,
                    exception_end_date
                FROM dbo.exception
                WHERE coordinator_id = @coordinatorId
                  AND LTRIM(RTRIM(exception_name)) = @exceptionName
                ORDER BY exception_id
            `);

            if (exceptionResult.recordset.length === 0) {
                return res.status(404).json({
                    message: "لم يتم العثور على هذا الاستثناء لهذا المنسق.",
                });
            }

            if (exceptionResult.recordset.length > 1) {
                return res.status(409).json({
                    message:
                        "يوجد أكثر من استثناء بنفس الاسم لهذا المنسق. يرجى تحديد تاريخ الاستثناء المطلوب حذفه.",
                });
            }

            const exceptionId = exceptionResult.recordset[0].exception_id;

            const deleteResult = await pool
                .request()
                .input("exceptionId", sql.Int, exceptionId)
                .input("coordinatorId", sql.Int, coordinatorId)
                .query(`
                DELETE FROM dbo.exception
                OUTPUT DELETED.exception_id,
                       DELETED.coordinator_id,
                       DELETED.exception_name,
                       DELETED.exception_start_date,
                       DELETED.exception_end_date
                WHERE exception_id = @exceptionId
                  AND coordinator_id = @coordinatorId
            `);

            if (deleteResult.recordset.length === 0) {
                return res.status(404).json({
                    message: "لم يتم العثور على الاستثناء المطلوب حذفه.",
                });
            }

            return res.status(200).json({
                message: "تم حذف الاستثناء بنجاح.",
                exception: deleteResult.recordset[0],
            });
        } catch (error) {
            console.error("Delete exception error:", error);

            return res.status(500).json({
                message: "حدث خطأ أثناء حذف الاستثناء.",
            });
        }
    },

};

export default ExceptionController;
