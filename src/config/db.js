
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sql from "mssql";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
    path: path.resolve(__dirname, "../../.env"),
});

const config = {
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 53306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
        encrypt: false,
        trustServerCertificate: true,
    },
    connectionTimeout: 30000,
    requestTimeout: 30000,
};

const poolPromise = sql.connect(config);

export { sql, poolPromise };
