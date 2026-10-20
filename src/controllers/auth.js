import { sql, poolPromise } from "../database/db.js";
const AuthController = {
    getAuthByNumber: async (req, res) => {
        try {
            const authNumber = req.body.authNumber;

            if (!Number.isInteger(Number(authNumber)) || Number(authNumber) <= 0) {
                return res.status(400).json({
                    message: "Invalid auth number",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("authNumber", sql.Int, Number(authNumber))
                .query("SELECT * FROM auth WHERE auth_number = @authNumber");

            const auth = result.recordset[0];

            if (!auth) {
                return res.status(404).json({
                    message: "auth not found",
                });
            }

            return res.status(200).json({
                message: "Get auth by number successful",
                auth,
            });
        } catch (error) {
            console.error("Get auth by ID error:", error);

            return res.status(500).json({
                message: "Get auth by ID failed",
            });
        }
    },
    getAllAuths: async (req, res) => {
        try {
            const pool = await poolPromise;

            const result = await pool
                .request()
                .query("SELECT * FROM auth");

            const auths = result.recordset;

            return res.status(200).json({
                message: "Get auths successful",
                auths,
            });
        } catch (error) {
            console.error("Get all auths error:", error);

            return res.status(500).json({
                message: "Get auths failed",
            });
        }
    },
    createAuth: async (req, res) => {
        try {
            const authNumber = req.body.authNumber;
            const authName = req.body.authName;


            if (
                authNumber === undefined ||
                authNumber === null ||
                String(authNumber).trim() === "" ||
                typeof authName !== "string" ||
                authName.trim() === ""
            ) {
                return res.status(400).json({
                    message: "Auth number and name are required",
                });
            }

            const pool = await poolPromise;
            const result = await pool
                .request()
                .input("authNumber", sql.Int, Number(authNumber))
                .input("authName", sql.NVarChar(255), authName.trim())
                .query(`
              INSERT INTO auth (auth_number, auth_name)
              OUTPUT
                INSERTED.auth_number,
                INSERTED.auth_name
                
              VALUES (@authNumber, @authName)
            `);
            return res.status(201).json({
                message: "Auth created successfully",
                auth: result.recordset[0],
            });
        } catch (error) {
            console.error("Create auth error:", error);

            if (error.number === 2627 || error.number === 2601) {
                return res.status(409).json({
                    message: "Auth number already exists",
                });
            }

            return res.status(500).json({
                message: "Failed to create auth",
            });
        }
    },
    updateAuth: async (req, res) => {
        try {
            const authNumber = req.body.authNumber;
            const authName = req.body.authName;
            if (
                authNumber === undefined ||
                authNumber === null ||
                String(authNumber).trim() === "" ||
                typeof authName !== "string" ||
                authName.trim() === ""
            ) {
                return res.status(400).json({
                    message: "Auth number and name are required",
                });
            }
            const pool = await poolPromise;
            const existingAuth = await pool
                .request()
                .input("authNumber", sql.Int, Number(authNumber))
                .query(`
        SELECT auth_number
        FROM auth
        WHERE auth_number = @authNumber
    `);

            if (existingAuth.recordset.length === 0) {
                return res.status(404).json({
                    message: "Auth not found",
                });
            }
            const result = await pool
                .request()
                .input("authNumber", sql.Int, Number(authNumber))
                .input("authName", sql.NVarChar(255), authName.trim())
                .query(`
                UPDATE auth
                SET auth_name = @authName
                OUTPUT
                    INSERTED.auth_number,
                    INSERTED.auth_name
                WHERE auth_number = @authNumber;
            `);

            return res.status(200).json({
                message: "Auth updated successfully",
                auth: result.recordset[0],
            });

        } catch (error) {
            console.error("Update auth error:", error);

            if (error.number === 2627 || error.number === 2601) {
                return res.status(409).json({
                    message: "Auth number already exists",
                });
            }

            return res.status(500).json({
                message: "Failed to update auth",
            });
        }
    }
}
export default AuthController;