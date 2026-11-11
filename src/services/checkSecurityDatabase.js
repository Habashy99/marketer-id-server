
import { retailPoolPromise, sql } from "../config/db.js";

async function checkDatabase() {
    const pool = await retailPoolPromise;

    const result = await pool.request().query(`
        SELECT
            @@SERVERNAME AS server_name,
            DB_NAME() AS database_name,
            OBJECT_ID('dbo.security_persons') AS security_persons,
            OBJECT_ID('dbo.security_incidents_import') AS incidents_import,
            OBJECT_ID('dbo.security_permits_import') AS permits_import;
    `);

    console.table(result.recordset);
}

checkDatabase()
    .catch(console.error)
    .finally(async () => {
        await sql.close();
    });
