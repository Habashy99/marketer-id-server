
import { retailPoolPromise } from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* Supplier Factors Controller                                                */
/* -------------------------------------------------------------------------- */

class SupplierFactorsController {
    static async getBranches(req, res) {
        try {
            const pool = await retailPoolPromise;

            const result = await pool.request().query(`
                SELECT
                    branch AS id,
                    LTRIM(RTRIM(a_name)) AS name,
                    LTRIM(RTRIM(l_name)) AS englishName
                FROM dbo.sys_branch
                WHERE warehouse = 1
                ORDER BY branch;
            `);

            return res.status(200).json({
                success: true,
                count: result.recordset.length,
                branches: result.recordset,
            });
        } catch (error) {
            console.error(
                "Supplier factors branches error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "حدث خطأ أثناء جلب الفروع",
            });
        }
    }
}

export default SupplierFactorsController;
