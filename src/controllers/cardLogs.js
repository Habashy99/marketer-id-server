
import sql from "mssql";
import { poolPromise } from "../config/db.js";

const CardLogsController = {
    getAllLogs: async (req, res) => {
        try {
            const { fromDate, toDate } = req.query;

            // A date range must include both dates.
            if ((fromDate && !toDate) || (!fromDate && toDate)) {
                return res.status(400).json({
                    message: "يجب إرسال تاريخ البداية وتاريخ النهاية معاً",
                });
            }

            const pool = await poolPromise;
            const request = pool.request();

            let query = `
                SELECT
                    cl.id,
                    cl.quantity,
                    cl.[date],
                    cl.created_by AS created_by_id,
                    u.name AS created_by
                FROM dbo.card_logs AS cl
                INNER JOIN dbo.users AS u
                    ON u.id = cl.created_by
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
                    WHERE cl.[date] >= @fromDate
                      AND cl.[date] <= @toDate
                `;
            }

            query += `
                ORDER BY cl.[date] DESC, cl.id DESC
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


    createLog: async (req, res) => {
        try {
            const quantity = Number(req.body.quantity);

            if (!Number.isInteger(quantity) || quantity <= 0) {
                return res.status(400).json({
                    message: "العدد يجب أن يكون رقماً صحيحاً أكبر من صفر",
                });
            }

            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    message: "يجب تسجيل الدخول أولاً",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("quantity", sql.Int, quantity)
                .input("createdBy", sql.Int, userId)
                .query(`
                INSERT INTO dbo.card_logs (quantity, created_by)
                OUTPUT
                    INSERTED.id,
                    INSERTED.quantity,
                    INSERTED.[date],
                    INSERTED.created_by AS created_by_id
                VALUES (@quantity, @createdBy);
            `);

            const insertedLog = result.recordset[0];

            const userResult = await pool
                .request()
                .input("userId", sql.Int, userId)
                .query(`
                SELECT name
                FROM dbo.users
                WHERE id = @userId;
            `);

            const user = userResult.recordset[0];

            return res.status(201).json({
                message: "تم إضافة السجل بنجاح",
                log: {
                    ...insertedLog,
                    created_by: user?.name ?? "غير معروف",
                },
            });
        } catch (error) {
            console.error("createLog error:", error);

            return res.status(500).json({
                message: "حدث خطأ أثناء إضافة السجل",
            });
        }
    },

    deleteLog: async (req, res) => {
        try {
            const id = Number(req.params.id);

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({
                    message: "رقم السجل غير صحيح",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, id)
                .query(`
                    DELETE FROM dbo.card_logs
                    OUTPUT DELETED.id
                    WHERE id = @id
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

    getTotalQuantity: async (req, res) => {
        try {
            const pool = await poolPromise;

            const result = await pool.request().query(`
                SELECT COALESCE(SUM(quantity), 0) AS totalQuantity
                FROM dbo.card_logs
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
};

export default CardLogsController;
