function encryptPassword(plainPassword) {
    if (typeof plainPassword !== "string") {
        throw new Error("Password must be a string");
    }

    let buffer = "";

    for (let i = 0; i < plainPassword.length; i++) {
        const shift = 2 * (i + 1);
        const encryptedCharCode =
            plainPassword.charCodeAt(i) + shift;

        buffer += String.fromCharCode(encryptedCharCode);
    }

    return buffer;
}

export default encryptPassword;