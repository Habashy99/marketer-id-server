
import "dotenv/config";
import sql from "mssql";

const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
        instanceName: process.env.DB_INSTANCE,
        encrypt: false,
        trustServerCertificate: true,
    },
};

const poolPromise = sql.connect(config);

export { sql, poolPromise };
