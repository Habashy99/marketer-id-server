import { sql, poolPromise } from "../config/db.js";

function isValidDesign(design) {
    if (!design || typeof design !== "object" || Array.isArray(design)) {
        return false;
    }

    if (!design.canvas || typeof design.canvas !== "object") {
        return false;
    }

    if (!Array.isArray(design.elements)) {
        return false;
    }

    if (!["horizontal", "vertical"].includes(design.orientation)) {
        return false;
    }

    const { width, height, background } = design.canvas;

    return (
        Number.isFinite(width) &&
        width > 0 &&
        Number.isFinite(height) &&
        height > 0 &&
        typeof background === "string"
    );
}

const CardTemplateController = {
    createDesign: async (req, res) => {
        try {
            const { name, design } = req.body ?? {};

            if (
                typeof name !== "string" ||
                !name.trim() ||
                name.trim().length > 150
            ) {
                return res.status(400).json({
                    message: "Design name is required and must not exceed 150 characters.",
                });
            }

            if (!isValidDesign(design)) {
                return res.status(400).json({
                    message: "Invalid design JSON.",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("name", sql.NVarChar(150), name.trim())
                .input(
                    "design",
                    sql.NVarChar(sql.MAX),
                    JSON.stringify(design)
                )
                .query(`
                INSERT INTO dbo.card_templates (name, design)
                OUTPUT
                    INSERTED.id,
                    INSERTED.name,
                    INSERTED.design
                VALUES (@name, @design);
            `);

            const row = result.recordset[0];

            return res.status(201).json({
                message: "Design saved successfully.",
                template: {
                    id: row.id,
                    name: row.name,
                    design: JSON.parse(row.design),
                },
            });
        } catch (error) {
            console.error("Create design error:", error);

            return res.status(500).json({
                message: "Failed to save design.",
            });
        }
    },

    getAllDesigns: async (req, res) => {
        try {
            const pool = await poolPromise;

            const result = await pool.request().query(`
                SELECT id, name, design
                FROM dbo.card_templates
                ORDER BY id DESC;
            `);

            const templates = result.recordset.map((row) => {
                let design;

                try {
                    design = JSON.parse(row.design);
                } catch {
                    design = null;
                }

                return {
                    id: row.id,
                    name: row.name,
                    design,
                };
            });

            return res.status(200).json({
                message: "Designs retrieved successfully.",
                templates,
            });
        } catch (error) {
            console.error("Get all designs error:", error);

            return res.status(500).json({
                message: "Failed to retrieve designs.",
            });
        }
    },

    getDesignById: async (req, res) => {
        try {
            const id = Number(req.params.id);

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({
                    message: "Invalid design ID.",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, id)
                .query(`
                    SELECT id, name, design
                    FROM dbo.card_templates
                    WHERE id = @id;
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "Design not found.",
                });
            }

            const row = result.recordset[0];

            let design;

            try {
                design = JSON.parse(row.design);
            } catch {
                return res.status(500).json({
                    message: "The stored design JSON is invalid.",
                });
            }

            return res.status(200).json({
                message: "Design retrieved successfully.",
                template: {
                    id: row.id,
                    name: row.name,
                    design,
                },
            });
        } catch (error) {
            console.error("Get design by ID error:", error);

            return res.status(500).json({
                message: "Failed to retrieve design.",
            });
        }
    },

    editDesign: async (req, res) => {
        try {
            const id = Number(req.params.id);
            const { name, design } = req.body ?? {};

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({
                    message: "Invalid design ID.",
                });
            }

            if (
                typeof name !== "string" ||
                !name.trim() ||
                name.trim().length > 150
            ) {
                return res.status(400).json({
                    message: "Design name is required and must not exceed 150 characters.",
                });
            }

            if (!isValidDesign(design)) {
                return res.status(400).json({
                    message: "Invalid design JSON.",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, id)
                .input("name", sql.NVarChar(150), name.trim())
                .input(
                    "design",
                    sql.NVarChar(sql.MAX),
                    JSON.stringify(design)
                )
                .query(`
                    UPDATE dbo.card_templates
                    SET
                        name = @name,
                        design = @design
                    OUTPUT
                        INSERTED.id,
                        INSERTED.name,
                        INSERTED.design
                    WHERE id = @id;
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "Design not found.",
                });
            }

            const row = result.recordset[0];

            return res.status(200).json({
                message: "Design updated successfully.",
                template: {
                    id: row.id,
                    name: row.name,
                    design: JSON.parse(row.design),
                },
            });
        } catch (error) {
            console.error("Edit design error:", error);

            return res.status(500).json({
                message: "Failed to update design.",
            });
        }
    },

    deleteDesign: async (req, res) => {
        try {
            const id = Number(req.params.id);

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({
                    message: "Invalid design ID.",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("id", sql.Int, id)
                .query(`
                    DELETE FROM dbo.card_templates
                    OUTPUT DELETED.id
                    WHERE id = @id;
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "Design not found.",
                });
            }

            return res.status(200).json({
                message: "Design deleted successfully.",
                id: result.recordset[0].id,
            });
        } catch (error) {
            console.error("Delete design error:", error);

            return res.status(500).json({
                message: "Failed to delete design.",
            });
        }
    },
};

export default CardTemplateController;