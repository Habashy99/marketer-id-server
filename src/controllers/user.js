import { sql, poolPromise } from "../database/db.js";
import createUser from "../helper/createUser.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const UserController = {

    getUserById: async (req, res) => {
        try {
            const id = req.params.id ?? req.body.id;

            if (
                id === undefined ||
                id === null ||
                String(id).trim() === "" ||
                !Number.isInteger(Number(id)) ||
                Number(id) <= 0
            ) {
                return res.status(400).json({
                    message: "Invalid user ID",
                });
            }

            const pool = await poolPromise;

            const result = await pool.request()
                .input("id", sql.Int, Number(id))
                .query(`
                SELECT
                    u.id AS user_id,
                    u.code,
                    u.name,
                    u.created_at,
                    u.created_by,
                    u.updated_at,
                    u.updated_by,
                    a.auth_number AS auth_id,
                    a.auth_number,
                    a.auth_name
                FROM users AS u
                LEFT JOIN user_auth AS au
                    ON au.user_id = u.id
                LEFT JOIN auth AS a
                    ON a.auth_number = au.auth_id
                WHERE u.id = @id
                ORDER BY a.auth_number;
            `);

            if (result.recordset.length === 0) {
                return res.status(404).json({
                    message: "User not found",
                });
            }

            const firstRow = result.recordset[0];

            const user = {
                id: firstRow.user_id,
                code: firstRow.code,
                name: firstRow.name,
                createdAt: firstRow.created_at,
                createdBy: firstRow.created_by,
                updatedAt: firstRow.updated_at,
                updatedBy: firstRow.updated_by,
                auths: result.recordset
                    .filter(row => row.auth_id !== null)
                    .map(row => ({
                        authNumber: row.auth_number,
                        authName: row.auth_name,
                    })),
            };

            return res.status(200).json({
                message: "Get user with permissions successful",
                user,
            });

        } catch (error) {
            console.error("Get user with permissions error:", error);

            return res.status(500).json({
                message: "Failed to get user with permissions",
            });
        }
    },

    getAllUsers: async (req, res) => {
        try {
            const pool = await poolPromise;

            const result = await pool.request().query(`
    SELECT
        u.id AS user_id,
        u.code,
        u.name,
        u.created_at,
        u.created_by,
        u.updated_at,
        u.updated_by,
        a.auth_number AS auth_id,
        a.auth_number,
        a.auth_name
    FROM users AS u
    LEFT JOIN user_auth AS au
        ON au.user_id = u.id
    LEFT JOIN auth AS a
        ON a.auth_number = au.auth_id
    ORDER BY u.id, a.auth_number;
`);

            const usersMap = new Map();

            for (const row of result.recordset) {
                if (!usersMap.has(row.user_id)) {
                    usersMap.set(row.user_id, {
                        id: row.user_id,
                        code: row.code,
                        name: row.name,
                        createdAt: row.created_at,
                        createdBy: row.created_by,
                        updatedAt: row.updated_at,
                        updatedBy: row.updated_by,
                        auths: [],
                    });
                }

                if (row.auth_id !== null) {
                    usersMap.get(row.user_id).auths.push({
                        id: row.auth_id,
                        authNumber: row.auth_number,
                        authName: row.auth_name,
                    });
                }
            }

            return res.status(200).json({
                message: "Get users with permissions successful",
                users: Array.from(usersMap.values()),
            });

        } catch (error) {
            console.error("Get all users with permissions error:", error);

            return res.status(500).json({
                message: "Failed to get users with permissions",
            });
        }
    },

    createUser: async (req, res) => {
        try {
            const { code, name, password, createdBy } = req.body;

            if (
                code === undefined ||
                code === null ||
                String(code).trim() === "" ||
                typeof name !== "string" ||
                name.trim() === "" ||
                typeof password !== "string" ||
                password.trim() === "" ||
                createdBy === undefined ||
                createdBy === null
            ) {
                return res.status(400).json({
                    message: "Code, name, password, and createdBy are required",
                });
            }

            const user = await createUser({
                code,
                name,
                password,
                createdBy,
            });

            return res.status(201).json({
                message: "User created successfully",
                user,
            });

        } catch (error) {
            console.error("Create user error:", error);

            if (
                error.statusCode === 409 ||
                error.number === 2627 ||
                error.number === 2601
            ) {
                return res.status(409).json({
                    message: "User code already exists",
                });
            }

            if (error.number === 547) {
                return res.status(400).json({
                    message: "Invalid createdBy: user does not exist",
                });
            }

            return res.status(500).json({
                message: "Failed to create user",
            });
        }
    },

    updateUser: async (req, res) => {
        try {
            const id = req.body.id;
            const name = req.body.name;
            const password = req.body.password;
            const updatedBy = req.body.updatedBy;
            const updatedAt = new Date();
            if (
                id === undefined ||
                id === null ||
                name === undefined ||
                name === null ||
                String(name).trim() === "" ||
                typeof name !== "string" ||
                name.trim() === "" ||
                password.trim() === "" ||
                updatedBy === undefined ||
                updatedBy === null
            ) {
                return res.status(400).json({
                    message: "Id, name, password, and updatedBy are required",
                });
            }
            const pool = await poolPromise;
            const existingUser = await pool
                .request()
                .input("id", sql.Int, Number(id))
                .query("SELECT id FROM users WHERE id = @id");

            if (existingUser.recordset.length === 0) {
                return res.status(404).json({
                    message: "User not found",
                });
            }
            const passwordHash = await bcrypt.hash(password, 12);
            const result = await pool
                .request()
                .input("id", sql.Int, Number(id))
                .input("name", sql.NVarChar(255), name.trim())
                .input("passwordHash", sql.VarChar(255), passwordHash)
                .input("updatedBy", sql.Int, Number(updatedBy))
                .input("updatedAt", sql.DateTime, updatedAt)
                .query(`
                UPDATE users
                SET
                    name = @name,
                    password = @passwordHash,
                    updated_by = @updatedBy,
                    updated_at = @updatedAt
                OUTPUT
                    INSERTED.id,
                    INSERTED.code,
                    INSERTED.name,
                    INSERTED.updated_by,
                    INSERTED.updated_at
                WHERE id = @id
            `);

            return res.status(200).json({
                message: "User updated successfully",
                user: result.recordset[0],
            });

        } catch (error) {
            console.error("Update user error:", error);

            if (error.number === 547) {
                return res.status(400).json({
                    message: "Invalid updatedBy: user does not exist",
                });
            }

            return res.status(500).json({
                message: "Failed to update user",
            });
        }
    },

    signup: async (req, res) => {
        try {
            const { code, name, password, createdBy } = req.body;

            if (
                code === undefined ||
                code === null ||
                String(code).trim() === "" ||
                typeof name !== "string" ||
                name.trim() === "" ||
                typeof password !== "string" ||
                password.trim() === "" ||
                createdBy === undefined ||
                createdBy === null
            ) {
                return res.status(400).json({
                    message: "Code, name, password, and createdBy are required",
                });
            }
            const user = await createUser({
                code,
                name,
                password,
                createdBy,
            });

            const token = jwt.sign(
                { id: user.id, code: user.code },
                process.env.JWT_SECRET,
                { expiresIn: "11h" }
            );

            res.cookie("accessToken", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                maxAge: 15 * 60 * 1000,
                path: "/",
            });
            return res.status(201).json({
                message: "Signup successful",
                user,
            });
        } catch (error) {
            console.error("Signup error:", error);

            if (error.statusCode === 409 || error.number === 2627 || error.number === 2601) {
                return res.status(409).json({
                    message: "User code already exists",
                });
            }

            if (error.number === 547) {
                return res.status(400).json({
                    message: "Invalid createdBy: user does not exist",
                });
            }

            return res.status(500).json({
                message: "Signup failed",
            });
        }

    },

    login: async (req, res) => {
        try {
            const { code, password } = req.body;

            if (
                code === undefined ||
                code === null ||
                String(code).trim() === "" ||
                typeof password !== "string" ||
                password.trim() === ""
            ) {
                return res.status(400).json({
                    message: "Code and password are required",
                });
            }

            const pool = await poolPromise;

            const result = await pool
                .request()
                .input("code", sql.Int, Number(code))
                .query(`
                SELECT id, code, name, password
                FROM users
                WHERE code = @code
            `);

            const user = result.recordset[0];

            if (
                !user ||
                !(await bcrypt.compare(password, user.password))
            ) {
                return res.status(401).json({
                    message: "Invalid code or password",
                });
            }

            const token = jwt.sign(
                { id: user.id, code: user.code },
                process.env.JWT_SECRET,
                { expiresIn: "11h" }
            );

            res.cookie("accessToken", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                maxAge: 15 * 60 * 1000,
                path: "/",
            });

            return res.status(200).json({
                message: "Login successful",
                user: {
                    id: user.id,
                    code: user.code,
                    name: user.name,
                },
            });
        } catch (error) {
            console.error("Login error:", error);

            return res.status(500).json({
                message: "Login failed",
            });
        }
    },

   logout: async (req, res) => {
    res.clearCookie("accessToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
    });

    return res.status(200).json({
        message: "Logged out successfully",
    });
},
};

export default UserController;
