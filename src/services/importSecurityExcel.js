
import XlsxPopulate from "xlsx-populate";
import { retailPoolPromise, sql } from "../config/db.js";

const BATCH_SIZE = 100;
const REQUEST_TIMEOUT = 120000;

// --------------------------------------------------
// EXCEL VALUE HELPERS
// --------------------------------------------------

function toText(value) {
    if (value === undefined || value === null) {
        return null;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    const result = String(value);

    return result.trim() === "" ? null : result;
}

function getSheetRows(workbook, sheetName) {
    const sheet = workbook.sheet(sheetName);

    if (!sheet) {
        throw new Error(`Worksheet "${sheetName}" was not found.`);
    }

    const range = sheet.usedRange();

    if (!range) {
        return [];
    }

    const rows = range.value();

    return Array.isArray(rows) ? rows : [];
}

function isEmptyRow(row, columnCount) {
    return row
        .slice(0, columnCount)
        .every(
            (value) =>
                value === undefined ||
                value === null ||
                String(value).trim() === ""
        );
}

// --------------------------------------------------
// INCIDENT EXCEL MAPPING
// --------------------------------------------------

function buildIncidentRows(rows) {
    const result = [];

    for (let index = 1; index < rows.length; index++) {
        const row = rows[index] ?? [];

        if (isEmptyRow(row, 11)) {
            continue;
        }

        result.push({
            source_record_number: toText(row[0]),
            name: toText(row[1]),
            birth_place: toText(row[2]),
            birth_date: toText(row[3]),
            national_id_number: toText(row[4]),
            branch: toText(row[5]),
            incident_notes: toText(row[6]),
            stolen_goods: toText(row[7]),
            stolen_goods_value: toText(row[8]),
            incident_date: toText(row[9]),
            notes: toText(row[10]),
            source_excel_row: index + 1,
        });
    }

    return result;
}

// --------------------------------------------------
// PERMITS EXCEL MAPPING
// --------------------------------------------------

function buildPermitRows(rows) {
    const result = [];

    for (let index = 1; index < rows.length; index++) {
        const row = rows[index] ?? [];

        if (isEmptyRow(row, 9)) {
            continue;
        }

        result.push({
            source_record_number: String(index + 1),
            permit_number: toText(row[0]),
            name: toText(row[1]),
            birth_date: toText(row[2]),
            birth_place: toText(row[3]),
            id_card_number: toText(row[4]),
            company_name: toText(row[5]),
            issue_date: toText(row[6]),
            branch: toText(row[7]),
            notes: toText(row[8]),
            source_excel_row: index + 1,
        });
    }

    return result;
}

// --------------------------------------------------
// SQL COLUMN DEFINITIONS
// --------------------------------------------------

const incidentColumns = [
    {
        name: "source_record_number",
        type: sql.NVarChar(100),
        maxLength: 100,
    },
    {
        name: "name",
        type: sql.NVarChar(255),
        maxLength: 255,
    },
    {
        name: "birth_place",
        type: sql.NVarChar(150),
        maxLength: 150,
    },
    {
        name: "birth_date",
        type: sql.NVarChar(50),
        maxLength: 50,
    },
    {
        name: "national_id_number",
        type: sql.NVarChar(sql.MAX),
    },
    {
        name: "branch",
        type: sql.NVarChar(255),
        maxLength: 255,
    },
    {
        name: "incident_notes",
        type: sql.NVarChar(sql.MAX),
    },
    {
        name: "stolen_goods",
        type: sql.NVarChar(sql.MAX),
    },
    {
        name: "stolen_goods_value",
        type: sql.NVarChar(100),
        maxLength: 100,
    },
    {
        name: "incident_date",
        type: sql.NVarChar(sql.MAX),
    },
    {
        name: "notes",
        type: sql.NVarChar(sql.MAX),
    },
    {
        name: "source_excel_row",
        type: sql.Int,
    },
];

const permitColumns = [
    {
        name: "source_record_number",
        type: sql.NVarChar(100),
        maxLength: 100,
    },
    {
        name: "permit_number",
        type: sql.NVarChar(100),
        maxLength: 100,
    },
    {
        name: "name",
        type: sql.NVarChar(255),
        maxLength: 255,
    },
    {
        name: "birth_date",
        type: sql.NVarChar(50),
        maxLength: 50,
    },
    {
        name: "birth_place",
        type: sql.NVarChar(150),
        maxLength: 150,
    },
    {
        name: "id_card_number",
        type: sql.NVarChar(100),
        maxLength: 100,
    },
    {
        name: "company_name",
        type: sql.NVarChar(255),
        maxLength: 255,
    },
    {
        name: "issue_date",
        type: sql.NVarChar(50),
        maxLength: 50,
    },
    {
        name: "branch",
        type: sql.NVarChar(255),
        maxLength: 255,
    },
    {
        name: "notes",
        type: sql.NVarChar(sql.MAX),
    },
    {
        name: "source_excel_row",
        type: sql.Int,
    },
];

// --------------------------------------------------
// VALIDATE FIELD LENGTHS
// --------------------------------------------------

function validateRecords(records, columns, tableName) {
    const errors = [];

    for (const record of records) {
        for (const column of columns) {
            if (column.maxLength === undefined) {
                continue;
            }

            const value = record[column.name];

            if (
                value !== null &&
                value !== undefined &&
                String(value).length > column.maxLength
            ) {
                errors.push({
                    table: tableName,
                    excelRow: record.source_excel_row,
                    column: column.name,
                    actualLength: String(value).length,
                    maximumLength: column.maxLength,
                    value: String(value).slice(0, 150),
                });
            }
        }
    }

    if (errors.length > 0) {
        console.error(`Found ${errors.length} oversized values:`);
        console.table(errors.slice(0, 30));

        throw new Error(
            `${tableName}: ${errors.length} values exceed SQL column lengths. ` +
            "No SQL transaction was started."
        );
    }
}

// --------------------------------------------------
// PARAMETERIZED BATCH INSERT
// --------------------------------------------------

async function insertBatch(transaction, tableName, columns, records) {
    if (records.length === 0) {
        return;
    }

    const request = new sql.Request(transaction);
    request.timeout = REQUEST_TIMEOUT;

    const columnNames = columns
        .map((column) => `[${column.name}]`)
        .join(", ");

    const valueGroups = [];

    for (let rowIndex = 0; rowIndex < records.length; rowIndex++) {
        const record = records[rowIndex];
        const placeholders = [];

        for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
            const column = columns[columnIndex];
            const parameterName = `p${rowIndex}_${columnIndex}`;

            request.input(
                parameterName,
                column.type,
                record[column.name] ?? null
            );

            placeholders.push(`@${parameterName}`);
        }

        valueGroups.push(`(${placeholders.join(", ")})`);
    }

    const query = `
        INSERT INTO ${tableName} (${columnNames})
        VALUES ${valueGroups.join(", ")};
    `;

    await request.query(query);
}

// --------------------------------------------------
// CHECK STAGING TABLES
// --------------------------------------------------

async function ensureStagingTablesAreEmpty(transaction) {
    const incidentResult = await new sql.Request(transaction).query(`
        SELECT COUNT_BIG(*) AS total
        FROM dbo.security_incidents_import;
    `);

    const permitResult = await new sql.Request(transaction).query(`
        SELECT COUNT_BIG(*) AS total
        FROM dbo.security_permits_import;
    `);

    const incidentsCount = Number(incidentResult.recordset[0].total);
    const permitsCount = Number(permitResult.recordset[0].total);

    if (incidentsCount > 0 || permitsCount > 0) {
        throw new Error(
            "Import cancelled: staging tables are not empty. " +
            `Incidents: ${incidentsCount}, Permits: ${permitsCount}.`
        );
    }
}

// --------------------------------------------------
// IMPORT RECORDS IN BATCHES
// --------------------------------------------------

async function importRecords(
    transaction,
    records,
    columns,
    tableName,
    label
) {
    for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
        const batch = records.slice(offset, offset + BATCH_SIZE);

        await insertBatch(
            transaction,
            tableName,
            columns,
            batch
        );

        const completed = Math.min(
            offset + batch.length,
            records.length
        );

        console.log(`${label}: ${completed} / ${records.length}`);
    }
}

// --------------------------------------------------
// MAIN IMPORT FUNCTION
// --------------------------------------------------

async function importSecurityExcel() {
    const incidentsPath =
        process.env.SECURITY_INCIDENTS_EXCEL_PATH ||
        "D:\\security2.xlsx";

    const permitsPath =
        process.env.SECURITY_PERMITS_EXCEL_PATH ||
        "D:\\مندوبين.xlsx";

    const incidentsPassword =
        process.env.SECURITY_INCIDENTS_EXCEL_PASSWORD;

    if (!incidentsPassword) {
        throw new Error(
            "SECURITY_INCIDENTS_EXCEL_PASSWORD is missing."
        );
    }

    console.log("Reading security incidents workbook...");

    const incidentsWorkbook = await XlsxPopulate.fromFileAsync(
        incidentsPath,
        { password: incidentsPassword }
    );

    const incidentSheetRows = getSheetRows(
        incidentsWorkbook,
        "Chart1"
    );

    const incidents = buildIncidentRows(incidentSheetRows);

    console.log(`Prepared ${incidents.length} incident records.`);

    console.log("Reading permits workbook...");

    const permitsWorkbook = await XlsxPopulate.fromFileAsync(
        permitsPath
    );

    const permitSheetRows = getSheetRows(
        permitsWorkbook,
        "Sheet1"
    );

    const permits = buildPermitRows(permitSheetRows);

    console.log(`Prepared ${permits.length} permit records.`);

    if (incidents.length === 0 || permits.length === 0) {
        throw new Error(
            "Import cancelled: one of the workbooks contains no usable records."
        );
    }

    console.log("Validating incident field lengths...");

    validateRecords(
        incidents,
        incidentColumns,
        "security_incidents_import"
    );

    console.log("Incident records validated.");

    console.log("Validating permit field lengths...");

    validateRecords(
        permits,
        permitColumns,
        "security_permits_import"
    );

    console.log("Permit records validated.");

    const pool = await retailPoolPromise;
    const transaction = new sql.Transaction(pool);

    let transactionStarted = false;

    try {
        console.log("Starting SQL Server transaction...");

        await transaction.begin(
            sql.ISOLATION_LEVEL.READ_COMMITTED
        );

        transactionStarted = true;

        await ensureStagingTablesAreEmpty(transaction);

        console.log("Importing incidents...");

        await importRecords(
            transaction,
            incidents,
            incidentColumns,
            "dbo.security_incidents_import",
            "Incidents"
        );

        console.log("Importing permits...");

        await importRecords(
            transaction,
            permits,
            permitColumns,
            "dbo.security_permits_import",
            "Permits"
        );

        await transaction.commit();
        transactionStarted = false;

        console.log("\n======================================");
        console.log("SECURITY EXCEL IMPORT COMPLETED");
        console.log("======================================");

        console.log(`Incidents imported: ${incidents.length}`);
        console.log(`Permits imported: ${permits.length}`);
        console.log("Both staging tables were populated successfully.");
    } catch (error) {
        if (transactionStarted) {
            try {
                await transaction.rollback();
                console.log("SQL transaction rolled back successfully.");
            } catch (rollbackError) {
                console.error(
                    "Rollback also failed:",
                    rollbackError.message
                );
            }

            transactionStarted = false;
        }

        console.error("Import failed.");
        throw error;
    }
}

// --------------------------------------------------
// EXECUTION
// --------------------------------------------------

importSecurityExcel().catch((error) => {
    console.error("\nSECURITY IMPORT ERROR:");
    console.error(error);

    process.exitCode = 1;
});
