"""자료 처리 이어 달리기가 끊겨도 잇는지만 따로 (데이터베이스를 비우고 e2e.relay_steps).
사용: python3 e2e_relay.py  (앱: localhost:3000, 가짜 백엔드: localhost:54321)
"""
import asyncio, pathlib, subprocess, sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import e2e  # noqa: E402


async def main():
    subprocess.run(["bash", str(pathlib.Path(__file__).parent / "db.sh"), "reset"], check=True)
    student = e2e.USERS["student"][0]
    e2e.db(f"update public.profiles set nickname = '학생', consented_at = now(), plan = 'pro', pro_until = now() + interval '30 days' where id = '{student}'")
    e2e.db(f"insert into public.subjects (user_id, name, color) values ('{student}', '과학', '#22c55e')")
    await e2e.relay_steps()
    print("\nSTEPS OK:", len(e2e.STEPS))


if __name__ == "__main__":
    asyncio.run(main())
