
import jwt from "jsonwebtoken";
import { sql, poolPromise } from "../config/db.js";

const authMiddleware = async (req, res, next) => {
    const token = req.cookies?.accessToken;

    if (!token) {
        return res.status(401).json({
            message: "Authentication required. Please login.",
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!Number.isInteger(decoded.id) || decoded.id <= 0) {
            return res.status(401).json({
                message: "Invalid token. Please login again.",
            });
        }

        const pool = await poolPromise;

        const result = await pool.request()
            .input("id", sql.Int, decoded.id)
            .query(`
                SELECT id, code, name, type
                FROM dbo.users
                WHERE id = @id;
            `);

        const user = result.recordset[0];

        if (!user) {
            return res.status(401).json({
                message: "User no longer exists. Please login again.",
            });
        }

        req.user = {
            id: user.id,
            code: user.code,
            name: user.name,
            type: user.type,
        };

        return next();
    } catch (error) {
        if (
            error.name === "TokenExpiredError" ||
            error.name === "JsonWebTokenError"
        ) {
            return res.status(401).json({
                message: "Invalid or expired token. Please login again.",
            });
        }

        console.error("Authentication error:", error);

        return res.status(500).json({
            message: "Authentication failed.",
        });
    }
};

export default authMiddleware;
