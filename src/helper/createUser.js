import { sql, poolPromise } from "../database/db.js";
import bcrypt from "bcryptjs";

const createUser = async ({ code, name, password, createdBy }) => {
    const pool = await poolPromise;

    const passwordHash = await bcrypt.hash(password, 12);
    const createdAt = new Date();

    const result = await pool
        .request()
        .input("code", sql.Int, Number(code))
        .input("name", sql.NVarChar(255), name.trim())
        .input("passwordHash", sql.VarChar(255), passwordHash)
        .input("createdBy", sql.Int, Number(createdBy))
        .input("createdAt", sql.DateTime, createdAt)
        .query(`
            INSERT INTO users (
                code, name, password, created_by, created_at
            )
            OUTPUT
                INSERTED.id,
                INSERTED.code,
                INSERTED.name,
                INSERTED.created_at AS createdAt,
                INSERTED.created_by AS createdBy
            VALUES (
                @code, @name, @passwordHash, @createdBy, @createdAt
            );
        `);

    return result.recordset[0];
};

export default createUser;