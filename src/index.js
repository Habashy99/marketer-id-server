
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { poolPromise } from "./config/db.js";
import { testNextcloudConnection } from "./controllers/imageController.js";
import usersRoutes from "./routes/user.js";
import coordinatorsRoutes from "./routes/coordinator.js";
import authsRoutes from "./routes/auth.js";
import authsUserRoutes from "./routes/authUser.js";
import dashboardRouter from "./routes/dashboard.js";
import exceptionsRouter from "./routes/exception.js";
import printLogRouter from "./routes/printLog.js";
import cardTemplatesRouter from "./routes/cardTemplates.js";
import cardLogsRouter from "./routes/cardLogs.js";
import cookieParser from "cookie-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
    path: path.resolve(__dirname, "../.env"),
});

const app = express();
const port = process.env.PORT || 3000;

const allowedOrigins = new Set([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
]);

app.use(
    cors({
        origin(origin, callback) {
            if (
                !origin ||
                origin === "null" ||
                origin === "file://" ||
                allowedOrigins.has(origin)
            ) {
                return callback(null, true);
            }

            console.error("Blocked CORS origin:", origin);

            return callback(
                new Error(`Origin not allowed by CORS: ${origin}`)
            );
        },
        credentials: true,
    })
);

app.use(express.json());
app.use(cookieParser());

// API routes
app.use("/users", usersRoutes);
app.use("/printLog", printLogRouter);
app.use("/coordinators", coordinatorsRoutes);
app.use("/auths", authsRoutes);
app.use("/exceptions", exceptionsRouter);
app.use("/authsUser", authsUserRoutes);
app.use("/dashboard", dashboardRouter);
app.use("/card-templates", cardTemplatesRouter);
app.use("/card-logs", cardLogsRouter);

// Serve the built React frontend in the packaged Electron app.
const frontendDistPath = process.env.FRONTEND_DIST_PATH;

if (frontendDistPath) {
    const frontendIndexPath = path.join(
        frontendDistPath,
        "index.html"
    );

    if (fs.existsSync(frontendIndexPath)) {
        app.use(express.static(frontendDistPath));

        app.get("/", (_req, res) => {
            res.sendFile(frontendIndexPath);
        });

        // Support React Router routes such as /dashboard and /users.
        app.get("/{*path}", (req, res, next) => {
            if (
                req.path.startsWith("/users/") ||
                req.path.startsWith("/coordinators/") ||
                req.path.startsWith("/dashboard/") ||
                req.path.startsWith("/auths/") ||
                req.path.startsWith("/authsUser/") ||
                req.path.startsWith("/exceptions/") ||
                req.path.startsWith("/printLog/") ||
                req.path.startsWith("/card-templates/") ||
                req.path.startsWith("/card-logs/")
            ) {
                return next();
            }

            res.sendFile(frontendIndexPath);
        });

        console.log("React frontend enabled:", frontendDistPath);
    } else {
        console.error(
            "Frontend index.html not found:",
            frontendIndexPath
        );
    }
}

testNextcloudConnection()
    .then((result) => {
        console.log("Nextcloud connection test:", result);
    })
    .catch((error) => {
        console.error(
            "Nextcloud connection test failed:",
            error.message
        );
    });

async function startServer() {
    try {
        await poolPromise;

        console.log("Connected to SQL Server successfully!");

        app.listen(port, "127.0.0.1", () => {
            console.log(`Server running on http://127.0.0.1:${port}`);
        });
    } catch (error) {
        console.error(
            "Database connection failed:",
            error.message
        );

        process.exit(1);
    }
}

startServer();
