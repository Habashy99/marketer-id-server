
import XlsxPopulate from "xlsx-populate";
import { randomUUID } from "node:crypto";

import {
  retailPoolPromise,
  sql,
} from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* Temporary Excel Files                                                      */
/* -------------------------------------------------------------------------- */

const FILE_TTL = 30 * 60 * 1000;
const temporaryFiles = new Map();

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const NATIONAL_ID_HEADERS = [
  "رقم قومي",
  "الرقم القومي",
  "الرقم القومى",
  "رقم الهوية",
  "national_id_number",
  "national_id",
  "nationalid",
];

const NAME_HEADERS = [
  "الاسم",
  "اسم المتقدم",
  "اسم المتقدمين",
  "اسم الموظف",
  "اسم المندوب",
  "name",
  "full_name",
  "applicant_name",
];

const DECISION_HEADER = "قرار التعيين";
const REASON_HEADER = "سبب القرار";

/* -------------------------------------------------------------------------- */
/* General Helpers                                                            */
/* -------------------------------------------------------------------------- */

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]/g, "");
}

function normalizeSheetName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[أإآ]/g, "ا");
}

function normalizeNationalId(value, numberFormat = "") {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    value instanceof Date
  ) {
    return "";
  }

  let nationalId = String(value).trim();

  nationalId = nationalId.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
    const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

    const arabicIndex = arabicDigits.indexOf(digit);

    if (arabicIndex !== -1) {
      return String(arabicIndex);
    }

    const persianIndex = persianDigits.indexOf(digit);

    if (persianIndex !== -1) {
      return String(persianIndex);
    }

    return digit;
  });

  nationalId = nationalId.replace(/\s/g, "");

  if (
    /^\d+$/.test(nationalId) &&
    /^0{2,}/.test(String(numberFormat || "")) &&
    nationalId.length < 14
  ) {
    nationalId = nationalId.padStart(14, "0");
  }

  return nationalId;
}

function serializeCellValue(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "object") {
    if (value.text !== undefined) {
      return String(value.text);
    }

    if (value.value !== undefined) {
      return serializeCellValue(value.value);
    }

    return "";
  }

  return "";
}

function isEmptyCell(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

function isEmptyRow(row) {
  return !row || row.every(isEmptyCell);
}

function cleanupExpiredFiles() {
  const now = Date.now();

  for (const [jobId, file] of temporaryFiles.entries()) {
    if (file.expiresAt <= now) {
      temporaryFiles.delete(jobId);
    }
  }
}

function findColumn(headerRow, acceptedHeaders) {
  const accepted = new Set(acceptedHeaders.map(normalizeHeader));

  return headerRow.findIndex((header) =>
    accepted.has(normalizeHeader(header)),
  );
}

function getColumnValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

/* -------------------------------------------------------------------------- */
/* SQL Helpers                                                                */
/* -------------------------------------------------------------------------- */

function addSqlParameters(request, values, prefix, type) {
  values.forEach((value, index) => {
    request.input(`${prefix}${index}`, type, value);
  });

  return values.map((_, index) => `@${prefix}${index}`).join(", ");
}

/* -------------------------------------------------------------------------- */
/* Excel Sheet Selection                                                      */
/* -------------------------------------------------------------------------- */

function findRecruitmentSheet(workbook) {
  const sheets = workbook.sheets();

  console.log(
    "[Recruitment] Available sheets:",
    sheets.map((item) => item.name()),
  );

  const targetName = normalizeSheetName("بيانات التعيينات");

  const sheet = sheets.find(
    (item) => normalizeSheetName(item.name()) === targetName,
  );

  if (!sheet) {
    const availableNames = sheets.map((item) => item.name()).join(" | ");

    throw new Error(
      `لم يتم العثور على صفحة بيانات التعيينات. الصفحات الموجودة: ${availableNames}`,
    );
  }

  console.log("[Recruitment] Selected sheet:", sheet.name());

  return sheet;
}

/* -------------------------------------------------------------------------- */
/* Find Actual Last Applicant Row                                             */
/* -------------------------------------------------------------------------- */

function findActualLastRow(
  sheet,
  maximumRow,
  nationalIdColumnIndex,
  nameColumnIndex,
) {
  if (maximumRow < 2) {
    return 1;
  }

  const columnsToCheck = [
    nationalIdColumnIndex,
    nameColumnIndex,
  ].filter(
    (column, index, array) =>
      column >= 0 && array.indexOf(column) === index,
  );

  const columnValues = [];

  for (const columnIndex of columnsToCheck) {
    const values = sheet
      .range(2, columnIndex + 1, maximumRow, columnIndex + 1)
      .value();

    columnValues.push(values);
  }

  const totalRows = maximumRow - 1;

  for (let index = totalRows - 1; index >= 0; index--) {
    const hasData = columnValues.some((values) => {
      const cellValue = getColumnValue(values[index]);

      return !isEmptyCell(cellValue);
    });

    if (hasData) {
      return index + 2;
    }
  }

  return 1;
}

/* -------------------------------------------------------------------------- */
/* Find Security National IDs                                                 */
/* -------------------------------------------------------------------------- */

async function findSecurityNationalIds(nationalIds) {
  const foundIds = new Set();

  const uniqueIds = [
    ...new Set(
      nationalIds
        .map((id) => normalizeNationalId(id))
        .filter((id) => /^\d{14}$/.test(id)),
    ),
  ];

  if (!uniqueIds.length) {
    return foundIds;
  }

  const pool = await retailPoolPromise;

  // تقسيم الأرقام إلى مجموعات لتجنب حد SQL Server للـ parameters
  const CHUNK_SIZE = 1000;

  for (let index = 0; index < uniqueIds.length; index += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(index, index + CHUNK_SIZE);

    const request = pool.request();

    const placeholders = addSqlParameters(
      request,
      chunk,
      "nationalId",
      sql.NVarChar(14),
    );

    const result = await request.query(`
      SELECT national_id_number
      FROM dbo.security_persons
      WHERE national_id_number IN (${placeholders})
        AND ISNULL(is_deleted, 0) = 0;
    `);

    for (const record of result.recordset || []) {
      const nationalId = normalizeNationalId(
        record.national_id_number,
      );

      if (/^\d{14}$/.test(nationalId)) {
        foundIds.add(nationalId);
      }
    }
  }

  return foundIds;
}

/* -------------------------------------------------------------------------- */
/* Process Excel                                                              */
/* -------------------------------------------------------------------------- */

async function processRecuritmentWorkbook(fileBuffer) {
  const startTime = Date.now();

  const workbook = await XlsxPopulate.fromDataAsync(fileBuffer);

  const sheet = findRecruitmentSheet(workbook);

  const usedRange = sheet.usedRange();

  if (!usedRange) {
    throw new Error("صفحة بيانات التعيينات فارغة.");
  }

  const maximumRow = usedRange.endCell().rowNumber();

  let lastColumn = usedRange.endCell().columnNumber();

  if (maximumRow < 2) {
    throw new Error("الملف لا يحتوي على بيانات للمتقدمين.");
  }

  // قراءة العناوين
  const headerRow = sheet.range(1, 1, 1, lastColumn).value()[0] || [];

  const nationalIdColumnIndex = findColumn(
    headerRow,
    NATIONAL_ID_HEADERS,
  );

  if (nationalIdColumnIndex === -1) {
    throw new Error(
      "لم يتم العثور على عمود الرقم القومي. تأكد من عنوان العمود.",
    );
  }

  const nameColumnIndex = findColumn(headerRow, NAME_HEADERS);

  if (nameColumnIndex === -1) {
    throw new Error(
      "لم يتم العثور على عمود الاسم. تأكد من عنوان العمود.",
    );
  }

  // البحث عن أعمدة القرار وسبب القرار
  let decisionColumnIndex = findColumn(headerRow, [
    DECISION_HEADER,
  ]);

  let reasonColumnIndex = findColumn(headerRow, [
    REASON_HEADER,
  ]);

  // إضافة الأعمدة الناقصة فقط
  if (decisionColumnIndex === -1) {
    decisionColumnIndex = lastColumn;

    lastColumn++;

    sheet
      .cell(1, decisionColumnIndex + 1)
      .value(DECISION_HEADER);
  }

  if (reasonColumnIndex === -1) {
    reasonColumnIndex = lastColumn;

    lastColumn++;

    sheet
      .cell(1, reasonColumnIndex + 1)
      .value(REASON_HEADER);
  }

  console.log(
    "[Recruitment] Maximum formatted row:",
    maximumRow,
  );

  // تحديد آخر صف فعلي
  const lastRow = findActualLastRow(
    sheet,
    maximumRow,
    nationalIdColumnIndex,
    nameColumnIndex,
  );

  if (lastRow < 2) {
    throw new Error("لم يتم العثور على متقدمين في الملف.");
  }

  console.log(
    "[Recruitment] Actual last applicant row:",
    lastRow,
  );

  // قراءة البيانات
  const data = sheet.range(1, 1, lastRow, lastColumn).value();

  const applicantsToCheck = [];

  let skipped = 0;

  // تجهيز المتقدمين وتخطي الصفوف التي تم فحصها سابقًا
  for (let index = 1; index < data.length; index++) {
    const row = data[index] || [];

    const rowNumber = index + 1;

    if (isEmptyRow(row)) {
      continue;
    }

    const name = serializeCellValue(row[nameColumnIndex]);

    const rawNationalId = row[nationalIdColumnIndex];

    const numberFormat = sheet
      .cell(rowNumber, nationalIdColumnIndex + 1)
      .style("numberFormat");

    const nationalId = normalizeNationalId(
      rawNationalId,
      numberFormat,
    );

    const existingDecision = serializeCellValue(
      row[decisionColumnIndex],
    );

    const existingReason = serializeCellValue(
      row[reasonColumnIndex],
    );

    // إذا كان القرار والسبب موجودين لا نعيد الفحص
    if (
      !isEmptyCell(existingDecision) &&
      !isEmptyCell(existingReason)
    ) {
      skipped++;
      continue;
    }

    applicantsToCheck.push({
      rowNumber,
      name,
      nationalId,
    });
  }

  console.log("[Recruitment] Total rows:", data.length - 1);

  console.log("[Recruitment] Already checked:", skipped);

  console.log(
    "[Recruitment] New applicants:",
    applicantsToCheck.length,
  );

  // فحص الأرقام القومية للمتقدمين الجدد فقط
  const uniqueNationalIds = [
    ...new Set(
      applicantsToCheck
        .map((applicant) => applicant.nationalId)
        .filter((id) => /^\d{14}$/.test(id)),
    ),
  ];

  const securityIds = await findSecurityNationalIds(
    uniqueNationalIds,
  );

  const summary = {
    total: applicantsToCheck.length,
    accepted: 0,
    rejected: 0,
    invalid: 0,
    skipped,
  };

  const results = [];

  // معالجة الصفوف الجديدة فقط
  for (const applicant of applicantsToCheck) {
    let decision;
    let reason;

    if (!/^\d{14}$/.test(applicant.nationalId)) {
      decision = "رقم قومي غير صحيح";

      reason = "الرقم القومي يجب أن يتكون من 14 رقمًا.";

      summary.invalid++;
    } else if (securityIds.has(applicant.nationalId)) {
      decision = "مرفوض";

      reason = "الرقم القومي مسجل في ملفات إدارة الأمن.";

      summary.rejected++;
    } else {
      decision = "مقبول";

      reason = "الرقم القومي غير موجود في ملفات إدارة الأمن.";

      summary.accepted++;
    }

    // تحديث خلايا الصف الجديد فقط
    sheet
      .cell(applicant.rowNumber, decisionColumnIndex + 1)
      .value(decision);

    sheet
      .cell(applicant.rowNumber, reasonColumnIndex + 1)
      .value(reason);

    results.push({
      serialNumber: results.length + 1,
      rowNumber: applicant.rowNumber,
      name: applicant.name,
      nationalId: applicant.nationalId,
      decision,
      reason,
    });
  }

  // إخراج الملف بعد الاحتفاظ بالنتائج القديمة وإضافة الجديدة
  const outputBuffer = await workbook.outputAsync();

  const durationSeconds = (
    (Date.now() - startTime) /
    1000
  ).toFixed(2);

  console.log("[Recruitment] Completed:", {
    totalRows: data.length - 1,
    checkedNow: summary.total,
    skipped,
    accepted: summary.accepted,
    rejected: summary.rejected,
    invalid: summary.invalid,
    durationSeconds,
  });

  return {
    columns: [
      "م",
      "الاسم",
      "الرقم القومي",
      DECISION_HEADER,
      REASON_HEADER,
    ],
    results,
    summary,
    outputBuffer,
  };
}

/* -------------------------------------------------------------------------- */
/* Check Applicants - Upload Excel                                            */
/* -------------------------------------------------------------------------- */

export async function checkRecuritment(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "من فضلك اختر ملف Excel أولاً.",
      });
    }

    cleanupExpiredFiles();

    const result = await processRecuritmentWorkbook(
      req.file.buffer,
    );

    const jobId = randomUUID();

    temporaryFiles.set(jobId, {
      ownerId: String(req.user.id),
      buffer: result.outputBuffer,
      fileName: "recuritment-results.xlsx",
      expiresAt: Date.now() + FILE_TTL,
    });

    return res.status(200).json({
      success: true,
      message: "تم رفع وفحص الملف بنجاح.",
      jobId,
      expiresInMinutes: 30,
      columns: result.columns,
      summary: result.summary,
      results: result.results,
    });
  } catch (error) {
    console.error("Recuritment check error:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "حدث خطأ أثناء فحص ملف المتقدمين.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Download Previously Processed Excel                                       */
/* -------------------------------------------------------------------------- */

export async function downloadRecuritmentResults(req, res) {
  try {
    cleanupExpiredFiles();

    const { jobId } = req.params;

    const savedFile = temporaryFiles.get(jobId);

    if (!savedFile) {
      return res.status(404).json({
        success: false,
        message:
          "الملف غير موجود أو انتهت مدة الاحتفاظ به. ارفع الملف مرة أخرى.",
      });
    }

    if (savedFile.ownerId !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: "ليس لديك صلاحية تنزيل هذا الملف.",
      });
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${savedFile.fileName}"`,
    );

    return res.status(200).send(savedFile.buffer);
  } catch (error) {
    console.error("Recuritment download error:", error);

    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تنزيل ملف النتائج.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Security National ID Lookup                                                */
/* -------------------------------------------------------------------------- */

export async function checkSecurityNationalId(req, res) {
  try {
const nationalId = normalizeNationalId(
  req.body?.nationalId ?? req.params?.nationalId,
).trim();

    if (!/^\d{14}$/.test(nationalId)) {
      return res.status(400).json({
        success: false,
        exists: false,
        message: "الرقم القومي يجب أن يتكون من 14 رقمًا.",
      });
    }

    const pool = await retailPoolPromise;

    // 1. بيانات الأشخاص
    const personsResult = await pool
      .request()
      .input("nationalId", sql.NVarChar(14), nationalId)
      .query(`
        SELECT
          id,
          name,
          national_id_number,
          birth_date,
          birth_place,
          security_situation,
          notes,
          created_at,
          updated_at,
          job,
          company_id,
          company_display_name,
          advertising_company_id,
          branch,
          branch_name,
          governorate,
          file_type,
          advertising_company_name
        FROM dbo.security_persons
        WHERE LTRIM(RTRIM(national_id_number)) = @nationalId
          AND ISNULL(is_deleted, 0) = 0
        ORDER BY created_at DESC, id DESC;
      `);

    const persons = personsResult.recordset || [];

    if (persons.length === 0) {
      return res.status(200).json({
        success: true,
        exists: false,
        nationalId,
        message: "هذا الرقم القومي غير موجود في سجلات الأمن.",
        records: [],
        summary: {
          persons: 0,
          incidents: 0,
          statusChanges: 0,
          permits: 0,
        },
      });
    }

    const personIds = persons.map((person) => person.id);

    // تجهيز Parameters آمنة للأشخاص
    const createPersonIdRequest = () => {
      const request = pool.request();

      const placeholders = addSqlParameters(
        request,
        personIds,
        "personId",
        sql.Int,
      );

      return { request, placeholders };
    };

    // 2. الوقائع الأمنية
    const incidentsQuery = createPersonIdRequest();

    const incidentsResult = await incidentsQuery.request.query(`
      SELECT
        id,
        security_person_id,
        branch,
        stolen_goods,
        stolen_goods_value,
        incident_date,
        notes
      FROM dbo.security_incidents
      WHERE security_person_id IN (${incidentsQuery.placeholders})
      ORDER BY incident_date DESC, id DESC;
    `);

    // 3. تاريخ تغييرات الحالة الأمنية
    const historyQuery = createPersonIdRequest();

    const historyResult = await historyQuery.request.query(`
      SELECT
        id,
        security_person_id,
        old_status,
        new_status,
        reason,
        changed_by,
        changed_at
      FROM dbo.security_status_history
      WHERE security_person_id IN (${historyQuery.placeholders})
      ORDER BY changed_at DESC, id DESC;
    `);

    // 4. التصاريح
    const permitsQuery = createPersonIdRequest();

    const permitsResult = await permitsQuery.request.query(`
      SELECT
        id,
        security_person_id,
        permit_number,
        company_name,
        issue_date,
        branch,
        notes
      FROM dbo.security_permits
      WHERE security_person_id IN (${permitsQuery.placeholders})
      ORDER BY issue_date DESC, id DESC;
    `);

    const incidents = incidentsResult.recordset || [];
    const history = historyResult.recordset || [];
    const permits = permitsResult.recordset || [];

    // تجميع البيانات تحت كل شخص
    const records = persons.map((person) => {
      const personId = person.id;

      return {
        ...person,

        incidents: incidents.filter(
          (item) => item.security_person_id === personId,
        ),

        statusHistory: history.filter(
          (item) => item.security_person_id === personId,
        ),

        permits: permits.filter(
          (item) => item.security_person_id === personId,
        ),
      };
    });

    return res.status(200).json({
      success: true,
      exists: true,
      nationalId,
      message: "هذا الرقم القومي موجود في سجلات الأمن.",
      records,
      summary: {
        persons: persons.length,
        incidents: incidents.length,
        statusChanges: history.length,
        permits: permits.length,
      },
    });
  } catch (error) {
    console.error("Check security national ID error:", error);

    return res.status(500).json({
      success: false,
      exists: false,
      message: "حدث خطأ أثناء الاستعلام في سجلات الأمن.",
    });
  }
}
