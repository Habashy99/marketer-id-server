
import { sql, retailPoolPromise } from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const VALID_STATUSES = ["سليم", "تحت المراجعة", "مرفوض", "غير محدد", "بلوك"];
const VALID_JOBS = ["عميل", "مندوب", "مندوبة", "منسق", "منسقة"];

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 30;

/* -------------------------------------------------------------------------- */
/* General Helpers                                                            */
/* -------------------------------------------------------------------------- */

function clean(value) {
  if (value === undefined || value === null) return null;

  const result = String(value).trim();
  return result || null;
}

function normalizeArabic(value) {
  return String(value ?? "")
    .replace(/[\s\u0640]+/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .trim();
}

function validNationalId(value) {
  return /^\d{14}$/.test(clean(value) || "");
}

function parseDate(value) {
  const dateValue = clean(value);

  if (!dateValue) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function appendNote(oldNotes, newNote) {
  const oldValue = clean(oldNotes);
  const newValue = clean(newNote);

  if (!newValue) return oldValue;
  if (!oldValue) return newValue;

  return `${oldValue}\n${newValue}`;
}

function getSecurityStatusFromNotes(notes, fallback = "غير محدد") {
  const value = normalizeArabic(notes);

  if (value.includes("ممنوع")) return "بلوك";

  if (value.includes("تمأخذجزاءبسبب")) {
    return "تحت المراجعة";
  }

  if (value.includes("لامانع")) return "سليم";

  return clean(fallback) || "غير محدد";
}

function getSecurityStatus(body) {
  return getSecurityStatusFromNotes(body?.notes, body?.security_status);
}

function getSourceLabel(sourceType) {
  return sourceType === "temporary" ? "مؤقت" : "أساسي";
}

function sendServerError(res, error, action) {
  console.error(`${action} error:`, error);

  return res.status(500).json({
    success: false,
    message: `تعذر ${action}.`,
    error: process.env.NODE_ENV === "development" ? error.message : undefined,
  });
}

async function rollbackSafely(transaction) {
  if (!transaction) return;

  try {
    await transaction.rollback();
  } catch {
    // Transaction may already be rolled back or committed.
  }
}

/* -------------------------------------------------------------------------- */
/* Coordinator Normalization                                                  */
/* -------------------------------------------------------------------------- */

function normalizeCoordinator(row) {
  return {
    id: row.id ?? null,
    code: clean(row.code),
    name: clean(row.name),
    job: clean(row.job),
    company_name: clean(row.company_name),
    national_id_number: clean(row.national_id_number),
    mobile: clean(row.mobile),
    governorate: clean(row.governorate),
    notes: clean(row.notes),
    security_situation: clean(row.security_situation) || "غير محدد",

    advertising_company_id:
      row.advertising_company_id == null
        ? null
        : Number(row.advertising_company_id),

    branch: clean(row.branch),
  };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "بيانات الطلب غير صحيحة.";
  }

  const name = clean(body.name);
  const nationalId = clean(body.national_id_number);
  const job = clean(body.job);
  const status = getSecurityStatus(body);

  const amount = clean(body.value_of_stolen_goods);
  const birthDate = clean(body.birth_date);
  const incidentDate = clean(body.incident_date);
  const permitDate = clean(body.permit_issue_date);

  if (!name) return "يرجى إدخال الاسم.";

  if (!validNationalId(nationalId)) {
    return "الرقم القومي يجب أن يتكون من 14 رقمًا.";
  }

  if (!VALID_JOBS.includes(job)) {
    return "الوظيفة غير صحيحة.";
  }

  if (!VALID_STATUSES.includes(status)) {
    return "الموقف الأمني غير صحيح.";
  }

  if (birthDate && !parseDate(birthDate)) {
    return "تاريخ الميلاد غير صحيح. استخدم YYYY-MM-DD.";
  }

  if (
    amount !== null &&
    (!Number.isFinite(Number(amount)) || Number(amount) < 0)
  ) {
    return "قيمة البضاعة غير صحيحة.";
  }

  if (incidentDate && !parseDate(incidentDate)) {
    return "تاريخ الواقعة غير صحيح. استخدم YYYY-MM-DD.";
  }

  if (permitDate && !parseDate(permitDate)) {
    return "تاريخ إصدار التصريح غير صحيح. استخدم YYYY-MM-DD.";
  }

  if (
    body.advertising_company !== undefined &&
    body.advertising_company !== null &&
    body.advertising_company !== "" &&
    (!/^\d+$/.test(String(body.advertising_company)) ||
      !Number.isSafeInteger(Number(body.advertising_company)))
  ) {
    return "رقم شركة الدعاية غير صحيح.";
  }

  return null;
}

function validatePersonBody(body, nationalId) {
  return validateBody({
    ...body,
    national_id_number: nationalId,
    incident_date: null,
    value_of_stolen_goods: null,
    permit_issue_date: null,
  });
}

/* -------------------------------------------------------------------------- */
/* SQL Binding                                                                */
/* -------------------------------------------------------------------------- */

function bindPerson(request, body) {
  const job = clean(body.job);

  // العميل يكون نوع ملفه 25 دائمًا، سواء عند الإضافة أو التعديل.
  const fileType = job === "عميل" ? "25" : clean(body.file_type);

  request.input("name", sql.NVarChar(255), clean(body.name));

  request.input(
    "nationalId",
    sql.NVarChar(50),
    clean(body.national_id_number),
  );

  request.input("birthDate", sql.Date, parseDate(body.birth_date));

  request.input(
    "birthPlace",
    sql.NVarChar(255),
    clean(body.birth_place),
  );

  request.input("job", sql.NVarChar(100), job);
  request.input("companyId", sql.NVarChar(100), clean(body.company_name));

  request.input(
    "companyDisplayName",
    sql.NVarChar(255),
    clean(body.company_display_name),
  );

  request.input(
    "advertisingCompanyId",
    sql.Int,
    clean(body.advertising_company) === null
      ? null
      : Number(body.advertising_company),
  );

  request.input(
    "advertisingCompanyName",
    sql.NVarChar(255),
    clean(body.advertising_company_name),
  );

  request.input("branch", sql.NVarChar(255), clean(body.branch));
  request.input("branchName", sql.NVarChar(255), clean(body.branch_name));
  request.input("governorate", sql.NVarChar(100), clean(body.governorate));

  request.input("fileType", sql.NVarChar(100), fileType);

  request.input("securityStatus", sql.NVarChar(50), getSecurityStatus(body));
  request.input("notes", sql.NVarChar(sql.MAX), clean(body.notes));
}

function bindIncident(request, body) {
  const amount = clean(body.value_of_stolen_goods);

  request.input(
    "stolenGoods",
    sql.NVarChar(sql.MAX),
    clean(body.stolen_goods),
  );

  request.input(
    "stolenGoodsValue",
    sql.Decimal(18, 2),
    amount === null ? null : Number(amount),
  );

  request.input("incidentDate", sql.Date, parseDate(body.incident_date));

  request.input(
    "incidentBranch",
    sql.NVarChar(255),
    clean(body.incident_branch) || clean(body.branch),
  );

  request.input(
    "incidentNotes",
    sql.NVarChar(sql.MAX),
    clean(body.incident_notes) || clean(body.notes),
  );
}

function bindPermit(request, body) {
  request.input("permitNumber", sql.NVarChar(50), clean(body.permit_number));

  request.input(
    "permitCompanyName",
    sql.NVarChar(255),
    clean(body.permit_company_name) || clean(body.company_display_name),
  );

  request.input("permitIssueDate", sql.Date, parseDate(body.permit_issue_date));

  request.input(
    "permitBranch",
    sql.NVarChar(255),
    clean(body.permit_branch) || clean(body.branch),
  );

  request.input(
    "permitNotes",
    sql.NVarChar(sql.MAX),
    clean(body.permit_notes) || clean(body.notes),
  );
}

function hasIncidentData(body) {
  return Boolean(
    clean(body.stolen_goods) ||
      clean(body.value_of_stolen_goods) ||
      clean(body.incident_date) ||
      clean(body.incident_notes) ||
      clean(body.incident_branch),
  );
}

function hasPermitData(body) {
  return Boolean(
    clean(body.permit_number) ||
      clean(body.permit_company_name) ||
      clean(body.permit_issue_date) ||
      clean(body.permit_branch) ||
      clean(body.permit_notes),
  );
}

/* -------------------------------------------------------------------------- */
/* Status History                                                             */
/* -------------------------------------------------------------------------- */

async function saveStatusHistory(
  transaction,
  personId,
  oldStatus,
  newStatus,
  reason,
  changedBy,
) {
  if (oldStatus === newStatus) return;

  const request = new sql.Request(transaction);

  request.input("personId", sql.Int, personId);
  request.input("oldStatus", sql.NVarChar(50), oldStatus);
  request.input("newStatus", sql.NVarChar(50), newStatus);
  request.input("reason", sql.NVarChar(sql.MAX), clean(reason));

  const userId = Number(changedBy);

  request.input(
    "changedBy",
    sql.Int,
    Number.isSafeInteger(userId) && userId > 0 ? userId : null,
  );

  await request.query(`
    INSERT INTO dbo.security_status_history (
      security_person_id,
      old_status,
      new_status,
      reason,
      changed_by
    )
    VALUES (
      @personId,
      @oldStatus,
      @newStatus,
      @reason,
      @changedBy
    );
  `);
}

/* -------------------------------------------------------------------------- */
/* Coordinator Synchronization                                                */
/* -------------------------------------------------------------------------- */

async function updateCoordinatorStatusInTransaction(
  transaction,
  nationalId,
  securityStatus,
  note = null,
) {
  const normalizedNationalId = clean(nationalId);

  if (!validNationalId(normalizedNationalId)) {
    throw new Error("National ID is invalid.");
  }

  if (!VALID_STATUSES.includes(securityStatus)) {
    throw new Error("Invalid security status.");
  }

  const normalizedNote = clean(note);

  const permanentRequest = new sql.Request(transaction);

  permanentRequest.input("nationalId", sql.VarChar(50), normalizedNationalId);
  permanentRequest.input("securityStatus", sql.NVarChar(50), securityStatus);
  permanentRequest.input("note", sql.NVarChar(sql.MAX), normalizedNote);

  const permanentResult = await permanentRequest.query(`
    UPDATE dbo.coordinator
    SET
      security_situation = @securityStatus,
      notes = CASE
        WHEN @note IS NULL THEN notes
        WHEN notes IS NULL OR LTRIM(RTRIM(notes)) = ''
          THEN @note
        ELSE CONCAT(notes, CHAR(13), CHAR(10), @note)
      END
    WHERE LTRIM(RTRIM(national_id_number)) = @nationalId;
  `);

  const temporaryRequest = new sql.Request(transaction);

  temporaryRequest.input("nationalId", sql.NVarChar(50), normalizedNationalId);
  temporaryRequest.input("securityStatus", sql.NVarChar(50), securityStatus);
  temporaryRequest.input("note", sql.NVarChar(sql.MAX), normalizedNote);

  const temporaryResult = await temporaryRequest.query(`
    UPDATE dbo.temporary_coordinator
    SET
      Security_Situation = @securityStatus,
      notes = CASE
        WHEN @note IS NULL THEN notes
        WHEN notes IS NULL OR LTRIM(RTRIM(notes)) = ''
          THEN @note
        ELSE CONCAT(notes, CHAR(13), CHAR(10), @note)
      END
    WHERE
      LTRIM(RTRIM(national_id_number)) = @nationalId
      AND ISNULL(isdeleted, 0) = 0;
  `);

  return {
    national_id_number: normalizedNationalId,
    security_status: securityStatus,
    coordinator_rows: permanentResult.rowsAffected[0] || 0,
    temporary_coordinator_rows: temporaryResult.rowsAffected[0] || 0,
  };
}

/* -------------------------------------------------------------------------- */
/* GET /security/coordinators                                                 */
/* -------------------------------------------------------------------------- */

export async function getSecurityCoordinators(req, res) {
  try {
    const pool = await retailPoolPromise;

    const result = await pool.request().query(`
      SELECT
        c.id,
        c.code,
        c.name,
        c.job,
        c.company_name,
        c.national_id_number,
        c.mobile,
        c.governorate,
        c.notes,
        c.security_situation,
        c.advertising_company_id,
        c.branch,

        N'permanent' AS source_type,

        sp.id AS security_person_id,

        COALESCE(
          NULLIF(LTRIM(RTRIM(sp.security_situation)), N''),
          NULLIF(LTRIM(RTRIM(c.security_situation)), N''),
          N'غير محدد'
        ) AS security_status,

        COALESCE(
          NULLIF(LTRIM(RTRIM(sp.notes)), N''),
          permit_notes.notes,
          NULLIF(LTRIM(RTRIM(c.notes)), N''),
          N''
        ) AS security_notes

      FROM dbo.coordinator c

      LEFT JOIN dbo.security_persons sp
        ON LTRIM(RTRIM(sp.national_id_number)) =
           LTRIM(RTRIM(c.national_id_number))
        AND ISNULL(sp.is_deleted, 0) = 0

      OUTER APPLY (
        SELECT
          STRING_AGG(
            CAST(NULLIF(LTRIM(RTRIM(pm.notes)), N'') AS NVARCHAR(MAX)),
            NCHAR(13) + NCHAR(10)
          ) AS notes
        FROM dbo.security_permits pm
        WHERE pm.security_person_id = sp.id
          AND NULLIF(LTRIM(RTRIM(pm.notes)), N'') IS NOT NULL
      ) permit_notes

      WHERE
        c.national_id_number IS NOT NULL
        AND LTRIM(RTRIM(c.national_id_number)) <> ''
        AND LTRIM(RTRIM(c.name)) <> ''
        AND LTRIM(RTRIM(c.job)) IN (
          N'مندوب',
          N'مندوبة',
          N'منسق',
          N'منسقة'
        )
        AND COALESCE(
          NULLIF(LTRIM(RTRIM(sp.security_situation)), N''),
          NULLIF(LTRIM(RTRIM(c.security_situation)), N''),
          N'غير محدد'
        ) = N'غير محدد'

      UNION ALL

      SELECT
        tc.id,
        CAST(NULL AS NVARCHAR(100)) AS code,
        tc.name,
        N'منسق' AS job,
        CAST(tc.mother_company AS NVARCHAR(255)) AS company_name,
        tc.national_id_number,
        CAST(NULL AS NVARCHAR(100)) AS mobile,
        CAST(NULL AS NVARCHAR(100)) AS governorate,
        tc.notes,
        tc.Security_Situation AS security_situation,
        tc.advertising_company_id,
        tc.branch,

        N'temporary' AS source_type,

        sp.id AS security_person_id,

        COALESCE(
          NULLIF(LTRIM(RTRIM(sp.security_situation)), N''),
          NULLIF(LTRIM(RTRIM(tc.Security_Situation)), N''),
          N'غير محدد'
        ) AS security_status,

        COALESCE(
          NULLIF(LTRIM(RTRIM(sp.notes)), N''),
          permit_notes.notes,
          NULLIF(LTRIM(RTRIM(tc.notes)), N''),
          N''
        ) AS security_notes

      FROM dbo.temporary_coordinator tc

      LEFT JOIN dbo.security_persons sp
        ON LTRIM(RTRIM(sp.national_id_number)) =
           LTRIM(RTRIM(tc.national_id_number))
        AND ISNULL(sp.is_deleted, 0) = 0

      OUTER APPLY (
        SELECT
          STRING_AGG(
            CAST(NULLIF(LTRIM(RTRIM(pm.notes)), N'') AS NVARCHAR(MAX)),
            NCHAR(13) + NCHAR(10)
          ) AS notes
        FROM dbo.security_permits pm
        WHERE pm.security_person_id = sp.id
          AND NULLIF(LTRIM(RTRIM(pm.notes)), N'') IS NOT NULL
      ) permit_notes

      WHERE
        ISNULL(tc.isdeleted, 0) = 0
        AND tc.national_id_number IS NOT NULL
        AND LTRIM(RTRIM(tc.national_id_number)) <> ''
        AND LTRIM(RTRIM(tc.name)) <> ''
        AND COALESCE(
          NULLIF(LTRIM(RTRIM(sp.security_situation)), N''),
          NULLIF(LTRIM(RTRIM(tc.Security_Situation)), N''),
          N'غير محدد'
        ) = N'غير محدد'

      ORDER BY id DESC;
    `);

    const rows = result.recordset || [];

    rows.sort((a, b) => {
      if (a.source_type !== b.source_type) {
        return a.source_type === "permanent" ? -1 : 1;
      }

      return Number(b.id) - Number(a.id);
    });

    const seenNationalIds = new Set();

    const coordinators = rows
      .map((row) => ({
        ...normalizeCoordinator(row),

        source_type: row.source_type,
        source_label: getSourceLabel(row.source_type),

        security_person_id: row.security_person_id ?? null,
        security_status: row.security_status || "غير محدد",
        security_notes: row.security_notes || "",
        notes: row.security_notes || "",

        already_imported: Boolean(row.security_person_id),
        deleted_security_record: false,
      }))
      .filter((item) => {
        if (!validNationalId(item.national_id_number)) return false;
        if (!VALID_JOBS.includes(item.job)) return false;
        if (!item.name) return false;

        const nationalId = item.national_id_number;

        if (seenNationalIds.has(nationalId)) return false;

        seenNationalIds.add(nationalId);

        return true;
      });

    return res.json({
      success: true,
      coordinators,
      total: coordinators.length,
      imported: coordinators.filter((item) => item.already_imported).length,
      not_imported: coordinators.filter((item) => !item.already_imported).length,
      deleted_records: 0,
    });
  } catch (error) {
    return sendServerError(res, error, "تحميل المناديب والمنسقين");
  }
}

/* -------------------------------------------------------------------------- */
/* POST /security/import-coordinators                                         */
/* -------------------------------------------------------------------------- */

export async function importSecurityCoordinators(req, res) {
  let transaction;

  try {
    const pool = await retailPoolPromise;

    const hasNationalIds = Array.isArray(req.body?.national_ids);

    const requestedIds = hasNationalIds
      ? [...new Set(req.body.national_ids.map(clean).filter(validNationalId))]
      : null;

    const reviews = Array.isArray(req.body?.reviews) ? req.body.reviews : [];

    const coordinatorResult = await pool.request().query(`
      SELECT
        id,
        code,
        name,
        job,
        company_name,
        national_id_number,
        mobile,
        governorate,
        notes,
        security_situation,
        advertising_company_id,
        branch,
        N'permanent' AS source_type,
        1 AS source_priority
      FROM dbo.coordinator
      WHERE
        national_id_number IS NOT NULL
        AND LTRIM(RTRIM(national_id_number)) <> ''
        AND LTRIM(RTRIM(name)) <> ''
        AND LTRIM(RTRIM(job)) IN (
          N'مندوب',
          N'مندوبة',
          N'منسق',
          N'منسقة'
        )

      UNION ALL

      SELECT
        id,
        CAST(NULL AS NVARCHAR(100)) AS code,
        name,
        N'منسق' AS job,
        CAST(mother_company AS NVARCHAR(255)) AS company_name,
        national_id_number,
        CAST(NULL AS NVARCHAR(100)) AS mobile,
        CAST(NULL AS NVARCHAR(100)) AS governorate,
        notes,
        Security_Situation AS security_situation,
        advertising_company_id,
        branch,
        N'temporary' AS source_type,
        2 AS source_priority
      FROM dbo.temporary_coordinator
      WHERE
        ISNULL(isdeleted, 0) = 0
        AND national_id_number IS NOT NULL
        AND LTRIM(RTRIM(national_id_number)) <> ''
        AND LTRIM(RTRIM(name)) <> ''

      ORDER BY source_priority, id DESC;
    `);

    let coordinators = (coordinatorResult.recordset || [])
      .map((row) => ({
        ...normalizeCoordinator(row),
        source_type: row.source_type,
        source_label: getSourceLabel(row.source_type),
        source_priority: Number(row.source_priority),
      }))
      .filter(
        (item) =>
          validNationalId(item.national_id_number) &&
          item.name &&
          VALID_JOBS.includes(item.job),
      );

    if (hasNationalIds) {
      const selectedIds = new Set(requestedIds);

      coordinators = coordinators.filter((item) =>
        selectedIds.has(clean(item.national_id_number)),
      );
    }

    coordinators.sort((a, b) => {
      if (a.source_priority !== b.source_priority) {
        return a.source_priority - b.source_priority;
      }

      return Number(b.id) - Number(a.id);
    });

    const uniqueCoordinators = [];
    const seenNationalIds = new Set();

    for (const coordinator of coordinators) {
      const nationalId = clean(coordinator.national_id_number);

      if (seenNationalIds.has(nationalId)) continue;

      seenNationalIds.add(nationalId);
      uniqueCoordinators.push(coordinator);
    }

    transaction = new sql.Transaction(pool);

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    let importedCount = 0;
    let skippedCount = 0;
    let updatedReviewsCount = 0;

    const skipped = [];
    const reviewResults = [];
    const importResults = [];

    for (const coordinator of uniqueCoordinators) {
      const nationalId = clean(coordinator.national_id_number);

      const existing = await new sql.Request(transaction)
        .input("nationalId", sql.NVarChar(50), nationalId)
        .query(`
          SELECT TOP 1
            id,
            is_deleted
          FROM dbo.security_persons WITH (UPDLOCK, HOLDLOCK)
          WHERE LTRIM(RTRIM(national_id_number)) = @nationalId;
        `);

      if (existing.recordset.length) {
        skippedCount++;

        skipped.push({
          national_id_number: nationalId,
          name: coordinator.name,
          job: coordinator.job,
          source_type: coordinator.source_type,
          source_label: coordinator.source_label,
          reason: existing.recordset[0].is_deleted
            ? "يوجد سجل محذوف بهذا الرقم القومي."
            : "مسجل بالفعل.",
        });

        continue;
      }

      const sourceStatus = VALID_STATUSES.includes(
        coordinator.security_situation,
      )
        ? coordinator.security_situation
        : "غير محدد";

      const insertResult = await new sql.Request(transaction)
        .input("name", sql.NVarChar(255), coordinator.name)
        .input("nationalId", sql.NVarChar(50), nationalId)
        .input("job", sql.NVarChar(100), coordinator.job)
        .input("companyId", sql.NVarChar(100), coordinator.company_name)
        .input(
          "advertisingCompanyId",
          sql.Int,
          Number.isSafeInteger(coordinator.advertising_company_id)
            ? coordinator.advertising_company_id
            : null,
        )
        .input("branch", sql.NVarChar(255), coordinator.branch)
        .input("governorate", sql.NVarChar(100), coordinator.governorate)
        .input("securityStatus", sql.NVarChar(50), sourceStatus)
        .input("notes", sql.NVarChar(sql.MAX), coordinator.notes)
        .query(`
          INSERT INTO dbo.security_persons (
            name,
            national_id_number,
            job,
            company_id,
            advertising_company_id,
            branch,
            governorate,
            file_type,
            security_situation,
            notes,
            is_deleted
          )
          OUTPUT INSERTED.id
          VALUES (
            @name,
            @nationalId,
            @job,
            @companyId,
            @advertisingCompanyId,
            @branch,
            @governorate,
            N'مناديب/ منسقين',
            @securityStatus,
            @notes,
            0
          );
        `);

      const personId = insertResult.recordset[0].id;

      const synchronization = await updateCoordinatorStatusInTransaction(
        transaction,
        nationalId,
        sourceStatus,
      );

      importedCount++;

      importResults.push({
        id: personId,
        national_id_number: nationalId,
        name: coordinator.name,
        job: coordinator.job,
        source_type: coordinator.source_type,
        source_label: coordinator.source_label,
        security_status: sourceStatus,
        synchronization,
      });
    }

    for (const review of reviews) {
      const nationalId = clean(review?.national_id_number);
      const status = clean(review?.security_status);
      const reviewNote = clean(review?.notes ?? review?.review_notes);

      if (!validNationalId(nationalId)) {
        reviewResults.push({
          national_id_number: nationalId,
          success: false,
          message: "الرقم القومي غير صحيح.",
        });

        continue;
      }

      if (!VALID_STATUSES.includes(status)) {
        reviewResults.push({
          national_id_number: nationalId,
          success: false,
          message: "الموقف الأمني غير صحيح.",
        });

        continue;
      }

      const personResult = await new sql.Request(transaction)
        .input("nationalId", sql.NVarChar(50), nationalId)
        .query(`
          SELECT TOP 1
            id,
            security_situation,
            notes
          FROM dbo.security_persons WITH (UPDLOCK, HOLDLOCK)
          WHERE
            LTRIM(RTRIM(national_id_number)) = @nationalId
            AND ISNULL(is_deleted, 0) = 0;
        `);

      if (!personResult.recordset.length) {
        reviewResults.push({
          national_id_number: nationalId,
          success: false,
          message: "لا يوجد سجل أمني نشط لهذا الرقم القومي.",
        });

        continue;
      }

      const person = personResult.recordset[0];
      const oldStatus = clean(person.security_situation) || "غير محدد";
      const updatedNotes = appendNote(person.notes, reviewNote);

      await new sql.Request(transaction)
        .input("personId", sql.Int, person.id)
        .input("status", sql.NVarChar(50), status)
        .input("notes", sql.NVarChar(sql.MAX), updatedNotes)
        .query(`
          UPDATE dbo.security_persons
          SET
            security_situation = @status,
            notes = @notes,
            updated_at = SYSDATETIME()
          WHERE id = @personId;
        `);

      await saveStatusHistory(
        transaction,
        person.id,
        oldStatus,
        status,
        reviewNote,
        req.user?.id,
      );

      const synchronization = await updateCoordinatorStatusInTransaction(
        transaction,
        nationalId,
        status,
        reviewNote,
      );

      updatedReviewsCount++;

      reviewResults.push({
        national_id_number: nationalId,
        success: true,
        old_status: oldStatus,
        security_status: status,
        synchronization,
      });
    }

    await transaction.commit();
    transaction = null;

    return res.status(200).json({
      success: true,
      message: "تم تنفيذ الاستيراد والمراجعات بنجاح.",

      imported_count: importedCount,
      skipped_count: skippedCount,
      updated_reviews_count: updatedReviewsCount,

      total_source_records: uniqueCoordinators.length,

      imported: importResults,
      skipped,
      reviews: reviewResults,
    });
  } catch (error) {
    await rollbackSafely(transaction);

    if (error.number === 2601 || error.number === 2627) {
      return res.status(409).json({
        success: false,
        message:
          "حدث تعارض أثناء الاستيراد. قد يكون أحد الأرقام القومية مسجلًا بالفعل.",
      });
    }

    return sendServerError(res, error, "استيراد ومراجعة المنسقين");
  }
}

/* -------------------------------------------------------------------------- */
/* PUT /security/coordinators/:nationalId                                     */
/* -------------------------------------------------------------------------- */

export async function updateCoordinatorSecurity(req, res) {
  const nationalId = clean(req.params.nationalId);
  const requestedStatus = clean(req.body?.security_status);
  const newNote = clean(req.body?.note);
  const updateStatus = req.body?.update_status !== false;

  if (!validNationalId(nationalId)) {
    return res.status(400).json({
      success: false,
      message: "الرقم القومي غير صحيح.",
    });
  }

  if (!updateStatus && !newNote) {
    return res.status(400).json({
      success: false,
      message: "يرجى إدخال ملاحظة أو اختيار تحديث الحالة.",
    });
  }

  if (updateStatus && !VALID_STATUSES.includes(requestedStatus)) {
    return res.status(400).json({
      success: false,
      message: "الموقف الأمني غير صحيح.",
    });
  }

  let transaction;

  try {
    const pool = await retailPoolPromise;

    transaction = new sql.Transaction(pool);

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const existing = await new sql.Request(transaction)
      .input("nationalId", sql.NVarChar(50), nationalId)
      .query(`
        SELECT TOP 1
          id,
          security_situation,
          notes
        FROM dbo.security_persons WITH (UPDLOCK, HOLDLOCK)
        WHERE
          LTRIM(RTRIM(national_id_number)) = @nationalId
          AND ISNULL(is_deleted, 0) = 0;
      `);

    if (!existing.recordset.length) {
      await rollbackSafely(transaction);
      transaction = null;

      return res.status(404).json({
        success: false,
        message: "المنسق غير موجود في سجلات الأمن. استورده أولاً.",
      });
    }

    const person = existing.recordset[0];

    const oldStatus = clean(person.security_situation) || "غير محدد";
    const finalStatus = updateStatus ? requestedStatus : oldStatus;
    const updatedNotes = appendNote(person.notes, newNote);

    await new sql.Request(transaction)
      .input("personId", sql.Int, person.id)
      .input("securityStatus", sql.NVarChar(50), finalStatus)
      .input("notes", sql.NVarChar(sql.MAX), updatedNotes)
      .query(`
        UPDATE dbo.security_persons
        SET
          security_situation = @securityStatus,
          notes = @notes,
          updated_at = SYSDATETIME()
        WHERE id = @personId;
      `);

    await saveStatusHistory(
      transaction,
      person.id,
      oldStatus,
      finalStatus,
      newNote,
      req.user?.id,
    );

    const synchronization = await updateCoordinatorStatusInTransaction(
      transaction,
      nationalId,
      finalStatus,
      newNote,
    );

    await transaction.commit();
    transaction = null;

    return res.json({
      success: true,
      message: "تم تحديث الموقف الأمني بنجاح.",
      national_id_number: nationalId,
      old_status: oldStatus,
      security_status: finalStatus,
      notes: updatedNotes,
      synchronization,
    });
  } catch (error) {
    await rollbackSafely(transaction);

    return sendServerError(res, error, "تحديث موقف المنسق الأمني");
  }
}

/* -------------------------------------------------------------------------- */
/* GET /security                                                              */
/* كل شخص يظهر مرة واحدة مع تجميع جميع الوقائع والتصاريح                      */
/* -------------------------------------------------------------------------- */

export async function getSecurityRecords(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE),
    );

    const offset = (page - 1) * limit;

    if (!Number.isSafeInteger(offset) || offset > 2147483647) {
      return res.status(400).json({
        success: false,
        message: "رقم الصفحة كبير جدًا.",
      });
    }

    const search = clean(req.query.search);
    const job = clean(req.query.job);
    const status = clean(req.query.status);
    const fileType = clean(req.query.file_type);

    const pool = await retailPoolPromise;
    const request = pool.request();

    request.input(
      "search",
      sql.NVarChar(255),
      search ? `%${search}%` : null,
    );

    request.input("job", sql.NVarChar(100), job);
    request.input("status", sql.NVarChar(50), status);
    request.input("fileType", sql.NVarChar(100), fileType);
    request.input("offset", sql.Int, offset);
    request.input("limit", sql.Int, limit);

    const result = await request.query(`
      ;WITH PersonRecords AS (
        SELECT
          p.id,
          p.id AS person_id,
          p.id AS serial_number,

          p.name,
          p.national_id_number,
          p.birth_date,
          p.birth_place,
          p.job,

          p.company_id,
          p.company_display_name,

          p.advertising_company_id,
          p.advertising_company_name,

          p.governorate,
          p.branch AS person_branch,
          p.branch_name,

          COALESCE(
            NULLIF(LTRIM(RTRIM(p.security_situation)), N''),
            N'غير محدد'
          ) AS security_situation,

          ISNULL(inc.incident_count, 0) AS total_incidents,
          ISNULL(per.permit_count, 0) AS total_permits,

          /* العميل نوع ملفه 25 دائمًا، حتى بدون وجود واقعة. */
          CASE
            WHEN LTRIM(RTRIM(ISNULL(p.job, N''))) = N'عميل'
              THEN N'25'

            WHEN ISNULL(inc.incident_count, 0) > 0
             AND ISNULL(per.permit_count, 0) > 0
              THEN N'25، مناديب/ منسقين'

            WHEN ISNULL(inc.incident_count, 0) > 0
              THEN N'25'

            WHEN ISNULL(per.permit_count, 0) > 0
              THEN N'مناديب/ منسقين'

            ELSE COALESCE(
              NULLIF(LTRIM(RTRIM(p.file_type)), N''),
              N'غير محدد'
            )
          END AS file_type,

          CASE
            WHEN LTRIM(RTRIM(ISNULL(p.job, N''))) = N'عميل'
              THEN N'عميل'

            WHEN ISNULL(inc.incident_count, 0) > 0
             AND ISNULL(per.permit_count, 0) > 0
              THEN N'واقعة وتصريح'

            WHEN ISNULL(inc.incident_count, 0) > 0
              THEN N'واقعة'

            WHEN ISNULL(per.permit_count, 0) > 0
              THEN N'تصريح'

            ELSE N'شخص'
          END AS record_type_name,

          N'person' AS record_type,

          inc.incidents_json,
          per.permits_json,

          inc.incident_ids,
          inc.incident_branch,
          inc.stolen_goods,
          inc.stolen_goods_value,
          inc.incident_dates,
          inc.incident_notes,

          per.permit_ids,
          per.permit_number,
          per.permit_company_name,
          per.permit_issue_dates,
          per.permit_branch,
          per.permit_notes,

          CONCAT_WS(
            NCHAR(13) + NCHAR(10),
            NULLIF(LTRIM(RTRIM(p.notes)), N''),
            NULLIF(inc.incident_notes, N''),
            NULLIF(per.permit_notes, N'')
          ) AS notes,

          CASE
            WHEN inc.latest_incident_date IS NULL
              THEN per.latest_permit_date

            WHEN per.latest_permit_date IS NULL
              THEN inc.latest_incident_date

            WHEN inc.latest_incident_date >= per.latest_permit_date
              THEN inc.latest_incident_date

            ELSE per.latest_permit_date
          END AS record_date

        FROM dbo.security_persons p

        OUTER APPLY (
          SELECT
            COUNT(*) AS incident_count,

            MAX(i.incident_date) AS latest_incident_date,

            (
              SELECT
                i2.id,
                i2.security_person_id,
                i2.branch,
                i2.stolen_goods,
                i2.stolen_goods_value,
                i2.incident_date,
                i2.notes,
                N'25' AS file_type,
                N'incident' AS record_type
              FROM dbo.security_incidents i2
              WHERE i2.security_person_id = p.id
              ORDER BY
                i2.incident_date DESC,
                i2.id DESC
              FOR JSON PATH
            ) AS incidents_json,

            STRING_AGG(
              CAST(i.id AS NVARCHAR(MAX)),
              N'، '
            ) AS incident_ids,

            STRING_AGG(
              CAST(i.branch AS NVARCHAR(MAX)),
              NCHAR(13) + NCHAR(10)
            ) AS incident_branch,

            STRING_AGG(
              CAST(i.stolen_goods AS NVARCHAR(MAX)),
              NCHAR(13) + NCHAR(10)
            ) AS stolen_goods,

            STRING_AGG(
              CAST(i.stolen_goods_value AS NVARCHAR(MAX)),
              NCHAR(13) + NCHAR(10)
            ) AS stolen_goods_value,

            STRING_AGG(
              CONVERT(NVARCHAR(10), i.incident_date, 23),
              NCHAR(13) + NCHAR(10)
            ) AS incident_dates,

            STRING_AGG(
              CAST(
                NULLIF(LTRIM(RTRIM(i.notes)), N'')
                AS NVARCHAR(MAX)
              ),
              NCHAR(13) + NCHAR(10)
            ) AS incident_notes

          FROM dbo.security_incidents i
          WHERE i.security_person_id = p.id
        ) inc

        OUTER APPLY (
          SELECT
            COUNT(*) AS permit_count,

            MAX(pm.issue_date) AS latest_permit_date,

            (
              SELECT
                pm2.id,
                pm2.security_person_id,
                pm2.permit_number,
                pm2.company_name,
                pm2.issue_date,
                pm2.branch,
                pm2.notes,
                N'مناديب/ منسقين' AS file_type,
                N'permit' AS record_type
              FROM dbo.security_permits pm2
              WHERE pm2.security_person_id = p.id
              ORDER BY
                pm2.issue_date DESC,
                pm2.id DESC
              FOR JSON PATH
            ) AS permits_json,

            STRING_AGG(
              CAST(pm.permit_number AS NVARCHAR(MAX)),
              NCHAR(13) + NCHAR(10)
            ) AS permit_number,

            STRING_AGG(
              CAST(pm.id AS NVARCHAR(MAX)),
              N'، '
            ) AS permit_ids,

            STRING_AGG(
              CAST(pm.company_name AS NVARCHAR(MAX)),
              NCHAR(13) + NCHAR(10)
            ) AS permit_company_name,

            STRING_AGG(
              CONVERT(NVARCHAR(10), pm.issue_date, 23),
              NCHAR(13) + NCHAR(10)
            ) AS permit_issue_dates,

            STRING_AGG(
              CAST(pm.branch AS NVARCHAR(MAX)),
              NCHAR(13) + NCHAR(10)
            ) AS permit_branch,

            STRING_AGG(
              CAST(
                NULLIF(LTRIM(RTRIM(pm.notes)), N'')
                AS NVARCHAR(MAX)
              ),
              NCHAR(13) + NCHAR(10)
            ) AS permit_notes

          FROM dbo.security_permits pm
          WHERE pm.security_person_id = p.id
        ) per

        WHERE ISNULL(p.is_deleted, 0) = 0
      ),

      FilteredRecords AS (
        SELECT *
        FROM PersonRecords r

        WHERE
          (
            @job IS NULL
            OR LTRIM(RTRIM(ISNULL(r.job, N''))) =
               LTRIM(RTRIM(@job))
          )

          AND (
            @status IS NULL
            OR LTRIM(RTRIM(ISNULL(r.security_situation, N'غير محدد'))) =
               LTRIM(RTRIM(@status))
          )

          /* فلتر نوع الملف 25 يشمل العملاء والوقائع. */
          AND (
            @fileType IS NULL

            OR (
              REPLACE(LTRIM(RTRIM(@fileType)), N' ', N'') = N'25'
              AND (
                LTRIM(RTRIM(ISNULL(r.job, N''))) = N'عميل'
                OR r.total_incidents > 0
              )
            )

            OR (
              REPLACE(LTRIM(RTRIM(@fileType)), N' ', N'')
                = N'مناديب/منسقين'
              AND r.total_permits > 0
            )

            OR (
              REPLACE(LTRIM(RTRIM(@fileType)), N' ', N'')
                = REPLACE(
                    LTRIM(RTRIM(ISNULL(r.file_type, N''))),
                    N' ',
                    N''
                  )
            )
          )

          AND (
            @search IS NULL

            OR ISNULL(r.name, N'') LIKE @search
            OR ISNULL(r.national_id_number, N'') LIKE @search
            OR ISNULL(r.governorate, N'') LIKE @search

            OR CONVERT(NVARCHAR(20), r.person_id) LIKE @search

            OR ISNULL(r.notes, N'') LIKE @search
            OR ISNULL(r.person_branch, N'') LIKE @search
            OR ISNULL(r.branch_name, N'') LIKE @search

            OR ISNULL(r.company_display_name, N'') LIKE @search
            OR ISNULL(r.advertising_company_name, N'') LIKE @search

            OR ISNULL(r.incident_branch, N'') LIKE @search
            OR ISNULL(r.stolen_goods, N'') LIKE @search
            OR ISNULL(r.stolen_goods_value, N'') LIKE @search
            OR ISNULL(r.incident_dates, N'') LIKE @search
            OR ISNULL(r.incident_ids, N'') LIKE @search

            OR ISNULL(r.permit_number, N'') LIKE @search
            OR ISNULL(r.permit_company_name, N'') LIKE @search
            OR ISNULL(r.permit_branch, N'') LIKE @search
            OR ISNULL(r.permit_issue_dates, N'') LIKE @search
            OR ISNULL(r.permit_ids, N'') LIKE @search

            OR ISNULL(r.file_type, N'') LIKE @search
          )
      )

      SELECT
        *,
        COUNT(*) OVER() AS total_count
      FROM FilteredRecords
      ORDER BY
        record_date DESC,
        person_id DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY;
    `);

    const records = (result.recordset || []).map((item) => {
      let incidents = [];
      let permits = [];

      try {
        incidents = item.incidents_json
          ? JSON.parse(item.incidents_json)
          : [];
      } catch {
        incidents = [];
      }

      try {
        permits = item.permits_json
          ? JSON.parse(item.permits_json)
          : [];
      } catch {
        permits = [];
      }

      const {
        incidents_json,
        permits_json,
        total_count,
        ...person
      } = item;

      return {
        ...person,
        incidents,
        permits,
        total_incidents: incidents.length,
        total_permits: permits.length,
      };
    });

    const total = result.recordset?.length
      ? Number(result.recordset[0].total_count)
      : 0;

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    return sendServerError(res, error, "تحميل سجلات الأمن");
  }
}

/* -------------------------------------------------------------------------- */
/* GET /security/national-id/:nationalId                                      */
/* -------------------------------------------------------------------------- */

export async function getSecurityByNationalId(req, res) {
  try {
    const nationalId = clean(req.params.nationalId);

    if (!validNationalId(nationalId)) {
      return res.status(400).json({
        success: false,
        message: "الرقم القومي يجب أن يتكون من 14 رقمًا.",
      });
    }

    const pool = await retailPoolPromise;
    const request = pool.request();

    request.input("nationalId", sql.NVarChar(50), nationalId);

    const result = await request.query(`
      SELECT
        p.*,
        CASE
          WHEN LTRIM(RTRIM(ISNULL(p.job, N''))) = N'عميل'
            THEN N'25'
          ELSE p.file_type
        END AS customer_file_type,
        CASE
          WHEN ISNULL(p.notes, N'') LIKE N'%ممنوع%'
            THEN N'بلوك'
          WHEN REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  ISNULL(p.notes, N''),
                  N' ',
                  N''
                ),
                NCHAR(9),
                N''
              ),
              NCHAR(10),
              N''
            ),
            NCHAR(13),
            N''
          ) LIKE N'%تمأخذجزاءبسبب%'
            THEN N'تحت المراجعة'
          WHEN REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  ISNULL(p.notes, N''),
                  N' ',
                  N''
                ),
                NCHAR(9),
                N''
              ),
              NCHAR(10),
              N''
            ),
            NCHAR(13),
            N''
          ) LIKE N'%لامانع%'
            THEN N'سليم'
          ELSE ISNULL(
            NULLIF(p.security_situation, N''),
            N'غير محدد'
          )
        END AS security_status
      FROM dbo.security_persons p
      WHERE
        p.national_id_number = @nationalId
        AND ISNULL(p.is_deleted, 0) = 0;

      SELECT
        i.id,
        i.security_person_id,
        i.branch,
        i.stolen_goods,
        i.stolen_goods_value,
        i.incident_date,
        i.notes,
        p.security_situation AS security_status,
        N'25' AS file_type,
        N'incident' AS record_type
      FROM dbo.security_incidents i
      INNER JOIN dbo.security_persons p
        ON p.id = i.security_person_id
      WHERE
        p.national_id_number = @nationalId
        AND ISNULL(p.is_deleted, 0) = 0
      ORDER BY i.id DESC;

      SELECT
        pm.id,
        pm.security_person_id,
        pm.permit_number,
        pm.company_name,
        pm.issue_date,
        pm.branch,
        pm.notes,
        p.security_situation AS security_status,
        N'مناديب/ منسقين' AS file_type,
        N'permit' AS record_type
      FROM dbo.security_permits pm
      INNER JOIN dbo.security_persons p
        ON p.id = pm.security_person_id
      WHERE
        p.national_id_number = @nationalId
        AND ISNULL(p.is_deleted, 0) = 0
      ORDER BY pm.id DESC;
    `);

    const person = result.recordsets?.[0]?.[0];

    if (!person) {
      return res.status(404).json({
        success: false,
        message: "لا يوجد سجل نشط بهذا الرقم القومي.",
      });
    }

    // إرجاع file_type = 25 للعميل حتى لو كان السجل قديمًا.
    if (clean(person.job) === "عميل") {
      person.file_type = "25";
    }

    return res.json({
      success: true,
      record: {
        ...person,
        incidents: result.recordsets?.[1] || [],
        permits: result.recordsets?.[2] || [],
      },
    });
  } catch (error) {
    return sendServerError(res, error, "البحث عن السجل");
  }
}

/* -------------------------------------------------------------------------- */
/* POST /security                                                             */
/* -------------------------------------------------------------------------- */


export async function createSecurityRecord(req, res) {
  let transaction;

  try {
    const job = clean(req.body.job);

    // تحديد نوع الملف تلقائيًا حسب الوظيفة
    let fileType = clean(req.body.file_type);

    if (job === "عميل") {
      fileType = "25";
    } else if (
      ["مندوب", "مندوبة", "منسق", "منسقة"].includes(job)
    ) {
      fileType = "مناديب/منسقين";
    }

    // تجهيز البيانات بالقيمة الصحيحة
    const body = {
      ...req.body,
      job,
      file_type: fileType,
    };

    // التحقق من البيانات بعد تصحيح نوع الملف
    const validationError = validateBody(body);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const pool = await retailPoolPromise;

    transaction = new sql.Transaction(pool);

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const nationalId = clean(body.national_id_number);
    const securityStatus = getSecurityStatus(body);

    // التأكد من عدم تكرار الرقم القومي
    const duplicate = await new sql.Request(transaction)
      .input("nationalId", sql.NVarChar(50), nationalId)
      .query(`
        SELECT TOP 1
          id,
          is_deleted
        FROM dbo.security_persons WITH (UPDLOCK, HOLDLOCK)
        WHERE national_id_number = @nationalId;
      `);

    if (duplicate.recordset.length) {
      await rollbackSafely(transaction);
      transaction = null;

      return res.status(409).json({
        success: false,
        message: duplicate.recordset[0].is_deleted
          ? "هذا الرقم القومي مسجل في سجل محذوف. لا يمكن إضافته مرة أخرى."
          : "يوجد سجل مسجل بالفعل بهذا الرقم القومي.",
      });
    }

    // إضافة بيانات الشخص
    const personRequest = new sql.Request(transaction);

    bindPerson(personRequest, body);

    const personResult = await personRequest.query(`
      INSERT INTO dbo.security_persons (
        name,
        national_id_number,
        birth_date,
        birth_place,
        job,
        company_id,
        company_display_name,
        advertising_company_id,
        advertising_company_name,
        branch,
        branch_name,
        governorate,
        file_type,
        security_situation,
        notes,
        is_deleted
      )
      OUTPUT INSERTED.id
      VALUES (
        @name,
        @nationalId,
        @birthDate,
        @birthPlace,
        @job,
        @companyId,
        @companyDisplayName,
        @advertisingCompanyId,
        @advertisingCompanyName,
        @branch,
        @branchName,
        @governorate,
        @fileType,
        @securityStatus,
        @notes,
        0
      );
    `);

    const personId = personResult.recordset[0].id;

    // إضافة الواقعة إن وجدت
    if (hasIncidentData(body)) {
      const incidentRequest = new sql.Request(transaction);

      bindIncident(incidentRequest, body);
      incidentRequest.input("personId", sql.Int, personId);

      await incidentRequest.query(`
        INSERT INTO dbo.security_incidents (
          security_person_id,
          branch,
          stolen_goods,
          stolen_goods_value,
          incident_date,
          notes
        )
        VALUES (
          @personId,
          @incidentBranch,
          @stolenGoods,
          @stolenGoodsValue,
          @incidentDate,
          @incidentNotes
        );
      `);
    }

    // إضافة التصريح إن وجد
    if (hasPermitData(body)) {
      const permitRequest = new sql.Request(transaction);

      bindPermit(permitRequest, body);
      permitRequest.input("personId", sql.Int, personId);

      await permitRequest.query(`
        INSERT INTO dbo.security_permits (
          security_person_id,
          permit_number,
          company_name,
          issue_date,
          branch,
          notes
        )
        VALUES (
          @personId,
          @permitNumber,
          @permitCompanyName,
          @permitIssueDate,
          @permitBranch,
          @permitNotes
        );
      `);
    }

    // مزامنة الموقف الأمني مع جدول المنسقين
    const synchronization =
      await updateCoordinatorStatusInTransaction(
        transaction,
        nationalId,
        securityStatus,
        body.notes,
      );

    await transaction.commit();
    transaction = null;

    return res.status(201).json({
      success: true,
      message: "تمت إضافة السجل بنجاح.",
      id: personId,
      security_status: securityStatus,
      file_type: fileType,
      synchronization,
    });
  } catch (error) {
    await rollbackSafely(transaction);

    if (error.number === 2601 || error.number === 2627) {
      return res.status(409).json({
        success: false,
        message: "الرقم القومي مسجل بالفعل.",
      });
    }

    console.error("createSecurityRecord error:", error);

    return sendServerError(res, error, "إضافة السجل");
  }
}


/* -------------------------------------------------------------------------- */
/* PUT /security/national-id/:nationalId                                      */
/* -------------------------------------------------------------------------- */

export const updateSecurityRecord = async (req, res) => {
  const transaction = new sql.Transaction(await retailPoolPromise);

  try {
    // الرقم القومي المعتمد هو الموجود في URL فقط
    const nationalId = clean(req.params.nationalId);

    if (!nationalId || !validNationalId(nationalId)) {
      return res.status(400).json({
        success: false,
        message: "الرقم القومي غير صحيح",
      });
    }

    // لا نسمح بتغيير الرقم القومي من خلال body
    const body = {
      ...req.body,
      national_id_number: nationalId,
    };

    // التحقق من صحة البيانات
    const validation = validatePersonBody(body, nationalId);

    if (validation) {
      return res.status(400).json({
        success: false,
        message: validation,
      });
    }

    await transaction.begin();

    // البحث عن الشخص باستخدام الرقم القومي الأصلي
    const existingRequest = new sql.Request(transaction);

    existingRequest.input(
      "national_id_number",
      sql.VarChar(14),
      nationalId
    );

    const existingResult = await existingRequest.query(`
      SELECT TOP 1 *
      FROM dbo.security_persons
      WHERE national_id_number = @national_id_number
    `);

    if (!existingResult.recordset.length) {
      await transaction.rollback();

      return res.status(404).json({
        success: false,
        message: "لم يتم العثور على سجل بهذا الرقم القومي",
      });
    }

    const existingPerson = existingResult.recordset[0];

    // تحديث بيانات الشخص دون تغيير الرقم القومي
    const updateRequest = new sql.Request(transaction);

    bindPerson(updateRequest, body);

    updateRequest.input(
      "person_id",
      sql.Int,
      existingPerson.id
    );

    await updateRequest.query(`
      UPDATE dbo.security_persons
      SET
        full_name = @full_name,
        birth_date = @birth_date,
        birth_place = @birth_place,
        job = @job,
        parent_company = @parent_company,
        advertising_company = @advertising_company,
        branch = @branch,
        governorate = @governorate,
        file_type = @file_type,
        security_status = @security_status,
        notes = @notes,
        updated_at = GETDATE()
      WHERE id = @person_id
    `);

    // تسجيل تغيير الموقف الأمني في سجل التاريخ
    await saveStatusHistory(
      transaction,
      existingPerson.id,
      existingPerson.security_status,
      body.security_status,
      req.user?.id || null,
      body.status_note || null
    );

    // مزامنة الموقف الأمني مع جدول المنسقين
    await updateCoordinatorStatusInTransaction(
      transaction,
      nationalId,
      body.security_status
    );

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "تم تحديث بيانات السجل الأمني بنجاح",
      data: {
        id: existingPerson.id,
        national_id_number: nationalId,
        security_status: body.security_status,
      },
    });
  } catch (error) {
    await rollbackSafely(transaction);

    console.error("updateSecurityRecord error:", error);

    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث السجل الأمني",
      error: error.message,
    });
  }
};

/* -------------------------------------------------------------------------- */
/* PUT /security/incidents/:incidentId                                        */
/* -------------------------------------------------------------------------- */

export async function updateSecurityIncident(req, res) {
  const incidentId = Number(req.params.incidentId);

  if (!Number.isSafeInteger(incidentId) || incidentId <= 0) {
    return res.status(400).json({
      success: false,
      message: "رقم الواقعة غير صحيح.",
    });
  }

  const amount = clean(req.body?.value_of_stolen_goods);
  const incidentDate = clean(req.body?.incident_date);

  if (
    amount !== null &&
    (!Number.isFinite(Number(amount)) || Number(amount) < 0)
  ) {
    return res.status(400).json({
      success: false,
      message: "قيمة البضاعة غير صحيحة.",
    });
  }

  if (incidentDate && !parseDate(incidentDate)) {
    return res.status(400).json({
      success: false,
      message: "تاريخ الواقعة غير صحيح.",
    });
  }

  let transaction;

  try {
    const pool = await retailPoolPromise;

    transaction = new sql.Transaction(pool);

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const existing = await new sql.Request(transaction)
      .input("incidentId", sql.Int, incidentId)
      .query(`
        SELECT
          i.id,
          i.security_person_id
        FROM dbo.security_incidents i WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.security_persons p
          ON p.id = i.security_person_id
        WHERE
          i.id = @incidentId
          AND ISNULL(p.is_deleted, 0) = 0;
      `);

    if (!existing.recordset.length) {
      await rollbackSafely(transaction);
      transaction = null;

      return res.status(404).json({
        success: false,
        message: "الواقعة غير موجودة أو الشخص المرتبط بها معطل.",
      });
    }

    const personId = existing.recordset[0].security_person_id;

    const updateRequest = new sql.Request(transaction);

    bindIncident(updateRequest, {
      ...req.body,
      incident_notes: req.body?.incident_notes ?? req.body?.notes,
    });

    updateRequest.input("incidentId", sql.Int, incidentId);
    updateRequest.input("personId", sql.Int, personId);

    await updateRequest.query(`
      UPDATE dbo.security_incidents
      SET
        branch = @incidentBranch,
        stolen_goods = @stolenGoods,
        stolen_goods_value = @stolenGoodsValue,
        incident_date = @incidentDate,
        notes = @incidentNotes
      WHERE
        id = @incidentId
        AND security_person_id = @personId;
    `);

    await transaction.commit();
    transaction = null;

    return res.json({
      success: true,
      message: "تم تعديل الواقعة بنجاح.",
      incident_id: incidentId,
    });
  } catch (error) {
    await rollbackSafely(transaction);

    return sendServerError(res, error, "تعديل الواقعة");
  }
}

/* -------------------------------------------------------------------------- */
/* PUT /security/permits/:permitId                                            */
/* -------------------------------------------------------------------------- */

export async function updateSecurityPermit(req, res) {
  const permitId = Number(req.params.permitId);

  if (!Number.isSafeInteger(permitId) || permitId <= 0) {
    return res.status(400).json({
      success: false,
      message: "رقم التصريح غير صحيح.",
    });
  }

  const permitDate = clean(req.body?.permit_issue_date);

  if (permitDate && !parseDate(permitDate)) {
    return res.status(400).json({
      success: false,
      message: "تاريخ إصدار التصريح غير صحيح.",
    });
  }

  let transaction;

  try {
    const pool = await retailPoolPromise;

    transaction = new sql.Transaction(pool);

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const existing = await new sql.Request(transaction)
      .input("permitId", sql.Int, permitId)
      .query(`
        SELECT
          pm.id,
          pm.security_person_id
        FROM dbo.security_permits pm WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.security_persons p
          ON p.id = pm.security_person_id
        WHERE
          pm.id = @permitId
          AND ISNULL(p.is_deleted, 0) = 0;
      `);

    if (!existing.recordset.length) {
      await rollbackSafely(transaction);
      transaction = null;

      return res.status(404).json({
        success: false,
        message: "التصريح غير موجود أو الشخص المرتبط به معطل.",
      });
    }

    const personId = existing.recordset[0].security_person_id;

    const updateRequest = new sql.Request(transaction);

    bindPermit(updateRequest, {
      ...req.body,
      permit_notes: req.body?.permit_notes ?? req.body?.notes,
    });

    updateRequest.input("permitId", sql.Int, permitId);
    updateRequest.input("personId", sql.Int, personId);

    await updateRequest.query(`
      UPDATE dbo.security_permits
      SET
        permit_number = @permitNumber,
        company_name = @permitCompanyName,
        issue_date = @permitIssueDate,
        branch = @permitBranch,
        notes = @permitNotes
      WHERE
        id = @permitId
        AND security_person_id = @personId;
    `);

    await transaction.commit();
    transaction = null;

    return res.json({
      success: true,
      message: "تم تعديل التصريح بنجاح.",
      permit_id: permitId,
    });
  } catch (error) {
    await rollbackSafely(transaction);

    return sendServerError(res, error, "تعديل التصريح");
  }
}

/* -------------------------------------------------------------------------- */
/* DELETE /security/national-id/:nationalId                                   */
/* -------------------------------------------------------------------------- */

export async function deleteSecurityRecord(req, res) {
  const nationalId = clean(req.params.nationalId);

  if (!validNationalId(nationalId)) {
    return res.status(400).json({
      success: false,
      message: "الرقم القومي يجب أن يتكون من 14 رقمًا.",
    });
  }

  let transaction;

  try {
    const pool = await retailPoolPromise;

    transaction = new sql.Transaction(pool);

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const findResult = await new sql.Request(transaction)
      .input("nationalId", sql.NVarChar(50), nationalId)
      .query(`
        SELECT TOP 1
          id,
          name,
          national_id_number
        FROM dbo.security_persons WITH (UPDLOCK, HOLDLOCK)
        WHERE
          national_id_number = @nationalId
          AND ISNULL(is_deleted, 0) = 0;
      `);

    if (!findResult.recordset.length) {
      await rollbackSafely(transaction);
      transaction = null;

      return res.status(404).json({
        success: false,
        message: "السجل غير موجود أو سبق حذفه.",
      });
    }

    const person = findResult.recordset[0];

    await new sql.Request(transaction)
      .input("personId", sql.Int, person.id)
      .query(`
        UPDATE dbo.security_persons
        SET
          is_deleted = 1,
          updated_at = SYSDATETIME()
        WHERE
          id = @personId
          AND ISNULL(is_deleted, 0) = 0;
      `);

    await transaction.commit();
    transaction = null;

    return res.json({
      success: true,
      message: "تم حذف السجل بنجاح.",
      deleted: {
        id: person.id,
        name: person.name,
        national_id_number: person.national_id_number,
      },
    });
  } catch (error) {
    await rollbackSafely(transaction);

    return sendServerError(res, error, "حذف السجل");
  }
}

/* -------------------------------------------------------------------------- */
/* GET /security/check-national-id/:nationalId                                */
/* -------------------------------------------------------------------------- */

export const checkSecurityNationalId = async (req, res) => {
  try {
    const nationalId = clean(req.params.nationalId);

    if (!validNationalId(nationalId)) {
      return res.status(400).json({
        success: false,
        message: "الرقم القومي يجب أن يتكون من 14 رقمًا.",
      });
    }

    const pool = await retailPoolPromise;

    const result = await pool
      .request()
      .input("nationalId", sql.NVarChar(50), nationalId)
      .query(`
        SELECT TOP 1
          national_id_number,
          security_situation,
          notes
        FROM dbo.security_persons
        WHERE
          LTRIM(RTRIM(national_id_number)) = @nationalId
          AND ISNULL(is_deleted, 0) = 0;
      `);

    const record = result.recordset[0] || null;

    const securityStatus = record
      ? getSecurityStatusFromNotes(
          record.notes,
          record.security_situation,
        )
      : null;

    return res.json({
      success: true,
      exists: Boolean(record),
      blocked: securityStatus === "بلوك",
      security_status: securityStatus,
      notes: record?.notes || "",
    });
  } catch (error) {
    console.error("Check security national ID error:", error);

    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء التحقق من الرقم القومي.",
    });
  }
};
