import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const data = JSON.parse(fs.readFileSync(path.join(root, "data/november-2026.json"), "utf8"));
const meals = ["breakfast", "lunch", "dinner", "late"];

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const menuRows = [];
for (const day of data.days) {
  const review = new Set(day.review ?? []);
  for (const meal of meals) {
    menuRows.push(
      `(${data.year}, ${data.month}, ${day.day}, ${sqlText(meal)}, ${sqlText(day[meal])}, ${review.has(meal) ? "true" : "false"})`,
    );
  }
}

const seed = `-- เมนูพฤศจิกายน 2026 ถอดจากภาพปฏิทินโรงอาหาร
-- รันซ้ำได้: ไม่ทับเมนูที่แก้ไว้แล้ว
insert into public.menus (year, month, day, meal, dish_text, needs_review) values
${menuRows.join(",\n")}
on conflict (year, month, day, meal) do nothing;
`;

const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
const migration = `${schema.trim()}\n\n${seed}`;
fs.mkdirSync(path.join(root, "supabase/migrations"), { recursive: true });
fs.writeFileSync(path.join(root, "supabase/migrations/20261112000000_init.sql"), migration);
fs.writeFileSync(path.join(root, "supabase/seed.sql"), seed);
fs.writeFileSync(path.join(root, "supabase/setup.sql"), migration);

const csv = ["day,เช้า,เที่ยง,เย็น,ดึก"];
for (const day of data.days) {
  csv.push([day.day, day.breakfast, day.lunch, day.dinner, day.late].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
}
fs.mkdirSync(path.join(root, "public/sample"), { recursive: true });
fs.writeFileSync(path.join(root, "public/sample/november-2026.csv"), `\uFEFF${csv.join("\n")}\n`);
console.log(`wrote ${menuRows.length} menu rows`);
