import { retailPoolPromise } from "../config/db.js";
import sql from "mssql";
const RetailController = {
    getSuppliers: async (req, res) => {
        try {
            const retailPool = await retailPoolPromise;

            if (!retailPool) {
                return res.status(503).json({
                    message: "Retail database is unavailable",
                });
            }

            const result = await retailPool.request().query(`
                SELECT
                    supplierno AS id,
                    LTRIM(RTRIM(a_name)) AS a_name
                FROM dbo.sys_supplier
                WHERE supplierno IS NOT NULL
                ORDER BY a_name;
            `);

            return res.status(200).json(result.recordset);
        } catch (error) {
            console.error("Get suppliers error:", error);

            return res.status(500).json({
                message: "Failed to get suppliers",
                error: error.message,
            });
        }
    },

    getBranches: async (req, res) => {
        try {
            const retailPool = await retailPoolPromise;

            if (!retailPool) {
                return res.status(503).json({
                    message: "Retail database is unavailable",
                });
            }

            const result = await retailPool.request().query(`
                SELECT
                    branch AS id,
                    LTRIM(RTRIM(a_name)) AS a_name
                FROM dbo.sys_branch
                WHERE branch IS NOT NULL
                ORDER BY a_name;
            `);

            return res.status(200).json(result.recordset);
        } catch (error) {
            console.error("Get branches error:", error);

            return res.status(500).json({
                message: "Failed to get branches",
                error: error.message,
            });
        }
    },

    searchSuppliers: async (req, res) => {
        try {
            const search =
                typeof req.query.search === "string"
                    ? req.query.search.trim()
                    : "";

            if (search.length < 2) {
                return res.status(200).json([]);
            }
            const searchText = search.trim();

            if (searchText.length < 2) {
                return res.status(200).json([]);
            }

            const retailPool = await retailPoolPromise;

            if (!retailPool) {
                return res.status(503).json({
                    message: "Retail database is unavailable",
                });
            }

            const result = await retailPool
                .request()
                .input("search", sql.NVarChar, `%${searchText}%`)
                .query(`
                SELECT TOP 50
                    supplierno AS id,
                    LTRIM(RTRIM(a_name)) AS a_name
                FROM dbo.sys_supplier
                WHERE supplierno IS NOT NULL
                  AND a_name LIKE @search
                ORDER BY a_name;
            `);

            return res.status(200).json(result.recordset);
        } catch (error) {
            console.error("Search suppliers error:", error);

            return res.status(500).json({
                message: "Failed to search suppliers",
                error: error.message,
            });
        }
    },
    searchBranches: async (req, res) => {
        try {
            const search =
                typeof req.query.search === "string"
                    ? req.query.search.trim()
                    : "";

            if (search.length < 2) {
                return res.status(200).json([]);
            }

            const retailPool = await retailPoolPromise;

            if (!retailPool) {
                return res.status(503).json({
                    message: "Retail database is unavailable",
                });
            }

            const result = await retailPool
                .request()
                .input(
                    "search",
                    sql.NVarChar,
                    `%${search}%`
                )
                .query(`
                SELECT TOP 50
                    branch AS id,
                    LTRIM(RTRIM(a_name)) AS a_name
                FROM dbo.sys_branch
                WHERE branch IS NOT NULL
                  AND a_name LIKE @search
                ORDER BY a_name;
            `);

            return res.status(200).json(result.recordset);
        } catch (error) {
            console.error("Search branches error:", error);

            return res.status(500).json({
                message: "Failed to search branches",
                error: error.message,
            });
        }
    },

};

export default RetailController;