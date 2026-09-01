import { execFileSync } from "node:child_process";

const workbookColumns = {
  A: "position",
  B: "runnerName",
  C: "club",
  D: "category",
  E: "categoryPosition",
  F: "finishTime",
  J: "raceNumber",
  L: "genderPosition",
  M: "recordedGenderCategory",
};

function xmlText(value = "") {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function unzipEntry(workbookPath, entry) {
  try {
    return execFileSync("unzip", ["-p", workbookPath, entry], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`Unable to read ${entry} from the workbook: ${error.message}`);
  }
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((text) => xmlText(text[1]))
      .join(""),
  );
}

function attribute(source, name) {
  return source.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
}

function parseRows(xml, sharedStrings) {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = {};
    const populatedCells = rowMatch[1].replace(/<c\b[^>]*\/>/g, "");
    for (const cellMatch of populatedCells.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = attribute(cellMatch[1], "r");
      const column = reference?.match(/^[A-Z]+/)?.[0];
      if (!column || !workbookColumns[column]) continue;

      const rawValue = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (rawValue === undefined) continue;
      row[column] = attribute(cellMatch[1], "t") === "s"
        ? sharedStrings[Number(rawValue)]
        : rawValue;
    }
    return row;
  });
}

function integer(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`${label} is not an integer: ${value}`);
  return number;
}

function excelTime(value) {
  const totalSeconds = Math.round(Number(value) * 24 * 60 * 60);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0 || totalSeconds >= 24 * 60 * 60) {
    throw new Error(`Invalid Excel finish time: ${value}`);
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function extractPublicResults(workbookPath) {
  const sharedStrings = parseSharedStrings(unzipEntry(workbookPath, "xl/sharedStrings.xml"));
  const rows = parseRows(unzipEntry(workbookPath, "xl/worksheets/sheet1.xml"), sharedStrings);

  return rows
    .filter((row) => Number(row.A) > 0 && Number.isInteger(Number(row.A)))
    .map((row) => ({
      year: 2025,
      position: integer(row.A, "Position"),
      raceNumber: integer(row.J, "Race number"),
      runnerName: String(row.B ?? "").trim(),
      club: String(row.C ?? "").trim(),
      category: String(row.D ?? "").trim(),
      categoryPosition: integer(row.E, "Category position"),
      genderPosition: integer(row.L, "Gender position"),
      recordedGenderCategory: String(row.M ?? "").trim(),
      finishTime: excelTime(row.F),
    }));
}
