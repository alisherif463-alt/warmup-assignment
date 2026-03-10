const fs = require("fs");

// ==================== Helper Functions ====================

function parse12HourToSeconds(timeStr) {
    if (!timeStr || typeof timeStr !== "string") return 0;
    const trimmed = timeStr.trim().toLowerCase();
    const parts = trimmed.split(" ");
    if (parts.length !== 2) return 0;
    const [timePart, meridiem] = parts;
    const t = timePart.split(":").map(Number);
    if (t.length !== 3 || t.some((n) => Number.isNaN(n))) return 0;
    let [h, m, s] = t;

    if (meridiem !== "am" && meridiem !== "pm") return 0;

    if (meridiem === "am") {
        if (h === 12) h = 0;
    } else {
        if (h !== 12) h += 12;
    }

    return h * 3600 + m * 60 + s;
}

function parseHmsToSeconds(hms) {
    if (!hms || typeof hms !== "string") return 0;
    const parts = hms.trim().split(":").map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return 0;
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
}

function formatSecondsToHms(totalSeconds) {
    let secs = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(secs / 3600);
    secs -= hours * 3600;
    const minutes = Math.floor(secs / 60);
    secs -= minutes * 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(secs).padStart(2, "0");
    return `${hours}:${mm}:${ss}`;
}

function isDateInEidPeriod(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return false;
    const [yearStr, monthStr, dayStr] = dateStr.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return false;
    if (year !== 2025 || month !== 4) return false;
    return day >= 10 && day <= 30;
}

function getDayNameFromDate(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return null;
    const [yearStr, monthStr, dayStr] = dateStr.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
    const d = new Date(year, month - 1, day);
    if (Number.isNaN(d.getTime())) return null;
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return names[d.getDay()] || null;
}

function safeReadFileLines(path) {
    try {
        const content = fs.readFileSync(path, "utf8");
        if (!content) return [];
        return content.split("\n").map((line) => line.replace(/\r$/, ""));
    } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
    }
}

function writeLines(path, lines) {
    fs.writeFileSync(path, lines.join("\n"), "utf8");
}

function parseShiftLine(line) {
    const parts = line.split(",");
    if (parts.length < 10) return null;
    return {
        driverID: parts[0],
        driverName: parts[1],
        date: parts[2],
        startTime: parts[3],
        endTime: parts[4],
        shiftDuration: parts[5],
        idleTime: parts[6],
        activeTime: parts[7],
        metQuota: parts[8] === "true",
        hasBonus: parts[9] === "true",
    };
}

function stringifyShiftRecord(rec) {
    return [
        rec.driverID,
        rec.driverName,
        rec.date,
        rec.startTime,
        rec.endTime,
        rec.shiftDuration,
        rec.idleTime,
        rec.activeTime,
        rec.metQuota ? "true" : "false",
        rec.hasBonus ? "true" : "false",
    ].join(",");
}

function parseRateLine(line) {
    const parts = line.split(",");
    if (parts.length < 4) return null;
    const basePay = Number(parts[2]);
    const tier = Number(parts[3]);
    if (Number.isNaN(basePay) || Number.isNaN(tier)) return null;
    return {
        driverID: parts[0],
        dayOff: parts[1],
        basePay,
        tier,
    };
}

function getDriverRate(rateFile, driverID) {
    const lines = safeReadFileLines(rateFile);
    for (const line of lines) {
        if (!line.trim()) continue;
        const rate = parseRateLine(line);
        if (!rate) continue;
        if (rate.driverID === driverID) return rate;
    }
    return null;
}

// ============================================================
// Function 1: getShiftDuration(startTime, endTime)
// startTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// endTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// Returns: string formatted as h:mm:ss
// ============================================================
function getShiftDuration(startTime, endTime) {
    const startSec = parse12HourToSeconds(startTime);
    let endSec = parse12HourToSeconds(endTime);

    if (endSec <= startSec) {
        endSec += 24 * 3600;
    }

    return formatSecondsToHms(Math.max(0, endSec - startSec));
}

// ============================================================
// Function 2: getIdleTime(startTime, endTime)
// startTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// endTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// Returns: string formatted as h:mm:ss
// ============================================================
function getIdleTime(startTime, endTime) {
    const DELIVERY_START = 8 * 3600;
    const DELIVERY_END = 22 * 3600;

    const startSec = parse12HourToSeconds(startTime);
    let endSec = parse12HourToSeconds(endTime);

    if (endSec <= startSec) {
        endSec += 24 * 3600;
    }

    const idleBefore = startSec < DELIVERY_START
        ? Math.max(0, Math.min(endSec, DELIVERY_START) - startSec)
        : 0;

    const idleAfter = endSec > DELIVERY_END
        ? Math.max(0, endSec - Math.max(DELIVERY_END, startSec))
        : 0;

    return formatSecondsToHms(Math.max(0, idleBefore + idleAfter));
}

// ============================================================
// Function 3: getActiveTime(shiftDuration, idleTime)
// shiftDuration: (typeof string) formatted as h:mm:ss
// idleTime: (typeof string) formatted as h:mm:ss
// Returns: string formatted as h:mm:ss
// ============================================================
function getActiveTime(shiftDuration, idleTime) {
    const shiftSec = parseHmsToSeconds(shiftDuration);
    const idleSec = parseHmsToSeconds(idleTime);
    return formatSecondsToHms(Math.max(0, shiftSec - idleSec));
}

// ============================================================
// Function 4: metQuota(date, activeTime)
// date: (typeof string) formatted as yyyy-mm-dd
// activeTime: (typeof string) formatted as h:mm:ss
// Returns: boolean
// ============================================================
function metQuota(date, activeTime) {
    const activeSec = parseHmsToSeconds(activeTime);
    const normalQuotaSec = 8 * 3600 + 24 * 60;
    const eidQuotaSec = 6 * 3600;
    const quotaSec = isDateInEidPeriod(date) ? eidQuotaSec : normalQuotaSec;
    return activeSec >= quotaSec;
}

// ============================================================
// Function 5: addShiftRecord(textFile, shiftObj)
// textFile: (typeof string) path to shifts text file
// shiftObj: (typeof object) has driverID, driverName, date, startTime, endTime
// Returns: object with 10 properties or empty object {}
// ============================================================
function addShiftRecord(textFile, shiftObj) {
    const lines = safeReadFileLines(textFile);
    const { driverID, driverName, date, startTime, endTime } = shiftObj;

    for (const line of lines) {
        if (!line.trim()) continue;
        const rec = parseShiftLine(line);
        if (!rec) continue;
        if (rec.driverID === driverID && rec.date === date) {
            return {};
        }
    }

    const shiftDuration = getShiftDuration(startTime, endTime);
    const idle = getIdleTime(startTime, endTime);
    const active = getActiveTime(shiftDuration, idle);
    const quotaMet = metQuota(date, active);

    const newRecord = {
        driverID,
        driverName,
        date,
        startTime,
        endTime,
        shiftDuration,
        idleTime: idle,
        activeTime: active,
        metQuota: quotaMet,
        hasBonus: false,
    };

    const newLine = stringifyShiftRecord(newRecord);

    let lastIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const rec = parseShiftLine(line);
        if (!rec) continue;
        if (rec.driverID === driverID) {
            lastIndex = i;
        }
    }

    if (lastIndex === -1) {
        lines.push(newLine);
    } else {
        lines.splice(lastIndex + 1, 0, newLine);
    }

    writeLines(textFile, lines);
    return newRecord;
}

// ============================================================
// Function 6: setBonus(textFile, driverID, date, newValue)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// date: (typeof string) formatted as yyyy-mm-dd
// newValue: (typeof boolean)
// Returns: nothing (void)
// ============================================================
function setBonus(textFile, driverID, date, newValue) {
    const lines = safeReadFileLines(textFile);
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const rec = parseShiftLine(line);
        if (!rec) continue;
        if (rec.driverID === driverID && rec.date === date) {
            rec.hasBonus = newValue;
            lines[i] = stringifyShiftRecord(rec);
            modified = true;
            break;
        }
    }

    if (modified) {
        writeLines(textFile, lines);
    }
}

// ============================================================
// Function 7: countBonusPerMonth(textFile, driverID, month)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// month: (typeof string) formatted as mm or m
// Returns: number (-1 if driverID not found)
// ============================================================
function countBonusPerMonth(textFile, driverID, month) {
    const targetMonth = parseInt(month, 10);
    if (Number.isNaN(targetMonth)) return -1;

    const lines = safeReadFileLines(textFile);
    let driverExists = false;
    let count = 0;

    for (const line of lines) {
        if (!line.trim()) continue;
        const rec = parseShiftLine(line);
        if (!rec) continue;
        if (rec.driverID !== driverID) continue;

        driverExists = true;
        const recMonth = Number(rec.date.split("-")[1]);
        if (!Number.isNaN(recMonth) && recMonth === targetMonth && rec.hasBonus) {
            count++;
        }
    }

    if (!driverExists) return -1;
    return count;
}

// ============================================================
// Function 8: getTotalActiveHoursPerMonth(textFile, driverID, month)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// month: (typeof number)
// Returns: string formatted as hhh:mm:ss
// ============================================================
function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    const targetMonth = Number(month);
    if (Number.isNaN(targetMonth)) return "0:00:00";

    const lines = safeReadFileLines(textFile);
    let totalSec = 0;

    for (const line of lines) {
        if (!line.trim()) continue;
        const rec = parseShiftLine(line);
        if (!rec) continue;
        if (rec.driverID !== driverID) continue;

        const recMonth = Number(rec.date.split("-")[1]);
        if (!Number.isNaN(recMonth) && recMonth === targetMonth) {
            totalSec += parseHmsToSeconds(rec.activeTime);
        }
    }

    return formatSecondsToHms(totalSec);
}

// ============================================================
// Function 9: getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month)
// textFile: (typeof string) path to shifts text file
// rateFile: (typeof string) path to driver rates text file
// bonusCount: (typeof number) total bonuses for given driver per month
// driverID: (typeof string)
// month: (typeof number)
// Returns: string formatted as hhh:mm:ss
// ============================================================
function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    const targetMonth = Number(month);
    if (Number.isNaN(targetMonth)) return "0:00:00";

    const rate = getDriverRate(rateFile, driverID);
    if (!rate) return "0:00:00";
    const dayOffName = rate.dayOff;

    const lines = safeReadFileLines(textFile);
    let totalQuotaSec = 0;

    for (const line of lines) {
        if (!line.trim()) continue;
        const rec = parseShiftLine(line);
        if (!rec) continue;
        if (rec.driverID !== driverID) continue;

        const recMonth = Number(rec.date.split("-")[1]);
        if (Number.isNaN(recMonth) || recMonth !== targetMonth) continue;

        const dayName = getDayNameFromDate(rec.date);
        if (dayName && dayOffName && dayName === dayOffName) continue;

        const quotaForDay = isDateInEidPeriod(rec.date)
            ? 6 * 3600
            : 8 * 3600 + 24 * 60;

        totalQuotaSec += quotaForDay;
    }

    const reductionSec = Math.max(0, bonusCount * 2 * 3600);
    const requiredSec = Math.max(0, totalQuotaSec - reductionSec);

    return formatSecondsToHms(requiredSec);
}

// ============================================================
// Function 10: getNetPay(driverID, actualHours, requiredHours, rateFile)
// driverID: (typeof string)
// actualHours: (typeof string) formatted as hhh:mm:ss
// requiredHours: (typeof string) formatted as hhh:mm:ss
// rateFile: (typeof string) path to driver rates text file
// Returns: integer (net pay)
// ============================================================
function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    const rate = getDriverRate(rateFile, driverID);
    if (!rate) return 0;

    const { basePay, tier } = rate;
    const actualSec = parseHmsToSeconds(actualHours);
    const requiredSec = parseHmsToSeconds(requiredHours);

    if (actualSec >= requiredSec) return basePay;

    const missingSec = requiredSec - actualSec;
    const missingHours = missingSec / 3600;

    let allowedMissing = 0;
    if (tier === 1) allowedMissing = 50;
    else if (tier === 2) allowedMissing = 20;
    else if (tier === 3) allowedMissing = 10;
    else if (tier === 4) allowedMissing = 3;

    const excessMissing = missingHours - allowedMissing;
    if (excessMissing <= 0) return basePay;

    const billableHours = Math.floor(excessMissing);
    const deductionRate = Math.floor(basePay / 185);
    const deduction = billableHours * deductionRate;

    return basePay - deduction;
}

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
