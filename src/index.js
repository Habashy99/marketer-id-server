import express from "express";
import cors from "cors";
import "dotenv/config";
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

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
    origin: "http://localhost:5173",
    credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

app.use("/users", usersRoutes);
app.use("/printLog", printLogRouter);
app.use("/coordinators", coordinatorsRoutes);
app.use("/auths", authsRoutes);
app.use("/exceptions", exceptionsRouter);
app.use("/authsUser", authsUserRoutes);
app.use("/dashboard", dashboardRouter);
app.use("/card-templates", cardTemplatesRouter);
app.use("/card-logs", cardLogsRouter);

testNextcloudConnection()
    .then((result) => {
        console.log("Nextcloud connection test:", result);
    })
    .catch((error) => {
        console.error("Nextcloud connection test failed:", error.message);
    });
async function startServer() {
    try {
        await poolPromise;

        console.log("Connected to SQL Server successfully!");

        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (error) {
        console.error("Database connection failed:", error.message);
        process.exit(1);
    }
}

startServer();