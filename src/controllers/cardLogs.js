import sql from "mssql";
import { retailPoolPromise } from "../config/db.js";

const CardLogsController = {
    // Get all card logs with optional date filtering
    getAllLogs: async (req, res) => {
        try {
            const { fromDate, toDate } = req.query;

            if ((fromDate && !toDate) || (!fromDate && toDate)) {
                return res.status(400).json({
                    message: "يجب إرسال تاريخ البداية وتاريخ النهاية معاً",
                });
            }

            const pool = await retailPoolPromise;
            const request = pool.request();

            let query = `
                SELECT
                    cl.id,
                    cl.quantity,
                    cl.[date],
                    cl.created_by AS created_by_id,
                    u.name AS created_by
                FROM dbo.card_logs AS cl
                LEFT JOIN dbo.DelegateuserPermissions AS u
                    ON u.id = cl.created_by
                WHERE cl.isdeleted = 0
            `;

            if (fromDate && toDate) {
                const datePattern = /^\d{4}-\d{2}-\d{2}$/;

                if (
                    !datePattern.test(fromDate) ||
                    !datePattern.test(toDate) ||
                    Number.isNaN(Date.parse(fromDate)) ||
                    Number.isNaN(Date.parse(toDate))
                ) {
                    return res.status(400).json({
                        message: "صيغة التاريخ يجب أن تكون YYYY-MM-DD",
                    });
                }

                if (fromDate > toDate) {
                    return res.status(400).json({
                        message: "تاريخ البداية يجب أن يكون قبل تاريخ النهاية",
                    });
                }

                request.input("fromDate", sql.Date, fromDate);
                request.input("toDate", sql.Date, toDate);

                query += `
                    AND cl.[date] >= @fromDate
                    AND cl.[date] < DATEADD(DAY, 1, @toDate)
                `;
            }

            query += `
                ORDER BY cl.[date] DESC, cl.id DESC;
            `;

            const result = await request.query(query);

            return res.status(200).json({
                logs: result.recordset,
            });
        } catch (error) {
            console.error("getAllLogs error:", error);

            return res.status(500).json({
                message: "حدث خطأ أثناء جلب سجل البطاقات",
            });
        }
    },

    // Create a positive or negative card quantity log
    createLog: async (req, res) => {
        try {
            const quantity = Number(req.body.quantity);

            // Validate quantity
            if (
                !Number.isSafeInteger(quantity) ||
                quantity === 0
            ) {
                return res.status(400).json({
                    message: "يجب إدخال عدد صحيح، موجب للإضافة أو سالب للخصم، ولا يمكن أن يكون صفراً",
                });
            }

            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    message: "يجب تسجيل الدخول أولاً",
                });
            }

            const pool = await retailPoolPromise;

            // Insert log
            const result = await pool
                .request()
                .input("quantity", sql.Int, quantity)
                .input("createdBy", sql.Int, userId)
                .query(`
                    INSERT INTO dbo.card_logs (
                        quantity,
                        created_by
                    )
                    OUTPUT
                        INSERTED.id,
                        INSERTED.quantity,
                        INSERTED.[date],
                        INSERTED.created_by AS created_by_id
                    VALUES (
                        @quantity,
                        @createdBy
                    );
                `);

            const insertedLog = result.recordset[0];

            // Get creator name
            const userResult = await pool
                .request()
                .input("userId", sql.Int, userId)
                .query(`
                    SELECT name
                    FROM dbo.DelegateuserPermissions
                    WHERE id = @userId;
                `);

            const user = userResult.recordset[0];

            const isAddition = quantity > 0;

            return res.status(201).json({
                message: isAddition
                    ? `تم إضافة ${quantity} كارت بنجاح`
                    : `تم خصم ${Math.abs(quantity)} كارت بنجاح`,

                log: {
                    ...insertedLog,
                    created_by: user?.name ?? "غير معروف",
                },
            });
        } catch (error) {
            console.error("createLog error:", {
                message: error.message,
                code: error.code,
                number: error.number,
                state: error.state,
                originalError: error.originalError?.message,
                precedingErrors: error.precedingErrors,
            });

            return res.status(500).json({
                message: "حدث خطأ أثناء تسجيل تعديل كمية البطاقات",
                ...(process.env.NODE_ENV !== "production" && {
                    details: error.message,
                    code: error.code,
                    number: error.number,
                }),
            });
        }
    },

    // Soft delete a card log
    deleteLog: async (req, res) => {
        try {
            const id = Number(req.params.id);

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({
                    message: "رقم السجل غير صحيح",
                });
            }

            const pool = await retailPoolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, id)
                .query(`
                    UPDATE dbo.card_logs
                    SET isdeleted = 1
                    OUTPUT INSERTED.id
                    WHERE id = @id
                      AND isdeleted = 0;
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "السجل غير موجود",
                });
            }

            return res.status(200).json({
                message: "تم حذف السجل بنجاح",
                id: result.recordset[0].id,
            });
        } catch (error) {
            console.error("deleteLog error:", error);

            return res.status(500).json({
                message: "حدث خطأ أثناء حذف السجل",
            });
        }
    },

    // Get total available card quantity
    getTotalQuantity: async (req, res) => {
        try {
            const pool = await retailPoolPromise;

            const result = await pool.request().query(`
                SELECT
                    COALESCE(SUM(quantity), 0) AS totalQuantity
                FROM dbo.card_logs
                WHERE isdeleted = 0;
            `);

            return res.status(200).json({
                totalQuantity: result.recordset[0].totalQuantity,
            });
        } catch (error) {
            console.error("getTotalQuantity error:", error);

            return res.status(500).json({
                message: "حدث خطأ أثناء حساب إجمالي العدد",
            });
        }
    },
    getTotalDisbursedQuantity: async (req, res) => {
        try {
            const pool = await retailPoolPromise;

            const result = await pool.request().query(`
            SELECT
                COUNT(*) AS totalQuantity
            FROM dbo.print_log
            WHERE
                isdeleted = 0
                AND [date] >= DATEFROMPARTS(YEAR(GETDATE()), 1, 1)
                AND [date] < DATEFROMPARTS(YEAR(GETDATE()) + 1, 1, 1);
        `);

            return res.status(200).json({
                totalQuantity: result.recordset[0].totalQuantity,
            });
        } catch (error) {
            console.error("getTotalQuantity error:", error);

            return res.status(500).json({
                message: "حدث خطأ أثناء حساب إجمالي الكروت المطبوعة",
            });
        }
    },
};

export default CardLogsController;