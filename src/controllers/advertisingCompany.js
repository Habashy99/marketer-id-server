
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
                    DELETE FROM dbo.advertising_companies
                    OUTPUT
                        DELETED.id,
                        DELETED.name
                    WHERE id = @id;
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

            // Company is referenced by temporary_coordinator
            if (error.number === 547) {
                return res.status(409).json({
                    message: "لا يمكن حذف الشركة لأنها مرتبطة بمنسق مؤقت.",
                });
            }

            return res.status(500).json({
                message: "Failed to delete advertising company.",
            });
        }
    },
};

export default AdvertisingCompanyController;
