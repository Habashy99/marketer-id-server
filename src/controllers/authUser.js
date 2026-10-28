
import { sql, poolPromise } from "../config/db.js";
import getUserIdByCode from "../helper/getUserIdByCode.js";

const AuthUserController = {
    createAuthUser: async (req, res) => {
        let transaction;

        try {
            const { code, authIds } = req.body;
            const userCode = Number(code);

            if (
                code == null ||
                String(code).trim() === "" ||
                !Number.isInteger(userCode) ||
                userCode <= 0 ||
                !Array.isArray(authIds) ||
                authIds.length === 0
            ) {
                return res.status(400).json({
                    message: "A valid user code and non-empty authIds array are required.",
                });
            }

            const permissionIds = authIds.map(Number);

            if (
                permissionIds.some(
                    (id) => !Number.isInteger(id) || id <= 0
                ) ||
                new Set(permissionIds).size !== permissionIds.length
            ) {
                return res.status(400).json({
                    message: "authIds must contain unique positive integers.",
                });
            }

            const pool = await poolPromise;

            const userResult = await pool.request()
                .input("code", sql.Int, userCode)
                .query(`
                SELECT id, type
                FROM dbo.users
                WHERE code = @code;
            `);

            const user = userResult.recordset[0];

            if (!user) {
                return res.status(404).json({ message: "User not found." });
            }

            if (user.type?.toLowerCase() === "admin") {
                return res.status(400).json({
                    message: "Admins automatically have all permissions.",
                });
            }

            if (user.type?.toLowerCase() !== "user") {
                return res.status(400).json({
                    message: "Invalid user type.",
                });
            }

            // Validate that every requested permission exists.
            const permissionParams = permissionIds
                .map((_, index) => `@auth${index}`)
                .join(", ");

            const permissionRequest = pool.request();

            permissionIds.forEach((id, index) => {
                permissionRequest.input(`auth${index}`, sql.Int, id);
            });

            const authResult = await permissionRequest.query(`
            SELECT auth_number
            FROM dbo.auth
            WHERE auth_number IN (${permissionParams});
        `);

            if (authResult.recordset.length !== permissionIds.length) {
                return res.status(400).json({
                    message: "One or more permissions do not exist.",
                });
            }

            transaction = new sql.Transaction(pool);
            await transaction.begin();

            const assigned = [];
            const alreadyAssigned = [];

            for (const permissionId of permissionIds) {
                const request = new sql.Request(transaction);

                const result = await request
                    .input("userId", sql.Int, user.id)
                    .input("authId", sql.Int, permissionId)
                    .query(`
                    IF EXISTS (
                        SELECT 1
                        FROM dbo.user_auth
                        WHERE user_id = @userId
                          AND auth_id = @authId
                    )
                    BEGIN
                        SELECT CAST(0 AS bit) AS inserted;
                    END
                    ELSE
                    BEGIN
                        INSERT INTO dbo.user_auth (user_id, auth_id)
                        VALUES (@userId, @authId);

                        SELECT CAST(1 AS bit) AS inserted;
                    END;
                `);

                if (result.recordset[0].inserted) {
                    assigned.push(permissionId);
                } else {
                    alreadyAssigned.push(permissionId);
                }
            }

            await transaction.commit();

            return res.status(200).json({
                message: "Permission assignment completed.",
                assigned,
                alreadyAssigned,
                totalAssigned: assigned.length,
            });
        } catch (error) {
            if (transaction) {
                try {
                    await transaction.rollback();
                } catch {
                    // The transaction may already have been rolled back.
                }
            }

            console.error("Create user permissions error:", error);

            return res.status(500).json({
                message: "Failed to assign permissions.",
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
            const { code, authIds } = req.body;
            const userCode = Number(code);

            if (
                code == null ||
                String(code).trim() === "" ||
                !Number.isInteger(userCode) ||
                userCode <= 0 ||
                !Array.isArray(authIds) ||
                authIds.length === 0
            ) {
                return res.status(400).json({
                    message: "A valid user code and non-empty authIds array are required.",
                });
            }

            const permissionIds = authIds.map(Number);

            if (
                permissionIds.some(
                    (id) => !Number.isInteger(id) || id <= 0
                ) ||
                new Set(permissionIds).size !== permissionIds.length
            ) {
                return res.status(400).json({
                    message: "authIds must contain unique positive integers.",
                });
            }

            const userId = await getUserIdByCode(userCode);

            if (userId == null) {
                return res.status(404).json({ message: "User not found." });
            }

            const pool = await poolPromise;
            const request = pool.request().input("userId", sql.Int, userId);

            const placeholders = permissionIds.map((id, index) => {
                request.input(`auth${index}`, sql.Int, id);
                return `@auth${index}`;
            });

            const result = await request.query(`
            DELETE FROM dbo.user_auth
            OUTPUT
                DELETED.id,
                DELETED.user_id,
                DELETED.auth_id
            WHERE user_id = @userId
              AND auth_id IN (${placeholders.join(", ")});
        `);

            const removedIds = result.recordset.map(
                (assignment) => assignment.auth_id
            );

            const notAssigned = permissionIds.filter(
                (id) => !removedIds.includes(id)
            );

            return res.status(200).json({
                message: "Permission removal completed.",
                removed: removedIds,
                notAssigned,
                totalRemoved: removedIds.length,
            });
        } catch (error) {
            console.error("Delete user permissions error:", error);

            return res.status(500).json({
                message: "Failed to remove permissions.",
            });
        }
    },
};

export default AuthUserController;
