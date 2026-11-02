
import { sql, poolPromise } from "../config/db.js";

const AdvertisingCompanyController = {
    // GET ALL ADVERTISING COMPANIES
    getAllAdvertisingCompanies: async (req, res) => {
        try {
            const pool = await poolPromise;

            const result = await pool.request().query(`
            SELECT
                id,
                name
            FROM dbo.advertising_companies
            WHERE isdeleted = 0
            ORDER BY name ASC;
        `);

            return res.status(200).json({
                companies: result.recordset,
            });
        } catch (error) {
            console.error("Get advertising companies error:", error);

            return res.status(500).json({
                message: "Failed to fetch advertising companies.",
            });
        }
    },

    // CREATE ADVERTISING COMPANY
    createAdvertisingCompany: async (req, res) => {
        try {
            const { name } = req.body;

            if (!name || !name.trim()) {
                return res.status(400).json({
                    message: "Company name is required.",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("name", sql.NVarChar(150), name.trim())
                .query(`
                    INSERT INTO dbo.advertising_companies (name)
                    OUTPUT
                        INSERTED.id,
                        INSERTED.name
                    VALUES (@name);
                `);

            return res.status(201).json({
                message: "Advertising company created successfully.",
                company: result.recordset[0],
            });
        } catch (error) {
            console.error("Create advertising company error:", error);

            // Duplicate company name
            if (error.number === 2627 || error.number === 2601) {
                return res.status(409).json({
                    message: "هذه الشركة الإعلانية موجودة بالفعل.",
                });
            }

            return res.status(500).json({
                message: "Failed to create advertising company.",
            });
        }
    },

    // DELETE ADVERTISING COMPANY
    deleteAdvertisingCompany: async (req, res) => {
        try {
            const id = Number(req.params.id);

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({
                    message: "Invalid company ID.",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, id)
                .query(`
                UPDATE dbo.advertising_companies
                SET isdeleted = 1
                OUTPUT
                    INSERTED.id,
                    INSERTED.name,
                    INSERTED.isdeleted
                WHERE id = @id
                  AND isdeleted = 0;
            `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "Advertising company not found.",
                });
            }

            return res.status(200).json({
                message: "Advertising company deleted successfully.",
                company: result.recordset[0],
            });

        } catch (error) {
            console.error("Delete advertising company error:", error);

            return res.status(500).json({
                message: "Failed to delete advertising company.",
            });
        }
    },
    // SEARCH ADVERTISING COMPANIES
    searchAdvertisingCompanies: async (req, res) => {
        try {
            const search = String(req.query.search ?? "").trim();

            if (search.length < 2) {
                return res.status(200).json([]);
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("search", sql.NVarChar(150), `%${search}%`)
                .query(`
                SELECT TOP 50
                    id,
                    name AS a_name
                FROM dbo.advertising_companies
                WHERE name LIKE @search
                ORDER BY name ASC;
            `);

            return res.status(200).json(result.recordset);
        } catch (error) {
            console.error("Search advertising companies error:", error);

            return res.status(500).json({
                message: "Failed to search advertising companies.",
            });
        }
    },
};

export default AdvertisingCompanyController;
