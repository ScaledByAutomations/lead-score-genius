import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase";

export async function POST(request: Request) {
  const client = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const result = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (result.error) {
      const status = (result.error as { status?: number })?.status;
      const message =
        result.error instanceof Error ? result.error.message : String(result.error);

      if (status === 422 || /already registered/i.test(message)) {
        return NextResponse.json({ error: "Email already registered" }, { status: 409 });
      }

      throw result.error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Signup failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to create user"
    }, { status: 500 });
  }
}
