
import jwt from "jsonwebtoken";
import { sql, poolPromise } from "../config/db.js";

const authMiddleware = async (req, res, next) => {
    console.log("Auth diagnostic:", {
        path: req.originalUrl,
        origin: req.headers.origin,
        host: req.headers.host,
        cookieHeaderPresent: Boolean(req.headers.cookie),
        cookieNames: Object.keys(req.cookies || {}),
        accessTokenPresent: Boolean(req.cookies?.accessToken),
    });
    const token = req.cookies?.accessToken;

    if (!token) {
        console.warn("Authentication failed: accessToken cookie is missing", {
            path: req.originalUrl,
            origin: req.headers.origin,
        });

        return res.status(401).json({
            message: "Authentication required. Please login.",
        });
    }

    let decoded;

    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        if (
            error.name === "TokenExpiredError" ||
            error.name === "JsonWebTokenError"
        ) {
            return res.status(401).json({
                message: "Invalid or expired token. Please login again.",
            });
        }

        console.error("JWT verification error:", error);

        return res.status(500).json({
            message: "Authentication failed.",
        });
    }

    if (!Number.isInteger(decoded.id) || decoded.id <= 0) {
        return res.status(401).json({
            message: "Invalid token. Please login again.",
        });
    }

    try {
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
        console.error("Authentication database error:", error);

        return res.status(500).json({
            message: "Authentication failed.",
        });
    }
};

export default authMiddleware;
