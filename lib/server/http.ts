import { NextResponse } from "next/server";

export function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
