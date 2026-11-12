
import { retailPoolPromise } from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* Dashboard Marketing - Coordinators                                          */
/* -------------------------------------------------------------------------- */

const dashboardMarketingCoordinatorsController = {
    getStats: async (_req, res) => {
        try {
            const pool = await retailPoolPromise;

            /* ------------------------------------------------------------------ */
            /* Permanent Coordinators & Representatives                           */
            /* ------------------------------------------------------------------ */

            const coordinatorsResult = await pool.request().query(`
                WITH normalized AS (
                    SELECT
                        CASE
                            WHEN LTRIM(RTRIM(job)) = N'مندوب'
                                THEN N'مندوب'

                            WHEN REPLACE(
                                LTRIM(RTRIM(job)), N'ه', N'ة'
                            ) = N'مندوبة'
                                THEN N'مندوبة'

                            WHEN LTRIM(RTRIM(job)) = N'منسق'
                                THEN N'منسق'

                            WHEN REPLACE(
                                LTRIM(RTRIM(job)), N'ه', N'ة'
                            ) = N'منسقة'
                                THEN N'منسقة'

                            ELSE N'غير معروف'
                        END AS normalized_job,

                        LTRIM(RTRIM(states)) AS states,
                        health_certificate_expiry_date

                    FROM dbo.coordinator
                )

                SELECT
                    COUNT(CASE WHEN normalized_job = N'مندوب'
                        THEN 1 END) AS maleRepresentatives,

                    COUNT(CASE WHEN normalized_job = N'مندوبة'
                        THEN 1 END) AS femaleRepresentatives,

                    COUNT(CASE WHEN normalized_job = N'منسق'
                        THEN 1 END) AS maleCoordinators,

                    COUNT(CASE WHEN normalized_job = N'منسقة'
                        THEN 1 END) AS femaleCoordinators,

                    COUNT(CASE WHEN states = N'غير مفعل'
                        THEN 1 END) AS inactiveCount,

                    COUNT(CASE
                        WHEN health_certificate_expiry_date < CAST(GETDATE() AS DATE)
                        THEN 1
                    END) AS expiredHealthCertificates,

                    COUNT(CASE
                        WHEN health_certificate_expiry_date >= CAST(GETDATE() AS DATE)
                        THEN 1
                    END) AS validHealthCertificates,

                    COUNT(CASE
                        WHEN health_certificate_expiry_date IS NULL
                        THEN 1
                    END) AS missingHealthCertificates,

                    COUNT(CASE
                        WHEN normalized_job IN (
                            N'مندوب', N'مندوبة', N'منسق', N'منسقة'
                        )
                        THEN 1
                    END) AS total

                FROM normalized;
            `);

            /* ------------------------------------------------------------------ */
            /* Temporary Coordinators                                             */
            /* ------------------------------------------------------------------ */

            const temporaryResult = await pool.request().query(`
                SELECT
                    COUNT(*) AS total,

                    COUNT(CASE
                        WHEN from_date <= CAST(GETDATE() AS DATE)
                         AND to_date >= CAST(GETDATE() AS DATE)
                        THEN 1
                    END) AS withinContractPeriod,

                    COUNT(CASE
                        WHEN to_date < CAST(GETDATE() AS DATE)
                        THEN 1
                    END) AS expired,

                    COUNT(CASE
                        WHEN from_date > CAST(GETDATE() AS DATE)
                        THEN 1
                    END) AS notStarted,

                    COUNT(CASE
                        WHEN from_date IS NULL OR to_date IS NULL
                        THEN 1
                    END) AS missingDates

                FROM dbo.temporary_coordinator
                WHERE ISNULL(isdeleted, 0) = 0;
            `);

            /* ------------------------------------------------------------------ */
            /* Advertising Companies                                              */
            /* ------------------------------------------------------------------ */

            const companiesResult = await pool.request().query(`
                SELECT
                    COUNT(*) AS total
                FROM dbo.advertising_companies
                WHERE ISNULL(isdeleted, 0) = 0;
            `);

            /* ------------------------------------------------------------------ */
            /* Security Persons                                                   */
            /* ------------------------------------------------------------------ */

            const securityResult = await pool.request().query(`
                SELECT
                    COUNT(*) AS total,

                    COUNT(CASE
                        WHEN LTRIM(RTRIM(security_situation)) = N'سليم'
                        THEN 1
                    END) AS safe,

                    COUNT(CASE
                        WHEN LTRIM(RTRIM(security_situation)) = N'تحت المراجعة'
                        THEN 1
                    END) AS underReview,

                    COUNT(CASE
                        WHEN LTRIM(RTRIM(security_situation)) IN (
                            N'بلوك', N'مرفوض', N'غير سليم'
                        )
                        THEN 1
                    END) AS blocked,

                    COUNT(CASE
                        WHEN security_situation IS NULL
                          OR LTRIM(RTRIM(security_situation)) = N''
                          OR LTRIM(RTRIM(security_situation)) = N'غير محدد'
                        THEN 1
                    END) AS unspecified

                FROM dbo.security_persons
                WHERE ISNULL(is_deleted, 0) = 0;
            `);

            /* ------------------------------------------------------------------ */
            /* Response                                                            */
            /* ------------------------------------------------------------------ */

            const stats = {
                coordinators: coordinatorsResult.recordset[0],
                temporaryCoordinators: temporaryResult.recordset[0],
                advertisingCompanies: companiesResult.recordset[0],
                security: securityResult.recordset[0],
            };

            return res.status(200).json({
                message: "Dashboard statistics retrieved successfully",
                stats,
            });

        } catch (error) {
            console.error(
                "Dashboard Marketing Coordinators Stats Error:",
                error
            );

            return res.status(500).json({
                message: "Failed to retrieve dashboard statistics",
            });
        }
    },
};

export default dashboardMarketingCoordinatorsController;
