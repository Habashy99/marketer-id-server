
import { sql, retailPoolPromise } from "../config/db.js";

const requirePermission = (authNumber) => {
    return async (req, res, next) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({
                    message: "Authentication required.",
                });
            }

            const pool = await retailPoolPromise;

            const result = await pool
                .request()
                .input("userId", sql.Int, req.user.id)
                .input("authNumber", sql.Int, authNumber)
                .query(`
                    SELECT TOP 1 1 AS hasPermission
                    FROM dbo.user_auth AS ua
                    INNER JOIN dbo.auth AS a
                        ON a.auth_number = ua.auth_id
                    WHERE ua.user_id = @userId
                      AND a.auth_number = @authNumber;
                `);

            if (result.recordset.length === 0) {
                return res.status(403).json({
                    message: "You do not have permission to perform this action.",
                });
            }

            return next();
        } catch (error) {
            console.error("Permission middleware error:", error);

            return res.status(500).json({
                message: "Failed to verify permissions.",
            });
        }
    };
};

export default requirePermission;
