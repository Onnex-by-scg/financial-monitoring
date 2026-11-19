import { bangkokToday, round2, type ArDebug, type ArInvoice, type ArResponse } from "./ar";

// Made-up AR data (PEAK_USE_SAMPLE=1 in .env.local) for demos and for when PEAK UAT is closed (it only runs Mon–Fri 08:00–22:00 Bangkok time).
// No PEAK calls. Dates are generated relative to today so the aging always looks realistic.

const SAMPLE_ENTITIES = ["BLC", "BPM", "Reseller", "Solar", "THS (Monthly)", "ZSA (Monthly)"];

const CUSTOMERS = [
  "บริษัท สยามกรีนเอนเนอร์ยี จำกัด",
  "บริษัท ไทยโซลาร์รูฟ จำกัด",
  "โรงพยาบาลเมืองใหม่",
  "บริษัท อีสต์เทิร์นพลาสติก จำกัด",
  "มหาวิทยาลัยตัวอย่าง",
  "บริษัท บางนาโลจิสติกส์ จำกัด",
  "นิติบุคคลอาคารชุด ริเวอร์วิว",
  "บริษัท ชลบุรีฟู้ดส์ จำกัด",
  "บริษัท เหนือคลีนเทค จำกัด",
  "บริษัท แสงอรุณรีเทล จำกัด",
  "Demo Joint Venture (Head Office)",
  "บริษัท ภูเก็ตรีสอร์ท จำกัด",
  "บริษัท ราชบุรีสตีล จำกัด",
  "บริษัท อยุธยาออโต้พาร์ท จำกัด",
  "บริษัท โคราชเท็กซ์ไทล์ จำกัด",
  "บริษัท สมุทรสาครแพ็คเกจจิ้ง จำกัด",
];

// Sample projects (a PEAK classification group named โครงการ). The last one has no open invoices on purpose.
const PROJECTS = [
  { code: "PJ001", name: "Solar Rooftop – โรงงานชลบุรี" },
  { code: "PJ002", name: "Solar Rooftop – โรงพยาบาลเมืองใหม่" },
  { code: "PJ003", name: "ESCO Chiller Retrofit" },
  { code: "PJ004", name: "Solar Farm ราชบุรี" },
  { code: "PJ005", name: "LED Retrofit – ห้างแสงอรุณ" },
  { code: "PJ006", name: "Battery Storage Pilot" },
];

// Small deterministic PRNG so each entity's sample is stable between reloads.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function sampleData(entityCode: string | null): ArResponse {
  const entity = SAMPLE_ENTITIES.includes(entityCode ?? "") ? entityCode! : SAMPLE_ENTITIES[0];
  const idx = SAMPLE_ENTITIES.indexOf(entity);
  const rand = rng(idx * 7919 + 17);
  const asOf = bangkokToday();
  const prefix = entity.slice(0, 2).toUpperCase();

  const count = 16 + Math.floor(rand() * 14);
  const invoices: ArInvoice[] = [];
  for (let i = 0; i < count; i++) {
    const customerIdx = Math.floor(rand() * CUSTOMERS.length);
    const credit = [15, 30, 30, 30, 45, 60][Math.floor(rand() * 6)];
    // Skew toward recent invoices, with a tail of older ones.
    const age = Math.floor(Math.pow(rand(), 1.8) * 140);
    const issuedDate = addDays(asOf, -age);
    const dueDate = addDays(issuedDate, credit);
    const net = round2((10 + Math.floor(rand() * 340)) * 1000 + Math.floor(rand() * 100) * 10);
    const partly = rand() < 0.2;
    const ym = issuedDate.slice(2, 4) + issuedDate.slice(5, 7);
    invoices.push({
      code: `IV-${prefix}-${ym}${String(100 + i).padStart(5, "0")}`,
      contactCode: `C${String(90000 + customerIdx * 137).padStart(6, "0")}`,
      contactName: CUSTOMERS[customerIdx],
      reference: rand() < 0.4 ? `PO-${2600 + Math.floor(rand() * 90)}` : "",
      issuedDate,
      dueDate,
      netAmount: net,
      remainAmount: partly ? round2(net * 0.7) : net,
      link: null,
      projects: sampleProjects(rand),
    });
  }

  return {
    entity,
    entityName: entity,
    entities: SAMPLE_ENTITIES.map((e) => ({ id: e, name: e, provider: "peak" as const })),
    businessName: "Sample data",
    source: "sample",
    asOf,
    fetchedAt: new Date().toISOString(),
    invoices,
    projects: { groupName: "โครงการ", items: PROJECTS, note: null },
    warnings: [],
    debug: sampleDebug(invoices),
  };
}

// About 1 in 5 invoices has no project, and 1 in 8 is split 60/40 between two.
function sampleProjects(rand: () => number): ArInvoice["projects"] {
  const r = rand();
  if (r < 0.2) return [];
  const a = PROJECTS[Math.floor(rand() * 5)];
  if (r > 0.875) {
    const b = PROJECTS[(PROJECTS.indexOf(a) + 1) % 5];
    return [{ ...a, percent: 60 }, { ...b, percent: 40 }];
  }
  return [{ ...a, percent: 100 }];
}

// Same shape as the PEAK debug info, with fields written the way PEAK sends them (yyyyMMdd dates).
function sampleDebug(invoices: ArInvoice[]): ArDebug {
  const peakDate = (iso: string) => iso.replace(/-/g, "");
  return {
    provider: "peak",
    baseUrl: null,
    servedFromCache: false,
    calls: [],
    raw: Object.fromEntries(
      invoices.map((i) => [
        i.code,
        {
          remainSource: "detail" as const,
          fields: {
            code: i.code,
            issuedDate: peakDate(i.issuedDate),
            dueDate: peakDate(i.dueDate),
            contactCode: i.contactCode,
            reference: i.reference,
            status: "Approve",
            netAmount: i.netAmount,
            paymentAmount: round2(i.netAmount - i.remainAmount),
            remainAmount: i.remainAmount,
          },
        },
      ]),
    ),
  };
}
