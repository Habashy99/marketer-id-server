
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

import { retailPoolPromise } from "./config/db.js";
import { testNextcloudConnection } from "./controllers/imageController.js";

import usersRoutes from "./routes/user.js";
import coordinatorsRoutes from "./routes/coordinator.js";
import authsRoutes from "./routes/auth.js";
import authsUserRoutes from "./routes/authUser.js";
import conductRouter from "./routes/conduct.js";
import exceptionsRouter from "./routes/exception.js";
import printLogRouter from "./routes/printLog.js";
import cardTemplatesRouter from "./routes/cardTemplates.js";
import cardLogsRouter from "./routes/cardLogs.js";
import temporaryCoordinator from "./routes/temporaryCoordinator.js";
import advertisingCompany from "./routes/advertisingCompany.js";
import retailRoutes from "./routes/retail.js";
import securityRoutes from "./routes/security.js";
import dashboardMarketingCoordinatorsRouter from "./routes/dashboardMarketingCoordinators.js";
import recuritmentRoutes from "./routes/recuritment.js";
import externalSecurityRoutes from "./routes/externalSecurityRoutes.js";

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
    path: path.resolve(__dirname, "../.env"),
});
console.log(
  "SECURITY API KEY loaded:",
  Boolean(process.env.SECURITY_LOOKUP_API_KEY),
);
/* -------------------------------------------------------------------------- */
/* Application                                                                */
/* -------------------------------------------------------------------------- */

const app = express();
const port = process.env.PORT || 3000;

const allowedOrigins = new Set([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "https://mk.gomlamarket.com",

    ...(process.env.CORS_ORIGINS || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
]);

/* -------------------------------------------------------------------------- */
/* Middlewares                                                                */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* External Security API                                                      */
/* -------------------------------------------------------------------------- */

// POST /api/external/security/check-national-id
app.use(
    "/api/external/security",
    externalSecurityRoutes
);

/* -------------------------------------------------------------------------- */
/* Internal API Routes                                                        */
/* -------------------------------------------------------------------------- */

app.use(
    "/dashboard-marketing-coordinators",
    dashboardMarketingCoordinatorsRouter
);

app.use("/users", usersRoutes);
app.use("/printLog", printLogRouter);
app.use("/coordinators", coordinatorsRoutes);
app.use("/retail", retailRoutes);
app.use("/auths", authsRoutes);
app.use("/exceptions", exceptionsRouter);
app.use("/authsUser", authsUserRoutes);
app.use("/conduct", conductRouter);
app.use("/card-templates", cardTemplatesRouter);
app.use("/card-logs", cardLogsRouter);
app.use("/temporary-coordinators", temporaryCoordinator);
app.use("/advertising-companies", advertisingCompany);
app.use("/security", securityRoutes);
app.use("/recuritment", recuritmentRoutes);

/* -------------------------------------------------------------------------- */
/* React Frontend                                                             */
/* -------------------------------------------------------------------------- */

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

        const apiPrefixes = [
            "/api",
            "/users",
            "/coordinators",
            "/conduct",
            "/auths",
            "/authsUser",
            "/exceptions",
            "/printLog",
            "/card-templates",
            "/card-logs",
            "/temporary-coordinators",
            "/advertising-companies",
            "/retail",
            "/security",
            "/dashboard-marketing-coordinators",
            "/recuritment",
        ];

        app.get("/{*path}", (req, res, next) => {
            const isApiRoute = apiPrefixes.some(
                (prefix) =>
                    req.path === prefix ||
                    req.path.startsWith(`${prefix}/`)
            );

            if (isApiRoute) {
                return next();
            }

            res.sendFile(frontendIndexPath);
        });

        console.log(
            "React frontend enabled:",
            frontendDistPath
        );
    } else {
        console.error(
            "Frontend index.html not found:",
            frontendIndexPath
        );
    }
}

/* -------------------------------------------------------------------------- */
/* Nextcloud Connection Test                                                  */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Start Server                                                               */
/* -------------------------------------------------------------------------- */

async function startServer() {
    try {
        await retailPoolPromise;

        console.log("Connected to SQL Server successfully!");

        const host = process.env.HOST || "0.0.0.0";

        app.listen(port, host, () => {
            console.log(
                `Server running on http://${host}:${port}`
            );
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
