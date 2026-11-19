
import sql from "mssql";
import dotenv from "dotenv";

dotenv.config();

/* -------------------------------------------------------------------------- */
/* Retail Database                                                            */
/* -------------------------------------------------------------------------- */

const retailConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
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
/* Security Database                                                          */
/* -------------------------------------------------------------------------- */

const securityConfig = {
    user: process.env.SECURITY_DB_USER,
    password: process.env.SECURITY_DB_PASSWORD,
    server: process.env.SECURITY_DB_SERVER,
    port: process.env.SECURITY_DB_PORT
        ? Number(process.env.SECURITY_DB_PORT)
        : undefined,
    database: process.env.SECURITY_DB_NAME,

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

    "SECURITY_DB_USER",
    "SECURITY_DB_PASSWORD",
    "SECURITY_DB_SERVER",
    "SECURITY_DB_NAME",
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
/* Connection Pools                                                           */
/* -------------------------------------------------------------------------- */

const retailPool = new sql.ConnectionPool(retailConfig);
const securityPool = new sql.ConnectionPool(securityConfig);

export const retailPoolPromise = retailPool.connect();
export const securityPoolPromise = securityPool.connect();

/* -------------------------------------------------------------------------- */
/* Connection Diagnostics                                                     */
/* -------------------------------------------------------------------------- */

retailPoolPromise
    .then((pool) => {
        console.log(
            "Retail DB connected successfully:",
            pool.config.database
        );
    })
    .catch((error) => {
        console.error("Retail DB connection failed:", error.message);
    });

securityPoolPromise
    .then((pool) => {
        console.log(
            "Security DB connected successfully:",
            pool.config.database
        );
    })
    .catch((error) => {
        console.error("Security DB connection failed:", error.message);
    });

retailPool.on("error", (error) => {
    console.error("Retail DB pool error:", error.message);
});

securityPool.on("error", (error) => {
    console.error("Security DB pool error:", error.message);
});

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

export { sql };
