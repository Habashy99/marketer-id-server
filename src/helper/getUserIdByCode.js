import { sql, retailPoolPromise } from "../config/db.js";

const getUserIdByCode = async (code) => {
    const pool = await retailPoolPromise;

    const result = await pool.request()
        .input("code", sql.Int, Number(code))
        .query(`
            SELECT id
            FROM dbo.DelegateuserPermissions
            WHERE code = @code;
        `);

    if (result.recordset.length === 0) {
        return null;
    }

    return result.recordset[0].id;
};

export default getUserIdByCode;