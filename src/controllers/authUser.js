
import { sql, poolPromise } from "../config/db.js";
import getUserIdByCode from "../helper/getUserIdByCode.js";

const AuthUserController = {
    createAuthUser: async (req, res) => {
        try {
            const { authId, code } = req.body;

            if (
                !Number.isInteger(code) || code <= 0 ||
                !Number.isInteger(authId) || authId <= 0
            ) {
                return res.status(400).json({
                    message: "Valid code and authId are required",
                });
            }

            const userId = await getUserIdByCode(code);

            if (userId === null) {
                return res.status(404).json({
                    message: "User not found",
                });
            }

            const pool = await poolPromise;

            const existing = await pool.request()
                .input("userId", sql.Int, userId)
                .input("authId", sql.Int, authId)
                .query(`
                    SELECT id
                    FROM dbo.user_auth
                    WHERE user_id = @userId
                      AND auth_id = @authId;
                `);

            if (existing.recordset.length > 0) {
                return res.status(409).json({
                    message: "Permission is already assigned to this user",
                });
            }

            const result = await pool.request()
                .input("userId", sql.Int, userId)
                .input("authId", sql.Int, authId)
                .query(`
                    INSERT INTO dbo.user_auth (user_id, auth_id)
                    OUTPUT
                        INSERTED.id,
                        INSERTED.user_id,
                        INSERTED.auth_id
                    VALUES (@userId, @authId);
                `);

            return res.status(201).json({
                message: "Permission assigned successfully",
                assignment: result.recordset[0],
            });
        } catch (error) {
            console.error("Create user permission error:", error);

            if (error.number === 547) {
                return res.status(400).json({
                    message: "User or permission does not exist",
                });
            }

            if (error.number === 2627 || error.number === 2601) {
                return res.status(409).json({
                    message: "Permission is already assigned to this user",
                });
            }

            return res.status(500).json({
                message: "Failed to assign permission",
            });
        }
    },

    updateAuthUser: async (req, res) => {
        try {
            const { id, userId, authId } = req.body;

            if (
                !Number.isInteger(id) || id <= 0 ||
                !Number.isInteger(userId) || userId <= 0 ||
                !Number.isInteger(authId) || authId <= 0
            ) {
                return res.status(400).json({
                    message: "Valid id, userId, and authId are required",
                });
            }

            const pool = await poolPromise;

            const existing = await pool.request()
                .input("id", sql.Int, id)
                .input("userId", sql.Int, userId)
                .input("authId", sql.Int, authId)
                .query(`
                    SELECT id
                    FROM dbo.user_auth
                    WHERE user_id = @userId
                      AND auth_id = @authId
                      AND id <> @id;
                `);

            if (existing.recordset.length > 0) {
                return res.status(409).json({
                    message: "Permission is already assigned to this user",
                });
            }

            const result = await pool.request()
                .input("id", sql.Int, id)
                .input("userId", sql.Int, userId)
                .input("authId", sql.Int, authId)
                .query(`
                    UPDATE dbo.user_auth
                    SET user_id = @userId,
                        auth_id = @authId
                    OUTPUT
                        INSERTED.id,
                        INSERTED.user_id,
                        INSERTED.auth_id
                    WHERE id = @id;
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "Permission assignment not found",
                });
            }

            return res.status(200).json({
                message: "Permission assignment updated successfully",
                assignment: result.recordset[0],
            });
        } catch (error) {
            console.error("Update user permission error:", error);

            if (error.number === 547) {
                return res.status(400).json({
                    message: "User or permission does not exist",
                });
            }

            if (error.number === 2627 || error.number === 2601) {
                return res.status(409).json({
                    message: "Permission is already assigned to this user",
                });
            }

            return res.status(500).json({
                message: "Failed to update permission assignment",
            });
        }
    },

    deleteAuthUser: async (req, res) => {
        try {
            const { code, authId } = req.body;

            const userCode = Number(code);
            const permissionId = Number(authId);

            if (
                code === undefined ||
                code === null ||
                String(code).trim() === "" ||
                !Number.isInteger(userCode) ||
                userCode <= 0 ||
                authId === undefined ||
                authId === null ||
                !Number.isInteger(permissionId) ||
                permissionId <= 0
            ) {
                return res.status(400).json({
                    message: "A valid user code and permission type are required",
                });
            }

            const userId = await getUserIdByCode(userCode);

            if (userId === null) {
                return res.status(404).json({
                    message: "User not found",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("userId", sql.Int, userId)
                .input("authId", sql.Int, permissionId)
                .query(`
                DELETE FROM dbo.user_auth
                OUTPUT
                    DELETED.id,
                    DELETED.user_id,
                    DELETED.auth_id
                WHERE user_id = @userId
                  AND auth_id = @authId;
            `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "This permission is not assigned to the user",
                });
            }

            return res.status(200).json({
                message: "Permission removed successfully",
                assignment: result.recordset[0],
            });
        } catch (error) {
            console.error("Delete user permission error:", error);

            return res.status(500).json({
                message: "Failed to remove permission",
            });
        }
    },
};

export default AuthUserController;
