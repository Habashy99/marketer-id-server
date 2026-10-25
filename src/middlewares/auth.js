
import jwt from "jsonwebtoken";

const authMiddleware = (req, res, next) => {
    const token = req.cookies?.accessToken;

    if (!token) {
        return res.status(401).json({
            message: "Authentication required. Please login.",
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        req.user = decoded;

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
            message: "Internal server error.",
        });
    }
};

export default authMiddleware;
