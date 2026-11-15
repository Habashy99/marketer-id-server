
import "dotenv/config";
import XlsxPopulate from "xlsx-populate";
import { retailPoolPromise, sql } from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const EXCEL_PATH =
  process.env.SECURITY_INCIDENTS_EXCEL_PATH || "D:/security2.xlsx";

const EXCEL_PASSWORD =
  process.env.SECURITY_INCIDENTS_EXCEL_PASSWORD || undefined;

const SHEET_NAME = "Chart1";
const IMPORT_LIMIT = 35;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function cleanText(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "object") return null;

  const text = String(value).trim();

  return text.length ? text : null;
}

function normalizeArabicDigits(value) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

  return String(value)
    .replace(/[٠-٩]/g, (d) => arabicDigits.indexOf(d))
    .replace(/[۰-۹]/g, (d) => persianDigits.indexOf(d));
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  // Excel serial date
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(
      Date.UTC(1899, 11, 30) + value * 86400000
    );

    return date.toISOString().slice(0, 10);
  }

  let text = normalizeArabicDigits(value).trim();

  if (!text) return null;

  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);

  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);

    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // yyyy-mm-dd
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);

    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

function normalizeNationalId(value) {
  const text = normalizeArabicDigits(value || "")
    .replace(/\s/g, "")
    .trim();

  return /^\d{14}$/.test(text) ? text : null;
}

function normalizeMoney(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  let text = normalizeArabicDigits(value)
    .replace(/٬/g, "")
    .replace(/٫/g, ".")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");

  if (!text || text === "-" || text === ".") return null;

  const number = Number(text);

  return Number.isFinite(number) ? number : null;
}

function combineNotes(first, second) {
  const values = [cleanText(first), cleanText(second)].filter(Boolean);

  return values.length ? values.join("\n\n") : null;
}

function mapExcelRow(row, excelRowNumber) {
  return {
    sourceRecordNumber: cleanText(row[0]),
    name: cleanText(row[1]),
    birthPlace: cleanText(row[2]),
    birthDate: normalizeDate(row[3]),
    nationalId: normalizeNationalId(row[4]),
    branch: cleanText(row[5]),
    notes: combineNotes(row[6], row[10]),
    stolenGoods: cleanText(row[7]),
    stolenGoodsValue: normalizeMoney(row[8]),
    incidentDate: normalizeDate(row[9]),
    excelRowNumber,
  };
}

/* -------------------------------------------------------------------------- */
/* Person matching / insertion                                                */
/* -------------------------------------------------------------------------- */

async function findOrCreatePerson(transaction, record) {
  if (!record.name) {
    throw new Error(
      `الاسم فارغ في صف Excel رقم ${record.excelRowNumber}`
    );
  }

  // 1. Match by national ID
  if (record.nationalId) {
    const request = new sql.Request(transaction);

    request.input(
      "nationalId",
      sql.NVarChar(100),
      record.nationalId
    );

    const result = await request.query(`
      SELECT TOP (2) id
      FROM dbo.security_persons WITH (UPDLOCK, HOLDLOCK)
      WHERE national_id_number = @nationalId
        AND ISNULL(is_deleted, 0) = 0
      ORDER BY id;
    `);

    if (result.recordset.length > 1) {
      throw new Error(
        `الرقم القومي ${record.nationalId} مرتبط بأكثر من شخص.`
      );
    }

    if (result.recordset.length === 1) {
      return {
        id: result.recordset[0].id,
        created: false,
      };
    }
  } else {
    // 2. Fallback only when the combination is unambiguous
    const request = new sql.Request(transaction);

    request.input("name", sql.NVarChar(510), record.name);
    request.input("birthPlace", sql.NVarChar(300), record.birthPlace);
    request.input(
      "birthDate",
      sql.Date,
      record.birthDate ? new Date(`${record.birthDate}T00:00:00Z`) : null
    );

    const result = await request.query(`
      SELECT TOP (2) id
      FROM dbo.security_persons WITH (UPDLOCK, HOLDLOCK)
      WHERE name = @name
        AND (
          birth_place = @birthPlace
          OR (birth_place IS NULL AND @birthPlace IS NULL)
        )
        AND (
          birth_date = @birthDate
          OR (birth_date IS NULL AND @birthDate IS NULL)
        )
        AND ISNULL(is_deleted, 0) = 0
      ORDER BY id;
    `);

    if (result.recordset.length > 1) {
      throw new Error(
        `لا يوجد رقم قومي صالح، والاسم "${record.name}" يطابق أكثر من شخص.`
      );
    }

    if (result.recordset.length === 1) {
      return {
        id: result.recordset[0].id,
        created: false,
      };
    }
  }

  // 3. Create a new person
  const insertRequest = new sql.Request(transaction);

  insertRequest.input("name", sql.NVarChar(510), record.name);
  insertRequest.input(
    "nationalId",
    sql.NVarChar(100),
    record.nationalId
  );
  insertRequest.input(
    "birthPlace",
    sql.NVarChar(300),
    record.birthPlace
  );
  insertRequest.input(
    "birthDate",
    sql.Date,
    record.birthDate ? new Date(`${record.birthDate}T00:00:00Z`) : null
  );

  const inserted = await insertRequest.query(`
    INSERT INTO dbo.security_persons
    (
      name,
      national_id_number,
      birth_date,
      birth_place,
      security_situation,
      created_at,
      is_deleted
    )
    OUTPUT INSERTED.id
    VALUES
    (
      @name,
      @nationalId,
      @birthDate,
      @birthPlace,
      N'غير محدد',
      SYSDATETIME(),
      0
    );
  `);

  return {
    id: inserted.recordset[0].id,
    created: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Incident insertion                                                         */
/* -------------------------------------------------------------------------- */

async function insertIncident(transaction, personId, record) {
  const request = new sql.Request(transaction);

  request.input("personId", sql.Int, personId);
  request.input("branch", sql.NVarChar(510), record.branch);
  request.input(
    "stolenGoods",
    sql.NVarChar(sql.MAX),
    record.stolenGoods
  );
  request.input(
    "stolenGoodsValue",
    sql.Decimal(28, 4),
    record.stolenGoodsValue
  );
  request.input(
    "incidentDate",
    sql.Date,
    record.incidentDate
      ? new Date(`${record.incidentDate}T00:00:00Z`)
      : null
  );
  request.input("notes", sql.NVarChar(sql.MAX), record.notes);

  // Avoid importing an identical incident twice
  const duplicate = await request.query(`
    SELECT TOP (1) id
    FROM dbo.security_incidents WITH (UPDLOCK, HOLDLOCK)
    WHERE security_person_id = @personId
      AND (branch = @branch OR (branch IS NULL AND @branch IS NULL))
      AND (
        stolen_goods = @stolenGoods
        OR (stolen_goods IS NULL AND @stolenGoods IS NULL)
      )
      AND (
        stolen_goods_value = @stolenGoodsValue
        OR (
          stolen_goods_value IS NULL
          AND @stolenGoodsValue IS NULL
        )
      )
      AND (
        incident_date = @incidentDate
        OR (incident_date IS NULL AND @incidentDate IS NULL)
      )
      AND (
        notes = @notes
        OR (notes IS NULL AND @notes IS NULL)
      );
  `);

  if (duplicate.recordset.length) {
    return {
      inserted: false,
      incidentId: duplicate.recordset[0].id,
    };
  }

  const inserted = await request.query(`
    INSERT INTO dbo.security_incidents
    (
      security_person_id,
      branch,
      stolen_goods,
      stolen_goods_value,
      incident_date,
      notes
    )
    OUTPUT INSERTED.id
    VALUES
    (
      @personId,
      @branch,
      @stolenGoods,
      @stolenGoodsValue,
      @incidentDate,
      @notes
    );
  `);

  return {
    inserted: true,
    incidentId: inserted.recordset[0].id,
  };
}

/* -------------------------------------------------------------------------- */
/* Main import                                                                */
/* -------------------------------------------------------------------------- */

async function importSecurityExcel() {
  console.log("======================================");
  console.log("SECURITY INCIDENTS - LAST 35 ROWS");
  console.log("======================================");

  console.log("Excel:", EXCEL_PATH);
  console.log("Sheet:", SHEET_NAME);

  const workbook = await XlsxPopulate.fromFileAsync(EXCEL_PATH, {
    password: EXCEL_PASSWORD,
  });

  const sheet = workbook.sheet(SHEET_NAME);

  if (!sheet) {
    throw new Error(`الشيت ${SHEET_NAME} غير موجود في ملف Excel.`);
  }

  const values = sheet.usedRange().value();

  if (!Array.isArray(values) || values.length < 2) {
    throw new Error("الشيت لا يحتوي على بيانات كافية.");
  }

  // First row is the header. Keep the last 35 non-empty data rows.
  const dataRows = values
    .slice(1)
    .map((row, index) => ({
      row,
      excelRowNumber: index + 2,
    }))
    .filter(({ row }) =>
      Array.isArray(row) &&
      row.some((value) => cleanText(value) !== null)
    );

  const selectedRows = dataRows.slice(-IMPORT_LIMIT);

  if (!selectedRows.length) {
    throw new Error("لم يتم العثور على سجلات للاستيراد.");
  }

  const records = selectedRows.map(({ row, excelRowNumber }) =>
    mapExcelRow(row, excelRowNumber)
  );

  console.log("Total data rows:", dataRows.length);
  console.log("Selected rows:", records.length);

  for (const record of records) {
    console.log(
      `Excel row ${record.excelRowNumber}: ${record.name || "NO NAME"}`
    );
  }

  const pool = await retailPoolPromise;
  const transaction = new sql.Transaction(pool);

  let insertedPeople = 0;
  let existingPeople = 0;
  let insertedIncidents = 0;
  let skippedIncidents = 0;

  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    for (const record of records) {
      const person = await findOrCreatePerson(transaction, record);

      if (person.created) {
        insertedPeople++;
      } else {
        existingPeople++;
      }

      const incident = await insertIncident(
        transaction,
        person.id,
        record
      );

      if (incident.inserted) {
        insertedIncidents++;
      } else {
        skippedIncidents++;
      }

      console.log(
        `Person ID: ${person.id} | Incident ID: ${incident.incidentId} | ${
          incident.inserted ? "INSERTED" : "ALREADY EXISTS"
        }`
      );
    }

    await transaction.commit();

    console.log("\n======================================");
    console.log("IMPORT COMPLETED SUCCESSFULLY");
    console.log("======================================");
    console.log("Rows processed:", records.length);
    console.log("New persons:", insertedPeople);
    console.log("Existing persons:", existingPeople);
    console.log("New incidents:", insertedIncidents);
    console.log("Skipped duplicate incidents:", skippedIncidents);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

importSecurityExcel()
  .then(() => {
    console.log("Security Excel import finished.");
  })
  .catch((error) => {
    console.error("IMPORT FAILED:", error);
    process.exitCode = 1;
  });
