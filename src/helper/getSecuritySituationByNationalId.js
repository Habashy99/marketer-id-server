import sql from "mssql";
import { retailPoolPromise } from "../config/db.js";

const VALID_SECURITY_STATUSES = new Set([
    "سليم",
    "تحت المراجعة",
    "مرفوض",
    "غير محدد",
    "بلوك",
]);

export async function getSecuritySituationByNationalId(nationalId) {
    const normalizedNationalId = String(nationalId ?? "").trim();

    if (!normalizedNationalId) {
        return null;
    }

    const retailPool = await retailPoolPromise;

    if (!retailPool) {
        throw new Error("Retail database unavailable.");
    }

    const result = await retailPool
        .request()
        .input("nationalId", sql.NVarChar(50), normalizedNationalId)
        .query(`
            SELECT TOP 1
                security_situation
            FROM dbo.security_persons
            WHERE LTRIM(RTRIM(national_id_number)) = @nationalId
              AND is_deleted = 0
            ORDER BY updated_at DESC, id DESC;
        `);

    if (result.recordset.length === 0) {
        return null;
    }

    const status = String(
        result.recordset[0].security_situation ?? ""
    ).trim();

    return VALID_SECURITY_STATUSES.has(status)
        ? status
        : "غير محدد";
}