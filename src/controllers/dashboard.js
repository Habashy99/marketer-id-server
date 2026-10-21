
import { poolPromise } from "../database/db.js";

const DashboardController = {
    getStats: async (req, res) => {
        try {
            const pool = await poolPromise;

            const result = await pool.request().query(`
                WITH normalized AS (
                    SELECT
                        CASE
                            WHEN RTRIM(LTRIM(job)) = N'منسق'
                                THEN N'منسق'

                            WHEN REPLACE(
                                RTRIM(LTRIM(job)), N'ه', N'ة'
                            ) = N'منسقة'
                                THEN N'منسقة'

                            WHEN RTRIM(LTRIM(job)) = N'مندوب'
                                THEN N'مندوب'

                            WHEN REPLACE(
                                RTRIM(LTRIM(job)), N'ه', N'ة'
                            ) = N'مندوبة'
                                THEN N'مندوبة'

                            ELSE N'غير معروف'
                        END AS normalized_job,

                        states,
                        health_certificate_expiry_date
                    FROM coordinator
                )
                SELECT
                    -- Total representatives and coordinators
                    COUNT(CASE
                        WHEN normalized_job = N'مندوب'
                        THEN 1 END) AS maleRepresentatives,

                    COUNT(CASE
                        WHEN normalized_job = N'مندوبة'
                        THEN 1 END) AS femaleRepresentatives,

                    COUNT(CASE
                        WHEN normalized_job = N'منسق'
                        THEN 1 END) AS maleCoordinators,

                    COUNT(CASE
                        WHEN normalized_job = N'منسقة'
                        THEN 1 END) AS femaleCoordinators,

                    -- Inactive representatives:
                    -- state is "غير مفعل" OR health certificate expired
                    COUNT(CASE
                        WHEN normalized_job = N'مندوب'
                        AND (
                            LTRIM(RTRIM(states)) = N'غير مفعل'
                            OR health_certificate_expiry_date
                                < CAST(GETDATE() AS DATE)
                        )
                        THEN 1 END) AS expiredMaleRepresentatives,

                    COUNT(CASE
                        WHEN normalized_job = N'مندوبة'
                        AND (
                            LTRIM(RTRIM(states)) = N'غير مفعل'
                            OR health_certificate_expiry_date
                                < CAST(GETDATE() AS DATE)
                        )
                        THEN 1 END) AS expiredFemaleRepresentatives,

                    COUNT(CASE
                        WHEN normalized_job = N'منسق'
                        AND (
                            LTRIM(RTRIM(states)) = N'غير مفعل'
                            OR health_certificate_expiry_date
                                < CAST(GETDATE() AS DATE)
                        )
                        THEN 1 END) AS expiredMaleCoordinators,

                    COUNT(CASE
                        WHEN normalized_job = N'منسقة'
                        AND (
                            LTRIM(RTRIM(states)) = N'غير مفعل'
                            OR health_certificate_expiry_date
                                < CAST(GETDATE() AS DATE)
                        )
                        THEN 1 END) AS expiredFemaleCoordinators

                FROM normalized;
            `);

            return res.status(200).json({
                message: "Dashboard statistics retrieved successfully",
                stats: result.recordset[0],
            });
        } catch (error) {
            console.error("Dashboard statistics error:", error);

            return res.status(500).json({
                message: "Failed to retrieve dashboard statistics",
            });
        }
    },
};

export default DashboardController;
