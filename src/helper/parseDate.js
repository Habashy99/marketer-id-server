const parseDate = (value) => {
    if (typeof value !== "string") return null;

    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

    if (!match) return null;

    const [, day, month, year] = match;

    const date = new Date(
        Date.UTC(Number(year), Number(month) - 1, Number(day))
    );

    if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() !== Number(month) - 1 ||
        date.getUTCDate() !== Number(day)
    ) {
        return null;
    }

    return date;
};

export default parseDate;