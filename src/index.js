import express from "express";
import "dotenv/config";
import { poolPromise } from "./database/db.js";
import usersRoutes from "./routes/user.js";
import coordinatorsRoutes from "./routes/coordinator.js";
import authssRoutes from "./routes/auth.js";

const app = express();
const port = process.env.PORT;

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS, PUT, PATCH, DELETE"
    );
    res.setHeader(
        "Access-Control-Allow-Headers",
        "X-Requested-With, Content-Type, Authorization"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }

    next();
});


app.use("/users", usersRoutes);
app.use("/coordinators", coordinatorsRoutes);
app.use("/auths", authssRoutes);

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





