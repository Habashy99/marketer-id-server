
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
        const { coordinatorId, exceptionId } = req.body.exception_id;

        console.log("Delete exception body:", req.body);
        console.log("coordinatorId:", coordinatorId, typeof coordinatorId);
        console.log("exceptionId:", exceptionId, typeof exceptionId);

        const parsedCoordinatorId = Number(coordinatorId);
        const parsedExceptionId = Number(exceptionId);

        if (
            !Number.isInteger(parsedCoordinatorId) ||
            parsedCoordinatorId <= 0 ||
            !Number.isInteger(parsedExceptionId) ||
            parsedExceptionId <= 0
        ) {
            return res.status(400).json({
                message: "يرجى اختيار المنسق والاستثناء بشكل صحيح.",
            });
        }

        const pool = await poolPromise;

        const result = await pool
            .request()
            .input("coordinatorId", sql.Int, parsedCoordinatorId)
            .input("exceptionId", sql.Int, parsedExceptionId)
            .query(`
                DELETE FROM dbo.exception
                OUTPUT
                    DELETED.exception_id,
                    DELETED.coordinator_id,
                    DELETED.exception_name,
                    DELETED.exception_start_date,
                    DELETED.exception_end_date
                WHERE exception_id = @exceptionId
                  AND coordinator_id = @coordinatorId;
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                message: "الاستثناء غير موجود لهذا المنسق.",
            });
        }

        return res.status(200).json({
            message: "تم حذف الاستثناء بنجاح.",
            exception: result.recordset[0],
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
