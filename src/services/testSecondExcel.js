
import XlsxPopulate from "xlsx-populate";

const file = "D:\\مندوبين.xlsx";

async function test() {
  for (const password of ["26288", undefined]) {
    try {
      console.log("Testing password:", password ? "26288" : "none");

      const workbook = await XlsxPopulate.fromFileAsync(
        file,
        password ? { password } : {}
      );

      console.log("SUCCESS");
      console.log(
        workbook.sheets().map((sheet) => sheet.name())
      );

      return;
    } catch (error) {
      console.log("FAILED:", error.message);
      console.log(error.stack);
    }
  }
}

test();
