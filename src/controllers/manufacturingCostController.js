import { retailPoolPromise, sql } from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* Manufacturing Cost Controller                                             */
/* -------------------------------------------------------------------------- */

class ManufacturingCostController {
  /* ------------------------------------------------------------------------ */
  /* Search Products From SQL Server                                          */
  /* ------------------------------------------------------------------------ */

  static async searchProducts(req, res) {
    try {
      const search = String(req.params.search || "").trim();

      if (!search) {
        return res.status(400).json({
          success: false,
          message: "من فضلك أدخل اسم المنتج أو الباركود",
        });
      }

      const pool = await retailPoolPromise;
      const result = await pool
        .request()
        .input("search", sql.NVarChar(200), search)
        .input("likeSearch", sql.NVarChar(202), `%${search}%`)
        .input("startsWith", sql.NVarChar(202), `${search}%`)
        .query(`
          SELECT TOP (100)
            LTRIM(RTRIM(iu.barcode)) AS barcode,
            LTRIM(RTRIM(iu.itemean)) AS itemean,
            i.a_name AS name,
            iu.unit,
            u.a_name AS unit_name,
            iu.costprice AS purchase_price,
            iu.buyunit,
            iu.peices,
            iu.Itempackage_Count,
            iu.weight,
            s.supplierno,
            s.a_name AS supplier_name,
            isp.unitprice AS supplier_unit_price
          FROM dbo.sys_item_units AS iu
          INNER JOIN dbo.sys_item AS i
            ON i.itemean = iu.itemean
          LEFT JOIN dbo.sys_unit AS u
            ON u.unit = iu.unit
          LEFT JOIN dbo.sys_item_suppliers AS isp
            ON isp.barcode = iu.barcode
            AND isp.itemean = iu.itemean
            AND isp.unit = iu.unit
            AND isp.status = 1
          LEFT JOIN dbo.sys_supplier AS s
            ON s.supplierno = isp.supplierno
            AND s.status = 1
          WHERE
            LTRIM(RTRIM(iu.barcode)) LIKE @likeSearch
            OR LTRIM(RTRIM(iu.itemean)) LIKE @likeSearch
            OR i.a_name LIKE N'%' + @search + N'%'
          ORDER BY
            CASE
              WHEN LTRIM(RTRIM(iu.barcode)) = @search THEN 0
              WHEN LTRIM(RTRIM(iu.itemean)) = @search THEN 1
              WHEN i.a_name = @search THEN 2
              WHEN LTRIM(RTRIM(iu.barcode)) LIKE @startsWith THEN 3
              WHEN LTRIM(RTRIM(iu.itemean)) LIKE @startsWith THEN 4
              ELSE 5
            END,
            i.a_name,
            iu.unit;
        `);

      const productsMap = new Map();

      for (const row of result.recordset) {
        const barcode = String(row.barcode || "").trim();
        const itemean = String(row.itemean || "").trim();
        const key = `${barcode}|${itemean}|${row.unit ?? ""}`;

        if (!productsMap.has(key)) {
          productsMap.set(key, {
            barcode,
            itemean,
            name: row.name,
            unit: row.unit,
            unit_name: row.unit_name,
            purchasePrice:
              row.purchase_price == null ? null : Number(row.purchase_price),
            buyUnit: row.buyunit,
            pieces: row.peices == null ? null : Number(row.peices),
            packageCount:
              row.Itempackage_Count == null
                ? null
                : Number(row.Itempackage_Count),
            weight: row.weight == null ? null : Number(row.weight),
            suppliers: [],
          });
        }

        if (row.supplierno != null) {
          const product = productsMap.get(key);
          const supplierId = Number(row.supplierno);
          if (!product.suppliers.some((supplier) => supplier.supplierId === supplierId)) {
            product.suppliers.push({
              supplierId,
              supplierName: row.supplier_name,
              unitPrice:
                row.supplier_unit_price == null
                  ? null
                  : Number(row.supplier_unit_price),
            });
          }
        }
      }

      const products = Array.from(productsMap.values());

      return res.status(200).json({
        success: true,
        products,
      });
    } catch (error) {
      console.error("Manufacturing cost products search error:", error);
      return res.status(500).json({
        success: false,
        message: "حدث خطأ أثناء البحث عن الخامات",
      });
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Get Product By Barcode                                                   */
  /* ------------------------------------------------------------------------ */

  static async getProductByBarcode(req, res) {
    try {
      const search = String(req.params.barcode || "").trim();

      if (!search) {
        return res.status(400).json({
          success: false,
          message: "من فضلك أدخل الباركود أو اسم المنتج",
        });
      }

      const pool = await retailPoolPromise;

      const result = await pool
        .request()
        .input("search", sql.NVarChar(100), search)
        .query(`
          SELECT TOP (1)
            LTRIM(RTRIM(iu.barcode)) AS barcode,
            LTRIM(RTRIM(iu.itemean)) AS itemean,
            i.a_name AS product_name,
            iu.unit,
            u.a_name AS unit_name,
            iu.costprice AS purchase_price,
            iu.buyunit,
            iu.peices,
            iu.Itempackage_Count,
            iu.weight,
            s.supplierno,
            s.a_name AS supplier_name,
            isp.unitprice AS supplier_unit_price
          FROM dbo.sys_item_units AS iu
          INNER JOIN dbo.sys_item AS i
            ON i.itemean = iu.itemean
          LEFT JOIN dbo.sys_unit AS u
            ON u.unit = iu.unit
          LEFT JOIN dbo.sys_item_suppliers AS isp
            ON isp.barcode = iu.barcode
            AND isp.itemean = iu.itemean
            AND isp.unit = iu.unit
            AND isp.status = 1
          LEFT JOIN dbo.sys_supplier AS s
            ON s.supplierno = isp.supplierno
            AND s.status = 1
          WHERE
            LTRIM(RTRIM(iu.barcode)) = @search
            OR i.a_name LIKE N'%' + @search + N'%'
          ORDER BY
            CASE
              WHEN LTRIM(RTRIM(iu.barcode)) = @search THEN 0
              WHEN i.a_name = @search THEN 1
              WHEN i.a_name LIKE @search + N'%' THEN 2
              ELSE 3
            END,
            i.a_name;
        `);

      if (!result.recordset.length) {
        return res.status(404).json({
          success: false,
          message: "لم يتم العثور على المنتج",
        });
      }

      const firstRow = result.recordset[0];
      const suppliersMap = new Map();

      for (const row of result.recordset) {
        if (row.supplierno == null) continue;
        const supplierId = Number(row.supplierno);
        if (!suppliersMap.has(supplierId)) {
          suppliersMap.set(supplierId, {
            supplierId,
            supplierName: row.supplier_name,
            unitPrice:
              row.supplier_unit_price == null
                ? null
                : Number(row.supplier_unit_price),
          });
        }
      }

      return res.status(200).json({
        success: true,
        product: {
          barcode: firstRow.barcode,
          itemean: firstRow.itemean,
          name: firstRow.product_name,
          purchasePrice:
            firstRow.purchase_price == null
              ? null
              : Number(firstRow.purchase_price),
          purchaseUnit: firstRow.unit_name || "وحدة",
          unit: firstRow.unit,
          unitName: firstRow.unit_name,
          buyUnit: firstRow.buyunit,
          pieces: firstRow.peices == null ? null : Number(firstRow.peices),
          packageCount:
            firstRow.Itempackage_Count == null
              ? null
              : Number(firstRow.Itempackage_Count),
          weight: firstRow.weight == null ? null : Number(firstRow.weight),
          priceSource: "sys_item_units.costprice",
          suppliers: Array.from(suppliersMap.values()),
        },
      });
    } catch (error) {
      console.error("Manufacturing cost product lookup error:", error);
      return res.status(500).json({
        success: false,
        message: "حدث خطأ أثناء البحث عن المنتج",
      });
    }
  }
}

export default ManufacturingCostController;
