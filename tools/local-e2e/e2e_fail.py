"""실패·환불·다시 하기, 비상 스위치 시험."""
import asyncio, base64, re, subprocess, urllib.request, json, time, pathlib, uuid
from playwright.async_api import async_playwright, expect
from e2e import new_ctx, BASE, ERRORS, shot, wait_ready, USERS, session_cookie, LIBRARY_SUBJECT, make_pdf

PSQL = ["psql", "-d", "kokapp", "-tA", "-c"]  # PGHOST·PGPORT·PGUSER 환경변수를 따른다


def sql(q):
    return subprocess.run(PSQL + [q], capture_output=True, text=True, check=True).stdout.strip()


def fake(path):
    return urllib.request.urlopen("http://localhost:54321" + path).read().decode()


async def main():
    subprocess.run(["bash", str(pathlib.Path(__file__).parent / "db.sh"), "reset"], check=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx, page = await new_ctx(b, "student")
        # 가입 확인
        await page.goto(BASE + "/welcome")
        await page.get_by_role("button", name="모두 동의").click()
        await page.get_by_label(re.compile("콕에서 쓸 이름")).fill("실패시험")
        await page.get_by_label("과목 이름").fill("과학")
        await page.get_by_role("button", name="시작하기").click()
        await page.wait_for_url(LIBRARY_SUBJECT)

        print("· quiz step fails 3 times → error + refund")
        fake("/__fail?task=quiz")
        box = page.get_by_role("dialog", name="자료 넣기").get_by_label("공부한 내용")
        await box.fill("광합성은 엽록체에서 일어난다. 재료는 물과 이산화탄소이고 결과물은 포도당과 산소다.")
        await box.press("Enter")
        await expect(page.locator("main a[href^='/notes/']").first).to_be_visible(timeout=15000)
        await expect(page.get_by_text("멈췄어요 · 에너지는 돌려줬어요")).to_be_visible(timeout=60000)
        await shot(page, "40-failed-card", full=False)
        await page.locator("main a[href^='/notes/']").first.click()
        await page.wait_for_url("**/notes/*")
        await expect(page.get_by_text("정리하다가 멈췄어요")).to_be_visible(timeout=60000)
        await shot(page, "40-failed", full=False)
        sid = page.url.rstrip("/").split("/")[-1]
        refund = sql(f"select coalesce(sum(energy),0) from public.energy_ledger where source_id = '{sid}' and task = 'refund'")
        total = sql(f"select coalesce(sum(energy),0) from public.energy_ledger where source_id = '{sid}'")
        print("   refund", refund, "net", total)
        assert float(refund) < 0 and abs(float(total)) < 0.001, (refund, total)
        print("· retry continues from the failed step")
        fake("/__fail?task=")
        await page.get_by_role("button", name="다시 하기").click()
        assert await wait_ready(page, 60), "retry did not finish"
        steps = sql(f"select string_agg(task, ',' order by id) from public.energy_ledger where source_id = '{sid}'")
        print("   ledger tasks:", steps)
        assert steps.count("organize") == 1, steps  # 정리는 다시 하지 않았다
        await shot(page, "41-after-retry", full=False)

        print("· kill switch")
        actx, apage = await new_ctx(b, "admin", width=1280)
        await apage.goto(BASE + "/welcome")
        await apage.get_by_role("button", name="모두 동의").click()
        await apage.get_by_label(re.compile("콕에서 쓸 이름")).fill("운영자")
        await apage.get_by_label("과목 이름").fill("수학")
        await apage.get_by_role("button", name="시작하기").click()
        await apage.wait_for_url(LIBRARY_SUBJECT)
        await apage.goto(BASE + "/admin")
        apage.once("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await apage.get_by_role("button", name="AI 전체 끄기").click()
        await expect(apage.get_by_role("button", name="AI 다시 켜기")).to_be_visible()
        await page.goto(BASE + "/add")
        composer = page.get_by_role("dialog", name="자료 넣기")
        await expect(composer).to_be_visible()
        await expect(composer.get_by_text("지금은 AI 기능을 잠깐 쉬고 있어요.")).to_be_visible()
        await composer.get_by_label("공부한 내용").fill("AI가 꺼져 있을 때 넣어 보는 글이에요. 보내지면 안 돼요.")
        await expect(composer.get_by_role("button", name="AI 정리 시작")).to_be_disabled()
        # API 도 막힌다
        r = await page.request.post(BASE + "/api/grade", data={"questionId": "00000000-0000-4000-8000-000000000000", "answer": "x"}, headers={"origin": BASE})
        print("   grade when off:", r.status)
        assert r.status in (404, 503), r.status
        await shot(page, "42-ai-off", full=False)
        await apage.get_by_role("button", name="AI 다시 켜기").click()
        await expect(apage.get_by_role("button", name="AI 전체 끄기")).to_be_visible()

        print("· cross-site POST is refused")
        r = await page.request.post(BASE + "/api/coupon", data={"code": "KOK-AAAA-BBBB"}, headers={"origin": "https://evil.example"})
        assert r.status == 403, r.status

        print("· other user cannot touch student's source")
        # 약관 동의를 마친 다른 사용자로 시험해야 '내 것이 아님' 검사까지 간다
        other_id, other_mail = USERS["other"]
        sql(
            "insert into public.profiles (id, email, nickname, consented_at) "
            f"values ('{other_id}', '{other_mail}', '다른사람', now()) "
            "on conflict (id) do update set consented_at = now(), nickname = '다른사람'"
        )
        octx, opage = await new_ctx(b, "other")
        note_id = sql(f"select id from public.notes where source_id = '{sid}'")
        qid = sql(f"select id from public.questions where note_id = '{note_id}' and type in ('short', 'cloze') limit 1")
        checks = [
            ("retry", opage.request.post(BASE + f"/api/sources/{sid}/retry", headers={"origin": BASE}, data={})),
            ("process", opage.request.post(BASE + f"/api/sources/{sid}/process", headers={"origin": BASE}, data={})),
            ("delete", opage.request.delete(BASE + f"/api/sources/{sid}", headers={"origin": BASE})),
            ("quiz", opage.request.post(BASE + f"/api/notes/{note_id}/quiz", headers={"origin": BASE}, data={"action": "preview"})),
            ("visual", opage.request.post(BASE + f"/api/notes/{note_id}/visual", headers={"origin": BASE}, data={"action": "preview"})),
        ]
        if qid:
            checks.append(("grade", opage.request.post(BASE + "/api/grade", headers={"origin": BASE}, data={"questionId": qid, "answer": "x"})))
        for name, req in checks:
            r = await req
            print(f"   other {name}:", r.status)
            assert r.status == 404, (name, r.status)
        assert sql(f"select count(*) from public.sources where id = '{sid}'") == "1"
        assert sql(f"select count(*) from public.energy_ledger where user_id = '{other_id}'") == "0"

        print("· students cannot upload straight to storage (only server-issued slots)")
        student_id, student_mail = USERS["student"]
        tok = json.loads(base64.urlsafe_b64decode(session_cookie(student_id, student_mail)["value"][len("base64-") :] + "=="))["access_token"]
        r = await page.request.post(
            f"http://localhost:54321/storage/v1/object/sources/{student_id}/{uuid.uuid4()}/source.pdf",
            headers={"authorization": f"Bearer {tok}", "apikey": "sb_publishable_fake", "content-type": "application/pdf"},
            data=b"%PDF-1.4 fake",
        )
        print("   direct upload:", r.status)
        assert r.status in (400, 403), r.status
        r = await page.request.post(BASE + "/api/uploads", headers={"origin": BASE}, data={"sourceId": str(uuid.uuid4()), "kind": "image", "files": [{"size": 1000}] * 6})
        assert r.status == 400, r.status  # 무료는 사진 5장까지

        print("· parallel source creation cannot pass the 3-at-once limit")
        subj = sql(f"select id from public.subjects where user_id = '{student_id}' limit 1")
        fake("/__fail?task=organize")  # 정리가 끝나지 않게 붙잡아 둔다
        body = lambda: {"id": str(uuid.uuid4()), "subjectId": subj, "kind": "text", "title": "동시", "text": "동시에 여러 개를 넣어 한도를 넘기려는 시험 글이에요. " * 3, "files": []}
        rs = await asyncio.gather(*[page.request.post(BASE + "/api/sources", headers={"origin": BASE}, data=body()) for _ in range(5)])
        codes = sorted(r.status for r in rs)
        print("   statuses:", codes)
        assert codes.count(200) == 3 and codes.count(429) == 2, codes

        print("· refused while 3 are running → the uploaded files stay, the same files work once a slot frees, a re-send makes no copy")
        sql(f"delete from public.energy_ledger where user_id = '{student_id}'")
        sql("truncate public.rate_hits")
        pdf = make_pdf(2)
        sid4 = str(uuid.uuid4())
        r = await page.request.post(BASE + "/api/uploads", headers={"origin": BASE}, data={"sourceId": sid4, "kind": "pdf", "files": [{"size": len(pdf)}]})
        assert r.status == 200, (r.status, await r.text())
        up = (await r.json())["uploads"][0]
        r = await page.request.put(
            f"http://localhost:54321/storage/v1/object/upload/sign/sources/{up['path']}?token={up['token']}",
            headers={"content-type": "application/pdf"},
            data=pdf,
        )
        assert r.status == 200, (r.status, await r.text())
        create = lambda: page.request.post(
            BASE + "/api/sources",
            headers={"origin": BASE},
            data={"id": sid4, "subjectId": subj, "kind": "pdf", "title": "기다린 PDF", "files": [up["path"]]},
        )
        r = await create()
        body4 = await r.json()
        assert r.status == 429 and body4["error"] == "too_many_running", (r.status, body4)
        sql(f"update public.sources set status = 'error' where user_id = '{student_id}' and title = '동시'")
        r = await create()
        assert r.status == 200, (r.status, await r.text())
        r = await create()
        assert r.status == 409, r.status
        assert sql(f"select count(*) from public.sources where id = '{sid4}'") == "1"
        fake("/__fail?task=")

        print("· rejoining on the day you deleted your account gives no new AI energy")
        r = await opage.request.delete(BASE + "/api/account", headers={"origin": BASE}, data={"confirm": "탈퇴"})
        assert r.status == 200, r.status
        assert sql(f"select count(*) from public.profiles where id = '{other_id}'") == "0"
        # 이메일과 로그인 회사 계정 번호를 남긴다
        assert sql("select count(*) from public.account_tombstones") == "2"
        new_id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        sql(
            "insert into auth.users (id, email, raw_app_meta_data) values "
            f"('{new_id}', '{other_mail}', '{{\"provider\": \"google\"}}')"
        )
        sql(f"update public.profiles set consented_at = now(), nickname = '다시' where id = '{new_id}'")
        new_subj = sql(f"insert into public.subjects (user_id, name) values ('{new_id}', '다시') returning id").splitlines()[0]
        nctx = await b.new_context()
        await nctx.add_cookies([session_cookie(new_id, other_mail)])
        npage = await nctx.new_page()
        r = await npage.request.post(
            BASE + "/api/sources",
            headers={"origin": BASE},
            data={"id": str(uuid.uuid4()), "subjectId": new_subj, "kind": "text", "title": "", "text": "탈퇴하고 바로 다시 가입한 사람의 글이에요. 오늘은 AI가 쉬어야 해요.", "files": []},
        )
        print("   rejoin create:", r.status)
        assert r.status == 429 and "탈퇴한 날" in (await r.text()), (r.status, await r.text())

        print("· a Kakao account without an email is also known again when it rejoins on the same day")
        k_id, k2_id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "ffffffff-ffff-4fff-8fff-ffffffffffff"
        meta = '{\"provider\": \"kakao\", \"provider_id\": \"4242\"}'
        sql(f"insert into auth.users (id, email, raw_app_meta_data) values ('{k_id}', null, '{meta}')")
        sql(f"update public.profiles set consented_at = now(), nickname = '카카오' where id = '{k_id}'")
        assert sql(f"select provider from public.profiles where id = '{k_id}'") == "kakao"
        kctx = await b.new_context()
        await kctx.add_cookies([session_cookie(k_id, None)])
        kpage = await kctx.new_page()
        me = await (await kpage.request.get(BASE + "/api/me")).json()
        assert me["email"] == "" and me["provider"] == "kakao", me
        await kpage.goto(BASE + "/settings")
        await kpage.get_by_text("로그인 계정: 카카오 계정").wait_for()
        before = int(sql("select count(*) from public.account_tombstones"))
        r = await kpage.request.delete(BASE + "/api/account", headers={"origin": BASE}, data={"confirm": "탈퇴"})
        assert r.status == 200, r.status
        # 이메일이 없으니 로그인 회사 계정 번호 하나만
        assert int(sql("select count(*) from public.account_tombstones")) == before + 1
        sql(f"insert into auth.users (id, email, raw_app_meta_data) values ('{k2_id}', null, '{meta}')")
        sql(f"update public.profiles set consented_at = now(), nickname = '다시카카오' where id = '{k2_id}'")
        k_subj = sql(f"insert into public.subjects (user_id, name) values ('{k2_id}', '다시') returning id").splitlines()[0]
        k2ctx = await b.new_context()
        await k2ctx.add_cookies([session_cookie(k2_id, None)])
        k2page = await k2ctx.new_page()
        r = await k2page.request.post(
            BASE + "/api/sources",
            headers={"origin": BASE},
            data={"id": str(uuid.uuid4()), "subjectId": k_subj, "kind": "text", "title": "", "text": "카카오로 탈퇴하고 바로 다시 가입한 사람의 글이에요. 오늘은 AI가 쉬어야 해요.", "files": []},
        )
        print("   kakao rejoin create:", r.status)
        assert r.status == 429 and "탈퇴한 날" in (await r.text()), (r.status, await r.text())
        await b.close()
    print("FAIL-PATH OK")
    if ERRORS:
        print("ERRORS:")
        for e in ERRORS:
            print(" ", e[:300])


if __name__ == "__main__":
    asyncio.run(main())
