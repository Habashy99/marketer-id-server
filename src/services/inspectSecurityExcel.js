
import XlsxPopulate from "xlsx-populate";

async function inspectWorkbook() {
  const filePath = process.env.EXCEL_PATH;
  const password = process.env.EXCEL_PASSWORD;

  if (!filePath || !password) {
    throw new Error("EXCEL_PATH and EXCEL_PASSWORD are required.");
  }

const workbook = await XlsxPopulate.fromFileAsync(filePath);

  const sheets = workbook.sheets();

  console.log(`\nFound ${sheets.length} worksheets.\n`);

  for (const sheet of sheets) {
    console.log("==================================");
    console.log(`Sheet: ${sheet.name()}`);

    const usedRange = sheet.usedRange();

    if (!usedRange) {
      console.log("EMPTY SHEET\n");
      continue;
    }

    const rows = usedRange.value();

    if (!rows || rows.length === 0) {
      console.log("EMPTY SHEET\n");
      continue;
    }

    console.log(`Rows detected: ${rows.length}`);
    console.log("First 8 rows:");

    console.dir(rows.slice(0, 8), {
      depth: null,
      maxArrayLength: 30,
    });

    console.log();
  }
}

inspectWorkbook().catch((error) => {
  console.error("Excel inspection failed:", error.message);
  process.exitCode = 1;
});
