
import sql from "mssql";
import dotenv from "dotenv";

dotenv.config();

/* -------------------------------------------------------------------------- */
/* Retail Database Configuration                                              */
/* -------------------------------------------------------------------------- */

const retailConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: process.env.DB_PORT
        ? Number(process.env.DB_PORT)
        : undefined,
    database: process.env.DB_NAME,

    options: {
        encrypt: false,
        trustServerCertificate: true,
    },

    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
    },

    connectionTimeout: 30000,
    requestTimeout: 30000,
};

/* -------------------------------------------------------------------------- */
/* Validate Configuration                                                     */
/* -------------------------------------------------------------------------- */

const requiredEnv = [
    "DB_USER",
    "DB_PASSWORD",
    "DB_SERVER",
    "DB_NAME",
];

const missingEnv = requiredEnv.filter(
    (key) => !process.env[key]
);

if (missingEnv.length > 0) {
    throw new Error(
        `Missing database environment variables: ${missingEnv.join(", ")}`
    );
}

/* -------------------------------------------------------------------------- */
/* Retail Connection Pool                                                     */
/* -------------------------------------------------------------------------- */

const retailPool = new sql.ConnectionPool(retailConfig);

export const retailPoolPromise = retailPool.connect();

/* -------------------------------------------------------------------------- */
/* Connection Diagnostics                                                     */
/* -------------------------------------------------------------------------- */

retailPoolPromise
    .then((pool) => {
        console.log("Retail DB connected successfully:", {
            database: pool.config.database,
            server: pool.config.server,
            port: pool.config.port,
        });
    })
    .catch((error) => {
        console.error(
            "Retail DB connection failed:",
            error.message
        );
    });

retailPool.on("error", (error) => {
    console.error("Retail DB pool error:", error.message);
});

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

export { sql };
