
const adminMiddleware = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            message: "Authentication required.",
        });
    }

    if (req.user.type !== "admin") {
        return res.status(403).json({
            message: "You do not have permission to perform this action.",
        });
    }

    return next();
};

export default adminMiddleware;
