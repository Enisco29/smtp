import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const user = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const campaign = "20000000-0000-4000-8000-000000000001";
const draft = "30000000-0000-4000-8000-000000000001";
const account = "40000000-0000-4000-8000-000000000001";
let db: PGlite;

async function identity(id = user, role = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${id}', false); select set_config('request.jwt.claim.role', '${role}', false); set role ${role};`);
}
async function owner() { await identity(); }
async function admin() { await db.exec("reset role; select set_config('request.jwt.claim.role', 'service_role', false);"); }
async function claim(retry = false, cutoff = "now()") {
  return db.query<{ draft_id: string; token: string }>(`select * from public.claim_next_email_send('${campaign}', 100, ${retry}, null, ${cutoff})`);
}
async function cooldown() { await admin(); await db.exec("update public.email_send_events set finished_at = now() - interval '20 minutes' where finished_at is not null;"); await owner(); }

describe("SMTP database state machine", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users (id uuid primary key); grant usage on schema auth to authenticated, service_role; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role', true) $$;`);
    for (const file of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()) {
      const sql = readFileSync(`supabase/migrations/${file}`, "utf8").replace("create extension if not exists pgcrypto;", "");
      await db.exec(sql);
    }
  }, 60000);

  beforeEach(async () => {
    await admin();
    await db.exec(`truncate auth.users cascade; update private.smtp_send_policy set daily_limit=100, delay_ms=1000;
      insert into auth.users values ('${user}'), ('${other}');
      update public.profiles set onboarding_completed_at=now();
      insert into public.smtp_accounts (id,user_id,sender_email) values ('${account}','${user}','ada@gmail.com');
      insert into private.smtp_account_secrets (smtp_account_id,encrypted_password) values ('${account}','encrypted-test');
      insert into public.campaigns (id,user_id,name,instructions) values ('${campaign}','${user}','Test campaign','Brief');
      insert into public.recipients (id,campaign_id,email) values ('50000000-0000-4000-8000-000000000001','${campaign}','alex@example.com'), ('50000000-0000-4000-8000-000000000002','${campaign}','excluded@example.com'), ('50000000-0000-4000-8000-000000000003','${campaign}','review@example.com');
      insert into public.email_drafts (id,campaign_id,recipient_id,subject,body,status,content_state,generated_at,approved_at) values
        ('${draft}','${campaign}','50000000-0000-4000-8000-000000000001','Approved','Exact body','approved','generated',now(),now()),
        ('30000000-0000-4000-8000-000000000002','${campaign}','50000000-0000-4000-8000-000000000002','Excluded','Excluded body','excluded','generated',now(),null),
        ('30000000-0000-4000-8000-000000000003','${campaign}','50000000-0000-4000-8000-000000000003','Review','Review body','edited','edited',now(),null);
      select public.start_campaign_sending_admin('${user}','${campaign}','ada@gmail.com','encrypted-test');`);
    await owner();
  });
  afterAll(async () => { await db?.close(); });

  it("claims only approved drafts and serializes concurrent requests", async () => {
    const results = await Promise.all([claim(), claim()]);
    expect(results.flatMap((result) => result.rows)).toHaveLength(1);
    expect(results.flatMap((result) => result.rows)[0].draft_id).toBe(draft);
  });

  it("persists sent content, rejects duplicate completion, and cannot resend", async () => {
    const first = (await claim()).rows[0];
    const result = await db.query(`select public.finalize_email_send('${campaign}','${draft}','${first.token}','sent') as saved`);
    expect(result.rows).toEqual([{ saved: true }]);
    expect((await db.query(`select public.finalize_email_send('${campaign}','${draft}','${first.token}','sent') as saved`)).rows).toEqual([{ saved: false }]);
    await cooldown();
    expect((await claim()).rows).toHaveLength(0);
    expect((await db.query(`select subject,body,sent_at is not null as stamped from public.email_drafts where id='${draft}'`)).rows).toEqual([{ subject: "Approved", body: "Exact body", stamped: true }]);
    await expect(db.query(`select public.edit_email_draft('${draft}',1,'Changed','Changed')`)).rejects.toThrow();
  });

  it("makes interrupted claims uncertain and permanently blocks retries", async () => {
    await claim();
    await admin(); await db.exec(`update public.email_drafts set send_claim_expires_at=now()-interval '1 second' where id='${draft}';`); await owner();
    await db.query(`select public.refresh_campaign_send_state('${campaign}')`);
    expect((await db.query(`select status,send_retryable from public.email_drafts where id='${draft}'`)).rows).toEqual([{ status: "uncertain", send_retryable: false }]);
    await cooldown(); expect((await claim(true)).rows).toHaveLength(0);
  });

  it("halts invalid credentials and permits a same-sender reconnect", async () => {
    const first = (await claim()).rows[0];
    await db.query(`select public.finalize_email_send('${campaign}','${draft}','${first.token}','send_failed','smtp_auth','Reconnect',true)`);
    await expect(claim(true)).rejects.toThrow("Campaign sender unavailable");
    await admin(); await db.query(`select public.reconnect_campaign_smtp_admin('${user}','${campaign}','new-encrypted-password')`); await cooldown();
    expect((await claim(true)).rows).toHaveLength(1);
    expect((await db.query(`select sender_email from public.campaign_senders where campaign_id='${campaign}'`)).rows).toEqual([{ sender_email: "ada@gmail.com" }]);
  });

  it("retries a failure once per confirmed cutoff", async () => {
    const first = (await claim()).rows[0];
    await db.query(`select public.finalize_email_send('${campaign}','${draft}','${first.token}','send_failed','smtp_connection','Connection failed',true)`);
    await cooldown();
    const cutoff = new Date().toISOString();
    const retry = (await claim(true, `'${cutoff}'::timestamptz`)).rows[0];
    expect(retry).toBeDefined();
    await db.query(`select public.finalize_email_send('${campaign}','${draft}','${retry.token}','send_failed','smtp_connection','Connection failed',true)`);
    await cooldown(); expect((await claim(true, `'${cutoff}'::timestamptz`)).rows).toHaveLength(0);
  });

  it("enforces quota from private policy and cannot bypass it through a caller argument", async () => {
    const first = (await claim()).rows[0];
    await db.query(`select public.finalize_email_send('${campaign}','${draft}','${first.token}','send_failed','smtp_connection','Connection failed',true)`);
    await cooldown(); await admin(); await db.exec("update private.smtp_send_policy set daily_limit=1"); await owner();
    await expect(db.query(`select * from public.claim_next_email_send('${campaign}',500,true)`)).rejects.toThrow("Daily sending limit reached");
  });

  it("finish refuses active sends, then preserves remaining drafts and locks review", async () => {
    const first = (await claim()).rows[0];
    await expect(db.query(`select public.finish_campaign('${campaign}')`)).rejects.toThrow("still in progress");
    await db.query(`select public.finalize_email_send('${campaign}','${draft}','${first.token}','sent')`);
    await db.query(`select public.finish_campaign('${campaign}')`);
    expect((await db.query(`select status from public.campaigns where id='${campaign}'`)).rows).toEqual([{ status: "finished" }]);
    expect((await db.query("select count(*)::integer as n from public.email_drafts")).rows).toEqual([{ n: 3 }]);
    await expect(db.query("select public.edit_email_draft('30000000-0000-4000-8000-000000000003',1,'Changed','Changed')")).rejects.toThrow();
  });


  it("rejects late AI results once an approved draft enters delivery", async () => {
    const review = await db.query<{ token: string }>(`select public.claim_review_ai('${draft}',1) as token`);
    await claim();
    await admin();
    const result = await db.query(`select public.complete_review_ai_admin('${user}','${draft}','${review.rows[0].token}',1,'generated','Late subject','Late body') as saved`);
    expect(result.rows).toEqual([{ saved: false }]);
    await owner();
    expect((await db.query(`select subject, body from public.email_drafts where id='${draft}'`)).rows).toEqual([{ subject: "Approved", body: "Exact body" }]);
  });

  it("keeps frozen sender metadata and credentials when account settings change", async () => {
    await admin();
    await db.exec(`update public.smtp_accounts set sender_email='different@gmail.com', sender_name='Different' where id='${account}'; update private.smtp_account_secrets set encrypted_password='different-password' where smtp_account_id='${account}';`);
    expect((await db.query(`select public.get_campaign_smtp_secret_admin('${user}','${campaign}') as secret`)).rows).toEqual([{ secret: "encrypted-test" }]);
    await owner();
    expect((await db.query(`select sender_email from public.campaign_senders where campaign_id='${campaign}'`)).rows).toEqual([{ sender_email: "ada@gmail.com" }]);
  });

  it("completes a fully terminal campaign and retains accurate event totals", async () => {
    await db.query("select public.exclude_email_draft('30000000-0000-4000-8000-000000000003',1)");
    const first = (await claim()).rows[0];
    await db.query(`select public.finalize_email_send('${campaign}','${draft}','${first.token}','send_failed','recipient_rejected','Recipient rejected',false)`);
    expect((await db.query(`select status from public.campaigns where id='${campaign}'`)).rows).toEqual([{ status: "completed_with_errors" }]);
    expect((await db.query("select status, count(*)::integer as n from public.email_drafts group by status order by status")).rows).toEqual([{ status: "excluded", n: 2 }, { status: "send_failed", n: 1 }]);
    expect((await db.query("select attempt_number,status from public.email_send_events")).rows).toEqual([{ attempt_number: 1, status: "send_failed" }]);
  });

  it("isolates owners, protects secrets, and blocks recipient replacement", async () => {
    await expect(db.query(`select public.replace_campaign_recipients('${campaign}','[]'::jsonb)`)).rejects.toThrow();
    await identity(other);
    expect((await db.query("select id from public.email_drafts")).rows).toHaveLength(0);
    expect((await db.query("select campaign_id from public.campaign_senders")).rows).toHaveLength(0);
    expect((await db.query("select id from public.email_send_events")).rows).toHaveLength(0);
    await expect(claim()).rejects.toThrow();
    await expect(db.query("select * from private.campaign_smtp_secrets")).rejects.toThrow();
    await expect(db.query("select send_claim_token from public.email_drafts")).rejects.toThrow();
  });
});
