
import { sql, poolPromise } from "../database/db.js";
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

            const result = await pool.request()
                .input("userId", sql.Int, userId)
                .input("authId", sql.Int, authId)
                .query(`
                    INSERT INTO user_auth (user_id, auth_id)
        OUTPUT
            INSERTED.id,
            INSERTED.user_id,
            INSERTED.auth_id
        VALUES (@userId, @authId);
                `);

            if (result.recordset.length === 0) {
                return res.status(409).json({
                    message: "Permission is already assigned to this user",
                });
            }

            return res.status(201).json({
                message: "Permission assigned successfully",
                assignment: result.recordset[0],
            });

        } catch (error) {
            console.error(error);

            if (error.number === 547) {
                return res.status(400).json({
                    message: "User or permission does not exist",
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

            const result = await pool.request()
                .input("id", sql.Int, id)
                .input("userId", sql.Int, userId)
                .input("authId", sql.Int, authId)
                .query(`
                    UPDATE user_auth
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
            console.error(error);

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
            const { id } = req.body;

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({
                    message: "A valid assignment id is required",
                });
            }

            const pool = await poolPromise;

            const result = await pool.request()
                .input("id", sql.Int, id)
                .query(`
                    DELETE FROM user_auth
                    OUTPUT
                        DELETED.id,
                        DELETED.user_id,
                        DELETED.auth_id
                    WHERE id = @id;
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "Permission assignment not found",
                });
            }

            return res.status(200).json({
                message: "Permission removed successfully",
                assignment: result.recordset[0],
            });

        } catch (error) {
            console.error(error);

            return res.status(500).json({
                message: "Failed to remove permission",
            });
        }
    },
};

export default AuthUserController;
