
import { retailPoolPromise, sql } from "../config/db.js";

const BATCH_SIZE = 100;
const REQUEST_TIMEOUT = 120000;

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function cleanText(value) {
    if (value === null || value === undefined) return null;

    const text = String(value).trim();

    return text.length ? text : null;
}

function fit(value, maxLength) {
    const text = cleanText(value);
    return text ? text.slice(0, maxLength) : null;
}

function isValidNationalId(value) {
    return /^\d{14}$/.test(cleanText(value) || "");
}

function parseDate(value, minYear = 1901) {
    const raw = cleanText(value);

    if (!raw) return null;

    let year;
    let month;
    let day;

    // Excel serial date
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
        const serial = Number(raw);

        if (!Number.isFinite(serial) || serial < 1 || serial > 100000) {
            return null;
        }

        const date = new Date(
            Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000
        );

        year = date.getUTCFullYear();
        month = date.getUTCMonth() + 1;
        day = date.getUTCDate();
    } else {
        // YYYY-MM-DD
        let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);

        if (match) {
            [, year, month, day] = match.map(Number);
        } else {
            // DD/MM/YYYY or DD-MM-YYYY
            match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);

            if (!match) return null;

            day = Number(match[1]);
            month = Number(match[2]);
            year = Number(match[3]);
        }
    }

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        year < minYear ||
        year > 2026 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31
    ) {
        return null;
    }

    const date = new Date(Date.UTC(year, month - 1, day));

    // Reject impossible dates such as 31/06/2005.
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return date;
}

function parseMoney(value) {
    const raw = cleanText(value);

    if (!raw) return null;

    let normalized = raw;

    // Arabic decimal separator used in the source:
    // 85ر75 => 85.75
    if (/^\d+ر\d+$/.test(raw)) {
        normalized = raw.replace("ر", ".");
    }

    // Reject ambiguous formats, formulas, commas and composite values.
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
        return null;
    }

    const amount = Number(normalized);

    if (
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > 9999999999999999
    ) {
        return null;
    }

    return Number(amount.toFixed(2));
}

function combineNotes(...values) {
    const notes = values
        .map(cleanText)
        .filter(Boolean);

    return notes.length ? notes.join("\n") : null;
}

function createRequest(transaction) {
    const request = new sql.Request(transaction);
    request.timeout = REQUEST_TIMEOUT;
    return request;
}

async function insertBatch(
    transaction,
    tableName,
    columns,
    rows,
    types
) {
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
        const batch = rows.slice(start, start + BATCH_SIZE);
        const request = createRequest(transaction);

        const values = batch.map((row, rowIndex) => {
            const placeholders = row.map((value, columnIndex) => {
                const parameter = `p_${rowIndex}_${columnIndex}`;

                request.input(
                    parameter,
                    types[columnIndex],
                    value
                );

                return `@${parameter}`;
            });

            return `(${placeholders.join(", ")})`;
        });

        const query = `
            INSERT INTO dbo.${tableName}
                (${columns.join(", ")})
            VALUES
                ${values.join(", ")};
        `;

        await request.query(query);
    }
}

// --------------------------------------------------
// Main migration
// --------------------------------------------------

async function migrateSecurityData() {
    const pool = await retailPoolPromise;
    const transaction = new sql.Transaction(pool);

    let transactionStarted = false;

    try {
        console.log("Starting security data migration...");

        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        transactionStarted = true;

        // --------------------------------------------------
        // 1. Protect existing final tables
        // --------------------------------------------------

        const countsResult = await createRequest(transaction).query(`
            SELECT
                (SELECT COUNT(*) FROM dbo.security_persons) AS persons,
                (SELECT COUNT(*) FROM dbo.security_incidents) AS incidents,
                (SELECT COUNT(*) FROM dbo.security_permits) AS permits,
                (SELECT COUNT(*) FROM dbo.security_status_history) AS history;
        `);

        const counts = countsResult.recordset[0];

        if (
            counts.persons ||
            counts.incidents ||
            counts.permits ||
            counts.history
        ) {
            throw new Error(
                "Final security tables are not empty. Migration stopped to prevent duplicate or mixed data."
            );
        }

        // --------------------------------------------------
        // 2. Read original staging records
        // --------------------------------------------------

        console.log("Reading original import tables...");

        const incidentsResult = await createRequest(transaction).query(`
            SELECT
                source_record_number,
                name,
                birth_place,
                birth_date,
                national_id_number,
                branch,
                incident_notes,
                stolen_goods,
                stolen_goods_value,
                incident_date,
                notes
            FROM dbo.security_incidents_import;
        `);

        const permitsResult = await createRequest(transaction).query(`
            SELECT
                source_record_number,
                permit_number,
                name,
                birth_date,
                birth_place,
                id_card_number,
                company_name,
                issue_date,
                branch,
                notes
            FROM dbo.security_permits_import;
        `);

        const incidents = incidentsResult.recordset;
        const permits = permitsResult.recordset;

        console.log(`Incident source records: ${incidents.length}`);
        console.log(`Permit source records: ${permits.length}`);

        // --------------------------------------------------
        // 3. Identify valid IDs and name conflicts
        // --------------------------------------------------

        const recordsById = new Map();

        function registerPerson(source, record, idValue) {
            const nationalId = cleanText(idValue);
            const name = cleanText(record.name);

            if (!isValidNationalId(nationalId) || !name) {
                return;
            }

            if (!recordsById.has(nationalId)) {
                recordsById.set(nationalId, []);
            }

            recordsById.get(nationalId).push({
                source,
                record,
                name,
            });
        }

        for (const record of incidents) {
            registerPerson(
                "incident",
                record,
                record.national_id_number
            );
        }

        for (const record of permits) {
            registerPerson(
                "permit",
                record,
                record.id_card_number
            );
        }

        const personsToInsert = [];
        const conflictedIds = new Set();

        for (const [nationalId, records] of recordsById) {
            const distinctNames = new Set(
                records.map((item) => item.name)
            );

            // Do not automatically group IDs with different names.
            if (distinctNames.size > 1) {
                conflictedIds.add(nationalId);
                continue;
            }

            const firstRecord = records[0];

            const birthDateRecord = records.find((item) =>
                parseDate(item.record.birth_date, 1900)
            );

            const birthPlaceRecord = records.find((item) =>
                cleanText(item.record.birth_place)
            );

            // Same ID and same name: one final person.
            personsToInsert.push({
                nationalId,
                name: firstRecord.name,
                birthDate: birthDateRecord
                    ? parseDate(birthDateRecord.record.birth_date, 1900)
                    : null,
                birthPlace: birthPlaceRecord
                    ? fit(birthPlaceRecord.record.birth_place, 150)
                    : null,
            });
        }

        console.log(`Valid distinct IDs: ${recordsById.size}`);
        console.log(`Conflicting IDs excluded: ${conflictedIds.size}`);
        console.log(`Persons to create: ${personsToInsert.length}`);

        // --------------------------------------------------
        // 4. Insert persons
        // --------------------------------------------------

        console.log("Inserting security persons...");

        const personRows = personsToInsert.map((person) => [
            fit(person.name, 255),
            person.nationalId,
            person.birthDate,
            person.birthPlace,
            null, // security_situation remains unassigned
            null, // notes
        ]);

        await insertBatch(
            transaction,
            "security_persons",
            [
                "name",
                "national_id_number",
                "birth_date",
                "birth_place",
                "security_situation",
                "notes",
            ],
            personRows,
            [
                sql.NVarChar(255),
                sql.NVarChar(50),
                sql.Date,
                sql.NVarChar(150),
                sql.NVarChar(50),
                sql.NVarChar(sql.MAX),
            ]
        );

        // --------------------------------------------------
        // 5. Load generated person IDs
        // --------------------------------------------------

        console.log("Building person ID map...");

        const personIdMap = new Map();

        for (
            let start = 0;
            start < personsToInsert.length;
            start += 1000
        ) {
            const batch = personsToInsert.slice(start, start + 1000);
            const request = createRequest(transaction);

            const parameters = batch.map((person, index) => {
                const parameter = `id_${index}`;

                request.input(
                    parameter,
                    sql.NVarChar(50),
                    person.nationalId
                );

                return `@${parameter}`;
            });

            const result = await request.query(`
                SELECT id, national_id_number
                FROM dbo.security_persons
                WHERE national_id_number IN (${parameters.join(", ")});
            `);

            for (const person of result.recordset) {
                personIdMap.set(
                    person.national_id_number,
                    person.id
                );
            }
        }

        if (personIdMap.size !== personsToInsert.length) {
            throw new Error(
                "Could not map all inserted persons. Migration cancelled."
            );
        }

        // --------------------------------------------------
        // 6. Prepare incident records
        // --------------------------------------------------

        console.log("Preparing incidents...");

        let skippedIncidentRecords = 0;
        let invalidIncidentDates = 0;
        let invalidIncidentValues = 0;

        const incidentRows = [];

        for (const record of incidents) {
            const nationalId = cleanText(record.national_id_number);

            if (
                !isValidNationalId(nationalId) ||
                conflictedIds.has(nationalId)
            ) {
                skippedIncidentRecords++;
                continue;
            }

            const personId = personIdMap.get(nationalId);

            if (!personId) {
                skippedIncidentRecords++;
                continue;
            }

            const incidentDate = parseDate(record.incident_date);
            const stolenGoodsValue = parseMoney(
                record.stolen_goods_value
            );

            if (cleanText(record.incident_date) && !incidentDate) {
                invalidIncidentDates++;
            }

            if (
                cleanText(record.stolen_goods_value) &&
                stolenGoodsValue === null
            ) {
                invalidIncidentValues++;
            }

            incidentRows.push([
                personId,
                fit(record.branch, 255),
                cleanText(record.stolen_goods),
                stolenGoodsValue,
                incidentDate,
                combineNotes(
                    record.incident_notes,
                    record.notes
                ),
            ]);
        }

        // --------------------------------------------------
        // 7. Prepare permit records
        // --------------------------------------------------

        console.log("Preparing permits...");

        let skippedPermitRecords = 0;
        let invalidPermitDates = 0;

        const permitRows = [];

        for (const record of permits) {
            const nationalId = cleanText(record.id_card_number);

            if (
                !isValidNationalId(nationalId) ||
                conflictedIds.has(nationalId)
            ) {
                skippedPermitRecords++;
                continue;
            }

            const personId = personIdMap.get(nationalId);

            if (!personId) {
                skippedPermitRecords++;
                continue;
            }

            const issueDate = parseDate(record.issue_date);

            if (cleanText(record.issue_date) && !issueDate) {
                invalidPermitDates++;
            }

            permitRows.push([
                personId,
                fit(record.permit_number, 50),
                fit(record.company_name, 255),
                issueDate,
                fit(record.branch, 255),
                cleanText(record.notes),
            ]);
        }

        // --------------------------------------------------
        // 8. Insert incidents
        // --------------------------------------------------

        console.log(`Inserting ${incidentRows.length} incidents...`);

        await insertBatch(
            transaction,
            "security_incidents",
            [
                "security_person_id",
                "branch",
                "stolen_goods",
                "stolen_goods_value",
                "incident_date",
                "notes",
            ],
            incidentRows,
            [
                sql.Int,
                sql.NVarChar(255),
                sql.NVarChar(sql.MAX),
                sql.Decimal(18, 2),
                sql.Date,
                sql.NVarChar(sql.MAX),
            ]
        );

        // --------------------------------------------------
        // 9. Insert permits
        // --------------------------------------------------

        console.log(`Inserting ${permitRows.length} permits...`);

        await insertBatch(
            transaction,
            "security_permits",
            [
                "security_person_id",
                "permit_number",
                "company_name",
                "issue_date",
                "branch",
                "notes",
            ],
            permitRows,
            [
                sql.Int,
                sql.NVarChar(50),
                sql.NVarChar(255),
                sql.Date,
                sql.NVarChar(255),
                sql.NVarChar(sql.MAX),
            ]
        );

        // --------------------------------------------------
        // 10. Verify final counts before commit
        // --------------------------------------------------

        const finalResult = await createRequest(transaction).query(`
            SELECT
                (SELECT COUNT(*) FROM dbo.security_persons) AS persons,
                (SELECT COUNT(*) FROM dbo.security_incidents) AS incidents,
                (SELECT COUNT(*) FROM dbo.security_permits) AS permits,
                (SELECT COUNT(*) FROM dbo.security_status_history) AS history;
        `);

        const finalCounts = finalResult.recordset[0];

        if (
            finalCounts.persons !== personsToInsert.length ||
            finalCounts.incidents !== incidentRows.length ||
            finalCounts.permits !== permitRows.length
        ) {
            throw new Error(
                "Final row counts do not match expected counts. Migration cancelled."
            );
        }

        await transaction.commit();
        transactionStarted = false;

        console.log("\n==================================");
        console.log("SECURITY MIGRATION COMPLETED");
        console.log("==================================");
        console.log("Final persons:", finalCounts.persons);
        console.log("Final incidents:", finalCounts.incidents);
        console.log("Final permits:", finalCounts.permits);
        console.log("Status history:", finalCounts.history);
        console.log("----------------------------------");
        console.log("Conflicting IDs excluded:", conflictedIds.size);
        console.log("Skipped incident records:", skippedIncidentRecords);
        console.log("Skipped permit records:", skippedPermitRecords);
        console.log("Invalid incident dates:", invalidIncidentDates);
        console.log("Invalid permit dates:", invalidPermitDates);
        console.log("Invalid incident values:", invalidIncidentValues);
        console.log("----------------------------------");
        console.log("Original import tables were not modified.");
        console.log("Coordinator tables were not modified.");
        console.log("==================================\n");
    } catch (error) {
        if (transactionStarted) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error("Rollback error:", rollbackError.message);
            }
        }

        console.error("\nSECURITY MIGRATION FAILED");
        console.error(error);

        throw error;
    }
}

migrateSecurityData()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
