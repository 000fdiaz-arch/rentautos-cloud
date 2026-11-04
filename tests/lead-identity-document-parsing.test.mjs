import assert from "node:assert/strict";
import { extractLeadIdentityDocumentData } from "../src/leadIdentityDocumentParsing.ts";

const today = new Date("2026-11-04T12:00:00Z");

assert.deepEqual(extractLeadIdentityDocumentData(`
  REPUBLICA DE PANAMA
  4-133-1524
  NOMBRE / NAME
  CHARLINE JISSEL AGUIRRE
  TRUJILLO
  NACIONALIDAD / NATIONALITY
  FECHA DE NACIMIENTO / DATE OF BIRTH
  12/02/2000
  EXPEDICION 25/08/2026   EXPIRACION 25/08/2030
`, today), { cedula: "4-133-1524", birthDate: "2000-02-12", fullName: "CHARLINE JISSEL AGUIRRE TRUJILLO" });

assert.deepEqual(extractLeadIdentityDocumentData(`
  DRIVER LICENSE 8 - 888 - 8888
  BIRTH 3-7-1987
  EXPIRES 03-07-2031
`, today), { cedula: "8-888-8888", birthDate: "1987-07-03", fullName: "" });

assert.deepEqual(extractLeadIdentityDocumentData(`
  9-123-4567
  10/09/2028
  04/05/1992
  10/09/2032
`, today), { cedula: "9-123-4567", birthDate: "1992-05-04", fullName: "" });

assert.deepEqual(extractLeadIdentityDocumentData("documento borroso", today), { cedula: "", birthDate: "", fullName: "" });

assert.deepEqual(extractLeadIdentityDocumentData(`
  LICENCIA DE CONDUCIR
  8-783-2400
  NOMBRE / NAME
  LINDA SUSSIBEL MARTINEZ
  ARIAS DE SANTOS
  NACIONALIDAD / NATIONALITY
  FECHA DE NACIMIENTO / DATE OF BIRTH
  23/02
  1985
`, today), { cedula: "8-783-2400", birthDate: "1985-02-23", fullName: "LINDA SUSSIBEL MARTINEZ ARIAS DE SANTOS" });

console.log("OK lectura de cédula y fecha desde documentos de identidad");
