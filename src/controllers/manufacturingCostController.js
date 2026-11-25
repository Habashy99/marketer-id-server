
import { retailPoolPromise, sql } from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* Product Lookup By Barcode - Manufacturing Cost                             */
/* -------------------------------------------------------------------------- */

class ManufacturingCostController {
    static async getProductByBarcode(req, res) {
        try {
            const barcode = String(req.params.barcode || "").trim();

            if (!barcode) {
                return res.status(400).json({
                    success: false,
                    message: "من فضلك أدخل الباركود",
                });
            }

            if (!/^\d{1,20}$/.test(barcode)) {
                return res.status(400).json({
                    success: false,
                    message: "الباركود غير صحيح",
                });
            }

            const pool = await retailPoolPromise;

            const result = await pool
                .request()
                .input("barcode", sql.Char(20), barcode)
                .query(`
                    SELECT
                        LTRIM(RTRIM(iu.barcode)) AS barcode,
                        LTRIM(RTRIM(iu.itemean)) AS itemean,
                        i.a_name AS product_name,
                        iu.unit,
                        u.a_name AS unit_name,
                        s.supplierno,
                        s.a_name AS supplier_name
                    FROM dbo.sys_item_units iu
                    INNER JOIN dbo.sys_item i
                        ON i.itemean = iu.itemean
                    LEFT JOIN dbo.sys_unit u
                        ON u.unit = iu.unit
                    LEFT JOIN dbo.sys_item_suppliers isp
                        ON isp.barcode = iu.barcode
                        AND isp.itemean = iu.itemean
                        AND isp.unit = iu.unit
                        AND isp.status = 1
                    LEFT JOIN dbo.sys_supplier s
                        ON s.supplierno = isp.supplierno
                        AND s.status = 1
                    WHERE LTRIM(RTRIM(iu.barcode)) = @barcode
                    ORDER BY s.a_name;
                `);

            if (!result.recordset.length) {
                return res.status(404).json({
                    success: false,
                    message: "لم يتم العثور على منتج بهذا الباركود",
                });
            }

            const firstRow = result.recordset[0];
            const suppliersMap = new Map();

            for (const row of result.recordset) {
                if (
                    row.supplierno === null ||
                    row.supplierno === undefined
                ) {
                    continue;
                }

                const supplierId = Number(row.supplierno);

                if (!suppliersMap.has(supplierId)) {
                    suppliersMap.set(supplierId, {
                        supplierId,
                        supplierName: row.supplier_name,
                    });
                }
            }

            return res.json({
                success: true,
                product: {
                    barcode: firstRow.barcode,
                    itemean: firstRow.itemean,
                    name: firstRow.product_name,
                    unit: firstRow.unit,
                    unitName: firstRow.unit_name,
                    suppliers: [...suppliersMap.values()],
                },
            });
        } catch (error) {
            console.error(
                "Manufacturing cost product lookup error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "حدث خطأ أثناء البحث عن المنتج",
            });
        }
    }
}

export default ManufacturingCostController;
