import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sql from "mssql";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
    path: path.resolve(__dirname, "../../.env"),
});

const createDatabaseConfig = (prefix) => {
    const isDefault = prefix === "DB";

    const config = {
        server: process.env[`${prefix}_SERVER`],
        port: Number(process.env[`${prefix}_PORT`]),
        database: process.env[`${prefix}_NAME`],
        user: process.env[`${prefix}_USER`],
        password: process.env[`${prefix}_PASSWORD`],

        options: {
            encrypt: false,
            trustServerCertificate: true,
        },

        connectionTimeout: 30000,
        requestTimeout: 30000,
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000,
        },
    };

    const instanceName = process.env[`${prefix}_INSTANCE`];

    if (instanceName) {
        config.options.instanceName = instanceName;
    }

    return config;
};


const dbConfig = createDatabaseConfig("DB");

export const retailPoolPromise = new sql.ConnectionPool(dbConfig).connect();

export { sql };